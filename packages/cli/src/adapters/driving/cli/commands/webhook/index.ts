/**
 * ship webhook - GitHub webhook operations
 *
 * This command group provides webhook-related functionality
 * for receiving real-time GitHub events.
 */

import * as Command from "@effect/cli/Command";
import * as Console from "effect/Console";
import { forwardCommand } from "./forward.js";

// Webhook parent command
const webhook = Command.make("webhook", {}, () =>
  Console.log(`ship webhook - GitHub webhook operations

Usage: ship webhook <command> [options]

Commands:
  forward           Forward GitHub events to OpenCode agent

Run 'ship webhook <command> --help' for more information.`),
);

// Combine webhook subcommands
export const webhookCommand = webhook.pipe(
  Command.withSubcommands([forwardCommand]),
);
