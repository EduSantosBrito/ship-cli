/**
 * ship stack abandon - Abandon a change
 *
 * Abandons the current jj change (or a specified change).
 * The change is removed from history and working copy moves to a new empty change.
 * If the change was created in a workspace, offers to clean up the workspace.
 */

import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Console from "effect/Console";
import * as FileSystem from "@effect/platform/FileSystem";
import * as Path from "@effect/platform/Path";
import { checkVcsAvailability, outputError } from "./shared.js";
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";
import {
  loadWorkspacesFile,
  saveWorkspacesFile,
  withWorkspaceLock,
  WorkspacesFile,
} from "../../../../../domain/Config.js";
import { dryRunOption } from "../shared.js";

// === Options ===

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

// Optional change ID argument
const changeIdArg = Args.text({ name: "changeId" }).pipe(
  Args.withDescription("Change ID to abandon (defaults to current @)"),
  Args.optional,
);

// === Output Types ===

interface AbandonOutput {
  abandoned: boolean;
  changeId?: string;
  newWorkingCopy?: string;
  workspaceRemoved?: string;
  error?: string;
}

// === Command ===

export const abandonCommand = Command.make(
  "abandon",
  { json: jsonOption, changeId: changeIdArg, dryRun: dryRunOption },
  ({ json, changeId, dryRun }) =>
    Effect.gen(function* () {
      // Check VCS availability (jj installed and in repo)
      const vcsCheck = yield* checkVcsAvailability();
      if (!vcsCheck.available) {
        yield* outputError(vcsCheck.error, json);
        return;
      }
      const { vcs } = vcsCheck;

      // Get the change ID to abandon (for output)
      const changeToAbandon = Option.getOrUndefined(changeId);

      // Get current change info before abandoning (for reporting and workspace lookup)
      const currentBefore = yield* vcs.getCurrentChange().pipe(
        Effect.map((change) => ({ success: true as const, change })),
        Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
      );

      const abandonedChangeId =
        changeToAbandon || (currentBefore.success ? currentBefore.change.changeId : "unknown");
      const bookmarks = currentBefore.success ? currentBefore.change.bookmarks : [];
      const changeDescription = currentBefore.success
        ? currentBefore.change.description
        : "(unknown)";

      // Dry run: output what would be abandoned without making changes
      if (dryRun) {
        if (json) {
          yield* Console.log(
            JSON.stringify({
              dryRun: true,
              wouldAbandon: {
                changeId: abandonedChangeId,
                description: changeDescription,
                bookmarks,
              },
            }),
          );
        } else {
          yield* Console.log(`[DRY RUN] Would abandon change:`);
          yield* Console.log(`  Change ID: ${abandonedChangeId.slice(0, 8)}`);
          yield* Console.log(
            `  Description: ${changeDescription.split("\n")[0] || "(no description)"}`,
          );
          if (bookmarks.length > 0) {
            yield* Console.log(`  Bookmarks: ${bookmarks.join(", ")}`);
          }
        }
        return;
      }

      // Perform the abandon - jj validates the change ID
      const abandonResult = yield* vcs.abandon(changeToAbandon).pipe(
        Effect.map((change) => ({ success: true as const, change })),
        Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
      );

      if (!abandonResult.success) {
        yield* outputError(`Failed to abandon: ${abandonResult.error}`, json);
        return;
      }

      const newWorkingCopy = abandonResult.change;

      // Check for associated workspace and clean up if autoCleanup is enabled
      let workspaceRemoved: string | undefined;
      if (bookmarks.length > 0) {
        const cleanupResult = yield* cleanupWorkspaceForBookmarks(vcs, bookmarks);
        if (cleanupResult.removed) {
          workspaceRemoved = cleanupResult.name;
        }
      }

      const output: AbandonOutput = {
        abandoned: true,
        changeId: abandonedChangeId,
        newWorkingCopy: newWorkingCopy.changeId,
        ...(workspaceRemoved ? { workspaceRemoved } : {}),
      };

      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* Console.log(`Abandoned ${abandonedChangeId.slice(0, 8)}`);
        yield* Console.log(`Working copy now at: ${newWorkingCopy.changeId.slice(0, 8)}`);
        if (workspaceRemoved) {
          yield* Console.log(`Cleaned up workspace: ${workspaceRemoved}`);
        }
      }
    }),
);

// === Workspace Cleanup Helper ===

/**
 * Look up workspace by bookmark and clean it up if autoCleanup is enabled.
 * Uses file locking to prevent race conditions in multi-agent scenarios.
 */
const cleanupWorkspaceForBookmarks = (
  vcs: { forgetWorkspace: (name: string) => Effect.Effect<void, unknown> },
  bookmarks: readonly string[],
): Effect.Effect<
  { removed: boolean; name?: string },
  never,
  ConfigRepository | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const configRepo = yield* ConfigRepository;

    // Load config to check autoCleanup setting
    const config = yield* configRepo
      .load()
      .pipe(Effect.catchAll(() => Effect.succeed({ workspace: { autoCleanup: true } })));

    if (!config.workspace.autoCleanup) {
      return { removed: false };
    }

    // Use file locking for the read-modify-write operation
    return yield* withWorkspaceLock(
      configRepo,
      Effect.gen(function* () {
        // Load workspace metadata with proper schema validation
        const workspacesFile = yield* loadWorkspacesFile(configRepo);
        const workspaces = workspacesFile.workspaces;

        // Find workspace matching any of the bookmarks
        const matchingWorkspace = workspaces.find((ws) => {
          const bookmarkValue = Option.getOrNull(ws.bookmark);
          return bookmarkValue !== null && bookmarks.includes(bookmarkValue);
        });

        if (!matchingWorkspace) {
          return { removed: false };
        }

        // Forget the workspace in jj
        const forgetResult = yield* vcs.forgetWorkspace(matchingWorkspace.name).pipe(
          Effect.map(() => ({ success: true as const })),
          Effect.catchAll(() => Effect.succeed({ success: false as const })),
        );

        if (!forgetResult.success) {
          return { removed: false };
        }

        // Remove from metadata and save
        const filtered = workspaces.filter((ws) => ws.name !== matchingWorkspace.name);
        yield* saveWorkspacesFile(configRepo, new WorkspacesFile({ workspaces: filtered }));

        return { removed: true, name: matchingWorkspace.name };
      }),
    );
  }).pipe(Effect.catchAll(() => Effect.succeed({ removed: false })));
