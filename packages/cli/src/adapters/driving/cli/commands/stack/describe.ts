/**
 * ship stack describe - Update change description
 *
 * Updates the description of the current jj change.
 * Supports either a single --message or separate --title and --description.
 */

import * as Command from "@effect/cli/Command";
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

const messageOption = Options.text("message").pipe(
  Options.withAlias("m"),
  Options.withDescription("Full description for the change (alternative to --title/--description)"),
  Options.withDefault(""),
);

const titleOption = Options.text("title").pipe(
  Options.withAlias("t"),
  Options.withDescription("Title (first line) of the commit message"),
  Options.withDefault(""),
);

const descriptionOption = Options.text("description").pipe(
  Options.withAlias("d"),
  Options.withDescription("Body of the commit message (appears after title with blank line)"),
  Options.withDefault(""),
);

/**
 * Build the full commit message from title and description, or use message directly.
 * Returns None if no valid message could be constructed.
 */
const buildMessage = (
  message: string,
  title: string,
  description: string,
): Option.Option<string> => {
  // If message is provided, use it directly
  if (message) {
    return Option.some(message);
  }

  // If title is provided, build message from title + optional description
  if (title) {
    if (description) {
      // Title + blank line + description
      return Option.some(`${title}\n\n${description}`);
    }
    // Title only
    return Option.some(title);
  }

  // No valid message
  return Option.none();
};

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
  {
    json: jsonOption,
    message: messageOption,
    title: titleOption,
    description: descriptionOption,
  },
  ({ json, message, title, description }) =>
    Effect.gen(function* () {
      // Check VCS availability (jj installed and in repo)
      const vcsCheck = yield* checkVcsAvailability();
      if (!vcsCheck.available) {
        yield* outputError(vcsCheck.error, json);
        return;
      }
      const { vcs } = vcsCheck;

      // Build the message from options
      const fullMessage = buildMessage(message, title, description);

      if (Option.isNone(fullMessage)) {
        yield* outputError(
          "Either --message or --title is required. Use --title with optional --description for multi-line commits.",
          json,
        );
        return;
      }

      const messageText = fullMessage.value;

      // Update the description - handle errors explicitly
      const describeResult = yield* vcs.describe(messageText).pipe(
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
          description: messageText,
        };
        if (json) {
          yield* Console.log(JSON.stringify(output, null, 2));
        } else {
          yield* Console.log(`Updated description`);
          yield* Console.log(`Description: ${messageText}`);
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
        yield* Console.log(`Description: ${messageText}`);
      }
    }),
);
