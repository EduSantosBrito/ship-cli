/**
 * ship stack undo - Undo the last jj operation
 *
 * Wraps `jj undo` to provide a controlled interface for AI agents.
 * This is critical for recovery from mistakes.
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

interface UndoOutput {
  undone: boolean;
  operation?: string;
  error?: string;
}

// === Command ===

export const undoCommand = Command.make("undo", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    // Check VCS availability (jj installed and in repo)
    const vcsCheck = yield* checkVcsAvailability();
    if (!vcsCheck.available) {
      yield* outputError(vcsCheck.error, json);
      return;
    }
    const { vcs } = vcsCheck;

    // Perform undo
    const result = yield* vcs.undo().pipe(
      Effect.map((r) => ({ success: true as const, result: r })),
      Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
    );

    if (!result.success) {
      yield* outputError(`Failed to undo: ${result.error}`, json);
      return;
    }

    const output: UndoOutput = {
      undone: result.result.undone,
      ...(result.result.operation && { operation: result.result.operation }),
    };

    if (json) {
      yield* Console.log(JSON.stringify(output, null, 2));
    } else {
      if (result.result.operation) {
        yield* Console.log(`Undone: ${result.result.operation}`);
      } else {
        yield* Console.log("Undone last operation");
      }
    }
  }),
);
