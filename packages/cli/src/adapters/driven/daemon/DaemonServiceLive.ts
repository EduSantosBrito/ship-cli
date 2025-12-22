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
import * as Duration from "effect/Duration";
import * as Scope from "effect/Scope";
import * as Queue from "effect/Queue";
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
import { OpenCodeService, SessionId } from "../../../ports/OpenCodeService.js";
import { formatWebhookEvent } from "../opencode/WebhookEventFormatter.js";

// === Registry Types ===

/**
 * The daemon registry maps PR numbers to sets of session IDs.
 * When an event for a PR comes in, we notify all subscribed sessions.
 */
type Registry = HashMap.HashMap<number, HashSet.HashSet<string>>;

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
 */
const sendCommand = (command: IpcCommand): Effect.Effect<typeof IpcResponse.Type, DaemonErrors> =>
  Effect.async<typeof IpcResponse.Type, DaemonErrors>((resume) => {
    // Check if socket exists
    if (!Fs.existsSync(DAEMON_SOCKET_PATH)) {
      resume(Effect.fail(DaemonNotRunningError.default));
      return;
    }

    const client = Net.createConnection(DAEMON_SOCKET_PATH);
    let responseData = "";

    client.on("connect", () => {
      client.write(JSON.stringify(command) + "\n");
    });

    client.on("data", (data) => {
      responseData += data.toString();
    });

    client.on("end", () => {
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
      if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED" || 
          (err as NodeJS.ErrnoException).code === "ENOENT") {
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
      }).pipe(Effect.ignore)
    );

    // Handle IPC command - pure Effect, no side effects
    const handleCommand = (command: IpcCommand): Effect.Effect<typeof IpcResponse.Type, never> =>
      Effect.gen(function* () {
        switch (command.type) {
          case "subscribe": {
            const { sessionId, prNumbers } = command;
            
            // Validate inputs
            if (!sessionId || sessionId.length === 0) {
              return new ErrorResponse({ type: "error", error: "sessionId is required" });
            }
            if (!prNumbers || prNumbers.length === 0) {
              return new ErrorResponse({ type: "error", error: "prNumbers is required" });
            }
            if (!prNumbers.every((n) => typeof n === "number" && n > 0)) {
              return new ErrorResponse({ type: "error", error: "prNumbers must be positive integers" });
            }
            
            yield* Ref.update(registryRef, (registry) => {
              let updated = registry;
              for (const pr of prNumbers) {
                const existing = HashMap.get(updated, pr);
                const sessions = existing._tag === "Some" 
                  ? HashSet.add(existing.value, sessionId)
                  : HashSet.make(sessionId);
                updated = HashMap.set(updated, pr, sessions);
              }
              return updated;
            });
            
            yield* Effect.logInfo("Subscribed session to PRs").pipe(
              Effect.annotateLogs({ sessionId, prNumbers: prNumbers.join(",") })
            );
            
            return new SuccessResponse({
              type: "success",
              message: `Subscribed session ${sessionId} to PRs: ${prNumbers.join(", ")}`,
            });
          }

          case "unsubscribe": {
            const { sessionId, prNumbers } = command;
            yield* Ref.update(registryRef, (registry) => {
              let updated = registry;
              for (const pr of prNumbers) {
                const existing = HashMap.get(updated, pr);
                if (existing._tag === "Some") {
                  const sessions = HashSet.remove(existing.value, sessionId);
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
              Effect.annotateLogs({ sessionId, prNumbers: prNumbers.join(",") })
            );
            
            return new SuccessResponse({
              type: "success",
              message: `Unsubscribed session ${sessionId} from PRs: ${prNumbers.join(", ")}`,
            });
          }

          case "status": {
            const registry = yield* Ref.get(registryRef);
            const connected = yield* Ref.get(connectedRef);
            
            // Build subscriptions list
            const subscriptions: SessionSubscription[] = [];
            const sessionPrs = new Map<string, number[]>();
            
            for (const [pr, sessions] of HashMap.entries(registry)) {
              for (const sessionId of HashSet.values(sessions)) {
                const prs = sessionPrs.get(sessionId) ?? [];
                prs.push(pr);
                sessionPrs.set(sessionId, prs);
              }
            }
            
            for (const [sessionId, prs] of sessionPrs.entries()) {
              subscriptions.push(
                new SessionSubscription({
                  sessionId,
                  prNumbers: prs as unknown as readonly PrNumber[],
                  subscribedAt: new Date().toISOString(),
                }),
              );
            }

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
        })
      )
    );

    // Start IPC server using acquireRelease for proper cleanup
    const server = yield* Effect.acquireRelease(
      Effect.sync(() => {
        // Remove existing socket file if present
        if (Fs.existsSync(DAEMON_SOCKET_PATH)) {
          Fs.unlinkSync(DAEMON_SOCKET_PATH);
        }

        const srv = Net.createServer((socket) => {
          let data = "";

          socket.on("data", (chunk) => {
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
              
              // Enqueue - handle shutdown gracefully
              try {
                Queue.unsafeOffer(commandQueue, request);
              } catch {
                // Queue is shut down, respond with error
                request.respond(new ErrorResponse({
                  type: "error",
                  error: "Daemon is shutting down",
                }));
              }
            }
          });

          socket.on("error", () => {
            // Socket errors are expected (client disconnects, etc.) - silently ignore
          });
        });

        return srv;
      }),
      (srv) =>
        Effect.async<void>((resume) => {
          srv.close(() => resume(Effect.void));
        })
    );

    // Start listening
    yield* Effect.async<void, DaemonError>((resume) => {
      server.on("error", (err) => {
        resume(Effect.fail(new DaemonError({ message: `IPC server error: ${err.message}`, cause: err })));
      });

      server.listen(DAEMON_SOCKET_PATH, () => {
        resume(Effect.void);
      });
    });

    yield* Effect.logInfo("IPC server listening").pipe(
      Effect.annotateLogs({ path: DAEMON_SOCKET_PATH })
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
        })
    );
    
    yield* Ref.set(webhookRef, webhook);
    yield* webhookService.activateWebhook(repo, webhook.id);
    yield* Ref.set(connectedRef, true);

    yield* Effect.logInfo("Connected to GitHub webhook").pipe(
      Effect.annotateLogs({ repo, events: events.join(",") })
    );

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
          Effect.annotateLogs({ event: event.event, action: event.action ?? "none" })
        );

        const prNumber = extractPrNumber(event);
        if (prNumber === null) {
          yield* Effect.logInfo("Event has no PR number, skipping").pipe(
            Effect.annotateLogs({ event: event.event })
          );
          return;
        }

        yield* Effect.logInfo("Extracted PR number").pipe(
          Effect.annotateLogs({ prNumber: String(prNumber) })
        );

        const registry = yield* Ref.get(registryRef);
        const sessions = HashMap.get(registry, prNumber);
        
        if (sessions._tag === "None" || HashSet.size(sessions.value) === 0) {
          yield* Effect.logInfo("No subscribers for PR").pipe(
            Effect.annotateLogs({ prNumber: String(prNumber) })
          );
          return;
        }

        const message = formatWebhookEvent(event);
        const eventDesc = event.action ? `${event.event}.${event.action}` : event.event;

        yield* Effect.logInfo("Forwarding to sessions").pipe(
          Effect.annotateLogs({ 
            prNumber: String(prNumber), 
            sessionCount: String(HashSet.size(sessions.value)) 
          })
        );

        // Forward to all sessions concurrently
        yield* Effect.forEach(
          HashSet.toValues(sessions.value),
          (sessionId) =>
            Schema.decode(SessionId)(sessionId).pipe(
              Effect.flatMap((sid) => openCodeService.sendPromptAsync(sid, message)),
              Effect.tap(() =>
                Effect.logInfo("Forwarded event to session").pipe(
                  Effect.annotateLogs({ event: eventDesc, prNumber: String(prNumber), sessionId })
                )
              ),
              Effect.catchAll((e) =>
                Effect.logWarning("Failed to forward to session").pipe(
                  Effect.annotateLogs({ sessionId, error: String(e) })
                )
              )
            ),
          { concurrency: "unbounded" }
        );
      });

    // Stream webhook events and route them
    yield* Effect.logInfo("Starting webhook event stream consumer");
    const eventStreamFiber = yield* webhookService
      .connectAndStream(webhook.wsUrl)
      .pipe(
        Stream.tap(() => Effect.logInfo("Stream consumer pulled an event")),
        Stream.mapEffect((event) => 
          Effect.gen(function* () {
            yield* Effect.logInfo("Received webhook event from stream").pipe(
              Effect.annotateLogs({ event: event.event, action: event.action ?? "none" })
            );
            yield* routeEvent(event);
            return event;
          })
        ),
        Stream.tapError((e) =>
          Ref.set(connectedRef, false).pipe(
            Effect.tap(() => 
              Effect.logError("WebSocket error").pipe(
                Effect.annotateLogs({ error: String(e) })
              )
            ),
          ),
        ),
        Stream.retry(
          Schedule.exponential(Duration.seconds(5)).pipe(
            Schedule.intersect(Schedule.recurs(10)),
          ),
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
  ): Effect.Effect<void, DaemonErrors> =>
    sendCommand({
      type: "subscribe",
      sessionId,
      prNumbers: prNumbers as number[],
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
  ): Effect.Effect<void, DaemonErrors> =>
    sendCommand({
      type: "unsubscribe",
      sessionId,
      prNumbers: prNumbers as number[],
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
    startDaemon,
  };
});

export const DaemonServiceLive = Layer.effect(DaemonService, make);
