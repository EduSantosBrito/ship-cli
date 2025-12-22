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
): Effect.Effect<void, DaemonErrors> =>
  Effect.gen(function* () {
    // Initialize state
    const registryRef = yield* Ref.make<Registry>(HashMap.empty());
    const startTime = Date.now();
    const shutdownDeferred = yield* Deferred.make<void>();
    const connectedRef = yield* Ref.make(false);
    const webhookRef = yield* Ref.make<CliWebhook | null>(null);

    // Write PID file
    yield* Effect.sync(() => {
      Fs.writeFileSync(DAEMON_PID_PATH, String(process.pid));
    });

    // Cleanup function
    const cleanup = Effect.gen(function* () {
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
        yield* webhookService.deactivateWebhook(repo, webhook.id).pipe(Effect.catchAll(() => Effect.void));
        yield* webhookService.deleteWebhook(repo, webhook.id).pipe(Effect.catchAll(() => Effect.void));
      }
    });

    // Handle IPC command
    const handleCommand = (command: IpcCommand): Effect.Effect<typeof IpcResponse.Type, never> =>
      Effect.gen(function* () {
        switch (command.type) {
          case "subscribe": {
            const { sessionId, prNumbers } = command;
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

    // Start IPC server
    const ipcServerFiber = yield* Effect.async<never, DaemonError>((resume) => {
      // Remove existing socket file if present
      if (Fs.existsSync(DAEMON_SOCKET_PATH)) {
        Fs.unlinkSync(DAEMON_SOCKET_PATH);
      }

      const server = Net.createServer((socket) => {
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

            // Handle command
            Effect.runPromise(handleCommand(parseResult.right))
              .then((response) => {
                socket.write(JSON.stringify(response));
                socket.end();
              })
              .catch((e) => {
                const response = new ErrorResponse({
                  type: "error",
                  error: String(e),
                });
                socket.write(JSON.stringify(response));
                socket.end();
              });
          }
        });

        socket.on("error", (err) => {
          console.error("[daemon] Socket error:", err.message);
        });
      });

      server.on("error", (err) => {
        resume(Effect.fail(new DaemonError({ message: `IPC server error: ${err.message}`, cause: err })));
      });

      server.listen(DAEMON_SOCKET_PATH, () => {
        console.log(`[daemon] IPC server listening on ${DAEMON_SOCKET_PATH}`);
      });

      // Handle shutdown
      Effect.runPromise(Deferred.await(shutdownDeferred)).then(() => {
        server.close();
      });
    }).pipe(Effect.fork);

    // Create webhook and connect to GitHub
    const webhookInput = new CreateCliWebhookInput({
      repo,
      events: events as unknown as readonly string[],
    });

    const webhook = yield* webhookService.createCliWebhook(webhookInput);
    yield* Ref.set(webhookRef, webhook);
    yield* webhookService.activateWebhook(repo, webhook.id);
    yield* Ref.set(connectedRef, true);

    console.log(`[daemon] Connected to GitHub webhook for ${repo}`);
    console.log(`[daemon] Listening for events: ${events.join(", ")}`);

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

    // Route event to subscribed sessions
    const routeEvent = (event: WebhookEvent): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        const prNumber = extractPrNumber(event);
        if (prNumber === null) {
          console.log(`[daemon] Event ${event.event} has no PR number, skipping`);
          return;
        }

        const registry = yield* Ref.get(registryRef);
        const sessions = HashMap.get(registry, prNumber);
        
        if (sessions._tag === "None" || HashSet.size(sessions.value) === 0) {
          console.log(`[daemon] No subscribers for PR #${prNumber}`);
          return;
        }

        const message = formatWebhookEvent(event);
        const eventDesc = event.action ? `${event.event}.${event.action}` : event.event;

        for (const sessionId of HashSet.values(sessions.value)) {
          yield* Schema.decode(SessionId)(sessionId).pipe(
            Effect.flatMap((sid) => openCodeService.sendPromptAsync(sid, message)),
            Effect.tap(() => Effect.sync(() => 
              console.log(`[daemon] Forwarded ${eventDesc} for PR #${prNumber} to session ${sessionId}`)
            )),
            Effect.catchAll((e) =>
              Effect.sync(() =>
                console.error(`[daemon] Failed to forward to session ${sessionId}: ${e}`)
              ),
            ),
          );
        }
      });

    // Stream webhook events and route them
    const eventStreamFiber = yield* webhookService
      .connectAndStream(webhook.wsUrl)
      .pipe(
        Stream.tap((event) => routeEvent(event)),
        Stream.tapError((e) =>
          Ref.set(connectedRef, false).pipe(
            Effect.tap(() => Effect.sync(() => console.error(`[daemon] WebSocket error: ${e}`))),
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

    console.log("[daemon] Webhook daemon started");

    // Wait for shutdown signal
    yield* Deferred.await(shutdownDeferred);

    console.log("[daemon] Shutting down...");

    // Cleanup
    yield* Fiber.interrupt(eventStreamFiber).pipe(Effect.catchAll(() => Effect.void));
    yield* Fiber.interrupt(ipcServerFiber).pipe(Effect.catchAll(() => Effect.void));
    yield* cleanup;

    console.log("[daemon] Daemon stopped");
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

      // Run the daemon server
      yield* runDaemonServer(repo, events, webhookService, openCodeService);
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
