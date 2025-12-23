/**
 * ship stack status - Show current change status
 *
 * Shows information about the current jj change including:
 * - Change ID and description
 * - Bookmarks attached to this change
 * - Whether the change is empty
 * - Whether jj is available and we're in a repo
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

interface StatusOutput {
  isRepo: boolean;
  change?: {
    changeId: string;
    commitId: string;
    description: string;
    bookmarks: readonly string[];
    isEmpty: boolean;
    hasConflict: boolean;
  };
}

// === Command ===

export const statusCommand = Command.make("status", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    // Check VCS availability (jj installed and in repo)
    const vcsCheck = yield* checkVcsAvailability();
    if (!vcsCheck.available) {
      yield* outputError(vcsCheck.error, json);
      return;
    }
    const { vcs } = vcsCheck;

    // Get current change - handle errors explicitly
    const changeResult = yield* vcs.getCurrentChange().pipe(
      Effect.map((change) => ({ success: true as const, change })),
      Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
    );

    if (!changeResult.success) {
      yield* outputError(`Failed to get current change: ${changeResult.error}`, json);
      return;
    }

    const change = changeResult.change;

    const output: StatusOutput = {
      isRepo: true,
      change: {
        changeId: change.changeId,
        commitId: change.id,
        description: change.description,
        bookmarks: change.bookmarks,
        isEmpty: change.isEmpty,
        hasConflict: change.hasConflict,
      },
    };

    if (json) {
      yield* Console.log(JSON.stringify(output, null, 2));
    } else {
      yield* Console.log(`Change:      ${change.changeId.slice(0, 8)}`);
      yield* Console.log(`Commit:      ${change.id.slice(0, 12)}`);
      yield* Console.log(`Description: ${change.description.split("\n")[0] || "(no description)"}`);
      if (change.bookmarks.length > 0) {
        yield* Console.log(`Bookmarks:   ${change.bookmarks.join(", ")}`);
      }
      if (change.hasConflict) {
        yield* Console.log(`Status:      CONFLICT (resolve before submitting)`);
      } else if (change.isEmpty) {
        yield* Console.log(`Status:      empty (no changes)`);
      } else {
        yield* Console.log(`Status:      has changes`);
      }
    }
  }),
);
