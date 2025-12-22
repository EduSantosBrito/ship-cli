/**
 * ship stack log - View stack with change info
 *
 * Shows the stack of changes from trunk to current working copy.
 * Each change includes its change ID, description, bookmarks, and status.
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

// === Output Formatters ===

interface StackChangeOutput {
  changeId: string;
  commitId: string;
  description: string;
  bookmarks: readonly string[];
  isEmpty: boolean;
  isWorkingCopy: boolean;
}

const formatChangeForJson = (
  change: import("../../../../../ports/VcsService.js").Change,
): StackChangeOutput => ({
  changeId: change.changeId,
  commitId: change.id,
  description: change.description,
  bookmarks: change.bookmarks,
  isEmpty: change.isEmpty,
  isWorkingCopy: change.isWorkingCopy,
});

const formatChangeForText = (
  change: import("../../../../../ports/VcsService.js").Change,
): string => {
  const marker = change.isWorkingCopy ? "@" : "○";
  const empty = change.isEmpty ? " (empty)" : "";
  const bookmarks = change.bookmarks.length > 0 ? ` [${change.bookmarks.join(", ")}]` : "";

  // Truncate description to first line
  const desc = change.description.split("\n")[0] || "(no description)";

  return `${marker}  ${change.changeId.slice(0, 8)} ${desc}${empty}${bookmarks}`;
};

// === Command ===

export const logCommand = Command.make("log", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    // Check VCS availability (jj installed and in repo)
    const vcsCheck = yield* checkVcsAvailability();
    if (!vcsCheck.available) {
      yield* outputError(vcsCheck.error, json);
      return;
    }
    const { vcs } = vcsCheck;

    // Get the stack - handle errors explicitly
    const stackResult = yield* vcs.getStack().pipe(
      Effect.map((stack) => ({ success: true as const, stack })),
      Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
    );

    if (!stackResult.success) {
      yield* outputError(`Failed to get stack: ${stackResult.error}`, json);
      return;
    }

    const stack = stackResult.stack;

    if (json) {
      const output = stack.map(formatChangeForJson);
      yield* Console.log(JSON.stringify(output, null, 2));
    } else {
      if (stack.length === 0) {
        yield* Console.log("No changes in stack (working copy is on trunk)");
      } else {
        yield* Console.log("Stack (trunk → @):\n");
        // Print in reverse order (trunk at bottom, @ at top)
        for (const change of [...stack].reverse()) {
          yield* Console.log(formatChangeForText(change));
        }
      }
    }
  }),
);
