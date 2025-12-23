import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Duration from "effect/Duration";
import * as Command from "@effect/platform/Command";
import * as CommandExecutor from "@effect/platform/CommandExecutor";
import { JjNotInstalledError, VcsError } from "../../../domain/Errors.js";
import {
  DEFAULT_WORKSPACE_NAME,
  SHIP_WORKSPACES_DIR,
} from "../../../domain/Config.js";
import {
  VcsService,
  ChangeId,
  Change,
  PushResult,
  TrunkInfo,
  SyncResult,
  AbandonedMergedChange,
  WorkspaceInfo,
  UpdateStaleResult,
  type VcsErrors,
} from "../../../ports/VcsService.js";
import {
  JJ_LOG_JSON_TEMPLATE,
  parseChanges,
  parseChangeIdFromOutput,
  getCurrentChangeId,
} from "./JjParser.js";
import { mapJjError, looksLikeError, type JjError } from "./JjErrorMapper.js";

// Retry policy for network operations: exponential backoff with max 3 retries
const networkRetryPolicy = Schedule.intersect(
  Schedule.exponential(Duration.millis(500)),
  Schedule.recurs(3),
);

// Timeout for network operations
const NETWORK_TIMEOUT = Duration.seconds(60);

const make = Effect.gen(function* () {
  // Get CommandExecutor from context - it will be provided by the layer
  const executor = yield* CommandExecutor.CommandExecutor;

  /**
   * Escape a string for safe use in a single-quoted shell argument.
   * Uses the POSIX-compliant pattern: replace ' with '\'' (end quote, escaped quote, start quote).
   *
   * Note: Consider using a library like `shell-quote` for more complex escaping needs.
   * For our use case (simple jj command arguments), this pattern is sufficient and well-tested.
   */
  const escapeShellArg = (arg: string): string => `'${arg.replace(/'/g, "'\"'\"'")}'`;

  /**
   * Run a jj command and return combined stdout+stderr as string.
   *
   * Why shell wrapper? jj outputs most information to stderr, not stdout.
   * @effect/platform's Command.string only captures stdout, so we use
   * `sh -c "jj ... 2>&1"` to redirect stderr to stdout for capture.
   *
   * Error handling: If the output looks like an error (based on heuristics),
   * we map it to a typed JjError using the error mapper.
   */
  const runJj = (...args: ReadonlyArray<string>): Effect.Effect<string, JjError> => {
    const escapedArgs = args.map(escapeShellArg).join(" ");
    const cmd = Command.make("sh", "-c", `jj ${escapedArgs} 2>&1`);
    const command = args[0] ?? "unknown";

    return Command.string(cmd).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
      Effect.flatMap((output) => {
        // Check if output looks like an error
        if (looksLikeError(output)) {
          return Effect.fail(mapJjError(output, command));
        }
        return Effect.succeed(output);
      }),
      Effect.mapError((e) => {
        // If already a JjError, pass through
        if (e && typeof e === "object" && "_tag" in e) {
          return e as JjError;
        }
        // Otherwise map the platform error
        return new VcsError({ message: `jj ${command} failed: ${e}`, cause: e });
      }),
    );
  };

  /**
   * Run a jj command and return exit code (for checking success/failure).
   *
   * Note: Uses direct execution (not shell-wrapped) since we only need the exit code,
   * not the output. Exit codes work correctly without stderr capture.
   */
  const runJjExitCode = (...args: ReadonlyArray<string>): Effect.Effect<number, never> => {
    const cmd = Command.make("jj", ...args);
    return Command.exitCode(cmd).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
      Effect.catchAll(() => Effect.succeed(1)),
    );
  };

  /**
   * Wrap an effect with network retry and timeout
   */
  const withNetworkRetry = <A, E>(
    effect: Effect.Effect<A, E>,
    operation: string,
  ): Effect.Effect<A, E | VcsError> =>
    effect.pipe(
      Effect.timeoutFail({
        duration: NETWORK_TIMEOUT,
        onTimeout: () => new VcsError({ message: `${operation} timed out after 60 seconds` }),
      }),
      Effect.retry(networkRetryPolicy),
    );

  const isAvailable = (): Effect.Effect<boolean, never> => {
    const cmd = Command.make("jj", "version");
    return Command.exitCode(cmd).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
      Effect.map((code) => code === 0),
      Effect.catchAll(() => Effect.succeed(false)),
    );
  };

  const isRepo = (): Effect.Effect<boolean, VcsErrors> =>
    runJjExitCode("root").pipe(Effect.map((code) => code === 0));

  const createChange = (
    message: string,
  ): Effect.Effect<ChangeId, JjNotInstalledError | VcsErrors> =>
    Effect.gen(function* () {
      const available = yield* isAvailable();
      if (!available) {
        return yield* JjNotInstalledError.default;
      }
      // Run jj new, then get the change ID from the new working copy
      // This is more reliable than parsing the stderr output
      yield* runJj("new", "-m", message);
      return yield* getCurrentChangeId(runJj);
    });

  const describe = (message: string): Effect.Effect<void, VcsErrors> =>
    runJj("describe", "-m", message).pipe(Effect.asVoid);

  const commit = (message: string): Effect.Effect<ChangeId, VcsErrors> =>
    Effect.gen(function* () {
      yield* runJj("commit", "-m", message);
      return yield* getCurrentChangeId(runJj);
    });

  const createBookmark = (name: string, ref?: ChangeId): Effect.Effect<void, VcsErrors> => {
    if (ref) {
      return runJj("bookmark", "create", name, "-r", ref).pipe(Effect.asVoid);
    }
    return runJj("bookmark", "create", name).pipe(Effect.asVoid);
  };

  const moveBookmark = (name: string, ref?: ChangeId): Effect.Effect<void, VcsErrors> => {
    if (ref) {
      return runJj("bookmark", "move", name, "--to", ref).pipe(Effect.asVoid);
    }
    return runJj("bookmark", "move", name, "--to", "@").pipe(Effect.asVoid);
  };

  const getCurrentChange = (): Effect.Effect<Change, VcsErrors> =>
    Effect.gen(function* () {
      const output = yield* runJj("log", "-r", "@", "-T", JJ_LOG_JSON_TEMPLATE, "--no-graph");
      const changes = yield* parseChanges(output);
      if (changes.length === 0) {
        return yield* new VcsError({ message: "No current change found" });
      }
      return changes[0];
    });

  const push = (bookmark: string): Effect.Effect<PushResult, VcsErrors> =>
    withNetworkRetry(
      Effect.gen(function* () {
        // Use --allow-new to support pushing new bookmarks for the first time
        yield* runJj("git", "push", "-b", bookmark, "--allow-new");
        // Get the current change to return the change ID
        const current = yield* getCurrentChange();
        return new PushResult({
          bookmark,
          remote: "origin",
          changeId: current.id,
        });
      }),
      "git push",
    );

  const getStack = (): Effect.Effect<ReadonlyArray<Change>, VcsErrors> =>
    Effect.gen(function* () {
      // Get changes from trunk (main/master) to current working copy
      const output = yield* runJj(
        "log",
        "-r",
        "trunk()..@",
        "-T",
        JJ_LOG_JSON_TEMPLATE,
        "--no-graph",
      );
      return yield* parseChanges(output);
    });

  const getLog = (revset?: string): Effect.Effect<ReadonlyArray<Change>, VcsErrors> =>
    Effect.gen(function* () {
      const rev = revset ?? "@";
      const output = yield* runJj("log", "-r", rev, "-T", JJ_LOG_JSON_TEMPLATE, "--no-graph");
      return yield* parseChanges(output);
    });

  const fetch = (): Effect.Effect<void, VcsErrors> =>
    withNetworkRetry(runJj("git", "fetch").pipe(Effect.asVoid), "git fetch");

  const getTrunkInfo = (): Effect.Effect<TrunkInfo, VcsErrors> =>
    Effect.gen(function* () {
      // Get trunk info using jj log
      const output = yield* runJj("log", "-r", "trunk()", "-T", JJ_LOG_JSON_TEMPLATE, "--no-graph");
      const changes = yield* parseChanges(output);
      if (changes.length === 0) {
        return yield* new VcsError({ message: "Could not find trunk (main/master)" });
      }
      const trunk = changes[0];
      return new TrunkInfo({
        id: trunk.id,
        shortChangeId: trunk.changeId,
        description: trunk.description,
      });
    });

  const rebase = (source: ChangeId, destination = "main"): Effect.Effect<void, VcsErrors> =>
    runJj("rebase", "-s", source, "-d", destination).pipe(Effect.asVoid);

  const getParentChange = (): Effect.Effect<Change | null, VcsErrors> =>
    Effect.gen(function* () {
      // Get parent of current working copy using @- revset
      const output = yield* runJj("log", "-r", "@-", "-T", JJ_LOG_JSON_TEMPLATE, "--no-graph");
      const changes = yield* parseChanges(output);

      if (changes.length === 0) {
        return null;
      }

      const parent = changes[0];

      // Check if parent is trunk (main/master) - if so, return null
      // We detect this by checking if the parent has no bookmarks that are user-created
      // (trunk has bookmarks like "main" or "master" but those are tracked remotes)
      const trunkResult = yield* getTrunkInfo().pipe(
        Effect.map((trunk) => ({ success: true as const, trunk })),
        Effect.catchAll(() => Effect.succeed({ success: false as const })),
      );

      if (trunkResult.success && parent.id === trunkResult.trunk.id) {
        // Parent is trunk, so there's no "parent change" in the stack sense
        return null;
      }

      return parent;
    });

  const sync = (): Effect.Effect<SyncResult, VcsErrors> =>
    Effect.gen(function* () {
      // 1. Fetch from remote
      yield* fetch();

      // 2. Get current stack before rebase
      const stackBefore = yield* getStack();

      // If no stack (already on trunk), we're done
      if (stackBefore.length === 0) {
        const trunk = yield* getTrunkInfo();
        return new SyncResult({
          fetched: true,
          rebased: false,
          trunkChangeId: trunk.shortChangeId,
          stackSize: 0,
          conflicted: false,
          abandonedMergedChanges: [],
          stackFullyMerged: false,
        });
      }

      // 3. Get the first change in stack (oldest, closest to trunk)
      // Stack is returned with newest first, so last element is the base
      const firstInStack = stackBefore[stackBefore.length - 1];

      // 4. Rebase stack onto trunk
      const rebaseResult = yield* runJj("rebase", "-s", firstInStack.id, "-d", "main").pipe(
        Effect.map(() => ({ conflicted: false })),
        Effect.catchTag("JjConflictError", () => Effect.succeed({ conflicted: true })),
      );

      // 5. Get updated stack after rebase
      let stackAfter = yield* getStack();

      // 6. Detect and abandon merged changes
      // After rebase, changes that became empty AND have a bookmark are likely merged
      // (their content is now in trunk)
      const abandonedChanges: AbandonedMergedChange[] = [];

      // Find changes that:
      // - Are empty (their content is now in the parent/trunk)
      // - Have at least one bookmark (they were pushed and tracked)
      // - Are not the working copy (don't abandon the current change if it's empty but we're working on it)
      const mergedChanges = stackAfter.filter(
        (change) => change.isEmpty && change.bookmarks.length > 0 && !change.isWorkingCopy,
      );

      // Abandon each merged change (jj will automatically restack descendants)
      for (const change of mergedChanges) {
        yield* runJj("abandon", change.id).pipe(
          Effect.tap(() =>
            Effect.logInfo(`Auto-abandoned merged change: ${change.changeId}`).pipe(
              Effect.annotateLogs({ bookmark: change.bookmarks[0] ?? "none" }),
            ),
          ),
          Effect.catchAll((e) =>
            Effect.logWarning(`Failed to abandon merged change: ${change.changeId}`).pipe(
              Effect.annotateLogs({ error: String(e) }),
            ),
          ),
        );

        abandonedChanges.push(
          new AbandonedMergedChange({
            changeId: change.changeId,
            bookmark: change.bookmarks[0],
          }),
        );
      }

      // 7. Get final stack after abandoning merged changes
      stackAfter = yield* getStack();
      const trunk = yield* getTrunkInfo();

      // Check if the entire stack was merged
      // Case 1: We abandoned changes and stack is now empty
      // Case 2: Stack only has an empty working copy placeholder with no bookmark
      //         (this happens when the last/only change was merged - its content is in trunk,
      //          leaving just an empty working copy)
      const isEmptyPlaceholderOnly =
        stackAfter.length === 1 &&
        stackAfter[0].isWorkingCopy &&
        stackAfter[0].isEmpty &&
        stackAfter[0].bookmarks.length === 0 &&
        (!stackAfter[0].description ||
          stackAfter[0].description === "(no description)" ||
          stackAfter[0].description.trim() === "");

      const stackFullyMerged =
        (abandonedChanges.length > 0 && stackAfter.length === 0) || isEmptyPlaceholderOnly;

      return new SyncResult({
        fetched: true,
        rebased: true,
        trunkChangeId: trunk.shortChangeId,
        stackSize: stackAfter.length,
        conflicted: rebaseResult.conflicted,
        abandonedMergedChanges: abandonedChanges,
        stackFullyMerged,
      });
    });

  const squash = (message: string): Effect.Effect<Change, VcsErrors> =>
    Effect.gen(function* () {
      // Run jj squash with message to set description on the combined change
      yield* runJj("squash", "-m", message);

      // After squash, jj creates a new empty working copy on top of the squashed result.
      // We need to return the parent (the actual squashed change), not the new empty working copy.
      const parent = yield* getParentChange();
      if (!parent) {
        return yield* new VcsError({ message: "Failed to get squashed change" });
      }
      return parent;
    });

  const abandon = (changeId?: string): Effect.Effect<Change, VcsErrors> =>
    Effect.gen(function* () {
      // Run jj abandon with optional change ID
      if (changeId) {
        yield* runJj("abandon", changeId);
      } else {
        yield* runJj("abandon");
      }

      // After abandon, working copy moves to a new empty change
      return yield* getCurrentChange();
    });

  // === Workspace Operations (jj workspace) ===

  /**
   * Template for jj workspace list output.
   * Returns format: name|changeId|shortChangeId|description
   *
   * WorkspaceRef type has:
   * - .name() -> RefSymbol: workspace name
   * - .target() -> Commit: working-copy commit of this workspace
   */
  const JJ_WORKSPACE_TEMPLATE =
    'self.name() ++ "|" ++ self.target().change_id() ++ "|" ++ self.target().change_id().short(8) ++ "|" ++ self.target().description().first_line() ++ "\\n"';

  /**
   * Parse jj workspace list output into WorkspaceInfo objects.
   *
   * Output format (with our template):
   * default|abc123...|abc12345|description here
   * feature|def456...|def45678|another description
   */
  const parseWorkspaceList = (
    output: string,
    mainRepoPath: string,
  ): ReadonlyArray<WorkspaceInfo> => {
    const workspaces: WorkspaceInfo[] = [];
    const lines = output.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      const parts = line.split("|");
      if (parts.length >= 4) {
        const name = parts[0];
        const changeId = parts[1];
        const shortChangeId = parts[2];
        const description = parts.slice(3).join("|"); // Description might contain |

        // Determine path: default workspace is at mainRepoPath
        // Non-default workspaces are in .ship/workspaces/<name>
        const path =
          name === DEFAULT_WORKSPACE_NAME
            ? mainRepoPath
            : `${mainRepoPath}/.ship/${SHIP_WORKSPACES_DIR}/${name}`;

        workspaces.push(
          new WorkspaceInfo({
            name,
            path,
            changeId,
            shortChangeId,
            description: description || "(no description)",
            isDefault: name === "default",
          }),
        );
      }
    }

    return workspaces;
  };

  /**
   * Create a workspace with proper resource management.
   *
   * Uses Effect.acquireRelease pattern to ensure cleanup on failure:
   * - If workspace creation succeeds but subsequent operations fail,
   *   the workspace is automatically forgotten to avoid leaving orphaned state.
   *
   * @param name - Workspace name for identification
   * @param path - Path where the workspace will be created
   * @param revision - Optional revision to checkout (defaults to @-)
   */
  const createWorkspace = (
    name: string,
    path: string,
    revision?: string,
  ): Effect.Effect<WorkspaceInfo, VcsErrors> =>
    Effect.acquireUseRelease(
      // Acquire: Create the workspace
      Effect.gen(function* () {
        yield* Effect.logDebug(`Creating workspace '${name}' at ${path}`);

        const args = ["workspace", "add", path, "--name", name];
        if (revision) {
          args.push("-r", revision);
        } else {
          // Default to parent of current change so the workspace starts fresh
          args.push("-r", "@-");
        }

        yield* runJj(...args);
        return name;
      }),
      // Use: Get info about the created workspace
      (createdName) =>
        Effect.gen(function* () {
          const workspaces = yield* listWorkspaces();
          const created = workspaces.find((ws) => ws.name === createdName);

          if (!created) {
            return yield* new VcsError({
              message: `Workspace created but not found in list: ${createdName}`,
            });
          }

          yield* Effect.logDebug(
            `Workspace '${created.name}' created successfully at ${created.path}`,
          );
          return created;
        }),
      // Release: Clean up on failure
      (createdName, exit) =>
        Effect.gen(function* () {
          if (exit._tag === "Failure") {
            yield* Effect.logDebug(`Cleaning up workspace '${createdName}' due to failure`);
            yield* forgetWorkspace(createdName).pipe(
              Effect.catchAll(() => Effect.void), // Ignore cleanup errors
            );
          }
        }),
    );

  const listWorkspaces = (): Effect.Effect<ReadonlyArray<WorkspaceInfo>, VcsErrors> =>
    Effect.gen(function* () {
      // Get the main repo root for path resolution
      const repoRoot = yield* runJj("workspace", "root");
      const mainRepoPath = repoRoot.trim();

      // Use template to get structured output
      const output = yield* runJj("workspace", "list", "-T", JJ_WORKSPACE_TEMPLATE);
      return parseWorkspaceList(output, mainRepoPath);
    });

  const forgetWorkspace = (name: string): Effect.Effect<void, VcsErrors> =>
    Effect.gen(function* () {
      yield* Effect.logDebug(`Forgetting workspace '${name}'`);
      yield* runJj("workspace", "forget", name);
    });

  const getWorkspaceRoot = (): Effect.Effect<string, VcsErrors> =>
    Effect.gen(function* () {
      const output = yield* runJj("workspace", "root");
      return output.trim();
    });

  const getCurrentWorkspaceName = (): Effect.Effect<string, VcsErrors> =>
    Effect.gen(function* () {
      // Get workspaces and find which one has current directory
      const currentRoot = yield* getWorkspaceRoot();
      const workspaces = yield* listWorkspaces();

      const current = workspaces.find((ws) => {
        // Normalize paths for comparison
        const wsPath = ws.path.replace(/\/$/, "");
        const curPath = currentRoot.replace(/\/$/, "");
        return wsPath === curPath || curPath.endsWith(ws.name);
      });

      return current?.name ?? "default";
    });

  const isNonDefaultWorkspace = (): Effect.Effect<boolean, VcsErrors> =>
    Effect.gen(function* () {
      const name = yield* getCurrentWorkspaceName();
      return name !== "default";
    });

  // === Stack Navigation ===

  const getChildChange = (): Effect.Effect<Change | null, VcsErrors> =>
    Effect.gen(function* () {
      // Get direct children of current working copy using @+ revset
      // @+ means "direct children of @" (immediate descendants)
      const output = yield* runJj("log", "-r", "@+", "-T", JJ_LOG_JSON_TEMPLATE, "--no-graph");
      const children = yield* parseChanges(output);

      if (children.length === 0) {
        // No children
        return null;
      }

      // If multiple children, prefer the first one (most recent by jj ordering)
      // In stacked changes workflow, there's usually only one child
      return children[0];
    });

  const editChange = (changeId: ChangeId): Effect.Effect<void, VcsErrors> =>
    runJj("edit", changeId).pipe(Effect.asVoid);

  // === Recovery Operations ===

  const undo = () =>
    Effect.gen(function* () {
      // Get the current operation description before undo
      const opLogOutput = yield* runJj("op", "log", "-n", "1", "-T", 'description ++ "\\n"');
      const currentOperation = opLogOutput.trim();

      // Perform the undo
      yield* runJj("undo");

      return {
        undone: true,
        operation: currentOperation || undefined,
      };
    });

  const updateStaleWorkspace = (): Effect.Effect<UpdateStaleResult, VcsErrors> =>
    Effect.gen(function* () {
      // Run jj workspace update-stale
      yield* runJj("workspace", "update-stale");

      // Get the current change after update
      const current = yield* getCurrentChange();

      return new UpdateStaleResult({
        updated: true,
        changeId: current.changeId,
      });
    });

  return {
    isAvailable,
    isRepo,
    createChange,
    describe,
    commit,
    createBookmark,
    moveBookmark,
    push,
    getCurrentChange,
    getStack,
    getLog,
    fetch,
    getTrunkInfo,
    rebase,
    sync,
    getParentChange,
    squash,
    abandon,
    // Workspace operations (jj workspace)
    createWorkspace,
    listWorkspaces,
    forgetWorkspace,
    getWorkspaceRoot,
    getCurrentWorkspaceName,
    isNonDefaultWorkspace,
    // Stack navigation
    getChildChange,
    editChange,
    // Recovery operations
    undo,
    updateStaleWorkspace,
  };
});

export const VcsServiceLive = Layer.effect(VcsService, make);

// Re-export parseChangeIdFromOutput for use in other modules that need to parse jj output
export { parseChangeIdFromOutput };
