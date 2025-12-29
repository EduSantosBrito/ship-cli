/**
 * ship webhook unsubscribe - Unsubscribe a session from PR events
 *
 * This command removes an OpenCode session from receiving events for specific PRs.
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
  Options.withDescription("OpenCode session ID to unsubscribe"),
);

const serverUrlOption = Options.text("server-url").pipe(
  Options.withDescription("OpenCode server URL (e.g., http://127.0.0.1:4097)"),
  Options.optional,
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

// === Args ===

const prNumbersArg = Args.text({ name: "pr-numbers" }).pipe(
  Args.withDescription("Comma-separated PR numbers to unsubscribe from (e.g., 34,35,36)"),
);

// === Command ===

export const unsubscribeCommand = Command.make(
  "unsubscribe",
  { session: sessionOption, serverUrl: serverUrlOption, prNumbers: prNumbersArg, json: jsonOption },
  ({ session, serverUrl, prNumbers, json }) =>
    Effect.gen(function* () {
      const daemonService = yield* DaemonService;

      // Check if daemon is running
      const running = yield* daemonService.isRunning();
      if (!running) {
        if (json) {
          yield* Console.log(JSON.stringify({ unsubscribed: false, error: "Daemon not running" }));
        } else {
          yield* Console.error("Webhook daemon is not running.");
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
          yield* Console.log(JSON.stringify({ unsubscribed: false, error: "No valid PR numbers" }));
        } else {
          yield* Console.error("No valid PR numbers provided.");
        }
        return;
      }

      // Get server URL from option or environment variable
      const resolvedServerUrl =
        serverUrl._tag === "Some"
          ? serverUrl.value
          : process.env.OPENCODE_SERVER_URL ?? undefined;

      // Unsubscribe
      const result = yield* daemonService.unsubscribe(session, prs, resolvedServerUrl).pipe(
        Effect.map(() => ({ unsubscribed: true, sessionId: session, prNumbers: prs })),
        Effect.catchAll((e) => Effect.succeed({ unsubscribed: false, error: String(e) })),
      );

      if (json) {
        yield* Console.log(JSON.stringify(result));
      } else if (result.unsubscribed) {
        yield* Console.log(`Unsubscribed session ${session} from PRs: ${prs.join(", ")}`);
      } else {
        yield* Console.error(
          `Failed to unsubscribe: ${"error" in result ? result.error : "Unknown error"}`,
        );
      }
    }),
);
