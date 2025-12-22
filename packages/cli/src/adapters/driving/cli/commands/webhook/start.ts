/**
 * ship webhook start - Start the webhook daemon
 *
 * This command starts the webhook daemon in the foreground.
 * The daemon:
 * 1. Creates a GitHub CLI webhook for the current repo
 * 2. Connects to WebSocket for real-time events
 * 3. Listens on a Unix socket for IPC commands
 * 4. Routes events to subscribed OpenCode sessions
 */

import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { PrService } from "../../../../../ports/PrService.js";
import { DaemonService, DaemonAlreadyRunningError } from "../../../../../ports/DaemonService.js";

// === Options ===

const eventsOption = Options.text("events").pipe(
  Options.withAlias("e"),
  Options.withDescription(
    "Comma-separated list of events to subscribe to (e.g., pull_request,pull_request_review)",
  ),
  Options.withDefault("pull_request,pull_request_review,issue_comment,check_run"),
);

// === Command ===

export const startCommand = Command.make(
  "start",
  { events: eventsOption },
  ({ events }) =>
    Effect.gen(function* () {
      const prService = yield* PrService;
      const daemonService = yield* DaemonService;

      // 1. Check if gh is available
      const ghAvailable = yield* prService.isAvailable();
      if (!ghAvailable) {
        yield* Console.error(
          "GitHub CLI (gh) is not installed or not authenticated. Run 'gh auth login' first.",
        );
        return;
      }

      // 2. Get current repo
      const repo = yield* prService.getCurrentRepo();
      if (!repo) {
        yield* Console.error(
          "Not in a git repository or no GitHub remote configured.",
        );
        return;
      }

      // 3. Parse events
      const eventList = events.split(",").map((e) => e.trim()).filter(Boolean);
      if (eventList.length === 0) {
        yield* Console.error("No events specified. Use --events to specify events to subscribe to.");
        return;
      }

      // 4. Start the daemon
      yield* Console.log(`Starting webhook daemon for ${repo}...`);
      yield* Console.log(`Events: ${eventList.join(", ")}`);
      yield* Console.log("");
      yield* Console.log("Press Ctrl+C to stop");
      yield* Console.log("");

      yield* daemonService.startDaemon(repo, eventList).pipe(
        Effect.catchTag("DaemonAlreadyRunningError", (e: DaemonAlreadyRunningError) =>
          Console.error(e.message),
        ),
        Effect.catchAll((e) =>
          Console.error(`Failed to start daemon: ${e}`),
        ),
      );
    }),
);
