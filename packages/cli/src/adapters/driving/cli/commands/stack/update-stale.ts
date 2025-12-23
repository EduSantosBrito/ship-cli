/**
 * ship stack update-stale - Update a stale working copy
 *
 * Wraps `jj workspace update-stale` to provide a controlled interface for AI agents.
 * Use this when the working copy becomes stale after operations in another workspace
 * or after remote changes (e.g., PR merge via CI).
 */

import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { checkVcsAvailability, outputError } from "./shared.js";

// === Options ===

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

// === Output Types ===

interface UpdateStaleOutput {
  updated: boolean;
  changeId?: string;
  error?: string;
}

// === Command ===

export const updateStaleCommand = Command.make("update-stale", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    // Check VCS availability (jj installed and in repo)
    const vcsCheck = yield* checkVcsAvailability();
    if (!vcsCheck.available) {
      yield* outputError(vcsCheck.error, json);
      return;
    }
    const { vcs } = vcsCheck;

    // Perform update-stale
    const result = yield* vcs.updateStaleWorkspace().pipe(
      Effect.map((r) => ({ success: true as const, result: r })),
      Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
    );

    if (!result.success) {
      yield* outputError(`Failed to update stale workspace: ${result.error}`, json);
      return;
    }

    const output: UpdateStaleOutput = {
      updated: result.result.updated,
      ...(result.result.changeId && { changeId: result.result.changeId }),
    };

    if (json) {
      yield* Console.log(JSON.stringify(output, null, 2));
    } else {
      if (result.result.changeId) {
        yield* Console.log(`Working copy updated. Now at: ${result.result.changeId}`);
      } else {
        yield* Console.log("Working copy updated.");
      }
    }
  }),
);
