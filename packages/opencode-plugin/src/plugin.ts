/**
 * Ship OpenCode Plugin
 *
 * Provides the `ship` tool for Linear task management and stacked changes workflow.
 * Instructions/guidance are handled by the ship-cli skill (.opencode/skill/ship-cli/SKILL.md)
 */

import type { Plugin, ToolDefinition } from "@opencode-ai/plugin";
import { tool as createTool } from "@opencode-ai/plugin";
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

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
      return ["pnpm", "ship"];
    }
    return ["ship"];
  };

  const extractJson = (output: string): string => {
    const jsonMatch = output.match(/^\s*[\[{]/m);
    if (jsonMatch && jsonMatch.index !== undefined) {
      return output.slice(jsonMatch.index);
    }
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
  readonly startTask: (taskId: string) => Effect.Effect<void, ShipCommandError>;
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
    }
  ) => Effect.Effect<ShipTask, ShipCommandError | JsonParseError>;
  readonly addBlocker: (blocker: string, blocked: string) => Effect.Effect<void, ShipCommandError>;
  readonly removeBlocker: (blocker: string, blocked: string) => Effect.Effect<void, ShipCommandError>;
  readonly relateTask: (taskId: string, relatedTaskId: string) => Effect.Effect<void, ShipCommandError>;
  // Stack operations - all accept optional workdir for workspace support
  readonly getStackLog: (workdir?: string) => Effect.Effect<StackChange[], ShipCommandError | JsonParseError>;
  readonly getStackStatus: (workdir?: string) => Effect.Effect<StackStatus, ShipCommandError | JsonParseError>;
  readonly createStackChange: (input: {
    message?: string;
    bookmark?: string;
    noWorkspace?: boolean;
    workdir?: string;
  }) => Effect.Effect<StackCreateResult, ShipCommandError | JsonParseError>;
  readonly describeStackChange: (message: string, workdir?: string) => Effect.Effect<StackDescribeResult, ShipCommandError | JsonParseError>;
  readonly syncStack: (workdir?: string) => Effect.Effect<StackSyncResult, ShipCommandError | JsonParseError>;
  readonly restackStack: (workdir?: string) => Effect.Effect<StackRestackResult, ShipCommandError | JsonParseError>;
  readonly submitStack: (input: {
    draft?: boolean;
    title?: string;
    body?: string;
    subscribe?: string; // OpenCode session ID to subscribe to all stack PRs
    workdir?: string;
  }) => Effect.Effect<StackSubmitResult, ShipCommandError | JsonParseError>;
  readonly squashStack: (message: string, workdir?: string) => Effect.Effect<StackSquashResult, ShipCommandError | JsonParseError>;
  readonly abandonStack: (changeId?: string, workdir?: string) => Effect.Effect<StackAbandonResult, ShipCommandError | JsonParseError>;
  // Stack navigation
  readonly stackUp: (workdir?: string) => Effect.Effect<StackNavigateResult, ShipCommandError | JsonParseError>;
  readonly stackDown: (workdir?: string) => Effect.Effect<StackNavigateResult, ShipCommandError | JsonParseError>;
  // Stack recovery
  readonly stackUndo: (workdir?: string) => Effect.Effect<StackUndoResult, ShipCommandError | JsonParseError>;
  readonly stackUpdateStale: (workdir?: string) => Effect.Effect<StackUpdateStaleResult, ShipCommandError | JsonParseError>;
  // Webhook operations - use Ref for thread-safe process tracking
  readonly startWebhook: (events?: string) => Effect.Effect<WebhookStartResult, never>;
  readonly stopWebhook: () => Effect.Effect<WebhookStopResult, never>;
  readonly getWebhookStatus: () => Effect.Effect<{ running: boolean; pid?: number }, never>;
  // Daemon-based webhook operations
  readonly getDaemonStatus: () => Effect.Effect<WebhookDaemonStatus, ShipCommandError | JsonParseError>;
  readonly subscribeToPRs: (sessionId: string, prNumbers: number[]) => Effect.Effect<WebhookSubscribeResult, ShipCommandError | JsonParseError>;
  readonly unsubscribeFromPRs: (sessionId: string, prNumbers: number[]) => Effect.Effect<WebhookUnsubscribeResult, ShipCommandError | JsonParseError>;
  // Workspace operations - accept optional workdir
  readonly listWorkspaces: (workdir?: string) => Effect.Effect<WorkspaceOutput[], ShipCommandError | JsonParseError>;
  readonly removeWorkspace: (name: string, deleteFiles?: boolean, workdir?: string) => Effect.Effect<RemoveWorkspaceResult, ShipCommandError | JsonParseError>;
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
      const output = yield* shell.run(["ready", "--json"]);
      return yield* parseJson<ShipTask[]>(output);
    });

  const getBlockedTasks = () =>
    Effect.gen(function* () {
      const output = yield* shell.run(["blocked", "--json"]);
      return yield* parseJson<ShipTask[]>(output);
    });

  const listTasks = (filter?: { status?: string; priority?: string; mine?: boolean }) =>
    Effect.gen(function* () {
      const args = ["list", "--json"];
      if (filter?.status) args.push("--status", filter.status);
      if (filter?.priority) args.push("--priority", filter.priority);
      if (filter?.mine) args.push("--mine");

      const output = yield* shell.run(args);
      return yield* parseJson<ShipTask[]>(output);
    });

  const getTask = (taskId: string) =>
    Effect.gen(function* () {
      const output = yield* shell.run(["show", "--json", taskId]);
      return yield* parseJson<ShipTask>(output);
    });

  const startTask = (taskId: string) => shell.run(["start", taskId]).pipe(Effect.asVoid);

  const completeTask = (taskId: string) => shell.run(["done", taskId]).pipe(Effect.asVoid);

  const createTask = (input: { title: string; description?: string; priority?: string; parentId?: string }) =>
    Effect.gen(function* () {
      const args = ["create", "--json"];
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
    input: { title?: string; description?: string; priority?: string; status?: string }
  ) =>
    Effect.gen(function* () {
      const args = ["update", "--json"];
      if (input.title) args.push("--title", input.title);
      if (input.description) args.push("--description", input.description);
      if (input.priority) args.push("--priority", input.priority);
      if (input.status) args.push("--status", input.status);
      args.push(taskId);

      const output = yield* shell.run(args);
      const response = yield* parseJson<{ task: ShipTask }>(output);
      return response.task;
    });

  const addBlocker = (blocker: string, blocked: string) =>
    shell.run(["block", blocker, blocked]).pipe(Effect.asVoid);

  const removeBlocker = (blocker: string, blocked: string) =>
    shell.run(["unblock", blocker, blocked]).pipe(Effect.asVoid);

  const relateTask = (taskId: string, relatedTaskId: string) =>
    shell.run(["relate", taskId, relatedTaskId]).pipe(Effect.asVoid);

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

  const createStackChange = (input: { message?: string; bookmark?: string; noWorkspace?: boolean; workdir?: string }) =>
    Effect.gen(function* () {
      const args = ["stack", "create", "--json"];
      if (input.message) args.push("--message", input.message);
      if (input.bookmark) args.push("--bookmark", input.bookmark);
      if (input.noWorkspace) args.push("--no-workspace");
      const output = yield* shell.run(args, input.workdir);
      return yield* parseJson<StackCreateResult>(output);
    });

  const describeStackChange = (message: string, workdir?: string) =>
    Effect.gen(function* () {
      const output = yield* shell.run(["stack", "describe", "--json", "--message", message], workdir);
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

  const submitStack = (input: { draft?: boolean; title?: string; body?: string; subscribe?: string; workdir?: string }) =>
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

  const getDaemonStatus = (): Effect.Effect<WebhookDaemonStatus, ShipCommandError | JsonParseError> =>
    Effect.gen(function* () {
      // First check if daemon is running by trying to get status
      const output = yield* shell.run(["webhook", "status", "--json"]).pipe(
        Effect.catchAll(() => Effect.succeed('{"running":false}')),
      );
      return yield* parseJson<WebhookDaemonStatus>(output);
    });

  const subscribeToPRs = (
    sessionId: string,
    prNumbers: number[],
  ): Effect.Effect<WebhookSubscribeResult, ShipCommandError | JsonParseError> =>
    Effect.gen(function* () {
      const prNumbersStr = prNumbers.join(",");
      const output = yield* shell.run([
        "webhook",
        "subscribe",
        "--json",
        "--session",
        sessionId,
        prNumbersStr,
      ]);
      return yield* parseJson<WebhookSubscribeResult>(output);
    });

  const unsubscribeFromPRs = (
    sessionId: string,
    prNumbers: number[],
  ): Effect.Effect<WebhookUnsubscribeResult, ShipCommandError | JsonParseError> =>
    Effect.gen(function* () {
      const prNumbersStr = prNumbers.join(",");
      const output = yield* shell.run([
        "webhook",
        "unsubscribe",
        "--json",
        "--session",
        sessionId,
        prNumbersStr,
      ]);
      return yield* parseJson<WebhookUnsubscribeResult>(output);
    });

  // Workspace operations - accept optional workdir
  const listWorkspaces = (workdir?: string): Effect.Effect<WorkspaceOutput[], ShipCommandError | JsonParseError> =>
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
    startWebhook,
    stopWebhook,
    getWebhookStatus,
    getDaemonStatus,
    subscribeToPRs,
    unsubscribeFromPRs,
    listWorkspaces,
    removeWorkspace,
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
};

const executeAction = (
  args: ToolArgs,
  contextSessionId?: string, // Session ID from OpenCode tool context
): Effect.Effect<string, ShipCommandError | JsonParseError | ShipNotConfiguredError, ShipService> =>
  Effect.gen(function* () {
    const ship = yield* ShipService;

    // Check configuration for all actions except status
    if (args.action !== "status") {
      const status = yield* ship.checkConfigured().pipe(Effect.catchAll(() => Effect.succeed({ configured: false })));
      if (!status.configured) {
        return yield* new ShipNotConfiguredError({});
      }
    }

    switch (args.action) {
      case "status": {
        const status = yield* ship.checkConfigured();
        if (status.configured) {
          return `Ship is configured.\n\nTeam: ${status.teamKey}\nProject: ${status.projectId || "none"}`;
        }
        return "Ship is not configured. Run 'ship init' first.";
      }

      case "ready": {
        const tasks = yield* ship.getReadyTasks();
        if (tasks.length === 0) {
          return "No tasks ready to work on (all tasks are either blocked or completed).";
        }
        return `Ready tasks (no blockers):\n\n${formatTaskList(tasks)}`;
      }

      case "blocked": {
        const tasks = yield* ship.getBlockedTasks();
        if (tasks.length === 0) {
          return "No blocked tasks.";
        }
        return `Blocked tasks:\n\n${formatTaskList(tasks)}`;
      }

      case "list": {
        const tasks = yield* ship.listTasks(args.filter);
        if (tasks.length === 0) {
          return "No tasks found matching the filter.";
        }
        return `Tasks:\n\n${formatTaskList(tasks)}`;
      }

      case "show": {
        if (!args.taskId) {
          return "Error: taskId is required for show action";
        }
        const task = yield* ship.getTask(args.taskId);
        return formatTaskDetails(task);
      }

      case "start": {
        if (!args.taskId) {
          return "Error: taskId is required for start action";
        }
        yield* ship.startTask(args.taskId);
        return `Started working on ${args.taskId}`;
      }

      case "done": {
        if (!args.taskId) {
          return "Error: taskId is required for done action";
        }
        yield* ship.completeTask(args.taskId);
        return `Completed ${args.taskId}`;
      }

      case "create": {
        if (!args.title) {
          return "Error: title is required for create action";
        }
        const task = yield* ship.createTask({
          title: args.title,
          description: args.description,
          priority: args.priority,
          parentId: args.parentId,
        });
        if (args.parentId) {
          return `Created subtask ${task.identifier}: ${task.title}\nParent: ${args.parentId}\nURL: ${task.url}`;
        }
        return `Created task ${task.identifier}: ${task.title}\nURL: ${task.url}`;
      }

      case "update": {
        if (!args.taskId) {
          return "Error: taskId is required for update action";
        }
        if (!args.title && !args.description && !args.priority && !args.status) {
          return "Error: at least one of title, description, priority, or status is required for update";
        }
        const task = yield* ship.updateTask(args.taskId, {
          title: args.title,
          description: args.description,
          priority: args.priority,
          status: args.status,
        });
        return `Updated task ${task.identifier}: ${task.title}\nURL: ${task.url}`;
      }

      case "block": {
        if (!args.blocker || !args.blocked) {
          return "Error: both blocker and blocked task IDs are required";
        }
        yield* ship.addBlocker(args.blocker, args.blocked);
        return `${args.blocker} now blocks ${args.blocked}`;
      }

      case "unblock": {
        if (!args.blocker || !args.blocked) {
          return "Error: both blocker and blocked task IDs are required";
        }
        yield* ship.removeBlocker(args.blocker, args.blocked);
        return `Removed ${args.blocker} as blocker of ${args.blocked}`;
      }

      case "relate": {
        if (!args.taskId || !args.relatedTaskId) {
          return "Error: both taskId and relatedTaskId are required for relate action";
        }
        yield* ship.relateTask(args.taskId, args.relatedTaskId);
        return `Linked ${args.taskId} ↔ ${args.relatedTaskId} as related`;
      }

      // Stack operations - pass workdir for workspace support
      case "stack-log": {
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
      }

      case "stack-status": {
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
        return output;
      }

      case "stack-create": {
        const result = yield* ship.createStackChange({
          message: args.message,
          bookmark: args.bookmark,
          noWorkspace: args.noWorkspace,
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
        }
        return output;
      }

      case "stack-describe": {
        if (!args.message) {
          return "Error: message is required for stack-describe action";
        }
        const result = yield* ship.describeStackChange(args.message, args.workdir);
        if (!result.updated) {
          return `Error: ${result.error || "Failed to update description"}`;
        }
        return `Updated change ${result.changeId?.slice(0, 8) || ""}\nDescription: ${result.description || args.message}`;
      }

      case "stack-sync": {
        const result = yield* ship.syncStack(args.workdir);
        if (result.error) {
          return `Sync failed: [${result.error.tag}] ${result.error.message}`;
        }

        // Build output parts
        const parts: string[] = [];

        // Report auto-abandoned merged changes
        if (result.abandonedMergedChanges && result.abandonedMergedChanges.length > 0) {
          parts.push("Auto-abandoned merged changes:");
          for (const change of result.abandonedMergedChanges) {
            const bookmarkInfo = change.bookmark ? ` (${change.bookmark})` : "";
            parts.push(`  - ${change.changeId}${bookmarkInfo}`);
          }
          parts.push("");
        }

        // Handle different scenarios
        if (result.stackFullyMerged) {
          parts.push("Stack fully merged! All changes are now in trunk.");
          if (result.cleanedUpWorkspace) {
            parts.push(`Cleaned up workspace: ${result.cleanedUpWorkspace}`);
          }
          parts.push(`  Trunk: ${result.trunkChangeId?.slice(0, 12) || "unknown"}`);
        } else if (result.conflicted) {
          parts.push("Sync completed with conflicts!");
          parts.push(`  Fetched: yes`);
          parts.push(`  Rebased: yes (with conflicts)`);
          parts.push(`  Trunk:   ${result.trunkChangeId?.slice(0, 12) || "unknown"}`);
          parts.push(`  Stack:   ${result.stackSize} change(s)`);
          parts.push("");
          parts.push("Resolve conflicts with 'jj status' and edit the conflicted files.");
        } else if (!result.rebased) {
          parts.push("Already up to date.");
          parts.push(`  Trunk: ${result.trunkChangeId?.slice(0, 12) || "unknown"}`);
          parts.push(`  Stack: ${result.stackSize} change(s)`);
        } else {
          parts.push("Sync completed successfully.");
          parts.push(`  Fetched: yes`);
          parts.push(`  Rebased: yes`);
          parts.push(`  Trunk:   ${result.trunkChangeId?.slice(0, 12) || "unknown"}`);
          parts.push(`  Stack:   ${result.stackSize} change(s)`);
        }

        return parts.join("\n");
      }

      case "stack-restack": {
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
      }

      case "stack-submit": {
        // Auto-subscribe using context session ID (from OpenCode) or explicit sessionId arg
        const subscribeSessionId = args.sessionId || contextSessionId;
        
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
          const statusMsg = result.pr.status === "created"
            ? "Created PR"
            : result.pr.status === "exists"
              ? "PR already exists"
              : "Updated PR";
          output = `Pushed bookmark: ${result.bookmark}\nBase branch: ${result.baseBranch || "main"}\n${statusMsg}: #${result.pr.number}\nURL: ${result.pr.url}`;
        } else {
          output = `Pushed bookmark: ${result.bookmark}\nBase branch: ${result.baseBranch || "main"}`;
        }
        // Add subscription info if auto-subscribed
        if (result.subscribed) {
          output += `\n\nAuto-subscribed to stack PRs: ${result.subscribed.prNumbers.join(", ")}`;
        }
        return output;
      }

      case "stack-squash": {
        if (!args.message) {
          return "Error: message is required for stack-squash action";
        }
        const result = yield* ship.squashStack(args.message, args.workdir);
        if (!result.squashed) {
          return `Error: ${result.error || "Failed to squash"}`;
        }
        return `Squashed into ${result.intoChangeId?.slice(0, 8) || "parent"}\nDescription: ${result.description?.split("\n")[0] || "(no description)"}`;
      }

      case "stack-abandon": {
        const result = yield* ship.abandonStack(args.changeId, args.workdir);
        if (!result.abandoned) {
          return `Error: ${result.error || "Failed to abandon"}`;
        }
        return `Abandoned ${result.changeId?.slice(0, 8) || "change"}\nWorking copy now at: ${result.newWorkingCopy?.slice(0, 8) || "unknown"}`;
      }

      // Stack navigation
      case "stack-up": {
        const result = yield* ship.stackUp(args.workdir);
        if (!result.moved) {
          return result.error || "Already at the tip of the stack (no child change)";
        }
        return `Moved up in stack:\n  From: ${result.from?.changeId.slice(0, 8) || "unknown"} ${result.from?.description || ""}\n  To:   ${result.to?.changeId.slice(0, 8) || "unknown"} ${result.to?.description || ""}`;
      }

      case "stack-down": {
        const result = yield* ship.stackDown(args.workdir);
        if (!result.moved) {
          return result.error || "Already at the base of the stack (on trunk)";
        }
        return `Moved down in stack:\n  From: ${result.from?.changeId.slice(0, 8) || "unknown"} ${result.from?.description || ""}\n  To:   ${result.to?.changeId.slice(0, 8) || "unknown"} ${result.to?.description || ""}`;
      }

      // Stack recovery
      case "stack-undo": {
        const result = yield* ship.stackUndo(args.workdir);
        if (!result.undone) {
          return `Error: ${result.error || "Failed to undo"}`;
        }
        return result.operation ? `Undone: ${result.operation}` : "Undone last operation";
      }

      case "stack-update-stale": {
        const result = yield* ship.stackUpdateStale(args.workdir);
        if (!result.updated) {
          return `Error: ${result.error || "Failed to update stale workspace"}`;
        }
        return result.changeId
          ? `Working copy updated. Now at: ${result.changeId}`
          : "Working copy updated.";
      }

      // Workspace operations - pass workdir for workspace support
      case "stack-workspaces": {
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
      }

      case "stack-remove-workspace": {
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
        return output;
      }

      // Webhook operations
      case "webhook-start": {
        const result = yield* ship.startWebhook(args.events);
        if (!result.started) {
          return `Error: ${result.error}${result.pid ? ` (PID: ${result.pid})` : ""}`;
        }
        return `Webhook forwarding started (PID: ${result.pid})
Events: ${result.events?.join(", ") || "default"}

GitHub events will be forwarded to the current OpenCode session.
Use action 'webhook-stop' to stop forwarding.`;
      }

      case "webhook-stop": {
        const result = yield* ship.stopWebhook();
        if (!result.stopped) {
          return result.error || "No webhook forwarding process is running";
        }
        return "Webhook forwarding stopped.";
      }

      case "webhook-status": {
        const status = yield* ship.getWebhookStatus();
        if (status.running) {
          return `Webhook forwarding is running (PID: ${status.pid})`;
        }
        return "Webhook forwarding is not running.";
      }

      // Daemon-based webhook operations
      case "webhook-subscribe": {
        // Auto-detect session ID from context (like stack-submit does)
        const sessionId = args.sessionId || contextSessionId;
        if (!sessionId) {
          return "Error: sessionId is required for webhook-subscribe action (not provided and could not auto-detect from context)";
        }
        if (!args.prNumbers || args.prNumbers.length === 0) {
          return "Error: prNumbers is required for webhook-subscribe action";
        }
        const result = yield* ship.subscribeToPRs(sessionId, args.prNumbers);
        if (!result.subscribed) {
          return `Error: ${result.error || "Failed to subscribe"}`;
        }
        return `Subscribed session ${sessionId} to PRs: ${args.prNumbers.join(", ")}

The daemon will forward GitHub events for these PRs to your session.
Use 'webhook-unsubscribe' to stop receiving events.`;
      }

      case "webhook-unsubscribe": {
        if (!args.sessionId) {
          return "Error: sessionId is required for webhook-unsubscribe action";
        }
        if (!args.prNumbers || args.prNumbers.length === 0) {
          return "Error: prNumbers is required for webhook-unsubscribe action";
        }
        const result = yield* ship.unsubscribeFromPRs(args.sessionId, args.prNumbers);
        if (!result.unsubscribed) {
          return `Error: ${result.error || "Failed to unsubscribe"}`;
        }
        return `Unsubscribed session ${args.sessionId} from PRs: ${args.prNumbers.join(", ")}`;
      }

      case "webhook-daemon-status": {
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
      }

      default:
        return `Unknown action: ${args.action}`;
    }
  });

// =============================================================================
// Tool Creation
// =============================================================================

/**
 * Create the ship tool with the opencode context.
 * 
 * @param $ - Bun shell from opencode
 * @param directory - Current working directory from opencode (Instance.directory)
 * @returns ToolDefinition for the ship tool
 */
const createShipTool = ($: BunShell, directory: string): ToolDefinition => {
  const shellService = makeShellService($, directory);
  const ShellServiceLive = Layer.succeed(ShellService, shellService);
  const ShipServiceLive = Layer.effect(ShipService, makeShipService).pipe(Layer.provide(ShellServiceLive));

  const runEffect = <A, E>(effect: Effect.Effect<A, E, ShipService>): Promise<A> =>
    Effect.runPromise(Effect.provide(effect, ShipServiceLive));

  return createTool({
    description: `Linear task management and VCS operations for the current project.

IMPORTANT: Always use this tool for VCS operations. NEVER run jj, gh, or git commands directly via bash.
- Use stack-create instead of: jj new, jj describe, jj bookmark create
- Use stack-describe instead of: jj describe
- Use stack-submit instead of: jj git push, gh pr create
- Use stack-sync instead of: jj git fetch, jj rebase

Use this tool to:
- List tasks ready to work on (no blockers)
- View task details
- Start/complete tasks
- Create new tasks
- Manage task dependencies (blocking relationships)
- Get AI-optimized context about current work
- Manage stacked changes (jj workflow)
- Start/stop GitHub webhook forwarding for real-time event notifications
- Subscribe to PR events via the webhook daemon (multi-session support)

Requires ship to be configured in the project (.ship/config.yaml).
Run 'ship init' in the terminal first if not configured.`,

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
          "stack-workspaces",
          "stack-remove-workspace",
          "webhook-daemon-status",
          "webhook-subscribe",
          "webhook-unsubscribe",
        ])
        .describe(
          "Action to perform: ready (unblocked tasks), list (all tasks), blocked (blocked tasks), show (task details), start (begin task), done (complete task), create (new task), update (modify task), block/unblock (dependencies), relate (link related tasks), status (current config), stack-log (view stack), stack-status (current change), stack-create (new change with workspace by default), stack-describe (update description), stack-sync (fetch and rebase), stack-restack (rebase stack onto trunk without fetching), stack-submit (push and create/update PR, auto-subscribes to webhook events), stack-squash (squash into parent), stack-abandon (abandon change), stack-up (move to child change toward tip), stack-down (move to parent change toward trunk), stack-undo (undo last jj operation), stack-update-stale (update stale working copy after workspace or remote changes), stack-workspaces (list all jj workspaces), stack-remove-workspace (remove a jj workspace), webhook-daemon-status (check daemon status), webhook-subscribe (subscribe to PR events), webhook-unsubscribe (unsubscribe from PR events)"
        ),
      taskId: createTool.schema
        .string()
        .optional()
        .describe("Task identifier (e.g., BRI-123) - required for show, start, done, update"),
      title: createTool.schema.string().optional().describe("Task title - required for create, optional for update"),
      description: createTool.schema.string().optional().describe("Task description - optional for create/update"),
      priority: createTool.schema
        .enum(["urgent", "high", "medium", "low", "none"])
        .optional()
        .describe("Task priority - optional for create/update"),
      status: createTool.schema
        .enum(["backlog", "todo", "in_progress", "in_review", "done", "cancelled"])
        .optional()
        .describe("Task status - optional for update"),
      blocker: createTool.schema.string().optional().describe("Blocker task ID - required for block/unblock"),
      blocked: createTool.schema.string().optional().describe("Blocked task ID - required for block/unblock"),
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
        .describe("Message for stack-create or stack-describe actions"),
      bookmark: createTool.schema
        .string()
        .optional()
        .describe("Bookmark name for stack-create action"),
      noWorkspace: createTool.schema
        .boolean()
        .optional()
        .describe("Skip workspace creation - for stack-create action (by default, workspace is created for isolated development)"),
      name: createTool.schema
        .string()
        .optional()
        .describe("Workspace name - required for stack-remove-workspace action"),
      deleteFiles: createTool.schema
        .boolean()
        .optional()
        .describe("Also delete the workspace directory from disk - for stack-remove-workspace action"),
      workdir: createTool.schema
        .string()
        .optional()
        .describe("Working directory for VCS operations - use this when operating in a jj workspace (e.g., the path returned by stack-create)"),
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
        .describe("Comma-separated GitHub events to forward (e.g., 'pull_request,check_run') - for webhook-start action"),
      sessionId: createTool.schema
        .string()
        .optional()
        .describe("OpenCode session ID - for webhook-subscribe/unsubscribe actions"),
      prNumbers: createTool.schema
        .array(createTool.schema.number())
        .optional()
        .describe("PR numbers to subscribe/unsubscribe - for webhook-subscribe/unsubscribe actions"),
    },

    async execute(args, context) {
      // Pass context.sessionID for auto-subscription in stack-submit
      const result = await runEffect(
        executeAction(args, context.sessionID).pipe(
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
          })
        )
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
// Plugin Export
// =============================================================================

export const ShipPlugin: Plugin = async ({ $, directory }) => ({
  config: async (config) => {
    config.command = { ...config.command, ...SHIP_COMMANDS };
  },
  tool: {
    ship: createShipTool($, directory),
  },
});

export default ShipPlugin;
