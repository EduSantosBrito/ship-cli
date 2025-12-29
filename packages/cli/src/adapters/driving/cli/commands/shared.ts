/**
 * Shared utilities and options for CLI commands
 */

import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { InvalidDateError } from "../../../../domain/Errors.js";

/**
 * Shared --dry-run option for commands that mutate state.
 *
 * When enabled, commands will:
 * - Perform all validation and resolution
 * - Calculate what would happen
 * - Output the planned action without executing it
 *
 * In JSON mode, the output includes `dryRun: true`.
 * In text mode, output is prefixed with "[DRY RUN]".
 */
export const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDescription("Preview changes without executing them"),
  Options.withDefault(false),
);

/**
 * Shared --json option for consistent JSON output across commands.
 */
export const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

/**
 * Format output for dry run mode.
 * Adds appropriate prefix/wrapper based on output format.
 */
export const formatDryRunOutput = (message: string, json: boolean): string => {
  if (json) {
    return message; // JSON output handles dryRun field separately
  }
  return `[DRY RUN] ${message}`;
};

/**
 * Schema for parsing date strings into Date objects.
 * Uses Effect's built-in Schema.Date which handles ISO 8601 formats.
 */
export const DateFromString = Schema.Date;

/**
 * Parse an optional date string with proper error handling.
 *
 * @param dateOption - Optional date string from CLI input
 * @param field - Field name for error messages (e.g., "targetDate")
 * @returns Effect that yields Option<Date> or fails with InvalidDateError
 */
export const parseOptionalDate = (
  dateOption: Option.Option<string>,
  field: string,
): Effect.Effect<Option.Option<Date>, InvalidDateError> =>
  Option.match(dateOption, {
    onNone: () => Effect.succeed(Option.none<Date>()),
    onSome: (dateStr) =>
      Schema.decodeUnknown(DateFromString)(dateStr).pipe(
        Effect.map(Option.some),
        Effect.catchTag("ParseError", () =>
          Effect.fail(new InvalidDateError({ input: dateStr, field })),
        ),
      ),
  });
