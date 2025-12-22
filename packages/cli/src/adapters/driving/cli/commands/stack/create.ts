/**
 * ship stack create - Create a new jj change
 *
 * Creates a new change on top of the current one with an optional
 * description and bookmark. This is separate from `ship start` which
 * also handles task management.
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
  Options.withDescription("Description for the new change"),
  Options.optional,
);

const bookmarkOption = Options.text("bookmark").pipe(
  Options.withAlias("b"),
  Options.withDescription("Create a bookmark at the new change"),
  Options.optional,
);

// === Output Types ===

interface CreateOutput {
  created: boolean;
  changeId?: string;
  bookmark?: string | undefined;
  error?: string;
}

// === Command ===

export const createCommand = Command.make(
  "create",
  { json: jsonOption, message: messageOption, bookmark: bookmarkOption },
  ({ json, message, bookmark }) =>
    Effect.gen(function* () {
      // Check VCS availability (jj installed and in repo)
      const vcsCheck = yield* checkVcsAvailability();
      if (!vcsCheck.available) {
        yield* outputError(vcsCheck.error, json);
        return;
      }
      const { vcs } = vcsCheck;

      // Create the change - handle errors explicitly
      const description = message._tag === "Some" ? message.value : "(no description)";
      const createResult = yield* vcs.createChange(description).pipe(
        Effect.map((changeId) => ({ success: true as const, changeId })),
        Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
      );

      if (!createResult.success) {
        yield* outputError(`Failed to create change: ${createResult.error}`, json);
        return;
      }

      const changeId = createResult.changeId;

      // Optionally create bookmark - handle partial failure
      let bookmarkName: string | undefined;
      if (bookmark._tag === "Some") {
        const bookmarkResult = yield* vcs.createBookmark(bookmark.value).pipe(
          Effect.map(() => ({ success: true as const })),
          Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
        );

        if (!bookmarkResult.success) {
          // Change was created but bookmark failed - report partial success
          const output: CreateOutput = {
            created: true,
            changeId,
            error: `Change created but bookmark failed: ${bookmarkResult.error}`,
          };
          if (json) {
            yield* Console.log(JSON.stringify(output, null, 2));
          } else {
            yield* Console.log(`Created change: ${changeId}`);
            yield* Console.log(`Warning: Failed to create bookmark: ${bookmarkResult.error}`);
          }
          return;
        }
        bookmarkName = bookmark.value;
      }

      const output: CreateOutput = {
        created: true,
        changeId,
        bookmark: bookmarkName,
      };

      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* Console.log(`Created change: ${changeId}`);
        if (bookmarkName) {
          yield* Console.log(`Created bookmark: ${bookmarkName}`);
        }
      }
    }),
);
