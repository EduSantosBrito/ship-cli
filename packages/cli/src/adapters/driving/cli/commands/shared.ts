/**
 * Shared utilities and options for CLI commands
 */

import * as Options from "@effect/cli/Options";

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
