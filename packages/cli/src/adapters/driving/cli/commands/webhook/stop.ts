/**
 * ship webhook stop - Stop the webhook daemon
 *
 * This command sends a shutdown signal to the running daemon.
 */

import * as Command from "@effect/cli/Command";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { DaemonService, DaemonNotRunningError } from "../../../../../ports/DaemonService.js";

// === Command ===

export const stopCommand = Command.make("stop", {}, () =>
  Effect.gen(function* () {
    const daemonService = yield* DaemonService;

    // Check if daemon is running
    const running = yield* daemonService.isRunning();
    if (!running) {
      yield* Console.log("Webhook daemon is not running.");
      return;
    }

    // Send shutdown signal
    yield* Console.log("Stopping webhook daemon...");
    yield* daemonService.shutdown().pipe(
      Effect.tap(() => Console.log("Shutdown signal sent.")),
      Effect.catchTag("DaemonNotRunningError", (e: DaemonNotRunningError) =>
        Console.log(e.message),
      ),
      Effect.catchAll((e) => Console.error(`Failed to stop daemon: ${e}`)),
    );
  }),
);
