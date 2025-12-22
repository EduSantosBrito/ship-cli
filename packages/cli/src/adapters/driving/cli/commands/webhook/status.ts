/**
 * ship webhook status - Show webhook daemon status
 *
 * This command displays the current status of the webhook daemon,
 * including connected sessions and PR subscriptions.
 */

import * as Command from "@effect/cli/Command";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { DaemonService } from "../../../../../ports/DaemonService.js";

// === Helpers ===

const formatUptime = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
};

// === Command ===

export const statusCommand = Command.make(
  "status",
  {},
  () =>
    Effect.gen(function* () {
      const daemonService = yield* DaemonService;

      // Check if daemon is running
      const running = yield* daemonService.isRunning();
      if (!running) {
        yield* Console.log("Webhook daemon is not running.");
        yield* Console.log("");
        yield* Console.log("Start it with: ship webhook start");
        return;
      }

      // Get daemon status
      const statusResult = yield* daemonService.getStatus().pipe(
        Effect.map((s) => ({ success: true as const, status: s })),
        Effect.catchTag("DaemonNotRunningError", () =>
          Effect.succeed({ success: false as const, error: "Daemon not running" }),
        ),
        Effect.catchAll((e) =>
          Console.error(`Failed to get daemon status: ${e}`).pipe(
            Effect.as({ success: false as const, error: String(e) }),
          ),
        ),
      );

      if (!statusResult.success) {
        yield* Console.log("Daemon appears to be running but not responding.");
        return;
      }

      const status = statusResult.status;

      // Display status
      yield* Console.log("Webhook Daemon Status");
      yield* Console.log("─".repeat(40));
      yield* Console.log("");
      yield* Console.log(`Status: ${status.running ? "Running" : "Stopped"}`);
      if (status.pid) {
        yield* Console.log(`PID: ${status.pid}`);
      }
      if (status.repo) {
        yield* Console.log(`Repository: ${status.repo}`);
      }
      yield* Console.log(`GitHub WebSocket: ${status.connectedToGitHub ? "Connected" : "Disconnected"}`);
      if (status.uptime !== undefined) {
        yield* Console.log(`Uptime: ${formatUptime(status.uptime)}`);
      }

      yield* Console.log("");
      yield* Console.log("Subscriptions");
      yield* Console.log("─".repeat(40));

      if (status.subscriptions.length === 0) {
        yield* Console.log("No active subscriptions.");
        yield* Console.log("");
        yield* Console.log("Agents can subscribe using the ship tool:");
        yield* Console.log("  ship tool: action=webhook-start");
      } else {
        for (const sub of status.subscriptions) {
          yield* Console.log("");
          yield* Console.log(`Session: ${sub.sessionId}`);
          yield* Console.log(`  PRs: ${sub.prNumbers.join(", ")}`);
        }
      }
    }),
);
