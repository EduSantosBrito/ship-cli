/**
 * WebhookServiceLive - GitHub CLI (gh) wrapper for webhook operations
 *
 * This adapter implements the WebhookService port using the gh CLI.
 * It leverages an undocumented GitHub feature where webhooks with name="cli"
 * return a ws_url field for real-time event streaming via WebSocket.
 *
 * Key gh commands used:
 * - `gh api POST /repos/{owner}/{repo}/hooks` - Create webhook
 * - `gh api PATCH /repos/{owner}/{repo}/hooks/{id}` - Update webhook (activate/deactivate)
 * - `gh api DELETE /repos/{owner}/{repo}/hooks/{id}` - Delete webhook
 * - `gh api GET /repos/{owner}/{repo}/hooks` - List webhooks
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as Duration from "effect/Duration";
import * as Command from "@effect/platform/Command";
import * as CommandExecutor from "@effect/platform/CommandExecutor";
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
 */
const GhWebhookResponseSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  active: Schema.Boolean,
  events: Schema.Array(Schema.String),
  config: Schema.Struct({
    content_type: Schema.optional(Schema.String),
    url: Schema.optional(Schema.String),
  }),
  url: Schema.String,
  // This is the magic field - only present for name="cli" webhooks
  ws_url: Schema.optional(Schema.String),
});

type GhWebhookResponse = typeof GhWebhookResponseSchema.Type;

// Retry policy for network operations: exponential backoff with max 3 retries
const networkRetryPolicy = Schedule.intersect(
  Schedule.exponential(Duration.millis(500)),
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
          // Use -f for strings, -F for non-strings (booleans, numbers, arrays)
          if (typeof value === "string") {
            args.push("-f", `${key}=${value}`);
          } else {
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
  const parseJson = <T>(
    output: string,
    schema: Schema.Schema<T>,
  ): Effect.Effect<T, WebhookError> =>
    Effect.try({
      try: () => JSON.parse(output),
      catch: (e) =>
        new WebhookError({ message: `Failed to parse gh output: ${e}`, cause: e }),
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
      Effect.map((id) =>
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
            message: "GitHub did not return a WebSocket URL. The webhook may have been created without the 'cli' name.",
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
      runGhApi("PATCH", `/repos/${repo}/hooks/${webhookId}`, { active: true }).pipe(
        Effect.asVoid,
      ),
      "activateWebhook",
    );

  const deactivateWebhook = (
    repo: string,
    webhookId: WebhookId,
  ): Effect.Effect<void, WebhookErrors> =>
    withNetworkRetry(
      runGhApi("PATCH", `/repos/${repo}/hooks/${webhookId}`, { active: false }).pipe(
        Effect.asVoid,
      ),
      "deactivateWebhook",
    );

  const deleteWebhook = (
    repo: string,
    webhookId: WebhookId,
  ): Effect.Effect<void, WebhookErrors> =>
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
   * Connect to a webhook's WebSocket URL and stream events.
   * This is a stub - actual WebSocket implementation is in BRI-74.
   */
  const connectAndStream = (wsUrl: string): Stream.Stream<WebhookEvent, WebhookErrors> =>
    Stream.fail(
      new WebhookConnectionError({
        message: "WebSocket streaming not yet implemented. See BRI-74.",
        wsUrl,
      }),
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
