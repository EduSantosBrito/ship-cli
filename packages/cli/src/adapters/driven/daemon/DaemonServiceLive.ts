/**
 * DaemonServiceLive - Webhook daemon implementation using Effect
 *
 * This adapter implements the DaemonService port providing:
 * 1. Unix socket IPC server for agent communication
 * 2. GitHub WebSocket connection with auto-reconnect
 * 3. In-memory registry for session → PR mappings
 * 4. Event routing to OpenCode sessions
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as Ref from "effect/Ref";
import * as HashMap from "effect/HashMap";
import * as HashSet from "effect/HashSet";
import * as Fiber from "effect/Fiber";
import * as Deferred from "effect/Deferred";
import * as Schedule from "effect/Schedule";
import * as Runtime from "effect/Runtime";
import * as Duration from "effect/Duration";
import * as Scope from "effect/Scope";
import * as Queue from "effect/Queue";
import * as Data from "effect/Data";
import * as Net from "node:net";
import * as Fs from "node:fs";
import {
  DaemonService,
  DaemonStatus,
  SessionSubscription,
  IpcCommand,
  IpcResponse,
  SuccessResponse,
  ErrorResponse,
  StatusResponse,
  CleanupResponse,
  DaemonError,
  DaemonNotRunningError,
  DaemonAlreadyRunningError,
  DAEMON_SOCKET_PATH,
  DAEMON_PID_PATH,
  type DaemonErrors,
  type PrNumber,
} from "../../../ports/DaemonService.js";
import {
  WebhookService,
  CreateCliWebhookInput,
  type CliWebhook,
  type WebhookEvent,
} from "../../../ports/WebhookService.js";
import { OpenCodeService, SessionId, type OpenCodeErrors } from "../../../ports/OpenCodeService.js";
import { OpenCodeError, OpenCodeSessionNotFoundError } from "../../../domain/Errors.js";
import { formatWebhookEvent } from "../opencode/WebhookEventFormatter.js";

// === Registry Types ===

/**
 * A subscription entry containing session ID and server URL.
 * Uses Effect's Data.Class for structural equality in HashSet.
 */
class SubscriptionEntry extends Data.Class<{
  readonly sessionId: string;
  readonly serverUrl: string | undefined;
}> {}

/**
 * The daemon registry maps PR numbers to sets of subscription entries.
 * When an event for a PR comes in, we notify all subscribed sessions at their respective server URLs.
 */
type Registry = HashMap.HashMap<number, HashSet.HashSet<SubscriptionEntry>>;

// === Type Guards ===

/**
 * Type guard to check if an unknown error is a tagged Effect error with a specific tag.
 * Useful for runtime error type checking in catchAll handlers.
 */
const isTaggedError = <T extends string>(e: unknown, tag: T): e is { _tag: T; message: string } =>
  typeof e === "object" && e !== null && "_tag" in e && e._tag === tag;

// === IPC Command Request ===

/**
 * Represents a pending IPC command with its response channel
 */
interface IpcRequest {
  command: IpcCommand;
  respond: (response: typeof IpcResponse.Type) => void;
}

// === IPC Client (for CLI/agent commands) ===

/**
 * Send a command to the daemon via Unix socket and get the response.
 * Uses Effect.async with proper cleanup on interruption.
 */
const sendCommand = (command: IpcCommand): Effect.Effect<typeof IpcResponse.Type, DaemonErrors> =>
  Effect.async<typeof IpcResponse.Type, DaemonErrors>((resume, signal) => {
    // Check if socket exists
    if (!Fs.existsSync(DAEMON_SOCKET_PATH)) {
      resume(Effect.fail(DaemonNotRunningError.default));
      return;
    }

    const client = Net.createConnection(DAEMON_SOCKET_PATH);
    let responseData = "";

    // Cleanup function to destroy socket and remove listeners
    const cleanup = () => {
      client.removeAllListeners();
      client.destroy();
    };

    // Register cleanup on abort signal for proper interruption handling
    signal.addEventListener("abort", cleanup);

    client.on("connect", () => {
      client.write(JSON.stringify(command) + "\n");
    });

    client.on("data", (data) => {
      responseData += data.toString();
    });

    client.on("end", () => {
      cleanup();
      const parseResult = Schema.decodeUnknownEither(IpcResponse)(JSON.parse(responseData));
      if (parseResult._tag === "Left") {
        resume(
          Effect.fail(
            new DaemonError({
              message: `Invalid response from daemon: ${parseResult.left}`,
            }),
          ),
        );
      } else {
        resume(Effect.succeed(parseResult.right));
      }
    });

    client.on("error", (err) => {
      cleanup();
      if (
        (err as NodeJS.ErrnoException).code === "ECONNREFUSED" ||
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        resume(Effect.fail(DaemonNotRunningError.default));
      } else {
        resume(Effect.fail(new DaemonError({ message: `IPC error: ${err.message}`, cause: err })));
      }
    });
  });

// === Daemon Server ===

/**
 * Create and run the daemon server.
 * This is a long-running Effect that handles:
 * 1. IPC commands from clients
 * 2. GitHub webhook events
 * 3. Routing events to subscribed sessions
 */
const runDaemonServer = (
  repo: string,
  events: ReadonlyArray<string>,
  webhookService: WebhookService,
  openCodeService: OpenCodeService,
): Effect.Effect<void, DaemonErrors, Scope.Scope> =>
  Effect.gen(function* () {
    // Initialize state
    const registryRef = yield* Ref.make<Registry>(HashMap.empty());
    const startTime = Date.now();
    const shutdownDeferred = yield* Deferred.make<void>();
    const connectedRef = yield* Ref.make(false);
    const webhookRef = yield* Ref.make<CliWebhook | null>(null);

    // Create a queue for IPC requests to be processed within the Effect runtime
    const commandQueue = yield* Queue.unbounded<IpcRequest>();

    /**
     * Send a prompt to an OpenCode session, optionally at a specific server URL.
     * If serverUrl is provided, makes a direct HTTP call; otherwise uses the default service.
     */
    const sendPromptToServer = (
      sessionId: SessionId,
      message: string,
      serverUrl: string | undefined,
    ): Effect.Effect<void, OpenCodeErrors> => {
      // If no custom URL, use the default OpenCode service
      if (!serverUrl) {
        return openCodeService.sendPromptAsync(sessionId, message);
      }

      // Make a direct HTTP call to the custom server URL
      // Use URL constructor to properly handle base URLs with/without trailing slashes
      return Effect.tryPromise({
        try: async () => {
          const url = new URL(`/session/${sessionId}/prompt_async`, serverUrl).toString();
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parts: [{ type: "text", text: message }] }),
          });

          if (response.status === 404) {
            throw { type: "not_found", sessionId };
          }
          if (response.status >= 400) {
            const text = await response.text().catch(() => "");
            throw { type: "server_error", status: response.status, text };
          }
        },
        catch: (error: unknown): OpenCodeErrors => {
          if (error && typeof error === "object" && "type" in error) {
            const e = error as Record<string, unknown>;
            if (e.type === "not_found") {
              return OpenCodeSessionNotFoundError.forId(String(e.sessionId));
            }
            if (e.type === "server_error") {
              return new OpenCodeError({
                message: `OpenCode server at ${serverUrl} returned ${e.status}: ${e.text}`,
              });
            }
          }
          return new OpenCodeError({
            message: `Failed to send prompt to ${serverUrl}: ${error}`,
            cause: error,
          });
        },
      });
    };

    // Write PID file
    yield* Effect.sync(() => {
      Fs.writeFileSync(DAEMON_PID_PATH, String(process.pid));
    });

    // Register cleanup as finalizer - runs on ANY exit (success, failure, interruption)
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Effect.logInfo("Running cleanup finalizer");

        // Remove socket file
        yield* Effect.sync(() => {
          if (Fs.existsSync(DAEMON_SOCKET_PATH)) {
            Fs.unlinkSync(DAEMON_SOCKET_PATH);
          }
        });

        // Remove PID file
        yield* Effect.sync(() => {
          if (Fs.existsSync(DAEMON_PID_PATH)) {
            Fs.unlinkSync(DAEMON_PID_PATH);
          }
        });

        // Cleanup webhook
        const webhook = yield* Ref.get(webhookRef);
        if (webhook) {
          yield* webhookService.deactivateWebhook(repo, webhook.id).pipe(Effect.ignore);
          yield* webhookService.deleteWebhook(repo, webhook.id).pipe(Effect.ignore);
        }

        yield* Effect.logInfo("Cleanup completed");
      }).pipe(Effect.ignore),
    );

    // Handle IPC command - pure Effect, no side effects
    const handleCommand = (command: IpcCommand): Effect.Effect<typeof IpcResponse.Type, never> =>
      Effect.gen(function* () {
        switch (command.type) {
          case "subscribe": {
            const { sessionId, prNumbers, serverUrl } = command;

            yield* Effect.logInfo("Received subscribe command").pipe(
              Effect.annotateLogs({
                sessionId: sessionId ?? "undefined",
                prNumbers: prNumbers?.join(",") ?? "undefined",
                serverUrl: serverUrl ?? "default",
              }),
            );

            // Validate inputs
            if (!sessionId || sessionId.length === 0) {
              yield* Effect.logWarning("Subscribe rejected: sessionId is required");
              return new ErrorResponse({ type: "error", error: "sessionId is required" });
            }
            if (!prNumbers || prNumbers.length === 0) {
              yield* Effect.logWarning("Subscribe rejected: prNumbers is required");
              return new ErrorResponse({ type: "error", error: "prNumbers is required" });
            }
            if (!prNumbers.every((n) => typeof n === "number" && n > 0)) {
              yield* Effect.logWarning("Subscribe rejected: prNumbers must be positive integers");
              return new ErrorResponse({
                type: "error",
                error: "prNumbers must be positive integers",
              });
            }

            // Log registry state before update
            const registryBefore = yield* Ref.get(registryRef);
            yield* Effect.logInfo("Registry state before subscribe").pipe(
              Effect.annotateLogs({
                registrySize: String(HashMap.size(registryBefore)),
              }),
            );

            // Create subscription entry with serverUrl
            const entry = new SubscriptionEntry({ sessionId, serverUrl });

            yield* Ref.update(registryRef, (registry) => {
              let updated = registry;
              for (const pr of prNumbers) {
                const existing = HashMap.get(updated, pr);
                const entries =
                  existing._tag === "Some"
                    ? HashSet.add(existing.value, entry)
                    : HashSet.make(entry);
                updated = HashMap.set(updated, pr, entries);
              }
              return updated;
            });

            yield* Effect.logInfo("Subscribed session to PRs").pipe(
              Effect.annotateLogs({ sessionId, prNumbers: prNumbers.join(",") }),
            );

            return new SuccessResponse({
              type: "success",
              message: `Subscribed session ${sessionId} to PRs: ${prNumbers.join(", ")}`,
            });
          }

          case "unsubscribe": {
            const { sessionId, prNumbers, serverUrl } = command;
            // Create entry to match (uses structural equality)
            const entry = new SubscriptionEntry({ sessionId, serverUrl });

            yield* Ref.update(registryRef, (registry) => {
              let updated = registry;
              for (const pr of prNumbers) {
                const existing = HashMap.get(updated, pr);
                if (existing._tag === "Some") {
                  const sessions = HashSet.remove(existing.value, entry);
                  if (HashSet.size(sessions) === 0) {
                    updated = HashMap.remove(updated, pr);
                  } else {
                    updated = HashMap.set(updated, pr, sessions);
                  }
                }
              }
              return updated;
            });

            yield* Effect.logInfo("Unsubscribed session from PRs").pipe(
              Effect.annotateLogs({
                sessionId,
                prNumbers: prNumbers.join(","),
                serverUrl: serverUrl ?? "default",
              }),
            );

            return new SuccessResponse({
              type: "success",
              message: `Unsubscribed session ${sessionId} from PRs: ${prNumbers.join(", ")}`,
            });
          }

          case "status": {
            const registry = yield* Ref.get(registryRef);
            const connected = yield* Ref.get(connectedRef);

            // Build subscriptions list - group by (sessionId, serverUrl) tuple using HashMap.reduce
            // Accumulator: HashMap<subscriptionKey, { sessionId, serverUrl, prs }>
            type SessionData = { sessionId: string; serverUrl: string | undefined; prs: number[] };
            const subscriptionKey = (e: SubscriptionEntry) =>
              `${e.sessionId}@${e.serverUrl ?? "default"}`;

            const grouped = HashMap.reduce(
              registry,
              HashMap.empty<string, SessionData>(),
              (acc, entries, pr) =>
                HashSet.reduce(entries, acc, (innerAcc, entry) => {
                  const key = subscriptionKey(entry);
                  const existing = HashMap.get(innerAcc, key);
                  return existing._tag === "Some"
                    ? HashMap.set(innerAcc, key, {
                        ...existing.value,
                        prs: [...existing.value.prs, pr],
                      })
                    : HashMap.set(innerAcc, key, {
                        sessionId: entry.sessionId,
                        serverUrl: entry.serverUrl,
                        prs: [pr],
                      });
                }),
            );

            const subscriptions = Array.from(HashMap.values(grouped)).map(
              ({ sessionId, serverUrl, prs }) =>
                new SessionSubscription({
                  sessionId,
                  prNumbers: prs as unknown as readonly PrNumber[],
                  subscribedAt: new Date().toISOString(),
                  serverUrl,
                }),
            );

            return new StatusResponse({
              type: "status_response",
              status: new DaemonStatus({
                running: true,
                pid: process.pid,
                repo,
                connectedToGitHub: connected,
                subscriptions,
                uptime: Math.floor((Date.now() - startTime) / 1000),
              }),
            });
          }

          case "shutdown": {
            yield* Deferred.succeed(shutdownDeferred, undefined);
            return new SuccessResponse({
              type: "success",
              message: "Daemon shutting down...",
            });
          }

          case "cleanup": {
            // Get all active OpenCode sessions
            const activeSessions = yield* openCodeService.listSessions().pipe(
              Effect.map((sessions) => new Set(sessions.map((s) => s.id as string))),
              Effect.catchAll(() => Effect.succeed(new Set<string>())),
            );

            // Find and remove subscriptions for sessions that no longer exist
            const registry = yield* Ref.get(registryRef);

            // Collect all unique session IDs from the registry using reduce
            const allSessionIds = HashMap.reduce(registry, new Set<string>(), (acc, entries) =>
              HashSet.reduce(entries, acc, (set, entry) => set.add(entry.sessionId)),
            );

            // Find stale session IDs (subscribed but not in active sessions)
            const staleSessionIds = new Set(
              Array.from(allSessionIds).filter((id) => !activeSessions.has(id)),
            );

            // Remove stale entries from registry using HashMap.map + HashSet.filter
            if (staleSessionIds.size > 0) {
              yield* Ref.update(registryRef, (reg) =>
                HashMap.reduce(
                  reg,
                  HashMap.empty<number, HashSet.HashSet<SubscriptionEntry>>(),
                  (acc, entries, pr) => {
                    const filtered = HashSet.filter(
                      entries,
                      (entry) => !staleSessionIds.has(entry.sessionId),
                    );
                    return HashSet.size(filtered) > 0 ? HashMap.set(acc, pr, filtered) : acc;
                  },
                ),
              );

              yield* Effect.logInfo("Cleaned up stale subscriptions").pipe(
                Effect.annotateLogs({
                  removedSessions: Array.from(staleSessionIds).join(","),
                  count: String(staleSessionIds.size),
                }),
              );
            }

            return new CleanupResponse({
              type: "cleanup_response",
              removedSessions: Array.from(staleSessionIds),
              remainingSessions: allSessionIds.size - staleSessionIds.size,
            });
          }
        }
      }).pipe(
        Effect.catchAll((e) =>
          Effect.succeed(
            new ErrorResponse({
              type: "error",
              error: String(e),
            }),
          ),
        ),
      );

    // Command processor fiber - processes IPC commands from the queue
    const commandProcessorFiber = yield* Effect.fork(
      Effect.forever(
        Effect.gen(function* () {
          const request = yield* Queue.take(commandQueue);
          const response = yield* handleCommand(request.command);
          yield* Effect.sync(() => request.respond(response));
        }),
      ),
    );

    // Track active client connections for proper cleanup
    const activeClients = new Set<Net.Socket>();

    // Get runtime for bridging callbacks into Effect
    const runtime = yield* Effect.runtime<never>();
    const runSync = Runtime.runSync(runtime);

    // Start IPC server using acquireRelease for proper cleanup
    const server = yield* Effect.acquireRelease(
      Effect.sync(() => {
        // Remove existing socket file if present
        if (Fs.existsSync(DAEMON_SOCKET_PATH)) {
          Fs.unlinkSync(DAEMON_SOCKET_PATH);
        }

        const srv = Net.createServer((socket) => {
          // Track this client connection
          activeClients.add(socket);
          let data = "";

          const onData = (chunk: Buffer) => {
            data += chunk.toString();

            // Check for complete message (newline-delimited)
            const lines = data.split("\n");
            data = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.trim()) continue;

              const parseResult = Schema.decodeUnknownEither(IpcCommand)(JSON.parse(line));
              if (parseResult._tag === "Left") {
                const response = new ErrorResponse({
                  type: "error",
                  error: `Invalid command: ${parseResult.left}`,
                });
                socket.write(JSON.stringify(response));
                socket.end();
                return;
              }

              // Enqueue command to be processed by the Effect runtime
              const request: IpcRequest = {
                command: parseResult.right,
                respond: (response) => {
                  socket.write(JSON.stringify(response));
                  socket.end();
                },
              };

              // Enqueue command using Effect-based queue operation
              // Use runtime obtained from Effect context to bridge callback into Effect
              const offerResult = runSync(
                Queue.offer(commandQueue, request).pipe(Effect.either),
              );

              if (offerResult._tag === "Left") {
                // Queue is shut down, respond with error
                request.respond(
                  new ErrorResponse({
                    type: "error",
                    error: "Daemon is shutting down",
                  }),
                );
              }
            }
          };

          const onError = () => {
            // Socket errors are expected (client disconnects, etc.) - silently ignore
          };

          const onClose = () => {
            // Clean up: remove listeners and untrack this client
            socket.removeListener("data", onData);
            socket.removeListener("error", onError);
            socket.removeListener("close", onClose);
            activeClients.delete(socket);
          };

          socket.on("data", onData);
          socket.on("error", onError);
          socket.on("close", onClose);
        });

        return srv;
      }),
      (srv) =>
        Effect.async<void>((resume) => {
          // Destroy all active client connections before closing server
          for (const client of activeClients) {
            client.removeAllListeners();
            client.destroy();
          }
          activeClients.clear();
          srv.close(() => resume(Effect.void));
        }),
    );

    // Start listening with proper cleanup of event handlers
    yield* Effect.async<void, DaemonError>((resume, signal) => {
      const onError = (err: Error) => {
        cleanup();
        resume(
          Effect.fail(new DaemonError({ message: `IPC server error: ${err.message}`, cause: err })),
        );
      };

      const onListening = () => {
        // Remove error handler once listening successfully (errors after this are handled elsewhere)
        server.removeListener("error", onError);
        resume(Effect.void);
      };

      const cleanup = () => {
        server.removeListener("error", onError);
        server.removeListener("listening", onListening);
      };

      // Register cleanup on abort signal for proper interruption handling
      signal.addEventListener("abort", cleanup);

      server.on("error", onError);
      server.on("listening", onListening);
      server.listen(DAEMON_SOCKET_PATH);
    });

    yield* Effect.logInfo("IPC server listening").pipe(
      Effect.annotateLogs({ path: DAEMON_SOCKET_PATH }),
    );

    // Create webhook and connect to GitHub using acquireRelease
    const webhookInput = new CreateCliWebhookInput({
      repo,
      events: events as unknown as readonly string[],
    });

    const webhook = yield* Effect.acquireRelease(
      webhookService.createCliWebhook(webhookInput),
      (wh) =>
        Effect.gen(function* () {
          yield* webhookService.deactivateWebhook(repo, wh.id).pipe(Effect.ignore);
          yield* webhookService.deleteWebhook(repo, wh.id).pipe(Effect.ignore);
        }),
    );

    yield* Ref.set(webhookRef, webhook);
    yield* webhookService.activateWebhook(repo, webhook.id);
    yield* Ref.set(connectedRef, true);

    yield* Effect.logInfo("Connected to GitHub webhook").pipe(
      Effect.annotateLogs({ repo, events: events.join(",") }),
    );

    // Check if event should be forwarded to the agent
    // Only forward actionable events: comments, reviews, and merges
    const shouldForwardEvent = (event: WebhookEvent): boolean => {
      const { event: eventType, action } = event;
      const payload = event.payload as Record<string, unknown> | null;

      // Comments on PRs - always actionable
      if (eventType === "issue_comment" && action === "created") {
        return true;
      }

      // Review comments - always actionable
      if (eventType === "pull_request_review_comment" && action === "created") {
        return true;
      }

      // Reviews - submitted reviews are actionable (approved, changes_requested, commented)
      if (eventType === "pull_request_review" && action === "submitted") {
        return true;
      }

      // PR merged - agent should sync
      if (eventType === "pull_request" && action === "closed") {
        const pr = payload?.pull_request as Record<string, unknown> | undefined;
        if (pr?.merged === true) {
          return true;
        }
      }

      // All other events are not forwarded
      return false;
    };

    // Extract PR number from webhook event
    const extractPrNumber = (event: WebhookEvent): number | null => {
      const payload = event.payload as Record<string, unknown> | null;
      if (!payload) return null;

      // Try pull_request object first
      const pr = payload.pull_request as Record<string, unknown> | undefined;
      if (pr?.number && typeof pr.number === "number") {
        return pr.number;
      }

      // Try issue object (for issue_comment on PRs)
      const issue = payload.issue as Record<string, unknown> | undefined;
      if (issue?.number && typeof issue.number === "number" && "pull_request" in issue) {
        return issue.number;
      }

      // Try check_run for check events
      const checkRun = payload.check_run as Record<string, unknown> | undefined;
      const pullRequests = checkRun?.pull_requests as Array<{ number: number }> | undefined;
      if (pullRequests && pullRequests.length > 0) {
        return pullRequests[0]?.number ?? null;
      }

      return null;
    };

    // Route event to subscribed sessions - with concurrent forwarding
    const routeEvent = (event: WebhookEvent): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        yield* Effect.logInfo("Routing webhook event").pipe(
          Effect.annotateLogs({ event: event.event, action: event.action ?? "none" }),
        );

        // Filter to only actionable events
        if (!shouldForwardEvent(event)) {
          yield* Effect.logDebug("Event filtered out (not actionable)").pipe(
            Effect.annotateLogs({ event: event.event, action: event.action ?? "none" }),
          );
          return;
        }

        const prNumber = extractPrNumber(event);
        if (prNumber === null) {
          yield* Effect.logInfo("Event has no PR number, skipping").pipe(
            Effect.annotateLogs({ event: event.event, action: event.action ?? "none" }),
          );
          return;
        }

        yield* Effect.logInfo("Extracted PR number").pipe(
          Effect.annotateLogs({ prNumber: String(prNumber) }),
        );

        const registry = yield* Ref.get(registryRef);
        const sessions = HashMap.get(registry, prNumber);

        if (sessions._tag === "None" || HashSet.size(sessions.value) === 0) {
          yield* Effect.logInfo("No subscribers for PR").pipe(
            Effect.annotateLogs({ prNumber: String(prNumber), event: event.event }),
          );
          return;
        }

        const message = formatWebhookEvent(event);
        const eventDesc = event.action ? `${event.event}.${event.action}` : event.event;

        yield* Effect.logInfo("Forwarding to sessions").pipe(
          Effect.annotateLogs({
            prNumber: String(prNumber),
            sessionCount: String(HashSet.size(sessions.value)),
          }),
        );

        // Forward to all sessions concurrently, removing stale entries on failure
        yield* Effect.forEach(
          HashSet.toValues(sessions.value),
          (entry) =>
            Schema.decode(SessionId)(entry.sessionId).pipe(
              Effect.flatMap((sid) => sendPromptToServer(sid, message, entry.serverUrl)),
              Effect.tap(() =>
                Effect.logInfo("Forwarded event to session").pipe(
                  Effect.annotateLogs({
                    event: eventDesc,
                    prNumber: String(prNumber),
                    sessionId: entry.sessionId,
                    serverUrl: entry.serverUrl ?? "default",
                  }),
                ),
              ),
              Effect.catchAll((e) => {
                // Only remove subscription for specific "session not found" errors
                // Check the error type explicitly to avoid false positives
                const isSessionGone =
                  isTaggedError(e, "OpenCodeSessionNotFoundError") ||
                  // Also check OpenCodeError with 404 indicator (from HTTP response)
                  (isTaggedError(e, "OpenCodeError") && e.message.includes("404"));

                if (isSessionGone) {
                  // Remove the stale subscription entry
                  return Ref.update(registryRef, (reg) => {
                    const existing = HashMap.get(reg, prNumber);
                    if (existing._tag === "Some") {
                      const newEntries = HashSet.remove(existing.value, entry);
                      if (HashSet.size(newEntries) === 0) {
                        return HashMap.remove(reg, prNumber);
                      }
                      return HashMap.set(reg, prNumber, newEntries);
                    }
                    return reg;
                  }).pipe(
                    Effect.tap(() =>
                      Effect.logInfo("Removed stale subscription (session no longer exists)").pipe(
                        Effect.annotateLogs({
                          sessionId: entry.sessionId,
                          serverUrl: entry.serverUrl ?? "default",
                          prNumber: String(prNumber),
                        }),
                      ),
                    ),
                  );
                }

                // For other errors, just log a warning (do NOT remove the subscription)
                return Effect.logWarning(
                  "Failed to forward to session (will retry on next event)",
                ).pipe(
                  Effect.annotateLogs({
                    sessionId: entry.sessionId,
                    serverUrl: entry.serverUrl ?? "default",
                    error: String(e),
                    errorTag: (e as { _tag?: string })?._tag ?? "unknown",
                  }),
                );
              }),
            ),
          { concurrency: "unbounded" },
        );
      });

    // Stream webhook events and route them
    yield* Effect.logInfo("Starting webhook event stream consumer");
    const eventStreamFiber = yield* webhookService.connectAndStream(webhook.wsUrl).pipe(
      Stream.tap((event) =>
        Effect.logInfo("Received webhook event").pipe(
          Effect.annotateLogs({
            event: event.event,
            action: event.action ?? "none",
            deliveryId: event.deliveryId,
          }),
        ),
      ),
      Stream.tap((event) => routeEvent(event)),
      Stream.tapError((e) =>
        Ref.set(connectedRef, false).pipe(
          Effect.tap(() =>
            Effect.logError("WebSocket error").pipe(Effect.annotateLogs({ error: String(e) })),
          ),
        ),
      ),
      Stream.retry(
        Schedule.exponential(Duration.seconds(5)).pipe(Schedule.intersect(Schedule.recurs(10))),
      ),
      Stream.runDrain,
      Effect.fork,
    );

    yield* Effect.logInfo("Webhook daemon started");

    // Wait for shutdown signal
    yield* Deferred.await(shutdownDeferred);

    yield* Effect.logInfo("Shutting down daemon");

    // Interrupt fibers - cleanup happens via finalizers
    yield* Fiber.interrupt(eventStreamFiber).pipe(Effect.ignore);
    yield* Fiber.interrupt(commandProcessorFiber).pipe(Effect.ignore);

    yield* Effect.logInfo("Daemon stopped");
  });

// === Service Implementation ===

const make = Effect.gen(function* () {
  const webhookService = yield* WebhookService;
  const openCodeService = yield* OpenCodeService;

  const isRunning = (): Effect.Effect<boolean, never> =>
    Effect.sync(() => Fs.existsSync(DAEMON_SOCKET_PATH));

  const getStatus = (): Effect.Effect<DaemonStatus, DaemonErrors> =>
    sendCommand({ type: "status" }).pipe(
      Effect.flatMap((response) => {
        if (response.type === "status_response") {
          return Effect.succeed(response.status);
        }
        if (response.type === "error") {
          return Effect.fail(new DaemonError({ message: response.error }));
        }
        return Effect.fail(new DaemonError({ message: "Unexpected response type" }));
      }),
    );

  const subscribe = (
    sessionId: string,
    prNumbers: ReadonlyArray<number>,
    serverUrl?: string,
  ): Effect.Effect<void, DaemonErrors> =>
    sendCommand({
      type: "subscribe",
      sessionId,
      prNumbers: prNumbers as number[],
      serverUrl,
    }).pipe(
      Effect.flatMap((response) => {
        if (response.type === "success") {
          return Effect.void;
        }
        if (response.type === "error") {
          return Effect.fail(new DaemonError({ message: response.error }));
        }
        return Effect.fail(new DaemonError({ message: "Unexpected response type" }));
      }),
    );

  const unsubscribe = (
    sessionId: string,
    prNumbers: ReadonlyArray<number>,
    serverUrl?: string,
  ): Effect.Effect<void, DaemonErrors> =>
    sendCommand({
      type: "unsubscribe",
      sessionId,
      prNumbers: prNumbers as number[],
      serverUrl,
    }).pipe(
      Effect.flatMap((response) => {
        if (response.type === "success") {
          return Effect.void;
        }
        if (response.type === "error") {
          return Effect.fail(new DaemonError({ message: response.error }));
        }
        return Effect.fail(new DaemonError({ message: "Unexpected response type" }));
      }),
    );

  const shutdown = (): Effect.Effect<void, DaemonErrors> =>
    sendCommand({ type: "shutdown" }).pipe(
      Effect.flatMap((response) => {
        if (response.type === "success") {
          return Effect.void;
        }
        if (response.type === "error") {
          return Effect.fail(new DaemonError({ message: response.error }));
        }
        return Effect.fail(new DaemonError({ message: "Unexpected response type" }));
      }),
    );

  const cleanup = (): Effect.Effect<ReadonlyArray<string>, DaemonErrors> =>
    sendCommand({ type: "cleanup" }).pipe(
      Effect.flatMap((response) => {
        if (response.type === "cleanup_response") {
          return Effect.succeed(response.removedSessions);
        }
        if (response.type === "error") {
          return Effect.fail(new DaemonError({ message: response.error }));
        }
        return Effect.fail(new DaemonError({ message: "Unexpected response type" }));
      }),
    );

  const startDaemon = (
    repo: string,
    events: ReadonlyArray<string>,
  ): Effect.Effect<void, DaemonErrors> =>
    Effect.gen(function* () {
      // Check if already running
      const running = yield* isRunning();
      if (running) {
        // Try to get status to confirm it's actually running
        const statusResult = yield* getStatus().pipe(
          Effect.map((status) => ({ running: true, pid: status.pid })),
          Effect.catchAll(() => Effect.succeed({ running: false, pid: undefined })),
        );

        if (statusResult.running) {
          return yield* Effect.fail(
            new DaemonAlreadyRunningError({
              message: `Daemon is already running (PID: ${statusResult.pid})`,
              pid: statusResult.pid,
            }),
          );
        }
      }

      // Run the daemon server with a scope for proper resource management
      yield* Effect.scoped(runDaemonServer(repo, events, webhookService, openCodeService));
    });

  return {
    isRunning,
    getStatus,
    subscribe,
    unsubscribe,
    shutdown,
    cleanup,
    startDaemon,
  };
});

export const DaemonServiceLive = Layer.effect(DaemonService, make);
