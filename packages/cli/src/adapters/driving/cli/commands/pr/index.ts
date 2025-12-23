/**
 * ship pr - PR workflow commands
 *
 * Commands for creating and managing GitHub PRs with Linear task integration.
 *
 * Usage:
 *   ship pr              # Show help
 *   ship pr create       # Create PR for current bookmark
 *   ship pr stack        # Create stacked PRs for entire stack
 *   ship pr review       # Fetch PR reviews and comments
 */

import * as Command from "@effect/cli/Command";
import * as Console from "effect/Console";
import { createPrCommand } from "./create.js";
import { stackCommand } from "./stack.js";
import { reviewCommand } from "./review.js";

// === Root Command ===

const prRoot = Command.make("pr", {}, () =>
  Console.log(`ship pr - PR workflow commands

Usage: ship pr <command> [options]

Commands:
  create              Create PR for current bookmark
  stack               Create stacked PRs for entire stack
  review [pr-number]  Fetch PR reviews and comments

Run 'ship pr <command> --help' for more information on a command.`),
);

// Combine with subcommands
export const prCommand = prRoot.pipe(
  Command.withSubcommands([createPrCommand, stackCommand, reviewCommand]),
);
