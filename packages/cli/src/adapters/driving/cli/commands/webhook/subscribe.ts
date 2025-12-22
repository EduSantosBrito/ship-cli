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

// === Args ===

const prNumbersArg = Args.text({ name: "pr-numbers" }).pipe(
  Args.withDescription("Comma-separated PR numbers to subscribe to (e.g., 34,35,36)"),
);

// === Command ===

export const subscribeCommand = Command.make(
  "subscribe",
  { session: sessionOption, prNumbers: prNumbersArg },
  ({ session, prNumbers }) =>
    Effect.gen(function* () {
      const daemonService = yield* DaemonService;

      // Check if daemon is running
      const running = yield* daemonService.isRunning();
      if (!running) {
        yield* Console.error("Webhook daemon is not running. Start it with 'ship webhook start'.");
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
        yield* Console.error("No valid PR numbers provided.");
        return;
      }

      // Subscribe
      yield* daemonService.subscribe(session, prs).pipe(
        Effect.tap(() =>
          Console.log(`Subscribed session ${session} to PRs: ${prs.join(", ")}`),
        ),
        Effect.catchAll((e) =>
          Console.error(`Failed to subscribe: ${e}`),
        ),
      );
    }),
);
