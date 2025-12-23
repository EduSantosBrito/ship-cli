/**
 * ship stack remove-workspace - Remove a jj workspace
 *
 * Forgets a jj workspace and optionally deletes its directory.
 * Also removes associated metadata from ship.
 */

import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Args from "@effect/cli/Args";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as FileSystem from "@effect/platform/FileSystem";
import * as Path from "@effect/platform/Path";
import { checkVcsAvailability, outputError } from "./shared.js";
import {
  loadWorkspacesFile,
  modifyWorkspacesFile,
  WorkspacesFile,
} from "../../../../../domain/Config.js";
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";

// === Options ===

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

const deleteFilesOption = Options.boolean("delete").pipe(
  Options.withAlias("d"),
  Options.withDescription("Also delete the workspace directory from disk"),
  Options.withDefault(false),
);

// === Arguments ===

const workspaceNameArg = Args.text({ name: "name" }).pipe(
  Args.withDescription("Workspace name to remove"),
);

// === Output Types ===

interface RemoveWorkspaceOutput {
  removed: boolean;
  name: string;
  filesDeleted?: boolean;
  error?: string;
}

// === Command ===

export const removeWorkspaceCommand = Command.make(
  "remove-workspace",
  {
    json: jsonOption,
    deleteFiles: deleteFilesOption,
    name: workspaceNameArg,
  },
  ({ json, deleteFiles, name }) =>
    Effect.gen(function* () {
      // Check VCS availability
      const vcsCheck = yield* checkVcsAvailability();
      if (!vcsCheck.available) {
        yield* outputError(vcsCheck.error, json);
        return;
      }
      const { vcs } = vcsCheck;

      // Prevent removing default workspace
      if (name === "default") {
        yield* outputError("Cannot remove the default workspace", json);
        return;
      }

      const configRepo = yield* ConfigRepository;

      // Get workspace info from jj (may not exist if already removed)
      const workspaces = yield* vcs.listWorkspaces();
      const jjWorkspace = workspaces.find((ws) => ws.name === name);

      // Also check ship metadata (for cases where jj workspace was already removed)
      const workspacesFile = yield* loadWorkspacesFile(configRepo);
      const metadataEntry = workspacesFile.workspaces.find((m) => m.name === name);

      // If workspace doesn't exist in either jj or metadata, it's not found
      if (!jjWorkspace && !metadataEntry) {
        yield* outputError(`Workspace '${name}' not found`, json);
        return;
      }

      // Determine the path for file deletion (prefer jj workspace path, fallback to metadata)
      const workspacePath = jjWorkspace?.path ?? metadataEntry?.path;

      // Forget the workspace in jj (only if it still exists)
      if (jjWorkspace) {
        const forgetResult = yield* vcs.forgetWorkspace(name).pipe(
          Effect.map(() => ({ success: true as const })),
          Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
        );

        if (!forgetResult.success) {
          yield* outputError(`Failed to forget workspace: ${forgetResult.error}`, json);
          return;
        }
      }

      // Always remove from ship metadata (even if jj workspace was already gone)
      yield* removeWorkspaceMetadata(configRepo, name);

      // Optionally delete files
      let filesDeleted = false;
      if (deleteFiles && workspacePath) {
        const fs = yield* FileSystem.FileSystem;
        const deleteResult = yield* fs.remove(workspacePath, { recursive: true }).pipe(
          Effect.map(() => ({ success: true as const })),
          Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
        );
        filesDeleted = deleteResult.success;
      }

      const output: RemoveWorkspaceOutput = deleteFiles
        ? { removed: true, name, filesDeleted }
        : { removed: true, name };

      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        const wasOnlyMetadata = !jjWorkspace && metadataEntry;
        if (wasOnlyMetadata) {
          yield* Console.log(
            `Removed workspace metadata: ${name} (jj workspace was already removed)`,
          );
        } else {
          yield* Console.log(`Removed workspace: ${name}`);
        }
        if (deleteFiles && workspacePath) {
          if (filesDeleted) {
            yield* Console.log(`Deleted files at: ${workspacePath}`);
          } else {
            yield* Console.log(`Warning: Could not delete files at: ${workspacePath}`);
          }
        } else if (!deleteFiles && workspacePath) {
          yield* Console.log(`Files remain at: ${workspacePath}`);
          yield* Console.log(`Use --delete to remove the directory.`);
        }
      }
    }),
);

// === Metadata Helpers ===

/**
 * Remove workspace metadata from .ship/workspaces.json
 */
const removeWorkspaceMetadata = (
  configRepo: ConfigRepository,
  workspaceName: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  modifyWorkspacesFile(configRepo, (workspacesFile) => {
    const filtered = workspacesFile.workspaces.filter((m) => m.name !== workspaceName);
    return [undefined, new WorkspacesFile({ workspaces: filtered })] as const;
  }).pipe(Effect.catchAll(() => Effect.void));
