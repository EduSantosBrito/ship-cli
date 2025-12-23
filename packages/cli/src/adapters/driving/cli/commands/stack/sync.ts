/**
 * ship stack sync - Fetch and rebase onto trunk
 *
 * Syncs the local stack with remote:
 * 1. Fetches latest changes from remote
 * 2. Rebases the stack onto updated trunk
 * 3. Auto-abandons merged changes (empty changes with bookmarks)
 * 4. Prompts to delete local bookmarks for abandoned merged changes
 * 5. Cleans up workspace if entire stack was merged
 * 6. Reports any conflicts that need resolution
 *
 * This is the critical command for syncing after PRs are merged.
 */

import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as clack from "@clack/prompts";

import * as Console from "effect/Console";
import * as FileSystem from "@effect/platform/FileSystem";
import * as Path from "@effect/platform/Path";
import { checkVcsAvailability, outputError, extractErrorInfo } from "./shared.js";
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";
import {
  loadWorkspacesFile,
  saveWorkspacesFile,
  withWorkspaceLock,
  WorkspacesFile,
} from "../../../../../domain/Config.js";

// === Options ===

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

const yesOption = Options.boolean("yes").pipe(
  Options.withAlias("y"),
  Options.withDescription("Auto-delete local bookmarks for merged changes without prompting"),
  Options.withDefault(false),
);

// === Output Types ===

interface AbandonedChangeOutput {
  changeId: string;
  bookmark: string | undefined;
}

interface SyncOutput {
  fetched: boolean;
  rebased: boolean;
  trunkChangeId: string | undefined;
  stackSize: number | undefined;
  conflicted: boolean | undefined;
  /** Changes that were auto-abandoned because they were merged */
  abandonedMergedChanges: AbandonedChangeOutput[] | undefined;
  /** Local bookmarks that were deleted */
  deletedBookmarks: string[] | undefined;
  /** Whether the entire stack was merged and workspace was cleaned up */
  stackFullyMerged: boolean | undefined;
  /** Workspace that was cleaned up (only if stackFullyMerged) */
  cleanedUpWorkspace: string | undefined;
  error: { tag: string; message: string } | undefined;
}

// === Command ===

export const syncCommand = Command.make(
  "sync",
  { json: jsonOption, yes: yesOption },
  ({ json, yes }) =>
    Effect.gen(function* () {
      // Check VCS availability (jj installed and in repo)
      const vcsCheck = yield* checkVcsAvailability();
      if (!vcsCheck.available) {
        yield* outputError(vcsCheck.error, json);
        return;
      }
      const { vcs } = vcsCheck;

      // Run sync operation - handle errors with preserved context
      const syncResult = yield* vcs.sync().pipe(
        Effect.map((result) => ({ success: true as const, result })),
        Effect.catchAll((e) => {
          return Effect.succeed({ success: false as const, error: extractErrorInfo(e) });
        }),
      );

      if (!syncResult.success) {
        const errMsg = `Sync failed: [${syncResult.error.tag}] ${syncResult.error.message}`;
        yield* outputError(errMsg, json);
        return;
      }

      const result = syncResult.result;

      // Build output with abandoned changes info
      const abandonedChanges: AbandonedChangeOutput[] = result.abandonedMergedChanges.map((c) => ({
        changeId: c.changeId,
        bookmark: c.bookmark,
      }));

      // Prompt to delete local bookmarks for abandoned merged changes
      const deletedBookmarks: string[] = [];
      const bookmarksToDelete = abandonedChanges
        .map((c) => c.bookmark)
        .filter((b): b is string => b !== undefined);

      // Determine whether to prompt: only in interactive mode (!json && !yes)
      const shouldPrompt = !json && !yes;

      for (const bookmark of bookmarksToDelete) {
        // In non-interactive mode (--yes) or JSON mode with --yes, auto-delete
        // In JSON mode without --yes, skip deletion (can't prompt)
        // Otherwise, prompt the user
        const shouldDelete = shouldPrompt
          ? yield* promptToDeleteBookmark(bookmark)
          : yes; // Only delete if --yes was passed

        if (shouldDelete) {
          const deleteResult = yield* vcs.deleteBookmark(bookmark).pipe(
            Effect.map(() => ({ success: true as const })),
            Effect.catchAll(() => Effect.succeed({ success: false as const })),
          );

          if (deleteResult.success) {
            deletedBookmarks.push(bookmark);
          }
        }
      }

      const output: SyncOutput = {
        fetched: result.fetched,
        rebased: result.rebased,
        trunkChangeId: result.trunkChangeId,
        stackSize: result.stackSize,
        conflicted: result.conflicted,
        abandonedMergedChanges: abandonedChanges.length > 0 ? abandonedChanges : undefined,
        deletedBookmarks: deletedBookmarks.length > 0 ? deletedBookmarks : undefined,
        stackFullyMerged: result.stackFullyMerged,
        cleanedUpWorkspace: undefined,
        error: undefined,
      };

      // If entire stack was merged, clean up workspace
      let cleanedUpWorkspace: string | undefined;
      if (result.stackFullyMerged) {
        const cleanupResult = yield* cleanupWorkspaceAfterMerge(vcs);
        if (cleanupResult.cleaned) {
          cleanedUpWorkspace = cleanupResult.workspaceName;
          output.cleanedUpWorkspace = cleanedUpWorkspace;
        }
      }

      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        // Report abandoned merged changes first
        if (abandonedChanges.length > 0) {
          yield* Console.log("Auto-abandoned merged changes:");
          for (const change of abandonedChanges) {
            const bookmarkInfo = change.bookmark ? ` (${change.bookmark})` : "";
            yield* Console.log(`  - ${change.changeId}${bookmarkInfo}`);
          }
          yield* Console.log("");
        }

        // Report deleted bookmarks
        if (deletedBookmarks.length > 0) {
          yield* Console.log("Deleted local bookmarks:");
          for (const bookmark of deletedBookmarks) {
            yield* Console.log(`  - ${bookmark}`);
          }
          yield* Console.log("");
        }

        if (result.stackFullyMerged) {
          yield* Console.log("Stack fully merged! All changes are now in trunk.");
          if (cleanedUpWorkspace) {
            yield* Console.log(`Cleaned up workspace: ${cleanedUpWorkspace}`);
          }
          yield* Console.log(`  Trunk: ${result.trunkChangeId.slice(0, 12)}`);
        } else if (result.conflicted) {
          yield* Console.log("Sync completed with conflicts!");
          yield* Console.log(`  Fetched: yes`);
          yield* Console.log(`  Rebased: yes (with conflicts)`);
          yield* Console.log(`  Trunk:   ${result.trunkChangeId.slice(0, 12)}`);
          yield* Console.log(`  Stack:   ${result.stackSize} change(s)`);
          yield* Console.log("");
          yield* Console.log("Resolve conflicts with 'jj status' and edit the conflicted files.");
        } else if (!result.rebased) {
          yield* Console.log("Already up to date.");
          yield* Console.log(`  Trunk: ${result.trunkChangeId.slice(0, 12)}`);
          yield* Console.log(`  Stack: ${result.stackSize} change(s)`);
        } else {
          yield* Console.log("Sync completed successfully.");
          yield* Console.log(`  Fetched: yes`);
          yield* Console.log(`  Rebased: yes`);
          yield* Console.log(`  Trunk:   ${result.trunkChangeId.slice(0, 12)}`);
          yield* Console.log(`  Stack:   ${result.stackSize} change(s)`);
        }
      }
    }),
);

// === Bookmark Deletion Helper ===

/**
 * Prompt user to confirm deletion of a local bookmark.
 * Returns true if the user confirms, false otherwise.
 *
 * Uses Effect.promise with orElseSucceed for clean error handling:
 * - Promise rejection → returns false (safe fallback)
 * - User cancels prompt → returns false
 * - User confirms → returns true
 */
const promptToDeleteBookmark = (bookmark: string): Effect.Effect<boolean, never> =>
  Effect.promise(() =>
    clack.confirm({
      message: `Delete local bookmark '${bookmark}'?`,
      initialValue: true,
    }),
  ).pipe(
    Effect.map((result) => !clack.isCancel(result) && result === true),
    Effect.orElseSucceed(() => false),
  );

// === Workspace Cleanup Helper ===

/**
 * Clean up the current workspace after the entire stack has been merged.
 * Only cleans up if:
 * 1. We're in a non-default workspace
 * 2. autoCleanup is enabled in config
 *
 * Cleanup includes:
 * - Forgetting the workspace from jj
 * - Removing workspace metadata
 * - Deleting the workspace directory from disk
 *
 * Uses file locking to prevent race conditions in multi-agent scenarios.
 */
const cleanupWorkspaceAfterMerge = (vcs: {
  getCurrentWorkspaceName: () => Effect.Effect<string, unknown>;
  isNonDefaultWorkspace: () => Effect.Effect<boolean, unknown>;
  forgetWorkspace: (name: string) => Effect.Effect<void, unknown>;
  getWorkspaceRoot: () => Effect.Effect<string, unknown>;
}): Effect.Effect<
  { cleaned: boolean; workspaceName?: string },
  never,
  ConfigRepository | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // Check if we're in a non-default workspace
    const isNonDefault = yield* vcs
      .isNonDefaultWorkspace()
      .pipe(Effect.catchAll(() => Effect.succeed(false)));

    if (!isNonDefault) {
      // We're in the default workspace, nothing to clean up
      return { cleaned: false };
    }

    const configRepo = yield* ConfigRepository;

    // Load config to check autoCleanup setting
    const config = yield* configRepo
      .load()
      .pipe(Effect.catchAll(() => Effect.succeed({ workspace: { autoCleanup: true } })));

    if (!config.workspace.autoCleanup) {
      return { cleaned: false };
    }

    // Get current workspace name and path before cleanup
    const workspaceName = yield* vcs
      .getCurrentWorkspaceName()
      .pipe(Effect.catchAll(() => Effect.succeed("unknown")));

    const workspacePath = yield* vcs
      .getWorkspaceRoot()
      .pipe(Effect.catchAll(() => Effect.succeed("")));

    // Use file locking for the workspace metadata update
    return yield* withWorkspaceLock(
      configRepo,
      Effect.gen(function* () {
        // Load workspace metadata
        const workspacesFile = yield* loadWorkspacesFile(configRepo);
        const workspaces = workspacesFile.workspaces;

        // Find matching workspace by name
        const matchingWorkspace = workspaces.find((ws) => ws.name === workspaceName);

        // Forget the workspace in jj
        const forgetResult = yield* vcs.forgetWorkspace(workspaceName).pipe(
          Effect.map(() => ({ success: true as const })),
          Effect.catchAll(() => Effect.succeed({ success: false as const })),
        );

        if (!forgetResult.success) {
          return { cleaned: false };
        }

        // Remove from metadata and save (if we found it)
        if (matchingWorkspace) {
          const filtered = workspaces.filter((ws) => ws.name !== workspaceName);
          yield* saveWorkspacesFile(configRepo, new WorkspacesFile({ workspaces: filtered }));
        }

        // Delete the workspace directory from disk
        if (workspacePath && workspacePath !== "") {
          yield* fs
            .remove(workspacePath, { recursive: true })
            .pipe(
              Effect.catchAll((e) =>
                Effect.logWarning(`Failed to delete workspace directory: ${workspacePath}`).pipe(
                  Effect.annotateLogs({ error: String(e) }),
                ),
              ),
            );
        }

        return { cleaned: true, workspaceName };
      }),
    );
  }).pipe(Effect.catchAll(() => Effect.succeed({ cleaned: false })));
