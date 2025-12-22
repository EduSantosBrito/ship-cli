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
import { modifyWorkspacesFile, WorkspacesFile } from "../../../../../domain/Config.js";
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

      // Get workspace info before removal (for path)
      const workspaces = yield* vcs.listWorkspaces();
      const workspace = workspaces.find((ws) => ws.name === name);

      if (!workspace) {
        yield* outputError(`Workspace '${name}' not found`, json);
        return;
      }

      // Forget the workspace in jj
      const forgetResult = yield* vcs.forgetWorkspace(name).pipe(
        Effect.map(() => ({ success: true as const })),
        Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
      );

      if (!forgetResult.success) {
        yield* outputError(`Failed to forget workspace: ${forgetResult.error}`, json);
        return;
      }

      // Remove from ship metadata
      const configRepo = yield* ConfigRepository;
      yield* removeWorkspaceMetadata(configRepo, name);

      // Optionally delete files
      let filesDeleted = false;
      if (deleteFiles) {
        const fs = yield* FileSystem.FileSystem;
        const deleteResult = yield* fs.remove(workspace.path, { recursive: true }).pipe(
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
        yield* Console.log(`Removed workspace: ${name}`);
        if (deleteFiles) {
          if (filesDeleted) {
            yield* Console.log(`Deleted files at: ${workspace.path}`);
          } else {
            yield* Console.log(`Warning: Could not delete files at: ${workspace.path}`);
          }
        } else {
          yield* Console.log(`Files remain at: ${workspace.path}`);
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
