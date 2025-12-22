/**
 * WebhookServiceLive - GitHub CLI (gh) wrapper for webhook operations
 *
 * This adapter implements the WebhookService port using the gh CLI.
 * It leverages an undocumented GitHub feature where webhooks with name="cli"
 * return a ws_url field for real-time event streaming via WebSocket.
 *
 * IMPORTANT: The CLI webhook protocol is BIDIRECTIONAL - after receiving
 * an event, we must send back an acknowledgment response. Without this,
 * the server will stop sending events after the first one.
 *
 * Key gh commands used:
 * - `gh api POST /repos/{owner}/{repo}/hooks` - Create webhook
 * - `gh api PATCH /repos/{owner}/{repo}/hooks/{id}` - Update webhook (activate/deactivate)
 * - `gh api DELETE /repos/{owner}/{repo}/hooks/{id}` - Delete webhook
 * - `gh api GET /repos/{owner}/{repo}/hooks` - List webhooks
 */

import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as Duration from "effect/Duration";
import * as Command from "@effect/platform/Command";
import * as CommandExecutor from "@effect/platform/CommandExecutor";
import * as Socket from "@effect/platform/Socket";
import * as WS from "ws";
import {
  GhNotInstalledError,
  GhNotAuthenticatedError,
  WebhookError,
  WebhookConnectionError,
  WebhookPermissionError,
  WebhookRateLimitError,
} from "../../../domain/Errors.js";
import {
  WebhookService,
  CliWebhook,
  WebhookId,
  WebhookEvent,
  type CreateCliWebhookInput,
  type WebhookErrors,
} from "../../../ports/WebhookService.js";

// === GitHub API Response Schemas ===

/**
 * Schema for GitHub webhook response
 * Note: ws_url is only present when name="cli"
 *
 * We use a permissive schema that only validates the fields we need,
 * since GitHub may add new fields at any time.
 */
const GhWebhookResponseSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  active: Schema.Boolean,
  events: Schema.Array(Schema.String),
  config: Schema.Struct({
    content_type: Schema.optional(Schema.String),
    url: Schema.optional(Schema.String),
    insecure_ssl: Schema.optional(Schema.String),
  }),
  url: Schema.String,
  // This is the magic field - only present for name="cli" webhooks
  ws_url: Schema.optional(Schema.String),
  // Additional fields returned by GitHub (optional, we don't use them all)
  type: Schema.optional(Schema.String),
  created_at: Schema.optional(Schema.String),
  updated_at: Schema.optional(Schema.String),
  test_url: Schema.optional(Schema.String),
  ping_url: Schema.optional(Schema.String),
  deliveries_url: Schema.optional(Schema.String),
  last_response: Schema.optional(Schema.Unknown),
});

type GhWebhookResponse = typeof GhWebhookResponseSchema.Type;

/**
 * Schema for WebSocket messages received from GitHub.
 * The actual format uses lowercase keys: header, body, delivery_id, request_id
 */
const WsEventReceivedSchema = Schema.Struct({
  header: Schema.Record({
    key: Schema.String,
    value: Schema.Union(Schema.String, Schema.Array(Schema.String)),
  }),
  body: Schema.Unknown,
  delivery_id: Schema.optional(Schema.String),
  request_id: Schema.optional(Schema.String),
});

/**
 * Schema for the acknowledgment response we send back to GitHub.
 * This is required for the bidirectional protocol - without sending
 * this response, GitHub will stop sending events after the first one.
 *
 * Note: The Body field must be base64-encoded because Go's encoding/json
 * marshals []byte as base64. The GitHub server expects this format.
 */
interface WsEventResponse {
  Status: number;
  Header: Record<string, string[]>;
  Body: string; // base64-encoded
}

// Retry policy for network operations: exponential backoff with max 3 retries
const networkRetryPolicy = Schedule.intersect(
  Schedule.exponential(Duration.millis(500)),
  Schedule.recurs(3),
);

// Retry policy for WebSocket reconnection: exponential backoff with max 3 retries
const wsReconnectPolicy = Schedule.intersect(
  Schedule.exponential(Duration.seconds(5)),
  Schedule.recurs(3),
);

// Timeout for network operations
const NETWORK_TIMEOUT = Duration.seconds(60);

// === Service Implementation ===

const make = Effect.gen(function* () {
  const executor = yield* CommandExecutor.CommandExecutor;

  /**
   * Wrap an effect with network retry and timeout for resilience
   */
  const withNetworkRetry = <A, E>(
    effect: Effect.Effect<A, E>,
    operation: string,
  ): Effect.Effect<A, E | WebhookError> =>
    effect.pipe(
      Effect.timeoutFail({
        duration: NETWORK_TIMEOUT,
        onTimeout: () => new WebhookError({ message: `${operation} timed out after 60 seconds` }),
      }),
      Effect.retry(networkRetryPolicy),
    );

  /**
   * Run a gh api command and return stdout as string.
   */
  const runGhApi = (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    endpoint: string,
    body?: Record<string, unknown>,
  ): Effect.Effect<string, WebhookErrors> => {
    const args = ["api", "-X", method, endpoint];

    // Add body fields if present
    if (body) {
      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined) {
          if (typeof value === "string") {
            // Use -f for strings
            args.push("-f", `${key}=${value}`);
          } else if (Array.isArray(value)) {
            // Arrays must be passed as separate elements with key[]=value syntax
            for (const item of value) {
              args.push("-f", `${key}[]=${String(item)}`);
            }
          } else if (typeof value === "object" && value !== null) {
            // Nested objects use key[subkey]=value syntax
            for (const [subkey, subvalue] of Object.entries(value)) {
              if (subvalue !== undefined) {
                args.push("-f", `${key}[${subkey}]=${String(subvalue)}`);
              }
            }
          } else {
            // Use -F for non-strings (booleans, numbers)
            args.push("-F", `${key}=${JSON.stringify(value)}`);
          }
        }
      }
    }

    const cmd = Command.make("gh", ...args);

    return Command.string(cmd).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
      Effect.mapError((e) => {
        const errorStr = String(e);

        if (
          errorStr.includes("command not found") ||
          errorStr.includes("ENOENT") ||
          errorStr.includes("gh: not found")
        ) {
          return GhNotInstalledError.default;
        }

        if (
          errorStr.includes("not logged in") ||
          errorStr.includes("authentication") ||
          errorStr.includes("401")
        ) {
          return GhNotAuthenticatedError.default;
        }

        // Rate limit detection - GitHub returns 403 with specific message or 429
        if (
          errorStr.includes("rate limit") ||
          errorStr.includes("API rate limit exceeded") ||
          errorStr.includes("429")
        ) {
          // Try to extract retry-after from error message if present
          const retryMatch = errorStr.match(/retry after (\d+)/i);
          const retryAfter = retryMatch ? parseInt(retryMatch[1], 10) : undefined;
          return WebhookRateLimitError.fromHeaders(retryAfter);
        }

        if (
          errorStr.includes("403") ||
          errorStr.includes("Must have admin rights") ||
          errorStr.includes("Resource not accessible")
        ) {
          return new WebhookPermissionError({
            message: `Permission denied: ${errorStr}`,
          });
        }

        return new WebhookError({
          message: `gh api ${method} ${endpoint} failed: ${errorStr}`,
          cause: e,
        });
      }),
    );
  };

  /**
   * Parse JSON output from gh command
   */
  const parseJson = <T>(output: string, schema: Schema.Schema<T>): Effect.Effect<T, WebhookError> =>
    Effect.try({
      try: () => JSON.parse(output),
      catch: (e) => new WebhookError({ message: `Failed to parse gh output: ${e}`, cause: e }),
    }).pipe(
      Effect.flatMap((json) =>
        Schema.decodeUnknown(schema)(json).pipe(
          Effect.mapError(
            (e) =>
              new WebhookError({
                message: `Invalid gh response format: ${e.message}`,
                cause: e,
              }),
          ),
        ),
      ),
    );

  /**
   * Convert GitHub webhook response to our CliWebhook domain type
   */
  const toCliWebhook = (response: GhWebhookResponse): Effect.Effect<CliWebhook, WebhookError> =>
    Schema.decode(WebhookId)(response.id).pipe(
      Effect.map(
        (id) =>
          new CliWebhook({
            id,
            wsUrl: response.ws_url ?? "",
            events: response.events,
            active: response.active,
            url: response.url,
          }),
      ),
      Effect.mapError(
        (e) => new WebhookError({ message: `Invalid webhook ID: ${e.message}`, cause: e }),
      ),
    );

  // === Public API ===

  const createCliWebhook = (
    input: CreateCliWebhookInput,
  ): Effect.Effect<CliWebhook, WebhookErrors> =>
    withNetworkRetry(
      Effect.gen(function* () {
        const endpoint = `/repos/${input.repo}/hooks`;

        // Create webhook with name="cli" to get WebSocket URL
        const body: Record<string, unknown> = {
          name: "cli", // Magic value that triggers WebSocket mode
          events: input.events,
          active: false, // Start inactive, activate after WebSocket connects
          config: {
            content_type: "json",
            ...(input.secret ? { secret: input.secret } : {}),
          },
        };

        const output = yield* runGhApi("POST", endpoint, body);
        const response = yield* parseJson(output, GhWebhookResponseSchema);

        if (!response.ws_url) {
          return yield* new WebhookError({
            message:
              "GitHub did not return a WebSocket URL. The webhook may have been created without the 'cli' name.",
          });
        }

        return yield* toCliWebhook(response);
      }),
      "createCliWebhook",
    );

  const activateWebhook = (
    repo: string,
    webhookId: WebhookId,
  ): Effect.Effect<void, WebhookErrors> =>
    withNetworkRetry(
      runGhApi("PATCH", `/repos/${repo}/hooks/${webhookId}`, { active: true }).pipe(Effect.asVoid),
      "activateWebhook",
    );

  const deactivateWebhook = (
    repo: string,
    webhookId: WebhookId,
  ): Effect.Effect<void, WebhookErrors> =>
    withNetworkRetry(
      runGhApi("PATCH", `/repos/${repo}/hooks/${webhookId}`, { active: false }).pipe(Effect.asVoid),
      "deactivateWebhook",
    );

  const deleteWebhook = (repo: string, webhookId: WebhookId): Effect.Effect<void, WebhookErrors> =>
    withNetworkRetry(
      runGhApi("DELETE", `/repos/${repo}/hooks/${webhookId}`).pipe(Effect.asVoid),
      "deleteWebhook",
    );

  const listWebhooks = (repo: string): Effect.Effect<ReadonlyArray<CliWebhook>, WebhookErrors> =>
    withNetworkRetry(
      Effect.gen(function* () {
        const endpoint = `/repos/${repo}/hooks`;
        const output = yield* runGhApi("GET", endpoint);

        const responses = yield* parseJson(output, Schema.Array(GhWebhookResponseSchema));

        // Filter to only cli webhooks (those with ws_url)
        const cliWebhooks = responses.filter((r) => r.name === "cli" && r.ws_url);

        return yield* Effect.all(cliWebhooks.map(toCliWebhook));
      }),
      "listWebhooks",
    );

  /**
   * Get the GitHub auth token using gh CLI
   */
  const getAuthToken = (): Effect.Effect<string, WebhookErrors> => {
    const cmd = Command.make("gh", "auth", "token");
    return Command.string(cmd).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
      Effect.map((token) => token.trim()),
      Effect.mapError((e) => {
        const errorStr = String(e);
        if (errorStr.includes("not logged in") || errorStr.includes("authentication")) {
          return GhNotAuthenticatedError.default;
        }
        return new WebhookError({ message: `Failed to get auth token: ${errorStr}`, cause: e });
      }),
    );
  };

  /**
   * Parse a WebSocket message into a WebhookEvent
   */
  const parseWsMessage = (data: string | Uint8Array): Effect.Effect<WebhookEvent, WebhookError> => {
    const jsonStr = typeof data === "string" ? data : new TextDecoder().decode(data);

    return Effect.gen(function* () {
      // Parse the raw JSON
      const raw = yield* Effect.try({
        try: () => JSON.parse(jsonStr),
        catch: (e) =>
          new WebhookError({ message: `Failed to parse WebSocket message: ${e}`, cause: e }),
      });

      // Decode to our schema
      const wsEvent = yield* Schema.decodeUnknown(WsEventReceivedSchema)(raw).pipe(
        Effect.mapError(
          (e) =>
            new WebhookError({
              message: `Invalid WebSocket message format: ${e.message}`,
              cause: e,
            }),
        ),
      );

      // Extract headers - normalize to single values (take first if array)
      const normalizedHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(wsEvent.header)) {
        normalizedHeaders[key] = Array.isArray(value) ? (value[0] ?? "") : value;
      }

      // Extract event info from headers
      const eventType =
        normalizedHeaders["X-GitHub-Event"] ??
        normalizedHeaders["x-github-event"] ??
        normalizedHeaders["X-Github-Event"] ??
        "unknown";
      const deliveryId =
        wsEvent.delivery_id ??
        normalizedHeaders["X-GitHub-Delivery"] ??
        normalizedHeaders["x-github-delivery"] ??
        normalizedHeaders["X-Github-Delivery"] ??
        "unknown";

      // Parse the body - GitHub sends it as base64-encoded JSON string
      let payload: unknown = wsEvent.body;

      if (typeof payload === "string") {
        // Try parsing as JSON first
        try {
          payload = JSON.parse(payload);
        } catch {
          // It's base64 encoded - decode and parse
          try {
            const decoded = Buffer.from(payload as string, "base64").toString("utf-8");
            payload = JSON.parse(decoded);
          } catch {
            // Keep as string if neither works
          }
        }
      }

      // Try to extract action from payload if it exists
      const action =
        payload &&
        typeof payload === "object" &&
        "action" in payload &&
        typeof (payload as { action: unknown }).action === "string"
          ? (payload as { action: string }).action
          : undefined;

      return new WebhookEvent({
        event: eventType,
        action,
        deliveryId,
        payload,
        headers: normalizedHeaders,
      });
    });
  };

  /**
   * Create the acknowledgment response to send back to GitHub.
   * This is required for the bidirectional protocol.
   *
   * The Body must be base64-encoded because Go's encoding/json marshals
   * []byte as base64, and the GitHub server expects this format.
   */
  const createAckResponse = (): WsEventResponse => ({
    Status: 200,
    Header: {},
    Body: Buffer.from("OK").toString("base64"), // "T0s=" - base64 encoded "OK"
  });

  /**
   * Create a WebSocket constructor that includes the Authorization header.
   * This wraps the standard WebSocket to pass authentication when connecting to GitHub.
   */
  const makeAuthenticatedWebSocketConstructor = (authToken: string) =>
    Layer.succeed(
      Socket.WebSocketConstructor,
      (url: string, protocols?: string | Array<string>) => {
        return new WS.WebSocket(url, protocols, {
          headers: {
            Authorization: authToken,
          },
        }) as unknown as globalThis.WebSocket;
      },
    );

  /**
   * Create a single WebSocket connection and stream events until disconnect.
   *
   * IMPORTANT: This implements the bidirectional GitHub CLI webhook protocol.
   * After receiving each event, we must send back an acknowledgment response
   * or GitHub will stop sending events.
   */
  const createWebSocketStream = (
    wsUrl: string,
    authToken: string,
  ): Stream.Stream<WebhookEvent, WebhookErrors> =>
    Stream.asyncPush<WebhookEvent, WebhookErrors>((emit) =>
      Effect.acquireRelease(
        // Acquire: Create WebSocket connection and start handler in background
        Effect.gen(function* () {
          // Create WebSocket connection
          const socket = yield* Socket.makeWebSocket(wsUrl).pipe(
            Effect.provide(makeAuthenticatedWebSocketConstructor(authToken)),
            Effect.mapError(
              (e) =>
                new WebhookConnectionError({
                  message: `Failed to connect to WebSocket: ${e}`,
                  wsUrl,
                  cause: e,
                }),
            ),
          );

          // Get the writer for sending acknowledgment responses
          const write = yield* socket.writer;

          // Fork the socket handler to run in background - this allows the stream to start consuming
          const fiber = yield* socket
            .runRaw((data: string | Uint8Array) =>
              Effect.gen(function* () {
                yield* Effect.logDebug("WebSocket received raw data").pipe(
                  Effect.annotateLogs(
                    "dataLength",
                    String(typeof data === "string" ? data.length : data.byteLength),
                  ),
                );

                // Parse the incoming event
                const event = yield* parseWsMessage(data).pipe(
                  Effect.catchAll((error) => {
                    // Log parse error but still try to send ack
                    return Effect.logError("Failed to parse webhook event").pipe(
                      Effect.annotateLogs("error", error.message),
                      Effect.as(null),
                    );
                  }),
                );

                // Send acknowledgment response back to GitHub
                // This is CRITICAL - without this, no more events will be received
                const ackResponse = createAckResponse();
                const ackJson = JSON.stringify(ackResponse);
                yield* Effect.logDebug("Sending WebSocket ack response").pipe(
                  Effect.annotateLogs("ack", ackJson),
                );
                yield* write(ackJson).pipe(
                  Effect.tap(() => Effect.logDebug("WebSocket ack sent successfully")),
                  Effect.catchAll((error) =>
                    Effect.logWarning("Failed to send WebSocket ack").pipe(
                      Effect.annotateLogs("error", String(error)),
                    ),
                  ),
                );

                // Emit the event if we parsed it successfully
                if (event !== null) {
                  yield* Effect.logDebug("Emitting parsed event").pipe(
                    Effect.annotateLogs("event", event.event),
                    Effect.annotateLogs("action", event.action ?? "none"),
                  );
                  const emitted = emit.single(event);
                  yield* Effect.logDebug("Event emitted to stream").pipe(
                    Effect.annotateLogs("emitted", String(emitted)),
                  );
                }
              }),
            )
            .pipe(
              Effect.catchAll((error) => {
                // Handle socket close/error
                if (Socket.SocketCloseError.is(error)) {
                  // Normal close (1000) - end the stream gracefully
                  if (error.code === 1000) {
                    return Effect.sync(() => emit.end());
                  }
                  // Abnormal close - emit error for retry
                  return Effect.sync(() =>
                    emit.fail(
                      new WebhookConnectionError({
                        message: `WebSocket closed with code ${error.code}: ${error.closeReason ?? "unknown"}`,
                        wsUrl,
                        cause: error,
                      }),
                    ),
                  );
                }
                // Other socket errors
                return Effect.sync(() =>
                  emit.fail(
                    new WebhookConnectionError({
                      message: `WebSocket error: ${error}`,
                      wsUrl,
                      cause: error,
                    }),
                  ),
                );
              }),
              Effect.fork,
            );

          return fiber;
        }),
        // Release: Interrupt the fiber when stream is done
        (fiber) => Fiber.interrupt(fiber).pipe(Effect.ignore),
      ),
    );

  /**
   * Connect to a webhook's WebSocket URL and stream events.
   * Handles reconnection automatically on disconnect with fresh auth token on each retry.
   */
  const connectAndStream = (wsUrl: string): Stream.Stream<WebhookEvent, WebhookErrors> =>
    Stream.unwrap(
      // Get fresh auth token for each connection attempt (including retries)
      getAuthToken().pipe(Effect.map((authToken) => createWebSocketStream(wsUrl, authToken))),
    ).pipe(
      Stream.retry(
        Schedule.intersect(
          // Only retry on connection errors that indicate disconnect
          Schedule.recurWhile<WebhookErrors>((error) => error._tag === "WebhookConnectionError"),
          wsReconnectPolicy,
        ),
      ),
    );

  return {
    createCliWebhook,
    activateWebhook,
    deactivateWebhook,
    deleteWebhook,
    listWebhooks,
    connectAndStream,
  };
});

export const WebhookServiceLive = Layer.effect(WebhookService, make);
