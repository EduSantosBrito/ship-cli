/**
 * ship stack describe - Update change description
 *
 * Updates the description of the current jj change.
 * Message is required (no interactive mode for AI agents).
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
  Options.withDescription("New description for the change"),
);

// === Output Types ===

interface DescribeOutput {
  updated: boolean;
  changeId?: string;
  description?: string;
  error?: string;
}

// === Command ===

export const describeCommand = Command.make(
  "describe",
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

      // Update the description - handle errors explicitly
      const describeResult = yield* vcs.describe(message).pipe(
        Effect.map(() => ({ success: true as const })),
        Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
      );

      if (!describeResult.success) {
        yield* outputError(`Failed to update description: ${describeResult.error}`, json);
        return;
      }

      // Get the current change to return its info - handle errors
      const changeResult = yield* vcs.getCurrentChange().pipe(
        Effect.map((change) => ({ success: true as const, change })),
        Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
      );

      if (!changeResult.success) {
        // Description was updated but we couldn't get the change info
        // Report success with partial info
        const output: DescribeOutput = {
          updated: true,
          description: message,
        };
        if (json) {
          yield* Console.log(JSON.stringify(output, null, 2));
        } else {
          yield* Console.log(`Updated description`);
          yield* Console.log(`Description: ${message}`);
        }
        return;
      }

      const change = changeResult.change;

      const output: DescribeOutput = {
        updated: true,
        changeId: change.changeId,
        description: change.description,
      };

      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* Console.log(`Updated change ${change.changeId.slice(0, 8)}`);
        yield* Console.log(`Description: ${message}`);
      }
    }),
);
