/**
 * ship webhook - GitHub webhook operations
 *
 * This command group provides webhook-related functionality
 * for receiving real-time GitHub events.
 */

import * as Command from "@effect/cli/Command";
import * as Console from "effect/Console";
import { forwardCommand } from "./forward.js";
import { startCommand } from "./start.js";
import { stopCommand } from "./stop.js";
import { statusCommand } from "./status.js";
import { subscribeCommand } from "./subscribe.js";
import { unsubscribeCommand } from "./unsubscribe.js";
import { cleanupCommand } from "./cleanup.js";

// Webhook parent command
const webhook = Command.make("webhook", {}, () =>
  Console.log(`ship webhook - GitHub webhook operations

Usage: ship webhook <command> [options]

Commands:
  start             Start the webhook daemon
  stop              Stop the webhook daemon
  status            Show daemon status and subscriptions
  subscribe         Subscribe a session to PR events
  unsubscribe       Unsubscribe a session from PR events
  cleanup           Clean up stale subscriptions
  forward           Forward GitHub events to OpenCode agent (legacy)

The daemon maintains a single WebSocket connection to GitHub and routes
events to subscribed OpenCode sessions based on PR number.

Run 'ship webhook <command> --help' for more information.`),
);

// Combine webhook subcommands
export const webhookCommand = webhook.pipe(
  Command.withSubcommands([
    startCommand,
    stopCommand,
    statusCommand,
    subscribeCommand,
    unsubscribeCommand,
    cleanupCommand,
    forwardCommand,
  ]),
);
