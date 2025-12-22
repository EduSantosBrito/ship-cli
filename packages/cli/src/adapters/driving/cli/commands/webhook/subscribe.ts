/**
 * ship webhook subscribe - Subscribe a session to PR events
 *
 * This command registers an OpenCode session to receive events for specific PRs.
 * Used by agents to subscribe to PRs they're working on.
 */

import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { DaemonService } from "../../../../../ports/DaemonService.js";

// === Options ===

const sessionOption = Options.text("session").pipe(
  Options.withAlias("s"),
  Options.withDescription("OpenCode session ID to subscribe"),
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

// === Args ===

const prNumbersArg = Args.text({ name: "pr-numbers" }).pipe(
  Args.withDescription("Comma-separated PR numbers to subscribe to (e.g., 34,35,36)"),
);

// === Command ===

export const subscribeCommand = Command.make(
  "subscribe",
  { session: sessionOption, prNumbers: prNumbersArg, json: jsonOption },
  ({ session, prNumbers, json }) =>
    Effect.gen(function* () {
      const daemonService = yield* DaemonService;

      // Check if daemon is running
      const running = yield* daemonService.isRunning();
      if (!running) {
        if (json) {
          yield* Console.log(JSON.stringify({ subscribed: false, error: "Daemon not running" }));
        } else {
          yield* Console.error(
            "Webhook daemon is not running. Start it with 'ship webhook start'.",
          );
        }
        return;
      }

      // Parse PR numbers
      const prs = prNumbers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => parseInt(s, 10))
        .filter((n) => !isNaN(n) && n > 0);

      if (prs.length === 0) {
        if (json) {
          yield* Console.log(JSON.stringify({ subscribed: false, error: "No valid PR numbers" }));
        } else {
          yield* Console.error("No valid PR numbers provided.");
        }
        return;
      }

      // Subscribe
      const result = yield* daemonService.subscribe(session, prs).pipe(
        Effect.map(() => ({ subscribed: true, sessionId: session, prNumbers: prs })),
        Effect.catchAll((e) => Effect.succeed({ subscribed: false, error: String(e) })),
      );

      if (json) {
        yield* Console.log(JSON.stringify(result));
      } else if (result.subscribed) {
        yield* Console.log(`Subscribed session ${session} to PRs: ${prs.join(", ")}`);
      } else {
        yield* Console.error(
          `Failed to subscribe: ${"error" in result ? result.error : "Unknown error"}`,
        );
      }
    }),
);
