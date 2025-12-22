/**
 * ship stack abandon - Abandon a change
 *
 * Abandons the current jj change (or a specified change).
 * The change is removed from history and working copy moves to a new empty change.
 */

import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Console from "effect/Console";
import { checkVcsAvailability, outputError } from "./shared.js";

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
  error?: string;
}

// === Command ===

export const abandonCommand = Command.make(
  "abandon",
  { json: jsonOption, changeId: changeIdArg },
  ({ json, changeId }) =>
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

      // Get current change info before abandoning (for reporting)
      const currentBefore = yield* vcs.getCurrentChange().pipe(
        Effect.map((change) => ({ success: true as const, change })),
        Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
      );

      const abandonedChangeId = changeToAbandon || (currentBefore.success ? currentBefore.change.changeId : "unknown");

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

      const output: AbandonOutput = {
        abandoned: true,
        changeId: abandonedChangeId,
        newWorkingCopy: newWorkingCopy.changeId,
      };

      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* Console.log(`Abandoned ${abandonedChangeId.slice(0, 8)}`);
        yield* Console.log(`Working copy now at: ${newWorkingCopy.changeId.slice(0, 8)}`);
      }
    }),
);
