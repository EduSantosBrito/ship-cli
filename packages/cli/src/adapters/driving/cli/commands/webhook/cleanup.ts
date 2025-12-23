/**
 * ship webhook cleanup - Clean up stale webhook subscriptions
 *
 * This command removes subscriptions for OpenCode sessions that no longer exist.
 * Useful when sessions have ended but their subscriptions remain in the daemon.
 */

import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { DaemonService } from "../../../../../ports/DaemonService.js";

// === Options ===

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

// === Command ===

export const cleanupCommand = Command.make("cleanup", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const daemonService = yield* DaemonService;

    // Check if daemon is running
    const running = yield* daemonService.isRunning();
    if (!running) {
      if (json) {
        yield* Console.log(JSON.stringify({ success: false, error: "Daemon not running" }));
      } else {
        yield* Console.log("Webhook daemon is not running.");
        yield* Console.log("");
        yield* Console.log("Start it with: ship webhook start");
      }
      return;
    }

    // Run cleanup
    const removedSessions = yield* daemonService.cleanup().pipe(
      Effect.catchTag("DaemonNotRunningError", () => Effect.fail({ type: "not_running" as const })),
      Effect.catchAll((e) => Effect.fail({ type: "error" as const, message: String(e) })),
    );

    if (typeof removedSessions === "object" && "type" in removedSessions) {
      if (json) {
        yield* Console.log(JSON.stringify({ success: false, error: removedSessions }));
      } else {
        yield* Console.log(`Failed to cleanup: ${JSON.stringify(removedSessions)}`);
      }
      return;
    }

    // JSON output
    if (json) {
      yield* Console.log(
        JSON.stringify({
          success: true,
          removedSessions,
          count: removedSessions.length,
        }),
      );
      return;
    }

    // Human-readable output
    if (removedSessions.length === 0) {
      yield* Console.log("No stale subscriptions found.");
      yield* Console.log("All subscribed sessions are still active.");
    } else {
      yield* Console.log(`Cleaned up ${removedSessions.length} stale subscription(s):`);
      yield* Console.log("");
      for (const sessionId of removedSessions) {
        yield* Console.log(`  - ${sessionId}`);
      }
      yield* Console.log("");
      yield* Console.log("These sessions no longer exist in OpenCode.");
    }
  }),
);
