/**
 * Ship OpenCode Plugin
 *
 * Provides the `ship` tool for Linear task management and stacked changes workflow.
 * Instructions/guidance are handled by the ship-cli skill (.opencode/skill/ship-cli/SKILL.md)
 */

import type { Hooks, Plugin, ToolDefinition } from "@opencode-ai/plugin";
import { tool as createTool } from "@opencode-ai/plugin";
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { sessionTaskMap, trackTask, getTrackedTask, decodeShipToolArgs } from "./compaction.js";

// =============================================================================
// Types & Errors
// =============================================================================

type BunShell = Parameters<Plugin>[0]["$"];

class ShipCommandError extends Data.TaggedError("ShipCommandError")<{
  readonly command: string;
  readonly message: string;
}> {}

class ShipNotConfiguredError extends Data.TaggedError("ShipNotConfiguredError")<{
  readonly reason?: string;
}> {}

class JsonParseError extends Data.TaggedError("JsonParseError")<{
  readonly raw: string;
  readonly cause: unknown;
}> {}

interface ShipStatus {
  configured: boolean;
  teamId?: string;
  teamKey?: string;
  projectId?: string | null;
}

/**
 * Webhook process management - module-level state for persistence across tool calls.
 *
 * Note: We previously attempted using Effect.Ref for state management, but it didn't
 * persist across separate Effect runs (each tool call creates a new runtime/layer).
 * Module-level state is a pragmatic solution for subprocess management.
 *
 * Future consideration: Refactor to use Effect Fibers with Effect.forkDaemon for
 * in-process webhook forwarding, which would allow proper Effect resource management.
 * See BRI-88 for details.
 */
let cleanupRegistered = false;
let processToCleanup: ReturnType<typeof Bun.spawn> | null = null;

const registerProcessCleanup = (proc: ReturnType<typeof Bun.spawn>) => {
  processToCleanup = proc;

  if (!cleanupRegistered) {
    cleanupRegistered = true;

    const cleanup = () => {
      if (processToCleanup && !processToCleanup.killed) {
        processToCleanup.kill();
        processToCleanup = null;
      }
    };

    process.on("exit", cleanup);
    process.on("SIGINT", () => {
      cleanup();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      cleanup();
      process.exit(0);
    });
  }
};

const unregisterProcessCleanup = () => {
  processToCleanup = null;
};

interface ShipSubtask {
  id: string;
  identifier: string;
  title: string;
  state: string;
  stateType: string;
  isDone: boolean;
}

// Milestone types
interface ShipMilestone {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  targetDate?: string | null;
  projectId: string;
  sortOrder: number;
}

interface ShipTask {
  identifier: string;
  title: string;
  description?: string;
  priority: string;
  status: string;
  state?: string;
  labels: string[];
  url: string;
  branchName?: string;
  subtasks?: ShipSubtask[];
  milestoneId?: string | null;
  milestoneName?: string | null;
}

// Stack types
interface StackChange {
  changeId: string;
  commitId: string;
  description: string;
  bookmarks: string[];
  isEmpty: boolean;
  isWorkingCopy: boolean;
}

interface StackStatus {
  isRepo: boolean;
  change?: {
    changeId: string;
    commitId: string;
    description: string;
    bookmarks: string[];
    isEmpty: boolean;
  };
  error?: string;
}

interface StackCreateResult {
  created: boolean;
  changeId?: string;
  bookmark?: string;
  workspace?: {
    name: string;
    path: string;
    created: boolean;
  };
  error?: string;
}

// Workspace types
interface WorkspaceOutput {
  name: string;
  path: string;
  changeId: string;
  description: string;
  isDefault: boolean;
  stackName: string | null;
  taskId: string | null;
}

interface RemoveWorkspaceResult {
  removed: boolean;
  name: string;
  filesDeleted?: boolean;
  error?: string;
}

interface StackDescribeResult {
  updated: boolean;
  changeId?: string;
  description?: string;
  error?: string;
}

interface AbandonedMergedChange {
  changeId: string;
  bookmark?: string;
}

interface StackSyncResult {
  fetched: boolean;
  rebased: boolean;
  trunkChangeId?: string;
  stackSize?: number;
  conflicted?: boolean;
  /** Changes that were auto-abandoned because they were merged */
  abandonedMergedChanges?: AbandonedMergedChange[];
  /** Whether the entire stack was merged and workspace was cleaned up */
  stackFullyMerged?: boolean;
  /** Workspace that was cleaned up (only if stackFullyMerged) */
  cleanedUpWorkspace?: string;
  error?: { tag: string; message: string };
}

interface StackRestackResult {
  restacked: boolean;
  stackSize?: number;
  trunkChangeId?: string;
  conflicted?: boolean;
  error?: string;
}

interface StackSubmitResult {
  pushed: boolean;
  bookmark?: string;
  baseBranch?: string;
  pr?: {
    url: string;
    number: number;
    status: "created" | "updated" | "exists";
  };
  error?: string;
  subscribed?: {
    sessionId: string;
    prNumbers: number[];
  };
}

interface StackSquashResult {
  squashed: boolean;
  intoChangeId?: string;
  description?: string;
  error?: string;
}

interface StackAbandonResult {
  abandoned: boolean;
  changeId?: string;
  newWorkingCopy?: string;
  error?: string;
}

interface StackNavigateResult {
  moved: boolean;
  from?: {
    changeId: string;
    description: string;
  };
  to?: {
    changeId: string;
    description: string;
  };
  error?: string;
}

interface StackUndoResult {
  undone: boolean;
  operation?: string;
  error?: string;
}

interface StackUpdateStaleResult {
  updated: boolean;
  changeId?: string;
  error?: string;
}

interface StackBookmarkResult {
  success: boolean;
  action: "created" | "moved";
  bookmark: string;
  changeId?: string;
  error?: string;
}

interface WebhookStartResult {
  started: boolean;
  pid?: number;
  repo?: string;
  events?: string[];
  error?: string;
}

interface WebhookStopResult {
  stopped: boolean;
  wasRunning: boolean;
  error?: string;
}

interface WebhookSubscribeResult {
  subscribed: boolean;
  sessionId?: string;
  prNumbers?: number[];
  error?: string;
}

interface WebhookUnsubscribeResult {
  unsubscribed: boolean;
  sessionId?: string;
  prNumbers?: number[];
  error?: string;
}

interface WebhookDaemonStatus {
  running: boolean;
  pid?: number;
  repo?: string;
  connectedToGitHub?: boolean;
  subscriptions?: Array<{ sessionId: string; prNumbers: number[] }>;
  uptime?: number;
}

interface WebhookCleanupResult {
  success: boolean;
  removedSessions: string[];
  remainingSessions?: number;
  error?: string;
}

// PR Review types
// Note: This type mirrors ReviewOutput from CLI's review.ts
// Kept separate for plugin isolation (plugin doesn't depend on CLI package)
interface PrReviewOutput {
  prNumber: number;
  prTitle?: string;
  prUrl?: string;
  reviews: Array<{
    id: number;
    author: string;
    state: string;
    body: string;
    submittedAt: string;
  }>;
  codeComments: Array<{
    id: number;
    path: string;
    line: number | null;
    body: string;
    author: string;
    createdAt: string;
    inReplyToId: number | null;
    diffHunk?: string;
  }>;
  conversationComments: Array<{
    id: number;
    body: string;
    author: string;
    createdAt: string;
  }>;
  commentsByFile: Record<
    string,
    Array<{
      line: number | null;
      author: string;
      body: string;
      id: number;
      diffHunk?: string;
    }>
  >;
  error?: string;
}

// =============================================================================
// Shell Service
// =============================================================================

interface ShellService {
  readonly run: (args: string[], cwd?: string) => Effect.Effect<string, ShipCommandError>;
}

const ShellService = Context.GenericTag<ShellService>("ShellService");

/**
 * Create a shell service for running ship commands.
 *
 * @param defaultCwd - Default working directory for commands (from opencode's Instance.directory)
 */
const makeShellService = (_$: BunShell, defaultCwd?: string): ShellService => {
  const getCommand = (): string[] => {
    if (process.env.NODE_ENV === "development") {
      // Use node with tsx loader directly to avoid pnpm re-escaping arguments with newlines
      return ["node", "--import=tsx", "packages/cli/src/bin.ts"];
    }
    return ["ship"];
  };

  /**
   * Schema for validating that a string is valid JSON.
   * Uses Effect's Schema.parseJson() for safe, Effect-native JSON parsing.
   */
  const JsonString = Schema.parseJson();
  const validateJson = Schema.decodeUnknownOption(JsonString);

  /**
   * Extract JSON from CLI output by finding valid JSON object or array.
   *
   * The CLI may output non-JSON content before the actual JSON response (e.g., spinner
   * output, progress messages). Additionally, task descriptions may contain JSON code
   * blocks which could be incorrectly matched if we search from the start.
   *
   * This function finds all potential JSON start positions and validates each candidate
   * using Schema.parseJson(). We prioritize top-level JSON (no leading whitespace) to
   * avoid matching nested objects inside arrays.
   */
  const extractJson = (output: string): string => {
    // Find all potential JSON start positions (lines starting with { or [)
    // The regex captures leading whitespace to distinguish top-level vs nested JSON
    const matches = [...output.matchAll(/^(\s*)([[{])/gm)];
    if (matches.length === 0) {
      return output;
    }

    // Separate top-level matches (no leading whitespace) from nested ones
    const topLevelMatches: Array<{ index: number }> = [];
    const nestedMatches: Array<{ index: number }> = [];

    for (const match of matches) {
      if (match.index === undefined) continue;
      const leadingWhitespace = match[1];
      // Top-level JSON starts at column 0 (no leading whitespace)
      if (leadingWhitespace === "") {
        topLevelMatches.push({ index: match.index });
      } else {
        nestedMatches.push({ index: match.index });
      }
    }

    // Try top-level matches first (most likely to be the actual response)
    // Then fall back to nested matches if needed
    const orderedMatches = [...topLevelMatches, ...nestedMatches];

    for (const match of orderedMatches) {
      const candidate = output.slice(match.index).trim();
      // Validate using Schema.parseJson() - returns Option.some if valid
      if (validateJson(candidate)._tag === "Some") {
        return candidate;
      }
    }

    // Fallback to original output if no valid JSON found
    return output;
  };

  return {
    run: (args: string[], cwd?: string) =>
      Effect.gen(function* () {
        const cmd = getCommand();
        const fullArgs = [...cmd, ...args];
        const workingDir = cwd ?? defaultCwd;

        const result = yield* Effect.tryPromise({
          try: async (signal) => {
            const proc = Bun.spawn(fullArgs, {
              stdout: "pipe",
              stderr: "pipe",
              signal,
              cwd: workingDir, // Use provided cwd or default from opencode
            });

            const [stdout, stderr, exitCode] = await Promise.all([
              new Response(proc.stdout).text(),
              new Response(proc.stderr).text(),
              proc.exited,
            ]);

            return { exitCode, stdout, stderr };
          },
          catch: (e) =>
            new ShipCommandError({
              command: args.join(" "),
              message: `Failed to execute: ${e}`,
            }),
        });

        if (result.exitCode !== 0) {
          return yield* new ShipCommandError({
            command: args.join(" "),
            message: result.stderr || result.stdout,
          });
        }

        if (args.includes("--json")) {
          return extractJson(result.stdout);
        }

        return result.stdout;
      }),
  };
};

// =============================================================================
// Ship Service
// =============================================================================

interface ShipService {
  readonly checkConfigured: () => Effect.Effect<ShipStatus, ShipCommandError | JsonParseError>;
  readonly getReadyTasks: () => Effect.Effect<ShipTask[], ShipCommandError | JsonParseError>;
  readonly getBlockedTasks: () => Effect.Effect<ShipTask[], ShipCommandError | JsonParseError>;
  readonly listTasks: (filter?: {
    status?: string;
    priority?: string;
    mine?: boolean;
  }) => Effect.Effect<ShipTask[], ShipCommandError | JsonParseError>;
  readonly getTask: (taskId: string) => Effect.Effect<ShipTask, ShipCommandError | JsonParseError>;
  readonly startTask: (taskId: string, sessionId?: string) => Effect.Effect<void, ShipCommandError>;
  readonly completeTask: (taskId: string) => Effect.Effect<void, ShipCommandError>;
  readonly createTask: (input: {
    title: string;
    description?: string;
    priority?: string;
    parentId?: string;
  }) => Effect.Effect<ShipTask, ShipCommandError | JsonParseError>;
  readonly updateTask: (
    taskId: string,
    input: {
      title?: string;
      description?: string;
      priority?: string;
      status?: string;
      parentId?: string;
    },
  ) => Effect.Effect<ShipTask, ShipCommandError | JsonParseError>;
  readonly addBlocker: (blocker: string, blocked: string) => Effect.Effect<void, ShipCommandError>;
  readonly removeBlocker: (
    blocker: string,
    blocked: string,
  ) => Effect.Effect<void, ShipCommandError>;
  readonly relateTask: (
    taskId: string,
    relatedTaskId: string,
  ) => Effect.Effect<void, ShipCommandError>;
  // Stack operations - all accept optional workdir for workspace support
  readonly getStackLog: (
    workdir?: string,
  ) => Effect.Effect<StackChange[], ShipCommandError | JsonParseError>;
  readonly getStackStatus: (
    workdir?: string,
  ) => Effect.Effect<StackStatus, ShipCommandError | JsonParseError>;
  readonly createStackChange: (input: {
    message?: string;
    bookmark?: string;
    noWorkspace?: boolean;
    taskId?: string;
    workdir?: string;
  }) => Effect.Effect<StackCreateResult, ShipCommandError | JsonParseError>;
  readonly describeStackChange: (
    input: { message?: string; title?: string; description?: string },
    workdir?: string,
  ) => Effect.Effect<StackDescribeResult, ShipCommandError | JsonParseError>;
  readonly syncStack: (
    workdir?: string,
  ) => Effect.Effect<StackSyncResult, ShipCommandError | JsonParseError>;
  readonly restackStack: (
    workdir?: string,
  ) => Effect.Effect<StackRestackResult, ShipCommandError | JsonParseError>;
  readonly submitStack: (input: {
    draft?: boolean;
    title?: string;
    body?: string;
    subscribe?: string; // OpenCode session ID to subscribe to all stack PRs
    workdir?: string;
  }) => Effect.Effect<StackSubmitResult, ShipCommandError | JsonParseError>;
  readonly squashStack: (
    message: string,
    workdir?: string,
  ) => Effect.Effect<StackSquashResult, ShipCommandError | JsonParseError>;
  readonly abandonStack: (
    changeId?: string,
    workdir?: string,
  ) => Effect.Effect<StackAbandonResult, ShipCommandError | JsonParseError>;
  // Stack navigation
  readonly stackUp: (
    workdir?: string,
  ) => Effect.Effect<StackNavigateResult, ShipCommandError | JsonParseError>;
  readonly stackDown: (
    workdir?: string,
  ) => Effect.Effect<StackNavigateResult, ShipCommandError | JsonParseError>;
  // Stack recovery
  readonly stackUndo: (
    workdir?: string,
  ) => Effect.Effect<StackUndoResult, ShipCommandError | JsonParseError>;
  readonly stackUpdateStale: (
    workdir?: string,
  ) => Effect.Effect<StackUpdateStaleResult, ShipCommandError | JsonParseError>;
  // Stack bookmark
  readonly bookmarkStack: (
    name: string,
    move?: boolean,
    workdir?: string,
  ) => Effect.Effect<StackBookmarkResult, ShipCommandError | JsonParseError>;
  // Webhook operations - use Ref for thread-safe process tracking
  readonly startWebhook: (events?: string) => Effect.Effect<WebhookStartResult, never>;
  readonly stopWebhook: () => Effect.Effect<WebhookStopResult, never>;
  readonly getWebhookStatus: () => Effect.Effect<{ running: boolean; pid?: number }, never>;
  // Daemon-based webhook operations
  readonly getDaemonStatus: () => Effect.Effect<
    WebhookDaemonStatus,
    ShipCommandError | JsonParseError
  >;
  readonly subscribeToPRs: (
    sessionId: string,
    prNumbers: number[],
    serverUrl?: string,
  ) => Effect.Effect<WebhookSubscribeResult, ShipCommandError | JsonParseError>;
  readonly unsubscribeFromPRs: (
    sessionId: string,
    prNumbers: number[],
    serverUrl?: string,
  ) => Effect.Effect<WebhookUnsubscribeResult, ShipCommandError | JsonParseError>;
  readonly cleanupStaleSubscriptions: () => Effect.Effect<
    WebhookCleanupResult,
    ShipCommandError | JsonParseError
  >;
  // Workspace operations - accept optional workdir
  readonly listWorkspaces: (
    workdir?: string,
  ) => Effect.Effect<WorkspaceOutput[], ShipCommandError | JsonParseError>;
  readonly removeWorkspace: (
    name: string,
    deleteFiles?: boolean,
    workdir?: string,
  ) => Effect.Effect<RemoveWorkspaceResult, ShipCommandError | JsonParseError>;
  // Milestone operations
  readonly listMilestones: () => Effect.Effect<ShipMilestone[], ShipCommandError | JsonParseError>;
  readonly getMilestone: (
    milestoneId: string,
  ) => Effect.Effect<ShipMilestone, ShipCommandError | JsonParseError>;
  readonly createMilestone: (input: {
    name: string;
    description?: string;
    targetDate?: string;
  }) => Effect.Effect<ShipMilestone, ShipCommandError | JsonParseError>;
  readonly updateMilestone: (
    milestoneId: string,
    input: { name?: string; description?: string; targetDate?: string },
  ) => Effect.Effect<ShipMilestone, ShipCommandError | JsonParseError>;
  readonly deleteMilestone: (milestoneId: string) => Effect.Effect<void, ShipCommandError>;
  readonly setTaskMilestone: (
    taskId: string,
    milestoneId: string,
  ) => Effect.Effect<ShipTask, ShipCommandError | JsonParseError>;
  readonly unsetTaskMilestone: (
    taskId: string,
  ) => Effect.Effect<ShipTask, ShipCommandError | JsonParseError>;
  // PR review operations
  readonly getPrReviews: (
    prNumber?: number,
    unresolved?: boolean,
    workdir?: string,
  ) => Effect.Effect<PrReviewOutput, ShipCommandError | JsonParseError>;
}

const ShipService = Context.GenericTag<ShipService>("ShipService");

/**
 * Parse JSON with type assertion.
 *
 * Note: This uses a type assertion rather than Schema.decodeUnknown for simplicity.
 * The CLI is the source of truth for these types, and we trust its JSON output.
 * For a more robust solution, consider importing shared schemas from the CLI package.
 *
 * @param raw - Raw JSON string from CLI output
 * @returns Parsed object with asserted type T
 */
const parseJson = <T>(raw: string): Effect.Effect<T, JsonParseError> =>
  Effect.try({
    try: () => {
      const parsed = JSON.parse(raw);
      // Basic runtime validation - ensure we got an object or array
      if (parsed === null || (typeof parsed !== "object" && !Array.isArray(parsed))) {
        throw new Error(`Expected object or array, got ${typeof parsed}`);
      }
      return parsed as T;
    },
    catch: (cause) => new JsonParseError({ raw: raw.slice(0, 500), cause }), // Truncate raw for readability
  });

const makeShipService = Effect.gen(function* () {
  const shell = yield* ShellService;

  const checkConfigured = () =>
    Effect.gen(function* () {
      const output = yield* shell.run(["status", "--json"]);
      return yield* parseJson<ShipStatus>(output);
    });

  const getReadyTasks = () =>
    Effect.gen(function* () {
      const output = yield* shell.run(["task", "ready", "--json"]);
      return yield* parseJson<ShipTask[]>(output);
    });

  const getBlockedTasks = () =>
    Effect.gen(function* () {
      const output = yield* shell.run(["task", "blocked", "--json"]);
      return yield* parseJson<ShipTask[]>(output);
    });

  const listTasks = (filter?: { status?: string; priority?: string; mine?: boolean }) =>
    Effect.gen(function* () {
      const args = ["task", "list", "--json"];
      if (filter?.status) args.push("--status", filter.status);
      if (filter?.priority) args.push("--priority", filter.priority);
      if (filter?.mine) args.push("--mine");

      const output = yield* shell.run(args);
      return yield* parseJson<ShipTask[]>(output);
    });

  const getTask = (taskId: string) =>
    Effect.gen(function* () {
      const output = yield* shell.run(["task", "show", "--json", taskId]);
      return yield* parseJson<ShipTask>(output);
    });

  const startTask = (taskId: string, sessionId?: string) => {
    const args = ["task", "start"];
    if (sessionId) {
      args.push("--session", sessionId);
    }
    args.push(taskId);
    return shell.run(args).pipe(Effect.asVoid);
  };

  const completeTask = (taskId: string) => shell.run(["task", "done", taskId]).pipe(Effect.asVoid);

  const createTask = (input: {
    title: string;
    description?: string;
    priority?: string;
    parentId?: string;
  }) =>
    Effect.gen(function* () {
      const args = ["task", "create", "--json"];
      if (input.description) args.push("--description", input.description);
      if (input.priority) args.push("--priority", input.priority);
      if (input.parentId) args.push("--parent", input.parentId);
      args.push(input.title);

      const output = yield* shell.run(args);
      const response = yield* parseJson<{ task: ShipTask }>(output);
      return response.task;
    });

  const updateTask = (
    taskId: string,
    input: {
      title?: string;
      description?: string;
      priority?: string;
      status?: string;
      parentId?: string;
    },
  ) =>
    Effect.gen(function* () {
      const args = ["task", "update", "--json"];
      if (input.title) args.push("--title", input.title);
      if (input.description) args.push("--description", input.description);
      if (input.priority) args.push("--priority", input.priority);
      if (input.status) args.push("--status", input.status);
      if (input.parentId !== undefined) args.push("--parent", input.parentId);
      args.push(taskId);

      const output = yield* shell.run(args);
      const response = yield* parseJson<{ task: ShipTask }>(output);
      return response.task;
    });

  const addBlocker = (blocker: string, blocked: string) =>
    shell.run(["task", "block", blocker, blocked]).pipe(Effect.asVoid);

  const removeBlocker = (blocker: string, blocked: string) =>
    shell.run(["task", "unblock", blocker, blocked]).pipe(Effect.asVoid);

  const relateTask = (taskId: string, relatedTaskId: string) =>
    shell.run(["task", "relate", taskId, relatedTaskId]).pipe(Effect.asVoid);

  // Stack operations - all accept optional workdir for workspace support
  const getStackLog = (workdir?: string) =>
    Effect.gen(function* () {
      const output = yield* shell.run(["stack", "log", "--json"], workdir);
      return yield* parseJson<StackChange[]>(output);
    });

  const getStackStatus = (workdir?: string) =>
    Effect.gen(function* () {
      const output = yield* shell.run(["stack", "status", "--json"], workdir);
      return yield* parseJson<StackStatus>(output);
    });

  const createStackChange = (input: {
    message?: string;
    bookmark?: string;
    noWorkspace?: boolean;
    taskId?: string;
    workdir?: string;
  }) =>
    Effect.gen(function* () {
      const args = ["stack", "create", "--json"];
      if (input.message) args.push("--message", input.message);
      if (input.bookmark) args.push("--bookmark", input.bookmark);
      if (input.noWorkspace) args.push("--no-workspace");
      if (input.taskId) args.push("--task-id", input.taskId);
      const output = yield* shell.run(args, input.workdir);
      return yield* parseJson<StackCreateResult>(output);
    });

  const describeStackChange = (
    input: { message?: string; title?: string; description?: string },
    workdir?: string,
  ) =>
    Effect.gen(function* () {
      const args = ["stack", "describe", "--json"];
      if (input.message) {
        args.push("--message", input.message);
      } else if (input.title) {
        args.push("--title", input.title);
        if (input.description) {
          args.push("--description", input.description);
        }
      }
      const output = yield* shell.run(args, workdir);
      return yield* parseJson<StackDescribeResult>(output);
    });

  const syncStack = (workdir?: string) =>
    Effect.gen(function* () {
      const output = yield* shell.run(["stack", "sync", "--json"], workdir);
      return yield* parseJson<StackSyncResult>(output);
    });

  const restackStack = (workdir?: string) =>
    Effect.gen(function* () {
      const output = yield* shell.run(["stack", "restack", "--json"], workdir);
      return yield* parseJson<StackRestackResult>(output);
    });

  const submitStack = (input: {
    draft?: boolean;
    title?: string;
    body?: string;
    subscribe?: string;
    workdir?: string;
  }) =>
    Effect.gen(function* () {
      const args = ["stack", "submit", "--json"];
      if (input.draft) args.push("--draft");
      if (input.title) args.push("--title", input.title);
      if (input.body) args.push("--body", input.body);
      if (input.subscribe) args.push("--subscribe", input.subscribe);
      const output = yield* shell.run(args, input.workdir);
      return yield* parseJson<StackSubmitResult>(output);
    });

  const squashStack = (message: string, workdir?: string) =>
    Effect.gen(function* () {
      const output = yield* shell.run(["stack", "squash", "--json", "-m", message], workdir);
      return yield* parseJson<StackSquashResult>(output);
    });

  const abandonStack = (changeId?: string, workdir?: string) =>
    Effect.gen(function* () {
      const args = ["stack", "abandon", "--json"];
      if (changeId) args.push(changeId);
      const output = yield* shell.run(args, workdir);
      return yield* parseJson<StackAbandonResult>(output);
    });

  // Stack navigation
  const stackUp = (workdir?: string) =>
    Effect.gen(function* () {
      const output = yield* shell.run(["stack", "up", "--json"], workdir);
      return yield* parseJson<StackNavigateResult>(output);
    });

  const stackDown = (workdir?: string) =>
    Effect.gen(function* () {
      const output = yield* shell.run(["stack", "down", "--json"], workdir);
      return yield* parseJson<StackNavigateResult>(output);
    });

  // Stack recovery
  const stackUndo = (workdir?: string) =>
    Effect.gen(function* () {
      const output = yield* shell.run(["stack", "undo", "--json"], workdir);
      return yield* parseJson<StackUndoResult>(output);
    });

  const stackUpdateStale = (workdir?: string) =>
    Effect.gen(function* () {
      const output = yield* shell.run(["stack", "update-stale", "--json"], workdir);
      return yield* parseJson<StackUpdateStaleResult>(output);
    });

  // Stack bookmark
  const bookmarkStack = (name: string, move?: boolean, workdir?: string) =>
    Effect.gen(function* () {
      const args = ["stack", "bookmark", "--json"];
      if (move) args.push("--move");
      args.push(name);
      const output = yield* shell.run(args, workdir);
      return yield* parseJson<StackBookmarkResult>(output);
    });

  // Webhook operations - uses module-level processToCleanup for persistence across tool calls

  const startWebhook = (events?: string): Effect.Effect<WebhookStartResult, never> =>
    Effect.gen(function* () {
      // Check if already running using module-level state
      if (processToCleanup && !processToCleanup.killed && processToCleanup.exitCode === null) {
        return {
          started: false,
          error: "Webhook forwarding is already running",
          pid: processToCleanup.pid,
        };
      }

      // Build command
      const cmd = process.env.NODE_ENV === "development" ? ["pnpm", "ship"] : ["ship"];
      const args = [...cmd, "webhook", "forward"];
      if (events) {
        args.push("--events", events);
      }

      // Spawn process with stderr for error reporting, ignore stdout to avoid buffer deadlock
      const proc = Bun.spawn(args, {
        stdout: "ignore",
        stderr: "pipe",
      });

      // Collect stderr output to detect errors
      let stderrOutput = "";
      const stderrReader = (async () => {
        const reader = proc.stderr.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            stderrOutput += decoder.decode(value, { stream: true });
          }
        } catch {
          // Ignore read errors
        }
      })();

      // Wait longer for the process to either:
      // 1. Exit with error (e.g., OpenCode not running)
      // 2. Start successfully and begin forwarding
      yield* Effect.sleep("2 seconds");

      // Check if process exited (indicates an error)
      if (proc.exitCode !== null || proc.killed) {
        // Wait for stderr to be fully read
        yield* Effect.promise(() => stderrReader);
        return {
          started: false,
          error: stderrOutput.trim() || "Process exited immediately",
        };
      }

      // Check stderr for known error patterns (process might still be running but failed)
      const errorPatterns = [
        "OpenCode server is not running",
        "No active OpenCode session",
        "not installed",
        "not authenticated",
        "Permission denied",
      ];

      const hasError = errorPatterns.some((pattern) => stderrOutput.includes(pattern));
      if (hasError) {
        // Kill the process since it's in a bad state
        proc.kill();
        yield* Effect.promise(() => stderrReader);
        return {
          started: false,
          error: stderrOutput.trim(),
        };
      }

      // Register process for cleanup (uses module-level state)
      registerProcessCleanup(proc);

      return {
        started: true,
        pid: proc.pid,
        events: events?.split(",").map((e) => e.trim()) || [
          "pull_request",
          "pull_request_review",
          "issue_comment",
          "check_run",
        ],
      };
    });

  const stopWebhook = (): Effect.Effect<WebhookStopResult, never> =>
    Effect.sync(() => {
      // Use module-level processToCleanup for persistence across Effect runs
      if (!processToCleanup) {
        return {
          stopped: false,
          wasRunning: false,
          error: "No webhook forwarding process is running",
        };
      }

      const wasRunning = !processToCleanup.killed && processToCleanup.exitCode === null;
      if (wasRunning) {
        processToCleanup.kill();
      }
      unregisterProcessCleanup();

      return {
        stopped: wasRunning,
        wasRunning,
      };
    });

  const getWebhookStatus = (): Effect.Effect<{ running: boolean; pid?: number }, never> =>
    Effect.sync(() => {
      // Use module-level processToCleanup for persistence across Effect runs
      if (processToCleanup && !processToCleanup.killed && processToCleanup.exitCode === null) {
        return { running: true, pid: processToCleanup.pid };
      }
      return { running: false };
    });

  // Daemon-based webhook operations - communicate with the webhook daemon via CLI

  const getDaemonStatus = (): Effect.Effect<
    WebhookDaemonStatus,
    ShipCommandError | JsonParseError
  > =>
    Effect.gen(function* () {
      // First check if daemon is running by trying to get status
      const output = yield* shell
        .run(["webhook", "status", "--json"])
        .pipe(Effect.catchAll(() => Effect.succeed('{"running":false}')));
      return yield* parseJson<WebhookDaemonStatus>(output);
    });

  const subscribeToPRs = (
    sessionId: string,
    prNumbers: number[],
    serverUrl?: string,
  ): Effect.Effect<WebhookSubscribeResult, ShipCommandError | JsonParseError> =>
    Effect.gen(function* () {
      const prNumbersStr = prNumbers.join(",");
      const args = ["webhook", "subscribe", "--json", "--session", sessionId];
      if (serverUrl) {
        args.push("--server-url", serverUrl);
      }
      args.push(prNumbersStr);
      const output = yield* shell.run(args);
      return yield* parseJson<WebhookSubscribeResult>(output);
    });

  const unsubscribeFromPRs = (
    sessionId: string,
    prNumbers: number[],
    serverUrl?: string,
  ): Effect.Effect<WebhookUnsubscribeResult, ShipCommandError | JsonParseError> =>
    Effect.gen(function* () {
      const prNumbersStr = prNumbers.join(",");
      const args = ["webhook", "unsubscribe", "--json", "--session", sessionId];
      if (serverUrl) {
        args.push("--server-url", serverUrl);
      }
      args.push(prNumbersStr);
      const output = yield* shell.run(args);
      return yield* parseJson<WebhookUnsubscribeResult>(output);
    });

  // Cleanup stale subscriptions
  const cleanupStaleSubscriptions = (): Effect.Effect<
    WebhookCleanupResult,
    ShipCommandError | JsonParseError
  > =>
    Effect.gen(function* () {
      const output = yield* shell.run(["webhook", "cleanup", "--json"]);
      return yield* parseJson<WebhookCleanupResult>(output);
    });

  // Workspace operations - accept optional workdir
  const listWorkspaces = (
    workdir?: string,
  ): Effect.Effect<WorkspaceOutput[], ShipCommandError | JsonParseError> =>
    Effect.gen(function* () {
      const output = yield* shell.run(["stack", "workspaces", "--json"], workdir);
      return yield* parseJson<WorkspaceOutput[]>(output);
    });

  const removeWorkspace = (
    name: string,
    deleteFiles?: boolean,
    workdir?: string,
  ): Effect.Effect<RemoveWorkspaceResult, ShipCommandError | JsonParseError> =>
    Effect.gen(function* () {
      const args = ["stack", "remove-workspace", "--json"];
      if (deleteFiles) args.push("--delete");
      args.push(name);
      const output = yield* shell.run(args, workdir);
      return yield* parseJson<RemoveWorkspaceResult>(output);
    });

  // Milestone operations
  const listMilestones = (): Effect.Effect<ShipMilestone[], ShipCommandError | JsonParseError> =>
    Effect.gen(function* () {
      const output = yield* shell.run(["milestone", "list", "--json"]);
      return yield* parseJson<ShipMilestone[]>(output);
    });

  const getMilestone = (
    milestoneId: string,
  ): Effect.Effect<ShipMilestone, ShipCommandError | JsonParseError> =>
    Effect.gen(function* () {
      const output = yield* shell.run(["milestone", "show", "--json", milestoneId]);
      return yield* parseJson<ShipMilestone>(output);
    });

  const createMilestone = (input: {
    name: string;
    description?: string;
    targetDate?: string;
  }): Effect.Effect<ShipMilestone, ShipCommandError | JsonParseError> =>
    Effect.gen(function* () {
      const args = ["milestone", "create", "--json"];
      if (input.description) args.push("--description", input.description);
      if (input.targetDate) args.push("--target-date", input.targetDate);
      args.push(input.name);

      const output = yield* shell.run(args);
      const response = yield* parseJson<{ milestone: ShipMilestone }>(output);
      return response.milestone;
    });

  const updateMilestone = (
    milestoneId: string,
    input: { name?: string; description?: string; targetDate?: string },
  ): Effect.Effect<ShipMilestone, ShipCommandError | JsonParseError> =>
    Effect.gen(function* () {
      const args = ["milestone", "update", "--json"];
      if (input.name) args.push("--name", input.name);
      if (input.description) args.push("--description", input.description);
      if (input.targetDate) args.push("--target-date", input.targetDate);
      args.push(milestoneId);

      const output = yield* shell.run(args);
      const response = yield* parseJson<{ milestone: ShipMilestone }>(output);
      return response.milestone;
    });

  const deleteMilestone = (milestoneId: string): Effect.Effect<void, ShipCommandError> =>
    shell.run(["milestone", "delete", milestoneId]).pipe(Effect.asVoid);

  const setTaskMilestone = (
    taskId: string,
    milestoneId: string,
  ): Effect.Effect<ShipTask, ShipCommandError | JsonParseError> =>
    Effect.gen(function* () {
      const args = ["task", "update", "--json", "--milestone", milestoneId, taskId];
      const output = yield* shell.run(args);
      const response = yield* parseJson<{ task: ShipTask }>(output);
      return response.task;
    });

  const unsetTaskMilestone = (
    taskId: string,
  ): Effect.Effect<ShipTask, ShipCommandError | JsonParseError> =>
    Effect.gen(function* () {
      // Empty string removes milestone
      const args = ["task", "update", "--json", "--milestone", "", taskId];
      const output = yield* shell.run(args);
      const response = yield* parseJson<{ task: ShipTask }>(output);
      return response.task;
    });

  // PR reviews operations
  const getPrReviews = (
    prNumber?: number,
    unresolved?: boolean,
    workdir?: string,
  ): Effect.Effect<PrReviewOutput, ShipCommandError | JsonParseError> =>
    Effect.gen(function* () {
      const args = ["pr", "reviews", "--json"];
      if (unresolved) args.push("--unresolved");
      if (prNumber !== undefined) args.push(String(prNumber));
      const output = yield* shell.run(args, workdir);
      return yield* parseJson<PrReviewOutput>(output);
    });

  return {
    checkConfigured,
    getReadyTasks,
    getBlockedTasks,
    listTasks,
    getTask,
    startTask,
    completeTask,
    createTask,
    updateTask,
    addBlocker,
    removeBlocker,
    relateTask,
    getStackLog,
    getStackStatus,
    createStackChange,
    describeStackChange,
    syncStack,
    restackStack,
    submitStack,
    squashStack,
    abandonStack,
    stackUp,
    stackDown,
    stackUndo,
    stackUpdateStale,
    bookmarkStack,
    startWebhook,
    stopWebhook,
    getWebhookStatus,
    getDaemonStatus,
    subscribeToPRs,
    unsubscribeFromPRs,
    cleanupStaleSubscriptions,
    listWorkspaces,
    removeWorkspace,
    listMilestones,
    getMilestone,
    createMilestone,
    updateMilestone,
    deleteMilestone,
    setTaskMilestone,
    unsetTaskMilestone,
    getPrReviews,
  } satisfies ShipService;
});

// =============================================================================
// Formatters
// =============================================================================

const formatTaskList = (tasks: ShipTask[]): string =>
  tasks
    .map((t) => {
      const priority = t.priority === "urgent" ? "[!]" : t.priority === "high" ? "[^]" : "   ";
      return `${priority} ${t.identifier.padEnd(10)} ${(t.state || t.status).padEnd(12)} ${t.title}`;
    })
    .join("\n");

const formatTaskDetails = (task: ShipTask): string => {
  let output = `# ${task.identifier}: ${task.title}

**Status:** ${task.state || task.status}
**Priority:** ${task.priority}
**Labels:** ${task.labels.length > 0 ? task.labels.join(", ") : "none"}
**URL:** ${task.url}`;

  if (task.branchName) {
    output += `\n**Branch:** ${task.branchName}`;
  }

  if (task.description) {
    output += `\n\n## Description\n\n${task.description}`;
  }

  if (task.subtasks && task.subtasks.length > 0) {
    output += `\n\n## Subtasks\n`;
    for (const subtask of task.subtasks) {
      const statusIndicator = subtask.isDone ? "[x]" : "[ ]";
      output += `\n${statusIndicator} ${subtask.identifier}: ${subtask.title} (${subtask.state})`;
    }
  }

  return output;
};

// =============================================================================
// Tool Actions
// =============================================================================

type ToolArgs = {
  action: string;
  taskId?: string;
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  blocker?: string;
  blocked?: string;
  relatedTaskId?: string;
  parentId?: string; // For creating subtasks
  filter?: {
    status?: string;
    priority?: string;
    mine?: boolean;
  };
  // Stack-specific args
  message?: string;
  bookmark?: string;
  draft?: boolean;
  body?: string;
  changeId?: string;
  move?: boolean; // For stack-bookmark to move instead of create
  // Workspace-specific args
  noWorkspace?: boolean; // For stack-create to skip workspace creation
  name?: string; // For remove-workspace (workspace name)
  deleteFiles?: boolean; // For remove-workspace
  workdir?: string; // Working directory for VCS operations (for jj workspaces)
  // Webhook-specific args
  events?: string;
  // Daemon webhook subscription args
  sessionId?: string;
  prNumbers?: number[];
  // PR review args
  prNumber?: number;
  unresolved?: boolean;
  // Milestone-specific args
  milestoneId?: string;
  milestoneName?: string;
  milestoneDescription?: string;
  milestoneTargetDate?: string;
};

/**
 * Context passed to action handlers for generating guidance.
 */
interface ActionContext {
  /** OpenCode session ID for webhook subscriptions */
  sessionId?: string;
  /** Main repository path (default workspace location) */
  mainRepoPath: string;
  /** OpenCode server URL for webhook routing (e.g., http://127.0.0.1:4097) */
  serverUrl?: string;
}

/**
 * Options for the addGuidance helper function.
 */
interface GuidanceOptions {
  /** Explicit working directory path (shown when workspace changes) */
  workdir?: string;
  /** Whether to show skill reminder */
  skill?: boolean;
  /** Contextual note/message */
  note?: string;
}

/**
 * Helper function to format guidance blocks consistently.
 * Reduces repetition and ensures consistent format across all actions.
 *
 * @param next - Suggested next actions (e.g., "action=done | action=ready")
 * @param opts - Optional workdir, skill reminder, and note
 * @returns Formatted guidance string to append to command output
 */
const addGuidance = (next: string, opts?: GuidanceOptions): string => {
  let g = `\n---\nNext: ${next}`;
  if (opts?.workdir) g += `\nWorkdir: ${opts.workdir}`;
  if (opts?.skill) g += `\nIMPORTANT: Load skill first → skill(name="ship-cli")`;
  if (opts?.note) g += `\nNote: ${opts.note}`;
  return g;
};

/**
 * Action handlers for the ship tool.
 * Each handler returns an Effect that produces a formatted string result.
 *
 * Using a record of handlers provides:
 * - Cleaner separation of action logic
 * - No fall-through bugs
 * - Easier to add new actions
 * - Each handler is self-contained
 */
type ActionHandler = (
  ship: ShipService,
  args: ToolArgs,
  context: ActionContext,
) => Effect.Effect<string, ShipCommandError | JsonParseError, never>;

const actionHandlers: Record<string, ActionHandler> = {
  status: (ship, _args, _ctx) =>
    Effect.gen(function* () {
      const status = yield* ship.checkConfigured();
      if (status.configured) {
        const guidance = addGuidance("action=ready (find tasks to work on)", { skill: true });
        return `Ship is configured.\n\nTeam: ${status.teamKey}\nProject: ${status.projectId || "none"}${guidance}`;
      }
      return "Ship is not configured. Run 'ship init' first.";
    }),

  ready: (ship, _args, _ctx) =>
    Effect.gen(function* () {
      const tasks = yield* ship.getReadyTasks();
      if (tasks.length === 0) {
        const guidance = addGuidance(
          "action=blocked (check blocked tasks) | action=create (create a new task)",
          { skill: true },
        );
        return `No tasks ready to work on (all tasks are either blocked or completed).${guidance}`;
      }
      const guidance = addGuidance("action=start (begin working on a task)", { skill: true });
      return `Ready tasks (no blockers):\n\n${formatTaskList(tasks)}${guidance}`;
    }),

  blocked: (ship, _args, _ctx) =>
    Effect.gen(function* () {
      const tasks = yield* ship.getBlockedTasks();
      if (tasks.length === 0) {
        const guidance = addGuidance("action=ready (check ready tasks)");
        return `No blocked tasks.${guidance}`;
      }
      const guidance = addGuidance(
        "action=show (view task details) | action=unblock (remove blocker)",
      );
      return `Blocked tasks:\n\n${formatTaskList(tasks)}${guidance}`;
    }),

  list: (ship, args, _ctx) =>
    Effect.gen(function* () {
      const tasks = yield* ship.listTasks(args.filter);
      if (tasks.length === 0) {
        const guidance = addGuidance("action=create (create a new task)");
        return `No tasks found matching the filter.${guidance}`;
      }
      const guidance = addGuidance(
        "action=show (view task details) | action=start (begin working)",
      );
      return `Tasks:\n\n${formatTaskList(tasks)}${guidance}`;
    }),

  show: (ship, args, _ctx) =>
    Effect.gen(function* () {
      if (!args.taskId) {
        return "Error: taskId is required for show action";
      }
      const task = yield* ship.getTask(args.taskId);
      const guidance = addGuidance("action=start (begin work) | action=update (modify task)");
      return formatTaskDetails(task) + guidance;
    }),

  start: (ship, args, ctx) =>
    Effect.gen(function* () {
      if (!args.taskId) {
        return "Error: taskId is required for start action";
      }
      yield* ship.startTask(args.taskId, ctx.sessionId);
      const sessionInfo = ctx.sessionId ? ` (labeled with session:${ctx.sessionId})` : "";
      const guidance = addGuidance(
        `action=stack-create with taskId="${args.taskId}" (creates isolated workspace for changes)`,
        {
          skill: true,
          note: "IMPORTANT: Create workspace before making any file changes",
        },
      );
      return `Task ${args.taskId} is now in progress${sessionInfo}.\n\nNext step: Create a workspace to isolate your changes.${guidance}`;
    }),

  done: (ship, args, _ctx) =>
    Effect.gen(function* () {
      if (!args.taskId) {
        return "Error: taskId is required for done action";
      }
      yield* ship.completeTask(args.taskId);
      const guidance = addGuidance(
        "action=ready (find next task) | action=stack-sync (cleanup if in workspace)",
      );
      return `Completed ${args.taskId}${guidance}`;
    }),

  create: (ship, args, _ctx) =>
    Effect.gen(function* () {
      if (!args.title) {
        return "Error: title is required for create action";
      }
      const task = yield* ship.createTask({
        title: args.title,
        description: args.description,
        priority: args.priority,
        parentId: args.parentId,
      });
      const guidance = addGuidance("action=start (begin work) | action=block (add dependencies)");
      if (args.parentId) {
        return `Created subtask ${task.identifier}: ${task.title}\nParent: ${args.parentId}\nURL: ${task.url}${guidance}`;
      }
      return `Created task ${task.identifier}: ${task.title}\nURL: ${task.url}${guidance}`;
    }),

  update: (ship, args, _ctx) =>
    Effect.gen(function* () {
      if (!args.taskId) {
        return "Error: taskId is required for update action";
      }
      if (
        !args.title &&
        !args.description &&
        !args.priority &&
        !args.status &&
        args.parentId === undefined
      ) {
        return "Error: at least one of title, description, priority, status, or parentId is required for update";
      }
      const task = yield* ship.updateTask(args.taskId, {
        title: args.title,
        description: args.description,
        priority: args.priority,
        status: args.status,
        parentId: args.parentId,
      });
      let output = `Updated task ${task.identifier}: ${task.title}`;
      if (args.parentId !== undefined) {
        output += args.parentId === "" ? "\nParent: removed" : `\nParent: ${args.parentId}`;
      }
      output += `\nURL: ${task.url}`;
      const guidance = addGuidance("action=show (verify changes)");
      return output + guidance;
    }),

  block: (ship, args, _ctx) =>
    Effect.gen(function* () {
      if (!args.blocker || !args.blocked) {
        return "Error: both blocker and blocked task IDs are required";
      }
      yield* ship.addBlocker(args.blocker, args.blocked);
      const guidance = addGuidance(
        "action=ready (find unblocked tasks) | action=blocked (view blocked tasks)",
      );
      return `${args.blocker} now blocks ${args.blocked}${guidance}`;
    }),

  unblock: (ship, args, _ctx) =>
    Effect.gen(function* () {
      if (!args.blocker || !args.blocked) {
        return "Error: both blocker and blocked task IDs are required";
      }
      yield* ship.removeBlocker(args.blocker, args.blocked);
      const guidance = addGuidance("action=ready (find unblocked tasks)");
      return `Removed ${args.blocker} as blocker of ${args.blocked}${guidance}`;
    }),

  relate: (ship, args, _ctx) =>
    Effect.gen(function* () {
      if (!args.taskId || !args.relatedTaskId) {
        return "Error: both taskId and relatedTaskId are required for relate action";
      }
      yield* ship.relateTask(args.taskId, args.relatedTaskId);
      const guidance = addGuidance("action=show (view task details)");
      return `Linked ${args.taskId} ↔ ${args.relatedTaskId} as related${guidance}`;
    }),

  "stack-log": (ship, args, _ctx) =>
    Effect.gen(function* () {
      const changes = yield* ship.getStackLog(args.workdir);
      if (changes.length === 0) {
        return "No changes in stack (working copy is on trunk)";
      }
      return `Stack (${changes.length} changes):\n\n${changes
        .map((c) => {
          const marker = c.isWorkingCopy ? "@" : "○";
          const empty = c.isEmpty ? " (empty)" : "";
          const bookmarks = c.bookmarks.length > 0 ? ` [${c.bookmarks.join(", ")}]` : "";
          const desc = c.description.split("\n")[0] || "(no description)";
          return `${marker}  ${c.changeId.slice(0, 8)} ${desc}${empty}${bookmarks}`;
        })
        .join("\n")}`;
    }),

  "stack-status": (ship, args, _ctx) =>
    Effect.gen(function* () {
      const status = yield* ship.getStackStatus(args.workdir);
      if (!status.isRepo) {
        return `Error: ${status.error || "Not a jj repository"}`;
      }
      if (!status.change) {
        return "Error: Could not get current change";
      }
      const c = status.change;
      let output = `Change:      ${c.changeId.slice(0, 8)}
Commit:      ${c.commitId.slice(0, 12)}
Description: ${c.description.split("\n")[0] || "(no description)"}`;
      if (c.bookmarks.length > 0) {
        output += `\nBookmarks:   ${c.bookmarks.join(", ")}`;
      }
      output += `\nStatus:      ${c.isEmpty ? "empty (no changes)" : "has changes"}`;
      const guidance = addGuidance(
        "action=stack-submit (push changes) | action=stack-sync (fetch latest)",
      );
      return output + guidance;
    }),

  "stack-create": (ship, args, _ctx) =>
    Effect.gen(function* () {
      const result = yield* ship.createStackChange({
        message: args.message,
        bookmark: args.bookmark,
        noWorkspace: args.noWorkspace,
        taskId: args.taskId,
        workdir: args.workdir,
      });
      if (!result.created) {
        return `Error: ${result.error || "Failed to create change"}`;
      }
      let output = `Created change: ${result.changeId}`;
      if (result.bookmark) {
        output += `\nCreated bookmark: ${result.bookmark}`;
      }
      if (result.workspace?.created) {
        output += `\nCreated workspace: ${result.workspace.name} at ${result.workspace.path}`;
        const guidance = addGuidance(
          "Implement the task (edit files) | action=stack-status (check change state)",
          {
            workdir: result.workspace.path,
            note: "Workspace created. Use the workdir above for all subsequent commands.",
          },
        );
        output += guidance;
      } else {
        const guidance = addGuidance(
          "Implement the task (edit files) | action=stack-status (check change state)",
        );
        output += guidance;
      }
      return output;
    }),

  "stack-describe": (ship, args, _ctx) =>
    Effect.gen(function* () {
      if (!args.message && !args.title) {
        return "Error: Either message or title is required for stack-describe action";
      }
      const result = yield* ship.describeStackChange(
        { message: args.message, title: args.title, description: args.description },
        args.workdir,
      );
      if (!result.updated) {
        return `Error: ${result.error || "Failed to update description"}`;
      }
      return `Updated change ${result.changeId?.slice(0, 8) || ""}\nDescription: ${result.description || args.title || args.message}`;
    }),

  "stack-sync": (ship, args, ctx) =>
    Effect.gen(function* () {
      const result = yield* ship.syncStack(args.workdir);
      if (result.error) {
        return `Sync failed: [${result.error.tag}] ${result.error.message}`;
      }

      const parts: string[] = [];

      if (result.abandonedMergedChanges && result.abandonedMergedChanges.length > 0) {
        parts.push("Auto-abandoned merged changes:");
        for (const change of result.abandonedMergedChanges) {
          const bookmarkInfo = change.bookmark ? ` (${change.bookmark})` : "";
          parts.push(`  - ${change.changeId}${bookmarkInfo}`);
        }
        parts.push("");
      }

      if (result.stackFullyMerged) {
        parts.push("Stack fully merged! All changes are now in trunk.");
        if (result.cleanedUpWorkspace) {
          parts.push(`Cleaned up workspace: ${result.cleanedUpWorkspace}`);
        }
        parts.push(`  Trunk: ${result.trunkChangeId?.slice(0, 12) || "unknown"}`);
        const guidance = addGuidance(
          "action=done (mark task complete) | action=ready (find next task)",
          {
            workdir: ctx.mainRepoPath,
            skill: true,
            note: `Workspace '${result.cleanedUpWorkspace}' was deleted. Use the workdir above for subsequent commands.`,
          },
        );
        parts.push(guidance);
      } else if (result.conflicted) {
        parts.push("Sync completed with conflicts!");
        parts.push(`  Fetched: yes`);
        parts.push(`  Rebased: yes (with conflicts)`);
        parts.push(`  Trunk:   ${result.trunkChangeId?.slice(0, 12) || "unknown"}`);
        parts.push(`  Stack:   ${result.stackSize} change(s)`);
        parts.push("");
        parts.push("Resolve conflicts with 'jj status' and edit the conflicted files.");
        const guidance = addGuidance(
          "resolve conflicts manually | action=stack-status (check conflict state)",
          {
            skill: true,
            note: "Conflicts detected during rebase. Resolve them before continuing.",
          },
        );
        parts.push(guidance);
      } else if (!result.rebased) {
        parts.push("Already up to date.");
        parts.push(`  Trunk: ${result.trunkChangeId?.slice(0, 12) || "unknown"}`);
        parts.push(`  Stack: ${result.stackSize} change(s)`);
        const guidance = addGuidance("continue work | action=stack-submit (if ready to push)");
        parts.push(guidance);
      } else {
        parts.push("Sync completed successfully.");
        parts.push(`  Fetched: yes`);
        parts.push(`  Rebased: yes`);
        parts.push(`  Trunk:   ${result.trunkChangeId?.slice(0, 12) || "unknown"}`);
        parts.push(`  Stack:   ${result.stackSize} change(s)`);
        const guidance = addGuidance("continue work | action=stack-submit (push rebased changes)");
        parts.push(guidance);
      }

      return parts.join("\n");
    }),

  "stack-restack": (ship, args, _ctx) =>
    Effect.gen(function* () {
      const result = yield* ship.restackStack(args.workdir);
      if (result.error) {
        return `Restack failed: ${result.error}`;
      }
      if (!result.restacked) {
        return `Nothing to restack (working copy is on trunk).
  Trunk: ${result.trunkChangeId?.slice(0, 12) || "unknown"}`;
      }
      if (result.conflicted) {
        return `Restack completed with conflicts!
  Rebased: yes (with conflicts)
  Trunk:   ${result.trunkChangeId?.slice(0, 12) || "unknown"}
  Stack:   ${result.stackSize} change(s)

Resolve conflicts with 'jj status' and edit the conflicted files.`;
      }
      return `Restack completed successfully.
  Rebased: ${result.stackSize} change(s)
  Trunk:   ${result.trunkChangeId?.slice(0, 12) || "unknown"}
  Stack:   ${result.stackSize} change(s)`;
    }),

  "stack-submit": (ship, args, ctx) =>
    Effect.gen(function* () {
      const subscribeSessionId = args.sessionId || ctx.sessionId;

      const result = yield* ship.submitStack({
        draft: args.draft,
        title: args.title,
        body: args.body,
        subscribe: subscribeSessionId,
        workdir: args.workdir,
      });
      if (result.error) {
        if (result.pushed) {
          return `Pushed bookmark: ${result.bookmark}\nBase branch: ${result.baseBranch || "main"}\nWarning: ${result.error}`;
        }
        return `Error: ${result.error}`;
      }
      let output = "";
      if (result.pr) {
        const statusMsg =
          result.pr.status === "created"
            ? "Created PR"
            : result.pr.status === "exists"
              ? "PR already exists"
              : "Updated PR";
        output = `Pushed bookmark: ${result.bookmark}\nBase branch: ${result.baseBranch || "main"}\n${statusMsg}: #${result.pr.number}\nURL: ${result.pr.url}`;
      } else {
        output = `Pushed bookmark: ${result.bookmark}\nBase branch: ${result.baseBranch || "main"}`;
      }
      if (result.subscribed) {
        output += `\n\nAuto-subscribed to stack PRs: ${result.subscribed.prNumbers.join(", ")}`;
      }
      // Add guidance for submit
      const prCreated = result.pr?.status === "created" || result.pr?.status === "updated";
      const guidance = addGuidance(
        prCreated
          ? "Wait for review | action=stack-create (start next change in stack) | action=done (if single-change task)"
          : "action=stack-status (check change state)",
      );
      output += guidance;
      return output;
    }),

  "stack-squash": (ship, args, _ctx) =>
    Effect.gen(function* () {
      if (!args.message) {
        return "Error: message is required for stack-squash action";
      }
      const result = yield* ship.squashStack(args.message, args.workdir);
      if (!result.squashed) {
        return `Error: ${result.error || "Failed to squash"}`;
      }
      return `Squashed into ${result.intoChangeId?.slice(0, 8) || "parent"}\nDescription: ${result.description?.split("\n")[0] || "(no description)"}`;
    }),

  "stack-abandon": (ship, args, _ctx) =>
    Effect.gen(function* () {
      const result = yield* ship.abandonStack(args.changeId, args.workdir);
      if (!result.abandoned) {
        return `Error: ${result.error || "Failed to abandon"}`;
      }
      let output = `Abandoned ${result.changeId?.slice(0, 8) || "change"}\nWorking copy now at: ${result.newWorkingCopy?.slice(0, 8) || "unknown"}`;
      // Note: We don't know if workspace was deleted from this result
      // The guidance for workspace deletion happens in stack-sync when stack is fully merged
      const guidance = addGuidance("action=stack-log (view remaining stack) | continue work");
      return output + guidance;
    }),

  "stack-up": (ship, args, _ctx) =>
    Effect.gen(function* () {
      const result = yield* ship.stackUp(args.workdir);
      if (!result.moved) {
        return result.error || "Already at the tip of the stack (no child change)";
      }
      return `Moved up in stack:\n  From: ${result.from?.changeId.slice(0, 8) || "unknown"} ${result.from?.description || ""}\n  To:   ${result.to?.changeId.slice(0, 8) || "unknown"} ${result.to?.description || ""}`;
    }),

  "stack-down": (ship, args, _ctx) =>
    Effect.gen(function* () {
      const result = yield* ship.stackDown(args.workdir);
      if (!result.moved) {
        return result.error || "Already at the base of the stack (on trunk)";
      }
      return `Moved down in stack:\n  From: ${result.from?.changeId.slice(0, 8) || "unknown"} ${result.from?.description || ""}\n  To:   ${result.to?.changeId.slice(0, 8) || "unknown"} ${result.to?.description || ""}`;
    }),

  "stack-undo": (ship, args, _ctx) =>
    Effect.gen(function* () {
      const result = yield* ship.stackUndo(args.workdir);
      if (!result.undone) {
        return `Error: ${result.error || "Failed to undo"}`;
      }
      return result.operation ? `Undone: ${result.operation}` : "Undone last operation";
    }),

  "stack-update-stale": (ship, args, _ctx) =>
    Effect.gen(function* () {
      const result = yield* ship.stackUpdateStale(args.workdir);
      if (!result.updated) {
        return `Error: ${result.error || "Failed to update stale workspace"}`;
      }
      return result.changeId
        ? `Working copy updated. Now at: ${result.changeId}`
        : "Working copy updated.";
    }),

  "stack-bookmark": (ship, args, _ctx) =>
    Effect.gen(function* () {
      if (!args.name) {
        return "Error: name is required for stack-bookmark action";
      }
      const result = yield* ship.bookmarkStack(args.name, args.move, args.workdir);
      if (!result.success) {
        return `Error: ${result.error || "Failed to create/move bookmark"}`;
      }
      const action = result.action === "moved" ? "Moved" : "Created";
      return `${action} bookmark '${result.bookmark}' at ${result.changeId?.slice(0, 8) || "current change"}`;
    }),

  "stack-workspaces": (ship, args, _ctx) =>
    Effect.gen(function* () {
      const workspaces = yield* ship.listWorkspaces(args.workdir);
      if (workspaces.length === 0) {
        return "No workspaces found.";
      }
      return `Workspaces (${workspaces.length}):\n\n${workspaces
        .map((ws: WorkspaceOutput) => {
          const defaultMark = ws.isDefault ? " (default)" : "";
          const stack = ws.stackName ? ` stack:${ws.stackName}` : "";
          const task = ws.taskId ? ` task:${ws.taskId}` : "";
          return `${ws.name}${defaultMark}${stack}${task}\n  Change: ${ws.changeId} - ${ws.description}\n  Path: ${ws.path}`;
        })
        .join("\n\n")}`;
    }),

  "stack-remove-workspace": (ship, args, ctx) =>
    Effect.gen(function* () {
      if (!args.name) {
        return "Error: name is required for stack-remove-workspace action";
      }
      const result = yield* ship.removeWorkspace(args.name, args.deleteFiles, args.workdir);
      if (!result.removed) {
        return `Error: ${result.error || "Failed to remove workspace"}`;
      }
      let output = `Removed workspace: ${result.name}`;
      if (result.filesDeleted !== undefined) {
        output += result.filesDeleted ? "\nFiles deleted." : "\nFiles remain on disk.";
      }
      const guidance = addGuidance(
        "action=ready (find next task) | action=stack-workspaces (list remaining)",
        {
          workdir: ctx.mainRepoPath,
          note: "Workspace removed. Use the workdir above for subsequent commands.",
        },
      );
      return output + guidance;
    }),

  "webhook-start": (ship, args, _ctx) =>
    Effect.gen(function* () {
      const result = yield* ship.startWebhook(args.events);
      if (!result.started) {
        return `Error: ${result.error}${result.pid ? ` (PID: ${result.pid})` : ""}`;
      }
      return `Webhook forwarding started (PID: ${result.pid})
Events: ${result.events?.join(", ") || "default"}

GitHub events will be forwarded to the current OpenCode session.
Use action 'webhook-stop' to stop forwarding.`;
    }),

  "webhook-stop": (ship, _args, _ctx) =>
    Effect.gen(function* () {
      const result = yield* ship.stopWebhook();
      if (!result.stopped) {
        return result.error || "No webhook forwarding process is running";
      }
      return "Webhook forwarding stopped.";
    }),

  "webhook-status": (ship, _args, _ctx) =>
    Effect.gen(function* () {
      const status = yield* ship.getWebhookStatus();
      if (status.running) {
        return `Webhook forwarding is running (PID: ${status.pid})`;
      }
      return "Webhook forwarding is not running.";
    }),

  "webhook-daemon-status": (ship, _args, _ctx) =>
    Effect.gen(function* () {
      const status = yield* ship.getDaemonStatus();
      if (!status.running) {
        return "Webhook daemon is not running.\n\nStart it with: ship webhook start";
      }
      let output = `Webhook Daemon Status
─────────────────────────────────────────
Status: Running
PID: ${status.pid || "unknown"}
Repository: ${status.repo || "unknown"}
GitHub WebSocket: ${status.connectedToGitHub ? "Connected" : "Disconnected"}
Uptime: ${status.uptime ? `${status.uptime}s` : "unknown"}

Subscriptions:`;
      if (!status.subscriptions || status.subscriptions.length === 0) {
        output += "\n  No active subscriptions.";
      } else {
        for (const sub of status.subscriptions) {
          output += `\n  Session ${sub.sessionId}: PRs ${sub.prNumbers.join(", ")}`;
        }
      }
      return output;
    }),

  "webhook-subscribe": (ship, args, ctx) =>
    Effect.gen(function* () {
      const sessionId = args.sessionId || ctx.sessionId;
      if (!sessionId) {
        return "Error: sessionId is required for webhook-subscribe action (not provided and could not auto-detect from context)";
      }
      if (!args.prNumbers || args.prNumbers.length === 0) {
        return "Error: prNumbers is required for webhook-subscribe action";
      }
      const result = yield* ship.subscribeToPRs(sessionId, args.prNumbers, ctx.serverUrl);
      if (!result.subscribed) {
        return `Error: ${result.error || "Failed to subscribe"}`;
      }
      const serverInfo = ctx.serverUrl ? ` (server: ${ctx.serverUrl})` : "";
      return `Subscribed session ${sessionId} to PRs: ${args.prNumbers.join(", ")}${serverInfo}

The daemon will forward GitHub events for these PRs to your session.
Use 'webhook-unsubscribe' to stop receiving events.`;
    }),

  "webhook-unsubscribe": (ship, args, ctx) =>
    Effect.gen(function* () {
      const sessionId = args.sessionId || ctx.sessionId;
      if (!sessionId) {
        return "Error: sessionId is required for webhook-unsubscribe action";
      }
      if (!args.prNumbers || args.prNumbers.length === 0) {
        return "Error: prNumbers is required for webhook-unsubscribe action";
      }
      const result = yield* ship.unsubscribeFromPRs(sessionId, args.prNumbers, ctx.serverUrl);
      if (!result.unsubscribed) {
        return `Error: ${result.error || "Failed to unsubscribe"}`;
      }
      return `Unsubscribed session ${sessionId} from PRs: ${args.prNumbers.join(", ")}`;
    }),

  "webhook-cleanup": (ship, _args, _ctx) =>
    Effect.gen(function* () {
      const result = yield* ship.cleanupStaleSubscriptions();
      if (!result.success) {
        return `Error: ${result.error || "Failed to cleanup"}`;
      }
      if (result.removedSessions.length === 0) {
        return "No stale subscriptions found. All subscribed sessions are still active.";
      }
      return `Cleaned up ${result.removedSessions.length} stale subscription(s):\n${result.removedSessions.map((s: string) => `  - ${s}`).join("\n")}\n\nThese sessions no longer exist in OpenCode.`;
    }),

  // PR reviews action
  "pr-reviews": (ship, args, _ctx) =>
    Effect.gen(function* () {
      const result = yield* ship.getPrReviews(args.prNumber, args.unresolved, args.workdir);

      if (result.error) {
        return `Error: ${result.error}`;
      }

      // Format the output in a human-readable way similar to the CLI
      const lines: string[] = [];

      lines.push(`## PR #${result.prNumber}${result.prTitle ? `: ${result.prTitle}` : ""}`);
      if (result.prUrl) {
        lines.push(`URL: ${result.prUrl}`);
      }
      lines.push("");

      // Reviews section
      if (result.reviews.length > 0) {
        lines.push("### Reviews");
        const sortedReviews = [...result.reviews].sort(
          (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
        );
        for (const review of sortedReviews) {
          const stateLabel =
            review.state === "APPROVED"
              ? "[APPROVED]"
              : review.state === "CHANGES_REQUESTED"
                ? "[CHANGES_REQUESTED]"
                : `[${review.state}]`;
          lines.push(`- @${review.author}: ${stateLabel}`);
          if (review.body) {
            const bodyLines = review.body.split("\n").map((l: string) => `  ${l}`);
            lines.push(...bodyLines);
          }
        }
        lines.push("");
      }

      // Code comments section
      const fileKeys = Object.keys(result.commentsByFile);
      if (fileKeys.length > 0) {
        lines.push(`### Code Comments (${result.codeComments.length} total)`);
        lines.push("");

        for (const filePath of fileKeys.sort()) {
          const fileComments = result.commentsByFile[filePath];
          lines.push(`#### ${filePath}`);

          for (const comment of fileComments) {
            const lineInfo = comment.line !== null ? `:${comment.line}` : "";
            lines.push(`**${filePath}${lineInfo}** - @${comment.author}:`);
            if (comment.diffHunk) {
              lines.push("```diff");
              lines.push(comment.diffHunk);
              lines.push("```");
            }
            const bodyLines = comment.body.split("\n").map((l: string) => `> ${l}`);
            lines.push(...bodyLines);
            lines.push("");
          }
        }
      }

      // Conversation comments section
      if (result.conversationComments.length > 0) {
        lines.push("### Conversation");
        for (const comment of result.conversationComments) {
          lines.push(`- @${comment.author}:`);
          const bodyLines = comment.body.split("\n").map((l: string) => `  ${l}`);
          lines.push(...bodyLines);
          lines.push("");
        }
      }

      // Summary if no feedback
      if (
        result.reviews.length === 0 &&
        result.codeComments.length === 0 &&
        result.conversationComments.length === 0
      ) {
        lines.push("No reviews or comments found.");
      }

      const guidance = addGuidance("address review feedback | action=stack-submit (push updates)");
      return lines.join("\n").trim() + guidance;
    }),

  // Milestone actions
  "milestone-list": (ship, _args, _ctx) =>
    Effect.gen(function* () {
      const milestones = yield* ship.listMilestones();
      if (milestones.length === 0) {
        return "No milestones found for this project.\n\nCreate one with: milestone-create action";
      }
      return `Milestones (${milestones.length}):\n\n${milestones
        .map((m) => {
          const targetDate = m.targetDate ? ` (due: ${m.targetDate})` : "";
          return `${m.slug.padEnd(25)} ${m.name}${targetDate}`;
        })
        .join("\n")}`;
    }),

  "milestone-show": (ship, args, _ctx) =>
    Effect.gen(function* () {
      if (!args.milestoneId) {
        return "Error: milestoneId is required for milestone-show action";
      }
      const milestone = yield* ship.getMilestone(args.milestoneId);
      let output = `# ${milestone.name}\n\n`;
      output += `**Slug:** ${milestone.slug}\n`;
      output += `**ID:** ${milestone.id}\n`;
      if (milestone.targetDate) {
        output += `**Target Date:** ${milestone.targetDate}\n`;
      }
      if (milestone.description) {
        output += `\n## Description\n\n${milestone.description}`;
      }
      return output;
    }),

  "milestone-create": (ship, args, _ctx) =>
    Effect.gen(function* () {
      if (!args.milestoneName) {
        return "Error: milestoneName is required for milestone-create action";
      }
      const milestone = yield* ship.createMilestone({
        name: args.milestoneName,
        description: args.milestoneDescription,
        targetDate: args.milestoneTargetDate,
      });
      let output = `Created milestone: ${milestone.name}\nSlug: ${milestone.slug}`;
      if (milestone.targetDate) {
        output += `\nTarget Date: ${milestone.targetDate}`;
      }
      return output;
    }),

  "milestone-update": (ship, args, _ctx) =>
    Effect.gen(function* () {
      if (!args.milestoneId) {
        return "Error: milestoneId is required for milestone-update action";
      }
      if (!args.milestoneName && !args.milestoneDescription && !args.milestoneTargetDate) {
        return "Error: at least one of milestoneName, milestoneDescription, or milestoneTargetDate is required";
      }
      const milestone = yield* ship.updateMilestone(args.milestoneId, {
        name: args.milestoneName,
        description: args.milestoneDescription,
        targetDate: args.milestoneTargetDate,
      });
      let output = `Updated milestone: ${milestone.name}\nSlug: ${milestone.slug}`;
      if (milestone.targetDate) {
        output += `\nTarget Date: ${milestone.targetDate}`;
      }
      return output;
    }),

  "milestone-delete": (ship, args, _ctx) =>
    Effect.gen(function* () {
      if (!args.milestoneId) {
        return "Error: milestoneId is required for milestone-delete action";
      }
      yield* ship.deleteMilestone(args.milestoneId);
      return `Deleted milestone: ${args.milestoneId}`;
    }),

  "task-set-milestone": (ship, args, _ctx) =>
    Effect.gen(function* () {
      if (!args.taskId) {
        return "Error: taskId is required for task-set-milestone action";
      }
      if (!args.milestoneId) {
        return "Error: milestoneId is required for task-set-milestone action";
      }
      const task = yield* ship.setTaskMilestone(args.taskId, args.milestoneId);
      return `Assigned ${task.identifier} to milestone: ${task.milestoneName || args.milestoneId}\nURL: ${task.url}`;
    }),

  "task-unset-milestone": (ship, args, _ctx) =>
    Effect.gen(function* () {
      if (!args.taskId) {
        return "Error: taskId is required for task-unset-milestone action";
      }
      const task = yield* ship.unsetTaskMilestone(args.taskId);
      return `Removed ${task.identifier} from its milestone\nURL: ${task.url}`;
    }),
};

const executeAction = (
  args: ToolArgs,
  context: ActionContext,
): Effect.Effect<string, ShipCommandError | JsonParseError | ShipNotConfiguredError, ShipService> =>
  Effect.gen(function* () {
    const ship = yield* ShipService;

    // Check configuration for all actions except status
    if (args.action !== "status") {
      const status = yield* ship
        .checkConfigured()
        .pipe(Effect.catchAll(() => Effect.succeed({ configured: false })));
      if (!status.configured) {
        return yield* new ShipNotConfiguredError({});
      }
    }

    // Look up handler from the record
    const handler = actionHandlers[args.action];
    if (!handler) {
      return `Unknown action: ${args.action}`;
    }

    return yield* handler(ship, args, context);
  });

// =============================================================================
// Tool Creation
// =============================================================================

/**
 * Build the tool description based on whether the project is a jj repo.
 * Only includes jj-specific hints when the project uses jj for VCS.
 */
const buildToolDescription = (isJjRepo: boolean): string => {
  const baseDescription = `Linear task management and VCS operations for the current project.`;

  const jjHints = isJjRepo
    ? `

IMPORTANT: Always use this tool for VCS operations. NEVER run jj, gh, or git commands directly via bash.
- Use stack-create instead of: jj new, jj describe, jj bookmark create
- Use stack-describe instead of: jj describe
- Use stack-submit instead of: jj git push, gh pr create
- Use stack-sync instead of: jj git fetch, jj rebase`
    : "";

  const taskFeatures = `
Use this tool to:
- List tasks ready to work on (no blockers)
- View task details
- Start/complete tasks
- Create new tasks
- Manage task dependencies (blocking relationships)
- Get AI-optimized context about current work`;

  const jjFeatures = isJjRepo
    ? `
- Manage stacked changes (jj workflow)
- Start/stop GitHub webhook forwarding for real-time event notifications
- Subscribe to PR events via the webhook daemon (multi-session support)`
    : "";

  const footer = `

Requires ship to be configured in the project (.ship/config.yaml).
Run 'ship init' in the terminal first if not configured.`;

  return baseDescription + jjHints + taskFeatures + jjFeatures + footer;
};

/**
 * Create the ship tool with the opencode context.
 *
 * @param $ - Bun shell from opencode
 * @param directory - Current working directory from opencode (Instance.directory)
 * @param serverUrl - OpenCode server URL for webhook routing
 * @param isJjRepo - Whether the directory is a jj repository
 * @returns ToolDefinition for the ship tool
 */
const createShipTool = (
  $: BunShell,
  directory: string,
  serverUrl?: string,
  isJjRepo?: boolean,
): ToolDefinition => {
  const shellService = makeShellService($, directory);
  const ShellServiceLive = Layer.succeed(ShellService, shellService);
  const ShipServiceLive = Layer.effect(ShipService, makeShipService).pipe(
    Layer.provide(ShellServiceLive),
  );

  const runEffect = <A, E>(effect: Effect.Effect<A, E, ShipService>): Promise<A> =>
    Effect.runPromise(Effect.provide(effect, ShipServiceLive));

  return createTool({
    description: buildToolDescription(isJjRepo ?? false),

    args: {
      action: createTool.schema
        .enum([
          "ready",
          "list",
          "blocked",
          "show",
          "start",
          "done",
          "create",
          "update",
          "block",
          "unblock",
          "relate",
          "status",
          "stack-log",
          "stack-status",
          "stack-create",
          "stack-describe",
          "stack-sync",
          "stack-restack",
          "stack-submit",
          "stack-squash",
          "stack-abandon",
          "stack-up",
          "stack-down",
          "stack-undo",
          "stack-update-stale",
          "stack-bookmark",
          "stack-workspaces",
          "stack-remove-workspace",
          "webhook-daemon-status",
          "webhook-subscribe",
          "webhook-unsubscribe",
          "webhook-cleanup",
          "pr-reviews",
          "milestone-list",
          "milestone-show",
          "milestone-create",
          "milestone-update",
          "milestone-delete",
          "task-set-milestone",
          "task-unset-milestone",
        ])
        .describe(
          "Action to perform: ready (unblocked tasks), list (all tasks), blocked (blocked tasks), show (task details), start (begin task), done (complete task), create (new task), update (modify task), block/unblock (dependencies), relate (link related tasks), status (current config), stack-log (view stack), stack-status (current change), stack-create (new change with workspace by default), stack-describe (update description), stack-bookmark (create or move a bookmark on current change), stack-sync (fetch and rebase), stack-restack (rebase stack onto trunk without fetching), stack-submit (push and create/update PR, auto-subscribes to webhook events), stack-squash (squash into parent), stack-abandon (abandon change), stack-up (move to child change toward tip), stack-down (move to parent change toward trunk), stack-undo (undo last jj operation), stack-update-stale (update stale working copy after workspace or remote changes), stack-workspaces (list all jj workspaces), stack-remove-workspace (remove a jj workspace), webhook-daemon-status (check daemon status), webhook-subscribe (subscribe to PR events), webhook-unsubscribe (unsubscribe from PR events), webhook-cleanup (cleanup stale subscriptions for sessions that no longer exist), pr-reviews (fetch PR reviews and comments), milestone-list (list project milestones), milestone-show (view milestone details), milestone-create (create new milestone), milestone-update (modify milestone), milestone-delete (delete milestone), task-set-milestone (assign task to milestone), task-unset-milestone (remove task from milestone)",
        ),
      taskId: createTool.schema
        .string()
        .optional()
        .describe(
          "Task identifier (e.g., BRI-123) - required for show, start, done, update; optional for stack-create to associate workspace with task",
        ),
      title: createTool.schema
        .string()
        .optional()
        .describe(
          "Title - for task create/update OR for stack-describe (first line of commit message)",
        ),
      description: createTool.schema
        .string()
        .optional()
        .describe(
          "For task create: REQUIRED - use template from skill (## Summary, ## Acceptance Criteria with checkboxes, ## Notes). For task update: optional changes. For stack-describe: commit body after title.",
        ),
      priority: createTool.schema
        .enum(["urgent", "high", "medium", "low", "none"])
        .optional()
        .describe("Task priority - optional for create/update"),
      status: createTool.schema
        .enum(["backlog", "todo", "in_progress", "in_review", "done", "cancelled"])
        .optional()
        .describe("Task status - optional for update"),
      blocker: createTool.schema
        .string()
        .optional()
        .describe("Blocker task ID - required for block/unblock"),
      blocked: createTool.schema
        .string()
        .optional()
        .describe("Blocked task ID - required for block/unblock"),
      relatedTaskId: createTool.schema
        .string()
        .optional()
        .describe("Related task ID - required for relate (use with taskId)"),
      parentId: createTool.schema
        .string()
        .optional()
        .describe("Parent task identifier (e.g., BRI-123) - for creating subtasks"),
      filter: createTool.schema
        .object({
          status: createTool.schema
            .enum(["backlog", "todo", "in_progress", "in_review", "done", "cancelled"])
            .optional(),
          priority: createTool.schema.enum(["urgent", "high", "medium", "low", "none"]).optional(),
          mine: createTool.schema.boolean().optional(),
        })
        .optional()
        .describe("Filters for list action"),
      message: createTool.schema
        .string()
        .optional()
        .describe(
          "Message for stack-create. For stack-describe, prefer using title + description params for proper multi-line commits",
        ),
      bookmark: createTool.schema
        .string()
        .optional()
        .describe("Bookmark name for stack-create action"),
      noWorkspace: createTool.schema
        .boolean()
        .optional()
        .describe(
          "Skip workspace creation - for stack-create action (by default, workspace is created for isolated development)",
        ),
      name: createTool.schema
        .string()
        .optional()
        .describe(
          "Bookmark or workspace name - required for stack-bookmark and stack-remove-workspace actions",
        ),
      move: createTool.schema
        .boolean()
        .optional()
        .describe(
          "Move an existing bookmark instead of creating a new one - for stack-bookmark action",
        ),
      deleteFiles: createTool.schema
        .boolean()
        .optional()
        .describe(
          "Also delete the workspace directory from disk - for stack-remove-workspace action",
        ),
      workdir: createTool.schema
        .string()
        .optional()
        .describe(
          "Working directory for VCS operations - use this when operating in a jj workspace (e.g., the path returned by stack-create)",
        ),
      draft: createTool.schema
        .boolean()
        .optional()
        .describe("Create PR as draft - for stack-submit action"),
      body: createTool.schema
        .string()
        .optional()
        .describe("PR body - for stack-submit action (defaults to change description)"),
      changeId: createTool.schema
        .string()
        .optional()
        .describe("Change ID to abandon - for stack-abandon action (defaults to current @)"),
      events: createTool.schema
        .string()
        .optional()
        .describe(
          "Comma-separated GitHub events to forward (e.g., 'pull_request,check_run') - for webhook-start action",
        ),
      sessionId: createTool.schema
        .string()
        .optional()
        .describe("OpenCode session ID - for webhook-subscribe/unsubscribe actions"),
      prNumbers: createTool.schema
        .array(createTool.schema.number())
        .optional()
        .describe(
          "PR numbers to subscribe/unsubscribe - for webhook-subscribe/unsubscribe actions",
        ),
      prNumber: createTool.schema
        .number()
        .optional()
        .describe(
          "PR number - for pr-reviews action (defaults to current bookmark's PR if not provided)",
        ),
      unresolved: createTool.schema
        .boolean()
        .optional()
        .describe("Show only unresolved/actionable comments - for pr-reviews action"),
      milestoneId: createTool.schema
        .string()
        .optional()
        .describe(
          "Milestone identifier (slug like 'q1-release' or UUID) - required for milestone-show, milestone-update, task-set-milestone",
        ),
      milestoneName: createTool.schema
        .string()
        .optional()
        .describe("Milestone name - required for milestone-create, optional for milestone-update"),
      milestoneDescription: createTool.schema
        .string()
        .optional()
        .describe("Milestone description - optional for milestone-create/update"),
      milestoneTargetDate: createTool.schema
        .string()
        .optional()
        .describe(
          "Milestone target date (ISO format like '2024-03-31') - optional for milestone-create/update",
        ),
    },

    async execute(args, context) {
      // Build action context with session ID, main repo path, and server URL
      const actionContext: ActionContext = {
        sessionId: context.sessionID,
        mainRepoPath: directory,
        serverUrl,
      };
      const result = await runEffect(
        executeAction(args, actionContext).pipe(
          Effect.catchAll((error) => {
            if (error._tag === "ShipNotConfiguredError") {
              return Effect.succeed(`Ship is not configured in this project.

Run 'ship init' in the terminal to:
1. Authenticate with Linear (paste your API key from https://linear.app/settings/api)
2. Select your team
3. Optionally select a project

After that, you can use this tool to manage tasks.`);
            }
            if (error._tag === "ShipCommandError") {
              return Effect.succeed(`Command failed: ${error.message}`);
            }
            if (error._tag === "JsonParseError") {
              return Effect.succeed(`Failed to parse response: ${error.raw}`);
            }
            return Effect.succeed(`Unknown error: ${JSON.stringify(error)}`);
          }),
        ),
      );
      return result;
    },
  });
};

// =============================================================================
// Commands
// =============================================================================

const SHIP_COMMANDS = {
  ready: {
    description: "Find ready-to-work tasks with no blockers",
    template: `Use the \`ship\` tool with action \`ready\` to find tasks that are ready to work on (no blocking dependencies).

Present the results in a clear format showing task ID, title, priority, and URL.

If there are ready tasks, ask the user which one they'd like to work on. If they choose one, use the \`ship\` tool with action \`start\` to begin work on it.

If there are no ready tasks, suggest checking blocked tasks (action \`blocked\`) or creating a new task (action \`create\`).`,
  },
};

// =============================================================================
// Compaction Context Hooks
// =============================================================================

/**
 * Create the compaction context hook.
 *
 * This hook is called BEFORE compaction starts. It allows us to append
 * additional context to the compaction prompt, which will be included
 * in the generated summary.
 *
 * @param shellService - Shell service for running ship commands
 */
const createCompactionHook = (
  shellService: ShellService,
): Hooks["experimental.session.compacting"] => {
  const ShellServiceLive = Layer.succeed(ShellService, shellService);
  const ShipServiceLive = Layer.effect(ShipService, makeShipService).pipe(
    Layer.provide(ShellServiceLive),
  );

  return async (input, output) => {
    const { sessionID } = input;

    // Try to get the tracked task for this session
    const trackedTask = getTrackedTask(sessionID);

    if (Option.isNone(trackedTask)) {
      // No task tracked for this session, nothing to preserve
      return;
    }

    const { taskId, workdir } = trackedTask.value;

    // Fetch task details and stack status in parallel
    const [taskResult, stackResult] = await Effect.runPromise(
      Effect.all(
        [
          Effect.gen(function* () {
            const ship = yield* ShipService;
            return yield* ship.getTask(taskId);
          }).pipe(Effect.catchAll(() => Effect.succeed(null))),
          Effect.gen(function* () {
            const ship = yield* ShipService;
            return yield* ship.getStackStatus(workdir);
          }).pipe(Effect.catchAll(() => Effect.succeed(null))),
        ],
        { concurrency: 2 },
      ).pipe(Effect.provide(ShipServiceLive)),
    );

    // Build the compaction context
    const contextParts: string[] = [];

    contextParts.push("## Ship Task Context (Preserve Across Compaction)");
    contextParts.push("");

    if (taskResult) {
      contextParts.push(`**Current Task:** ${taskResult.identifier} - ${taskResult.title}`);
      contextParts.push(`**Status:** ${taskResult.state || taskResult.status}`);
      contextParts.push(`**Priority:** ${taskResult.priority}`);
      contextParts.push(`**URL:** ${taskResult.url}`);
    } else {
      contextParts.push(`**Current Task:** ${taskId} (details unavailable)`);
    }

    if (workdir) {
      contextParts.push(`**Workspace:** ${workdir}`);
    }

    if (stackResult?.change) {
      const c = stackResult.change;
      contextParts.push("");
      contextParts.push("**VCS State:**");
      contextParts.push(`- Change: ${c.changeId.slice(0, 8)}`);
      contextParts.push(`- Description: ${c.description.split("\n")[0] || "(no description)"}`);
      if (c.bookmarks.length > 0) {
        contextParts.push(`- Bookmarks: ${c.bookmarks.join(", ")}`);
      }
    }

    contextParts.push("");
    contextParts.push("**IMPORTANT:** After compaction, immediately:");
    contextParts.push('1. Load the ship-cli skill using: `skill(name="ship-cli")`');
    contextParts.push(
      `2. Continue working on task ${taskId}${workdir ? ` in workspace ${workdir}` : ""}`,
    );

    // Add to output context
    output.context.push(contextParts.join("\n"));
  };
};

// =============================================================================
// Tool Execute Hook
// =============================================================================

/**
 * Create the tool.execute.after hook to track task state.
 *
 * This hook monitors ship tool calls to track:
 * - When tasks are started (action=start)
 * - When workspaces are created (action=stack-create)
 *
 * This state is used during compaction to preserve context.
 */
const createToolExecuteAfterHook = (): Hooks["tool.execute.after"] => {
  return async (input, output) => {
    // Only track ship tool calls
    if (input.tool !== "ship") {
      return;
    }

    const { sessionID } = input;

    // Parse the args from the output metadata using Schema validation
    const argsOption = decodeShipToolArgs(output.metadata);
    if (Option.isNone(argsOption)) {
      return;
    }
    const args = argsOption.value;

    // Track task starts
    if (args.action === "start" && args.taskId) {
      trackTask(sessionID, { taskId: args.taskId });
    }

    // Track workspace creation (updates workdir for existing task)
    if (args.action === "stack-create") {
      // Extract workspace path from output
      const workspaceMatch = output.output.match(/Created workspace: \S+ at (.+?)(?:\n|$)/);
      const workdir = workspaceMatch?.[1];

      // Extract taskId from args or from existing tracked task
      const taskId = args.taskId;
      if (taskId) {
        trackTask(sessionID, { taskId, workdir });
      } else if (workdir) {
        // Just update workdir for existing tracked task
        trackTask(sessionID, { workdir });
      }
    }

    // Track task completion - clear the tracked task
    if (args.action === "done" && args.taskId) {
      const existing = sessionTaskMap.get(sessionID);
      if (existing?.taskId === args.taskId) {
        sessionTaskMap.delete(sessionID);
      }
    }
  };
};

// =============================================================================
// Plugin Export
// =============================================================================

// Extended PluginInput type to include serverUrl (available in OpenCode 1.0.144+)
type ExtendedPluginInput = Parameters<Plugin>[0] & {
  serverUrl?: URL;
};

/**
 * Check if a directory is a jj repository by looking for the .jj directory.
 * This is a simple filesystem check that doesn't require jj to be installed.
 */
const checkIsJjRepo = async (directory: string): Promise<boolean> => {
  try {
    const jjPath = `${directory}/.jj`;
    const file = Bun.file(jjPath);
    // Bun.file().exists() returns true for directories too
    return await file.exists();
  } catch {
    return false;
  }
};

export const ShipPlugin = async (input: ExtendedPluginInput) => {
  const { $, directory, serverUrl } = input;
  const shellService = makeShellService($, directory);
  // Convert URL object to string for passing to CLI commands
  const serverUrlString = serverUrl?.toString();
  // Check if this is a jj repository
  const isJjRepo = await checkIsJjRepo(directory);

  return {
    config: async (config: Parameters<NonNullable<Awaited<ReturnType<Plugin>>["config"]>>[0]) => {
      config.command = { ...config.command, ...SHIP_COMMANDS };
    },
    tool: {
      ship: createShipTool($, directory, serverUrlString, isJjRepo),
    },
    "tool.execute.after": createToolExecuteAfterHook(),
    "experimental.session.compacting": createCompactionHook(shellService),
  };
};

export default ShipPlugin;
