/**
 * ship webhook forward - Forward GitHub webhook events to OpenCode agent
 *
 * This command:
 * 1. Checks if OpenCode server is running
 * 2. Creates a CLI webhook on the current repo
 * 3. Connects to WebSocket
 * 4. Activates the webhook
 * 5. Forwards events to OpenCode session
 * 6. On SIGINT/SIGTERM: cleans up webhook and exits
 */

import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import { PrService } from "../../../../../ports/PrService.js";
import {
  WebhookService,
  CreateCliWebhookInput,
  type CliWebhook,
} from "../../../../../ports/WebhookService.js";
import { OpenCodeService, SessionId } from "../../../../../ports/OpenCodeService.js";
import { formatWebhookEvent } from "../../../../driven/opencode/WebhookEventFormatter.js";

// === Options ===

const eventsOption = Options.text("events").pipe(
  Options.withAlias("e"),
  Options.withDescription(
    "Comma-separated list of events to forward (e.g., pull_request,pull_request_review)",
  ),
  Options.withDefault("pull_request,pull_request_review,issue_comment,check_run"),
);

const sessionOption = Options.text("session").pipe(
  Options.withAlias("s"),
  Options.withDescription("OpenCode session ID to send events to (default: auto-detect active session)"),
  Options.optional,
);

// === Output helpers ===

const timestamp = (): string => {
  const now = new Date();
  return now.toLocaleTimeString("en-US", { hour12: false });
};

const log = (message: string) => Console.log(`[${timestamp()}] ${message}`);

// === Command ===

export const forwardCommand = Command.make(
  "forward",
  { events: eventsOption, session: sessionOption },
  ({ events, session }) =>
    Effect.gen(function* () {
      const prService = yield* PrService;
      const webhookService = yield* WebhookService;
      const openCodeService = yield* OpenCodeService;

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

      // 3. Check if OpenCode is running
      const openCodeAvailable = yield* openCodeService.isAvailable();
      if (!openCodeAvailable) {
        yield* Console.error(
          "OpenCode server is not running. Start OpenCode first.",
        );
        return;
      }

      // 4. Find or validate session using Effect patterns (no let)
      const resolveSessionId: Effect.Effect<SessionId, string> =
        session._tag === "Some"
          ? // User provided a session ID - validate it with proper schema decoding
            Schema.decode(SessionId)(session.value).pipe(
              Effect.mapError(() => "Invalid session ID format"),
              Effect.flatMap((sessionId) =>
                openCodeService.getSession(sessionId).pipe(
                  Effect.map((s) => s.id),
                  Effect.mapError(() => `Session '${session.value}' not found`),
                ),
              ),
            )
          : // Auto-detect active session
            openCodeService.findActiveSession().pipe(
              Effect.mapError((e) => `Failed to find active session: ${e}`),
              Effect.flatMap((activeSession) =>
                activeSession
                  ? Effect.succeed(activeSession.id)
                  : Effect.fail("No active OpenCode session found. Start a session in OpenCode first."),
              ),
            );

      const sessionIdResult = yield* resolveSessionId.pipe(
        Effect.map((id) => ({ success: true as const, id })),
        Effect.catchAll((errorMsg) =>
          Console.error(errorMsg).pipe(Effect.as({ success: false as const })),
        ),
      );

      if (!sessionIdResult.success) {
        return;
      }

      const targetSessionId = sessionIdResult.id;

      // 5. Parse events
      const eventList = events.split(",").map((e) => e.trim()).filter(Boolean);
      if (eventList.length === 0) {
        yield* Console.error("No events specified. Use --events to specify events to forward.");
        return;
      }

      // 6. Create webhook with guaranteed cleanup using acquireRelease
      yield* Console.log(`Creating webhook for ${repo}...`);

      const webhookInput = new CreateCliWebhookInput({
        repo,
        events: eventList,
      });

      // Helper to cleanup webhook
      const cleanupWebhook = (webhook: CliWebhook, repoName: string) =>
        Effect.gen(function* () {
          yield* Console.log("\nShutting down...");
          yield* webhookService.deactivateWebhook(repoName, webhook.id).pipe(
            Effect.catchAll(() => Effect.void),
          );
          yield* webhookService.deleteWebhook(repoName, webhook.id).pipe(
            Effect.catchAll(() => Effect.void),
          );
          yield* Console.log("Webhook cleaned up.");
        });

      // Use acquireRelease for guaranteed cleanup on all exit paths
      yield* Effect.acquireUseRelease(
        // Acquire: Create the webhook
        webhookService.createCliWebhook(webhookInput),

        // Use: Run the event forwarding loop
        (webhook) =>
          Effect.gen(function* () {
            yield* Console.log(`Connecting to WebSocket...`);

            // Activate the webhook
            yield* webhookService.activateWebhook(repo, webhook.id).pipe(
              Effect.catchAll((e) =>
                Console.error(`Warning: Failed to activate webhook: ${e}`),
              ),
            );

            // Print startup info
            yield* Console.log("");
            yield* Console.log(`Webhook forwarding started for ${repo}`);
            yield* Console.log(`Events: ${eventList.join(", ")}`);
            yield* Console.log(`OpenCode session: ${targetSessionId}`);
            yield* Console.log("");
            yield* Console.log("Forwarding events... (Ctrl+C to stop)");
            yield* Console.log("");

            // Stream events and forward to OpenCode
            yield* webhookService.connectAndStream(webhook.wsUrl).pipe(
              Stream.tap((event) =>
                Effect.gen(function* () {
                  // Format the event
                  const message = formatWebhookEvent(event);

                  // Log received event
                  const eventDesc = event.action
                    ? `${event.event}.${event.action}`
                    : event.event;
                  yield* log(`Received: ${eventDesc}`);

                  // Send to OpenCode
                  const sendResult = yield* openCodeService
                    .sendPromptAsync(targetSessionId, message)
                    .pipe(
                      Effect.map(() => ({ success: true as const })),
                      Effect.catchAll((e) =>
                        Effect.succeed({ success: false as const, error: String(e) }),
                      ),
                    );

                  if (sendResult.success) {
                    yield* log(`Forwarded to session ${targetSessionId}`);
                  } else {
                    yield* log(`Failed to forward: ${sendResult.error}`);
                  }
                }),
              ),
              Stream.runDrain,
            );
          }),

        // Release: Cleanup webhook (runs on success, failure, or interrupt)
        (webhook, exit) =>
          cleanupWebhook(webhook, repo).pipe(
            Effect.tap(() =>
              exit._tag === "Failure"
                ? Console.error(`Exited due to: ${exit.cause}`)
                : Effect.void,
            ),
          ),
      ).pipe(
        Effect.catchAll((e) =>
          Console.error(`Failed to create webhook: ${e}`),
        ),
      );
    }),
);
