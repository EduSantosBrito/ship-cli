/**
 * Core services for the Ship OpenCode Plugin.
 * Separated from plugin.ts for testability (avoids @opencode-ai/plugin import issues in tests).
 */

import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import * as Context from "effect/Context";
import { extractJson, type ShipTask } from "./utils.js";

// =============================================================================
// Errors
// =============================================================================

export class ShipCommandError extends Data.TaggedError("ShipCommandError")<{
  readonly command: string;
  readonly message: string;
}> {}

export class JsonParseError extends Data.TaggedError("JsonParseError")<{
  readonly raw: string;
  readonly cause: unknown;
}> {}

// =============================================================================
// Types
// =============================================================================

export interface ShipStatus {
  configured: boolean;
  teamId?: string;
  teamKey?: string;
  projectId?: string | null;
}

export interface ShipSubtask {
  id: string;
  identifier: string;
  title: string;
  state: string;
  stateType: string;
  isDone: boolean;
}

export interface ShipMilestone {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  targetDate?: string | null;
  projectId: string;
  sortOrder: number;
}

export interface StackChange {
  changeId: string;
  commitId: string;
  description: string;
  bookmarks: string[];
  isEmpty: boolean;
  isWorkingCopy: boolean;
}

export interface StackStatus {
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

export interface StackCreateResult {
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

export interface StackDescribeResult {
  updated: boolean;
  changeId?: string;
  description?: string;
  error?: string;
}

export interface AbandonedMergedChange {
  changeId: string;
  bookmark?: string;
}

export interface StackSyncResult {
  fetched: boolean;
  rebased: boolean;
  trunkChangeId?: string;
  stackSize?: number;
  conflicted?: boolean;
  abandonedMergedChanges?: AbandonedMergedChange[];
  stackFullyMerged?: boolean;
  cleanedUpWorkspace?: string;
  error?: { tag: string; message: string };
}

export interface StackRestackResult {
  restacked: boolean;
  stackSize?: number;
  trunkChangeId?: string;
  conflicted?: boolean;
  error?: string;
}

export interface StackSubmitResult {
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

export interface StackSquashResult {
  squashed: boolean;
  intoChangeId?: string;
  description?: string;
  error?: string;
}

export interface StackAbandonResult {
  abandoned: boolean;
  changeId?: string;
  newWorkingCopy?: string;
  error?: string;
}

export interface StackNavigateResult {
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

export interface StackUndoResult {
  undone: boolean;
  operation?: string;
  error?: string;
}

export interface StackUpdateStaleResult {
  updated: boolean;
  changeId?: string;
  error?: string;
}

export interface StackBookmarkResult {
  success: boolean;
  action: "created" | "moved";
  bookmark: string;
  changeId?: string;
  error?: string;
}

export interface WorkspaceOutput {
  name: string;
  path: string;
  changeId: string;
  description: string;
  isDefault: boolean;
  stackName: string | null;
  taskId: string | null;
}

export interface RemoveWorkspaceResult {
  removed: boolean;
  name: string;
  filesDeleted?: boolean;
  error?: string;
}

export interface WebhookDaemonStatus {
  running: boolean;
  pid?: number;
  repo?: string;
  connectedToGitHub?: boolean;
  subscriptions?: Array<{ sessionId: string; prNumbers: number[] }>;
  uptime?: number;
}

export interface WebhookSubscribeResult {
  subscribed: boolean;
  sessionId?: string;
  prNumbers?: number[];
  error?: string;
}

export interface WebhookUnsubscribeResult {
  unsubscribed: boolean;
  sessionId?: string;
  prNumbers?: number[];
  error?: string;
}

export interface WebhookCleanupResult {
  success: boolean;
  removedSessions: string[];
  remainingSessions?: number;
  error?: string;
}

// =============================================================================
// Shell Service
// =============================================================================

export interface ShellService {
  readonly run: (args: string[], cwd?: string) => Effect.Effect<string, ShipCommandError>;
}

export const ShellService = Context.GenericTag<ShellService>("ShellService");

/**
 * Create a shell service that extracts JSON from CLI output.
 * The actual shell execution is handled by the BunShell in the plugin.
 */
export const createShellService = (
  execute: (args: string[], cwd?: string) => Effect.Effect<string, ShipCommandError>,
): ShellService => ({
  run: (args: string[], cwd?: string) =>
    execute(args, cwd).pipe(
      Effect.map((output) => (args.includes("--json") ? extractJson(output) : output)),
    ),
});

// =============================================================================
// JSON Parsing
// =============================================================================

/**
 * Parse JSON with type assertion.
 */
export const parseJson = <T>(raw: string): Effect.Effect<T, JsonParseError> =>
  Effect.try({
    try: () => {
      const parsed = JSON.parse(raw);
      if (parsed === null || (typeof parsed !== "object" && !Array.isArray(parsed))) {
        throw new Error(`Expected object or array, got ${typeof parsed}`);
      }
      return parsed as T;
    },
    catch: (cause) => new JsonParseError({ raw: raw.slice(0, 500), cause }),
  });

// =============================================================================
// Ship Service
// =============================================================================

export interface ShipService {
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
    message: string,
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
    subscribe?: string;
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
  readonly stackUp: (
    workdir?: string,
  ) => Effect.Effect<StackNavigateResult, ShipCommandError | JsonParseError>;
  readonly stackDown: (
    workdir?: string,
  ) => Effect.Effect<StackNavigateResult, ShipCommandError | JsonParseError>;
  readonly stackUndo: (
    workdir?: string,
  ) => Effect.Effect<StackUndoResult, ShipCommandError | JsonParseError>;
  readonly stackUpdateStale: (
    workdir?: string,
  ) => Effect.Effect<StackUpdateStaleResult, ShipCommandError | JsonParseError>;
  readonly bookmarkStack: (
    name: string,
    move?: boolean,
    workdir?: string,
  ) => Effect.Effect<StackBookmarkResult, ShipCommandError | JsonParseError>;
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
  readonly listWorkspaces: (
    workdir?: string,
  ) => Effect.Effect<WorkspaceOutput[], ShipCommandError | JsonParseError>;
  readonly removeWorkspace: (
    name: string,
    deleteFiles?: boolean,
    workdir?: string,
  ) => Effect.Effect<RemoveWorkspaceResult, ShipCommandError | JsonParseError>;
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
}

export const ShipServiceTag = Context.GenericTag<ShipService>("ShipService");

/**
 * Create the ShipService implementation.
 * This is an Effect that requires ShellService and produces ShipService.
 */
export const makeShipService = Effect.gen(function* () {
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

  const describeStackChange = (message: string, workdir?: string) =>
    Effect.gen(function* () {
      const output = yield* shell.run(
        ["stack", "describe", "--json", "--message", message],
        workdir,
      );
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

  const bookmarkStack = (name: string, move?: boolean, workdir?: string) =>
    Effect.gen(function* () {
      const args = ["stack", "bookmark", "--json"];
      if (move) args.push("--move");
      args.push(name);
      const output = yield* shell.run(args, workdir);
      return yield* parseJson<StackBookmarkResult>(output);
    });

  const getDaemonStatus = (): Effect.Effect<
    WebhookDaemonStatus,
    ShipCommandError | JsonParseError
  > =>
    Effect.gen(function* () {
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

  const cleanupStaleSubscriptions = (): Effect.Effect<
    WebhookCleanupResult,
    ShipCommandError | JsonParseError
  > =>
    Effect.gen(function* () {
      const output = yield* shell.run(["webhook", "cleanup", "--json"]);
      return yield* parseJson<WebhookCleanupResult>(output);
    });

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
      const args = ["task", "update", "--json", "--milestone", "", taskId];
      const output = yield* shell.run(args);
      const response = yield* parseJson<{ task: ShipTask }>(output);
      return response.task;
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
  } satisfies ShipService;
});
