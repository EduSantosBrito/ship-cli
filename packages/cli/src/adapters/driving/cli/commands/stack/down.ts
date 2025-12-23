/**
 * ship stack down - Navigate to parent change (toward trunk)
 *
 * Moves the working copy to the parent change in the stack.
 * If already at the base of the stack (on trunk), reports that there's no parent.
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

interface DownOutput {
  moved: boolean;
  from?: {
    changeId: string;
    description: string;
  };
  to?: {
    changeId: string;
    description: string;
  };
  error?: string;
}

// === Command ===

export const downCommand = Command.make("down", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    // Check VCS availability (jj installed and in repo)
    const vcsCheck = yield* checkVcsAvailability();
    if (!vcsCheck.available) {
      yield* outputError(vcsCheck.error, json);
      return;
    }
    const { vcs } = vcsCheck;

    // Get current change
    const currentResult = yield* vcs.getCurrentChange().pipe(
      Effect.map((change) => ({ success: true as const, change })),
      Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
    );

    if (!currentResult.success) {
      yield* outputError(`Failed to get current change: ${currentResult.error}`, json);
      return;
    }

    const current = currentResult.change;

    // Get parent change
    const parentResult = yield* vcs.getParentChange().pipe(
      Effect.map((parent) => ({ success: true as const, parent })),
      Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
    );

    if (!parentResult.success) {
      yield* outputError(`Failed to get parent change: ${parentResult.error}`, json);
      return;
    }

    const parent = parentResult.parent;

    if (!parent) {
      const output: DownOutput = {
        moved: false,
        error: "Already at the base of the stack (on trunk)",
      };
      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* Console.log("Already at the base of the stack (on trunk)");
      }
      return;
    }

    // Edit the parent change
    const editResult = yield* vcs.editChange(parent.id).pipe(
      Effect.map(() => ({ success: true as const })),
      Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
    );

    if (!editResult.success) {
      yield* outputError(`Failed to move to parent change: ${editResult.error}`, json);
      return;
    }

    const output: DownOutput = {
      moved: true,
      from: {
        changeId: current.changeId,
        description: current.description.split("\n")[0] || "(no description)",
      },
      to: {
        changeId: parent.changeId,
        description: parent.description.split("\n")[0] || "(no description)",
      },
    };

    if (json) {
      yield* Console.log(JSON.stringify(output, null, 2));
    } else {
      yield* Console.log(`Moved down in stack:`);
      yield* Console.log(
        `  From: ${current.changeId.slice(0, 8)} ${current.description.split("\n")[0] || "(no description)"}`,
      );
      yield* Console.log(
        `  To:   ${parent.changeId.slice(0, 8)} ${parent.description.split("\n")[0] || "(no description)"}`,
      );
    }
  }),
);
