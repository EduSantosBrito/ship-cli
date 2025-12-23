/**
 * ship stack up - Navigate to child change (toward working copy tip)
 *
 * Moves the working copy to the child change in the stack.
 * If already at the tip of the stack, reports that there's no child.
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

interface UpOutput {
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

export const upCommand = Command.make("up", { json: jsonOption }, ({ json }) =>
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

    // Get child change
    const childResult = yield* vcs.getChildChange().pipe(
      Effect.map((child) => ({ success: true as const, child })),
      Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
    );

    if (!childResult.success) {
      yield* outputError(`Failed to get child change: ${childResult.error}`, json);
      return;
    }

    const child = childResult.child;

    if (!child) {
      const output: UpOutput = {
        moved: false,
        error: "Already at the tip of the stack (no child change)",
      };
      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* Console.log("Already at the tip of the stack (no child change)");
      }
      return;
    }

    // Edit the child change
    const editResult = yield* vcs.editChange(child.id).pipe(
      Effect.map(() => ({ success: true as const })),
      Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
    );

    if (!editResult.success) {
      yield* outputError(`Failed to move to child change: ${editResult.error}`, json);
      return;
    }

    const output: UpOutput = {
      moved: true,
      from: {
        changeId: current.changeId,
        description: current.description.split("\n")[0] || "(no description)",
      },
      to: {
        changeId: child.changeId,
        description: child.description.split("\n")[0] || "(no description)",
      },
    };

    if (json) {
      yield* Console.log(JSON.stringify(output, null, 2));
    } else {
      yield* Console.log(`Moved up in stack:`);
      yield* Console.log(`  From: ${current.changeId.slice(0, 8)} ${current.description.split("\n")[0] || "(no description)"}`);
      yield* Console.log(`  To:   ${child.changeId.slice(0, 8)} ${child.description.split("\n")[0] || "(no description)"}`);
    }
  }),
);
