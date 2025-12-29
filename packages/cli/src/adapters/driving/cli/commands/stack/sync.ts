/**
 * ship stack sync - Fetch and rebase onto trunk
 *
 * Syncs the local stack with remote:
 * 1. Fetches latest changes from remote
 * 2. Rebases the stack onto updated trunk
 * 3. Auto-abandons merged changes (empty changes with bookmarks)
 * 4. Prompts to delete local bookmarks for abandoned merged changes
 * 5. Updates PR base branches when parent PRs are merged
 * 6. Cleans up workspace if entire stack was merged
 * 7. Reports any conflicts that need resolution
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
import { checkVcsAvailability, outputError, extractErrorInfo, getDefaultBranch } from "./shared.js";
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";
import { PrService, type PullRequest } from "../../../../../ports/PrService.js";
import type { Change } from "../../../../../ports/VcsService.js";
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

const autoSubmitOption = Options.boolean("auto-submit").pipe(
  Options.withDescription(
    "Automatically push rebased changes after sync when parent PRs were merged",
  ),
  Options.withDefault(false),
);

const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDescription(
    "Show what would be auto-submitted without actually pushing (requires --auto-submit)",
  ),
  Options.withDefault(false),
);

// === Output Types ===

interface AbandonedChangeOutput {
  changeId: string;
  bookmark: string | undefined;
}

interface UpdatedPrBaseOutput {
  prNumber: number;
  bookmark: string;
  oldBase: string;
  newBase: string;
}

interface AutoSubmittedPrOutput {
  bookmark: string;
  prNumber: number;
  url: string;
  /** Only present if there was a push failure */
  error?: string;
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
  /** PRs whose base branch was updated after parent merge */
  updatedPrBases: UpdatedPrBaseOutput[] | undefined;
  /** PRs that were auto-submitted (pushed) after rebasing due to merged parent PRs */
  autoSubmittedPrs: AutoSubmittedPrOutput[] | undefined;
  /** PRs that would be auto-submitted (dry-run mode) */
  wouldAutoSubmitPrs: AutoSubmittedPrOutput[] | undefined;
  /** PRs that failed to push during auto-submit */
  failedAutoSubmitPrs: AutoSubmittedPrOutput[] | undefined;
  /** Whether the entire stack was merged and workspace was cleaned up */
  stackFullyMerged: boolean | undefined;
  /** Workspace that was cleaned up (only if stackFullyMerged) */
  cleanedUpWorkspace: string | undefined;
  error: { tag: string; message: string } | undefined;
}

// === Command ===

export const syncCommand = Command.make(
  "sync",
  { json: jsonOption, yes: yesOption, autoSubmit: autoSubmitOption, dryRun: dryRunOption },
  ({ json, yes, autoSubmit, dryRun }) =>
    Effect.gen(function* () {
      // Check VCS availability (jj installed and in repo)
      const vcsCheck = yield* checkVcsAvailability();
      if (!vcsCheck.available) {
        yield* outputError(vcsCheck.error, json);
        return;
      }
      const { vcs } = vcsCheck;

      // Get configured default branch (trunk)
      const defaultBranch = yield* getDefaultBranch();

      // Run sync operation - handle errors with preserved context
      const syncResult = yield* vcs.sync(defaultBranch).pipe(
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
        const shouldDelete = shouldPrompt ? yield* promptToDeleteBookmark(bookmark) : yes; // Only delete if --yes was passed

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
        updatedPrBases: undefined,
        autoSubmittedPrs: undefined,
        wouldAutoSubmitPrs: undefined,
        failedAutoSubmitPrs: undefined,
        stackFullyMerged: result.stackFullyMerged,
        cleanedUpWorkspace: undefined,
        error: undefined,
      };

      // If changes were abandoned (parent PRs merged), update child PR base branches
      // This ensures GitHub PRs point to the correct base after parent merges
      if (abandonedChanges.length > 0 && !result.stackFullyMerged) {
        const updatedBases = yield* updatePrBasesAfterMerge(vcs, abandonedChanges, defaultBranch);
        if (updatedBases.length > 0) {
          output.updatedPrBases = updatedBases;
        }
      }

      // Auto-submit: push rebased changes and update PRs when parent PRs were merged
      // This is triggered with --auto-submit flag or when parent PRs were merged
      if (
        autoSubmit &&
        abandonedChanges.length > 0 &&
        !result.stackFullyMerged &&
        !result.conflicted
      ) {
        const autoSubmitResult = yield* autoSubmitRebasedChanges(vcs, dryRun);
        if (dryRun) {
          if (autoSubmitResult.wouldSubmit.length > 0) {
            output.wouldAutoSubmitPrs = autoSubmitResult.wouldSubmit;
          }
        } else {
          if (autoSubmitResult.submitted.length > 0) {
            output.autoSubmittedPrs = autoSubmitResult.submitted;
          }
          if (autoSubmitResult.failed.length > 0) {
            output.failedAutoSubmitPrs = autoSubmitResult.failed;
          }
        }
      }

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

        // Report updated PR bases
        if (output.updatedPrBases && output.updatedPrBases.length > 0) {
          yield* Console.log("Updated PR base branches:");
          for (const update of output.updatedPrBases) {
            yield* Console.log(
              `  - PR #${update.prNumber} (${update.bookmark}): ${update.oldBase} -> ${update.newBase}`,
            );
          }
          yield* Console.log("");
        }

        // Report auto-submitted PRs
        if (output.autoSubmittedPrs && output.autoSubmittedPrs.length > 0) {
          yield* Console.log("Auto-submitted PRs (pushed rebased changes):");
          for (const submitted of output.autoSubmittedPrs) {
            yield* Console.log(`  - PR #${submitted.prNumber} (${submitted.bookmark})`);
          }
          yield* Console.log("");
        }

        // Report failed auto-submits
        if (output.failedAutoSubmitPrs && output.failedAutoSubmitPrs.length > 0) {
          yield* Console.log("Failed to auto-submit PRs:");
          for (const failed of output.failedAutoSubmitPrs) {
            yield* Console.log(`  - PR #${failed.prNumber} (${failed.bookmark}): ${failed.error}`);
          }
          yield* Console.log("");
        }

        // Report dry-run: would auto-submit PRs
        if (output.wouldAutoSubmitPrs && output.wouldAutoSubmitPrs.length > 0) {
          yield* Console.log("Would auto-submit PRs (dry-run):");
          for (const wouldSubmit of output.wouldAutoSubmitPrs) {
            yield* Console.log(`  - PR #${wouldSubmit.prNumber} (${wouldSubmit.bookmark})`);
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

// === PR Base Update Helper ===

/**
 * Update PR base branches after parent PRs are merged.
 *
 * When a parent PR is merged AND GitHub's auto-delete branch feature is DISABLED:
 * 1. Its bookmark is removed from the stack (change becomes empty and is abandoned)
 * 2. Child PRs still point to the old parent branch on GitHub
 * 3. This function detects this situation and updates child PR bases
 *
 * NOTE: If GitHub's "Automatically delete head branches" is enabled (the default for
 * many repos), GitHub automatically retargets child PRs when the parent branch is deleted.
 * In that case, the PR's base won't be in mergedBookmarks anymore (GitHub already updated it).
 *
 * Logic:
 * - Get the current stack after sync (which already abandoned merged changes)
 * - For each change with a bookmark, check if there's a PR
 * - Determine the correct base: parent's bookmark, or configured default branch if no parent
 * - If PR's current base is a merged bookmark, update it to the correct base
 *
 * @param vcs - VCS service for getting stack info
 * @param abandonedChanges - Changes that were abandoned (merged PRs)
 * @param defaultBranch - The configured trunk branch name (from config.git.defaultBranch)
 * @returns Array of PRs whose base was updated
 */
const updatePrBasesAfterMerge = (
  vcs: {
    getStack: () => Effect.Effect<ReadonlyArray<Change>, unknown>;
  },
  abandonedChanges: AbandonedChangeOutput[],
  defaultBranch: string,
): Effect.Effect<UpdatedPrBaseOutput[], never, PrService> =>
  Effect.gen(function* () {
    const prService = yield* PrService;

    // Check if gh is available
    const ghAvailable = yield* prService.isAvailable();
    if (!ghAvailable) {
      // gh not available, skip PR base updates
      return [];
    }

    // Get the merged bookmarks (these are the branches whose PRs were merged)
    const mergedBookmarks = new Set(
      abandonedChanges.map((c) => c.bookmark).filter((b): b is string => b !== undefined),
    );

    // If no bookmarks were merged, nothing to update
    if (mergedBookmarks.size === 0) {
      return [];
    }

    // Get current stack after sync
    const stack = yield* vcs.getStack().pipe(Effect.catchAll(() => Effect.succeed([] as Change[])));

    // Stack is returned newest-first, so we reverse to go from trunk upward
    // This ensures we process parents before children
    const stackFromTrunk = [...stack].reverse();

    const updatedPrBases: UpdatedPrBaseOutput[] = [];

    // Build a map of bookmark -> parent bookmark (or default branch if at base of stack)
    const bookmarkToParent = new Map<string, string>();
    for (let i = 0; i < stackFromTrunk.length; i++) {
      const change = stackFromTrunk[i];
      if (change.bookmarks.length > 0) {
        const bookmark = change.bookmarks[0];
        // Find parent bookmark by looking at previous changes in stack
        let parentBookmark = defaultBranch;
        for (let j = i - 1; j >= 0; j--) {
          const parentChange = stackFromTrunk[j];
          if (parentChange.bookmarks.length > 0) {
            parentBookmark = parentChange.bookmarks[0];
            break;
          }
        }
        bookmarkToParent.set(bookmark, parentBookmark);
      }
    }

    // For each bookmark in the stack, check if its PR needs a base update
    for (const [bookmark, expectedBase] of bookmarkToParent) {
      // Get PR for this bookmark
      const pr = yield* prService
        .getPrByBranch(bookmark)
        .pipe(Effect.catchAll(() => Effect.succeed(null as PullRequest | null)));

      if (!pr || pr.state !== "open") {
        // No PR or PR is not open, skip
        continue;
      }

      // Check if current base was one of the merged bookmarks
      // This means the PR still points to a branch that was merged and may no longer exist.
      // Note: If GitHub's auto-delete is enabled, GitHub would have already retargeted the PR,
      // so pr.base would NOT be in mergedBookmarks (it would already be the new target).
      if (mergedBookmarks.has(pr.base)) {
        // PR's base points to a merged branch, update to the new expected base
        const updateResult = yield* prService.updatePrBase(pr.number, expectedBase).pipe(
          Effect.map((updated) => ({ success: true as const, pr: updated })),
          Effect.catchAll((e) => {
            return Effect.logWarning(`Failed to update PR #${pr.number} base`).pipe(
              Effect.annotateLogs({ error: String(e), bookmark, oldBase: pr.base }),
              Effect.map(() => ({ success: false as const })),
            );
          }),
        );

        if (updateResult.success) {
          updatedPrBases.push({
            prNumber: pr.number,
            bookmark,
            oldBase: pr.base,
            newBase: expectedBase,
          });
        }
      }
    }

    return updatedPrBases;
  }).pipe(Effect.catchAll(() => Effect.succeed([] as UpdatedPrBaseOutput[])));

// === Auto-Submit Helper ===

interface AutoSubmitResult {
  submitted: AutoSubmittedPrOutput[];
  failed: AutoSubmittedPrOutput[];
  wouldSubmit: AutoSubmittedPrOutput[];
}

/**
 * Automatically push rebased changes after parent PRs are merged.
 *
 * When a parent PR is merged and the stack is rebased:
 * 1. Child changes have new commit SHAs that need to be pushed
 * 2. This function pushes all changes with bookmarks that have open PRs
 * 3. Returns info about each successfully pushed PR
 *
 * This is triggered by the --auto-submit flag and automates the workflow
 * of pushing dependent PRs after a parent merge.
 *
 * @param vcs - VCS service for stack info and push
 * @param dryRun - If true, don't actually push, just report what would be pushed
 * @returns Object with submitted, failed, and wouldSubmit arrays
 */
const autoSubmitRebasedChanges = (
  vcs: {
    getStack: () => Effect.Effect<ReadonlyArray<Change>, unknown>;
    push: (bookmark: string) => Effect.Effect<void, unknown>;
  },
  dryRun: boolean,
): Effect.Effect<AutoSubmitResult, never, PrService> =>
  Effect.gen(function* () {
    const prService = yield* PrService;

    const result: AutoSubmitResult = {
      submitted: [],
      failed: [],
      wouldSubmit: [],
    };

    // Check if gh is available
    const ghAvailable = yield* prService.isAvailable();
    if (!ghAvailable) {
      return result;
    }

    // Get current stack after sync
    const stack = yield* vcs.getStack().pipe(Effect.catchAll(() => Effect.succeed([] as Change[])));

    // Find all changes with bookmarks that have open PRs
    const changesWithBookmarks = stack.filter(
      (c) => c.bookmarks.length > 0 && !c.isEmpty && !c.hasConflict,
    );

    for (const change of changesWithBookmarks) {
      const bookmark = change.bookmarks[0];

      // Check if there's an open PR for this bookmark
      const pr = yield* prService
        .getPrByBranch(bookmark)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));

      if (!pr || pr.state !== "open") {
        continue;
      }

      const prOutput: AutoSubmittedPrOutput = {
        bookmark,
        prNumber: pr.number,
        url: pr.url,
      };

      // In dry-run mode, just record what would be pushed
      if (dryRun) {
        result.wouldSubmit.push(prOutput);
        continue;
      }

      // Push the bookmark to update the PR
      const pushResult = yield* vcs.push(bookmark).pipe(
        Effect.map(() => ({ success: true as const, error: undefined })),
        Effect.catchAll((e) => {
          const errorMsg = String(e);
          return Effect.logWarning(`Failed to push ${bookmark}`).pipe(
            Effect.annotateLogs({ error: errorMsg, bookmark }),
            Effect.map(() => ({ success: false as const, error: errorMsg })),
          );
        }),
      );

      if (pushResult.success) {
        result.submitted.push(prOutput);
      } else {
        result.failed.push({ ...prOutput, error: pushResult.error });
      }
    }

    return result;
  }).pipe(Effect.catchAll(() => Effect.succeed({ submitted: [], failed: [], wouldSubmit: [] })));
