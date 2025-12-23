/**
 * ship stack workspaces - List jj workspaces
 *
 * Lists all jj workspaces in the repository with their associated
 * stack/task metadata from ship.
 */

import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Console from "effect/Console";
import { checkVcsAvailability, outputError } from "./shared.js";
import {
  loadWorkspacesFile,
  saveWorkspacesFile,
  WorkspacesFile,
} from "../../../../../domain/Config.js";
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";
import type { WorkspaceInfo } from "../../../../../ports/VcsService.js";

// === Options ===

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

// === Output Types ===

interface WorkspaceOutput {
  name: string;
  path: string;
  changeId: string;
  description: string;
  isDefault: boolean;
  stackName: string | null;
  taskId: string | null;
}

// === Command ===

export const workspacesCommand = Command.make("workspaces", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    // Check VCS availability
    const vcsCheck = yield* checkVcsAvailability();
    if (!vcsCheck.available) {
      yield* outputError(vcsCheck.error, json);
      return;
    }
    const { vcs } = vcsCheck;

    // Get jj workspaces
    const workspaces = yield* vcs.listWorkspaces().pipe(
      Effect.catchAll(() => {
        return Effect.succeed([] as readonly WorkspaceInfo[]);
      }),
    );

    // Load ship metadata for task associations
    const configRepo = yield* ConfigRepository;
    const metadata = yield* loadWorkspacesFile(configRepo);

    // Sync metadata: remove entries for workspaces that no longer exist in jj
    const jjWorkspaceNames = new Set(workspaces.map((ws) => ws.name));
    const validMetadata = metadata.workspaces.filter((m) => jjWorkspaceNames.has(m.name));
    if (validMetadata.length !== metadata.workspaces.length) {
      // Some workspaces were removed, update the metadata file
      yield* saveWorkspacesFile(configRepo, new WorkspacesFile({ workspaces: validMetadata }));
    }

    // Merge jj workspace info with ship metadata
    const output: WorkspaceOutput[] = workspaces.map((ws) => {
      const meta = validMetadata.find((m) => m.name === ws.name);
      return {
        name: ws.name,
        path: ws.path,
        changeId: ws.shortChangeId,
        description: ws.description,
        isDefault: ws.isDefault,
        stackName: meta?.stackName ?? null,
        taskId: meta ? Option.getOrNull(meta.taskId) : null,
      };
    });

    if (json) {
      yield* Console.log(JSON.stringify(output, null, 2));
    } else {
      if (output.length === 0) {
        yield* Console.log("No workspaces found.");
        return;
      }

      yield* Console.log(`Workspaces (${output.length}):\n`);
      for (const ws of output) {
        const defaultMarker = ws.isDefault ? " (default)" : "";
        const taskMarker = ws.taskId ? ` [${ws.taskId}]` : "";
        yield* Console.log(`  ${ws.name}${defaultMarker}${taskMarker}`);
        yield* Console.log(`    Change: ${ws.changeId} - ${ws.description}`);
        yield* Console.log(`    Path: ${ws.path}`);
      }
    }
  }),
);
