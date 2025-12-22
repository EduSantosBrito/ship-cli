/**
 * ship stack squash - Squash current change into parent
 *
 * Squashes the current jj change into its parent change.
 * Useful for cleaning up the stack before pushing.
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

const messageOption = Options.text("message").pipe(
  Options.withAlias("m"),
  Options.withDescription("Message for the combined change (required)"),
);

// === Output Types ===

interface SquashOutput {
  squashed: boolean;
  intoChangeId?: string;
  description?: string;
  error?: string;
}

// === Command ===

export const squashCommand = Command.make(
  "squash",
  { json: jsonOption, message: messageOption },
  ({ json, message }) =>
    Effect.gen(function* () {
      // Check VCS availability (jj installed and in repo)
      const vcsCheck = yield* checkVcsAvailability();
      if (!vcsCheck.available) {
        yield* outputError(vcsCheck.error, json);
        return;
      }
      const { vcs } = vcsCheck;

      // Check if we have a parent to squash into
      const parentResult = yield* vcs.getParentChange().pipe(
        Effect.map((parent) => ({ success: true as const, parent })),
        Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
      );

      if (!parentResult.success) {
        yield* outputError(`Failed to get parent change: ${parentResult.error}`, json);
        return;
      }

      if (!parentResult.parent) {
        yield* outputError("Cannot squash: current change has no parent in the stack (already at trunk)", json);
        return;
      }

      // Perform the squash
      const squashResult = yield* vcs.squash(message).pipe(
        Effect.map((change) => ({ success: true as const, change })),
        Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
      );

      if (!squashResult.success) {
        yield* outputError(`Failed to squash: ${squashResult.error}`, json);
        return;
      }

      const change = squashResult.change;

      const output: SquashOutput = {
        squashed: true,
        intoChangeId: change.changeId,
        description: change.description,
      };

      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* Console.log(`Squashed into ${change.changeId.slice(0, 8)}`);
        if (change.description) {
          yield* Console.log(`Description: ${change.description.split("\n")[0]}`);
        }
      }
    }),
);
