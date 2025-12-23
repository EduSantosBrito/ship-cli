/**
 * ship stack bookmark - Create or move a bookmark on current change
 *
 * Creates a new bookmark at the current change, or moves an existing
 * bookmark to the current change with --move flag.
 *
 * This command is useful for recovering bookmarks that get lost during
 * stack operations like squashing or rebasing.
 */

import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Args from "@effect/cli/Args";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { checkVcsAvailability, outputError } from "./shared.js";

// === Options ===

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

const moveOption = Options.boolean("move").pipe(
  Options.withDescription("Move an existing bookmark instead of creating a new one"),
  Options.withDefault(false),
);

// === Args ===

const bookmarkArg = Args.text({ name: "name" }).pipe(
  Args.withDescription("Bookmark name to create or move"),
);

// === Output Types ===

interface BookmarkOutput {
  success: boolean;
  action: "created" | "moved";
  bookmark: string;
  changeId?: string;
  error?: string;
}

// === Command ===

export const bookmarkCommand = Command.make(
  "bookmark",
  { json: jsonOption, move: moveOption, name: bookmarkArg },
  ({ json, move, name }) =>
    Effect.gen(function* () {
      // Check VCS availability (jj installed and in repo)
      const vcsCheck = yield* checkVcsAvailability();
      if (!vcsCheck.available) {
        yield* outputError(vcsCheck.error, json);
        return;
      }
      const { vcs } = vcsCheck;

      // Get current change for output
      const currentChange = yield* vcs.getCurrentChange().pipe(
        Effect.map((change) => ({ success: true as const, change })),
        Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
      );

      if (!currentChange.success) {
        yield* outputError(`Failed to get current change: ${currentChange.error}`, json);
        return;
      }

      if (move) {
        // Move existing bookmark
        const moveResult = yield* vcs.moveBookmark(name).pipe(
          Effect.map(() => ({ success: true as const })),
          Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
        );

        if (!moveResult.success) {
          yield* outputError(`Failed to move bookmark: ${moveResult.error}`, json);
          return;
        }

        const output: BookmarkOutput = {
          success: true,
          action: "moved",
          bookmark: name,
          changeId: currentChange.change.changeId,
        };

        if (json) {
          yield* Console.log(JSON.stringify(output, null, 2));
        } else {
          yield* Console.log(`Moved bookmark '${name}' to ${currentChange.change.changeId.slice(0, 8)}`);
        }
      } else {
        // Create new bookmark
        const createResult = yield* vcs.createBookmark(name).pipe(
          Effect.map(() => ({ success: true as const })),
          Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
        );

        if (!createResult.success) {
          // Check if error is because bookmark already exists
          if (createResult.error.includes("already exists")) {
            const output: BookmarkOutput = {
              success: false,
              action: "created",
              bookmark: name,
              error: `Bookmark '${name}' already exists. Use --move to move it to the current change.`,
            };

            if (json) {
              yield* Console.log(JSON.stringify(output, null, 2));
            } else {
              yield* Console.error(`Error: Bookmark '${name}' already exists.`);
              yield* Console.error(`Use --move to move it to the current change.`);
            }
            return;
          }

          yield* outputError(`Failed to create bookmark: ${createResult.error}`, json);
          return;
        }

        const output: BookmarkOutput = {
          success: true,
          action: "created",
          bookmark: name,
          changeId: currentChange.change.changeId,
        };

        if (json) {
          yield* Console.log(JSON.stringify(output, null, 2));
        } else {
          yield* Console.log(`Created bookmark '${name}' at ${currentChange.change.changeId.slice(0, 8)}`);
        }
      }
    }),
);
