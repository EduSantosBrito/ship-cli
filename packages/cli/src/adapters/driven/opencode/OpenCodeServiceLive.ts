/**
 * OpenCodeServiceLive - HTTP client for OpenCode server
 *
 * This adapter implements the OpenCodeService port using HTTP requests
 * to the OpenCode server API.
 *
 * Key endpoints used:
 * - GET /session - List all sessions
 * - GET /session/status - Get session statuses
 * - GET /session/:id - Get session details
 * - POST /session/:id/prompt_async - Send async message
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as Duration from "effect/Duration";
import {
  OpenCodeService,
  Session,
  SessionId,
  type SessionStatus,
  type OpenCodeErrors,
} from "../../../ports/OpenCodeService.js";
import {
  OpenCodeError,
  OpenCodeNotRunningError,
  OpenCodeSessionNotFoundError,
} from "../../../domain/Errors.js";

// Default OpenCode server URL
const DEFAULT_SERVER_URL = "http://127.0.0.1:4096";

// Retry policy for network operations: exponential backoff with max 3 retries
const networkRetryPolicy = Schedule.intersect(Schedule.exponential(Duration.millis(500)), Schedule.recurs(3));

// Timeout for network operations (shorter than other services since OpenCode is local)
const NETWORK_TIMEOUT = Duration.seconds(10);

// === API Response Schemas ===

/**
 * Session response from OpenCode API
 *
 * Note: OpenCode returns timestamps as Unix milliseconds in a nested `time` object,
 * not as ISO strings at the top level.
 */
const SessionResponseSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
  }),
  parentID: Schema.optional(Schema.String),
  share: Schema.optional(Schema.String),
});

/**
 * Session status response - map of session ID to status
 */
const SessionStatusResponseSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Literal("running", "idle"),
});

// === Service Implementation ===

const make = Effect.gen(function* () {
  // Get server URL from environment, wrapped in Effect for proper side-effect handling
  const serverUrl = yield* Effect.sync(() => process.env.OPENCODE_SERVER_URL ?? DEFAULT_SERVER_URL);

  /**
   * Wrap an effect with network retry and timeout for resilience
   */
  const withNetworkRetry = <A, E>(
    effect: Effect.Effect<A, E>,
    operation: string,
  ): Effect.Effect<A, E | OpenCodeError> =>
    effect.pipe(
      Effect.timeoutFail({
        duration: NETWORK_TIMEOUT,
        onTimeout: () => new OpenCodeError({ message: `${operation} timed out after 10 seconds` }),
      }),
      Effect.retry(networkRetryPolicy),
    );

  /**
   * Make an HTTP request to the OpenCode server.
   */
  const request = <T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Effect.Effect<T, OpenCodeErrors> =>
    withNetworkRetry(
      Effect.tryPromise({
        try: async () => {
          const url = `${serverUrl}${path}`;
          const options: RequestInit = {
            method,
            headers: {
              "Content-Type": "application/json",
            },
          };

          if (body) {
            options.body = JSON.stringify(body);
          }

          const response = await fetch(url, options);

          // For 204 No Content, return undefined
          if (response.status === 204) {
            return undefined as T;
          }

          // Handle error status codes
          if (response.status === 404) {
            throw { type: "not_found", path };
          }

          if (response.status >= 400) {
            const text = await response.text().catch(() => "");
            throw { type: "server_error", status: response.status, text };
          }

          // Parse JSON response
          return (await response.json()) as T;
        },
        catch: (error: unknown): OpenCodeErrors => {
          // Handle specific error types thrown from the try block
          if (error && typeof error === "object" && "type" in error) {
            const e = error as Record<string, unknown>;
            if (e.type === "not_found") {
              return new OpenCodeError({
                message: `Not found: ${String(e.path ?? "")}`,
              });
            }
            if (e.type === "server_error") {
              return new OpenCodeError({
                message: `OpenCode server returned ${e.status}: ${e.text}`,
              });
            }
          }

          // Connection refused = server not running
          const errorStr = String(error);
          if (
            errorStr.includes("ECONNREFUSED") ||
            errorStr.includes("fetch failed") ||
            errorStr.includes("network") ||
            errorStr.includes("Failed to fetch")
          ) {
            return OpenCodeNotRunningError.forUrl(serverUrl);
          }

          return new OpenCodeError({ message: `HTTP request failed: ${error}`, cause: error });
        },
      }),
      `${method} ${path}`,
    );

  /**
   * Convert API response to Session domain type
   *
   * OpenCode returns timestamps as Unix milliseconds, we convert to ISO strings
   * for the domain model.
   */
  const toSession = (response: typeof SessionResponseSchema.Type): Effect.Effect<Session, OpenCodeError> =>
    Schema.decode(SessionId)(response.id).pipe(
      Effect.map(
        (id) =>
          new Session({
            id,
            title: response.title,
            createdAt: new Date(response.time.created).toISOString(),
            updatedAt: new Date(response.time.updated).toISOString(),
            parentID: response.parentID,
            share: response.share,
          }),
      ),
      Effect.mapError((e) => new OpenCodeError({ message: `Invalid session ID: ${e.message}`, cause: e })),
    );

  // === Public API ===

  const isAvailable = (): Effect.Effect<boolean, never> =>
    request<unknown>("GET", "/config").pipe(
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false)),
    );

  const listSessions = (): Effect.Effect<ReadonlyArray<Session>, OpenCodeErrors> =>
    Effect.gen(function* () {
      const responses = yield* request<Array<typeof SessionResponseSchema.Type>>("GET", "/session");

      // Validate and convert each session
      const sessions: Session[] = [];
      for (const response of responses) {
        const validated = yield* Schema.decodeUnknown(SessionResponseSchema)(response).pipe(
          Effect.mapError((e) => new OpenCodeError({ message: `Invalid session response: ${e.message}`, cause: e })),
        );
        const session = yield* toSession(validated);
        sessions.push(session);
      }

      return sessions;
    });

  const getSessionStatuses = (): Effect.Effect<Record<string, SessionStatus>, OpenCodeErrors> =>
    Effect.gen(function* () {
      const statuses = yield* request<Record<string, string>>("GET", "/session/status");

      // Validate the response
      const validated = yield* Schema.decodeUnknown(SessionStatusResponseSchema)(statuses).pipe(
        Effect.mapError(
          (e) => new OpenCodeError({ message: `Invalid session status response: ${e.message}`, cause: e }),
        ),
      );

      return validated as Record<string, SessionStatus>;
    });

  const getSession = (sessionId: SessionId): Effect.Effect<Session, OpenCodeErrors> =>
    Effect.gen(function* () {
      const response = yield* request<typeof SessionResponseSchema.Type>("GET", `/session/${sessionId}`).pipe(
        Effect.catchIf(
          (e) => e._tag === "OpenCodeError" && e.message.includes("Not found"),
          () => Effect.fail(OpenCodeSessionNotFoundError.forId(sessionId)),
        ),
      );

      const validated = yield* Schema.decodeUnknown(SessionResponseSchema)(response).pipe(
        Effect.mapError((e) => new OpenCodeError({ message: `Invalid session response: ${e.message}`, cause: e })),
      );

      return yield* toSession(validated);
    });

  const sendPromptAsync = (sessionId: SessionId, message: string): Effect.Effect<void, OpenCodeErrors> =>
    request<void>("POST", `/session/${sessionId}/prompt_async`, {
      parts: [{ type: "text", text: message }],
    }).pipe(
      Effect.catchIf(
        (e) => e._tag === "OpenCodeError" && e.message.includes("Not found"),
        () => Effect.fail(OpenCodeSessionNotFoundError.forId(sessionId)),
      ),
      Effect.asVoid,
    );

  const findActiveSession = (): Effect.Effect<Session | null, OpenCodeErrors> =>
    Effect.gen(function* () {
      const [sessions, statuses] = yield* Effect.all([listSessions(), getSessionStatuses()]);

      if (sessions.length === 0) {
        return null;
      }

      // First priority: find a running session
      const runningSessions = sessions.filter((s) => statuses[s.id] === "running");
      if (runningSessions.length > 0) {
        // Return the most recently updated running session
        return (
          runningSessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] ?? null
        );
      }

      // Second priority: return the most recently updated session
      return (
        [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] ?? null
      );
    });

  return {
    isAvailable,
    listSessions,
    getSessionStatuses,
    getSession,
    sendPromptAsync,
    findActiveSession,
  };
});

export const OpenCodeServiceLive = Layer.effect(OpenCodeService, make);
