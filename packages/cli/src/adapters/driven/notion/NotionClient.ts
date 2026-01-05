import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Duration from "effect/Duration";
import * as Schedule from "effect/Schedule";
import { Client as NotionSDK, APIErrorCode, isNotionClientError } from "@notionhq/client";
import { AuthService } from "../../../ports/AuthService.js";
import { NotionApiError } from "../../../domain/Errors.js";

// =============================================================================
// Notion Client Service
// =============================================================================

/**
 * Service that provides access to the Notion SDK client.
 * Wraps the official @notionhq/client with Effect patterns.
 */
export interface NotionClientService {
  /**
   * Get the Notion client instance.
   * The client is cached (singleton per session) for efficiency.
   */
  readonly client: () => Effect.Effect<NotionSDK, NotionApiError>;
}

export const NotionClientService = Context.GenericTag<NotionClientService>(
  "NotionClientService",
);

// =============================================================================
// Error Mapping
// =============================================================================

/**
 * Map Notion SDK errors to our domain NotionApiError.
 * Handles all Notion-specific error codes for proper error messages.
 */
export const mapNotionError = (error: unknown): NotionApiError => {
  if (isNotionClientError(error)) {
    const code = error.code;
    let message = error.message;
    let statusCode: number | undefined;

    // Map Notion error codes to user-friendly messages
    switch (code) {
      case APIErrorCode.Unauthorized:
        message = "Notion authentication failed. Check your integration token.";
        statusCode = 401;
        break;
      case APIErrorCode.RestrictedResource:
        message = "Access denied. The integration doesn't have access to this resource.";
        statusCode = 403;
        break;
      case APIErrorCode.ObjectNotFound:
        message = "Resource not found. Check the database ID or page ID.";
        statusCode = 404;
        break;
      case APIErrorCode.RateLimited:
        message = "Rate limited by Notion API. Please wait before retrying.";
        statusCode = 429;
        break;
      case APIErrorCode.InvalidJSON:
        message = "Invalid request format.";
        statusCode = 400;
        break;
      case APIErrorCode.InvalidRequestURL:
        message = "Invalid request URL.";
        statusCode = 400;
        break;
      case APIErrorCode.InvalidRequest:
        message = "Invalid request parameters.";
        statusCode = 400;
        break;
      case APIErrorCode.ValidationError:
        message = `Validation error: ${error.message}`;
        statusCode = 400;
        break;
      case APIErrorCode.ConflictError:
        message = "Conflict: The resource was modified by another request.";
        statusCode = 409;
        break;
      case APIErrorCode.InternalServerError:
        message = "Notion server error. Please try again later.";
        statusCode = 500;
        break;
      case APIErrorCode.ServiceUnavailable:
        message = "Notion service is temporarily unavailable.";
        statusCode = 503;
        break;
      default:
        // Keep original message for unknown codes
        break;
    }

    return new NotionApiError({
      message,
      ...(statusCode !== undefined && { statusCode }),
      code,
      cause: error,
    });
  }

  // Handle non-Notion errors
  if (error instanceof Error) {
    return new NotionApiError({
      message: error.message,
      cause: error,
    });
  }

  return new NotionApiError({
    message: String(error),
    cause: error,
  });
};

// =============================================================================
// Retry Policy
// =============================================================================

/**
 * Retry policy for Notion API rate limits.
 * Notion has a rate limit of 3 requests per second.
 * This policy handles 429 errors with exponential backoff.
 */
export const notionRetryPolicy = Schedule.intersect(
  Schedule.exponential(Duration.millis(500)), // Start with 500ms, double each time
  Schedule.recurs(3), // Max 3 retries
).pipe(
  Schedule.whileInput((error: NotionApiError) => error.statusCode === 429),
);

// =============================================================================
// Configuration
// =============================================================================

/**
 * Default timeout for Notion API requests (30 seconds).
 */
export const NOTION_DEFAULT_TIMEOUT = Duration.seconds(30);

// =============================================================================
// Live Implementation
// =============================================================================

/**
 * Create the NotionClientService implementation.
 * Features:
 * - Singleton client instance (fiber-safe cached per session)
 * - Authentication via AuthService
 * - Configurable timeout
 */
const make = Effect.gen(function* () {
  const auth = yield* AuthService;

  // Effect that creates a new Notion client
  const createClient = Effect.gen(function* () {
    // Get API key from auth service
    const apiKey = yield* auth.getApiKey().pipe(
      Effect.mapError(
        (e) =>
          new NotionApiError({
            message: `Authentication required: ${e.message}`,
          }),
      ),
    );

    // Create the client
    return new NotionSDK({
      auth: apiKey,
      timeoutMs: Duration.toMillis(NOTION_DEFAULT_TIMEOUT),
    });
  });

  // Memoize the client creation - fiber-safe and lazy
  // Effect.cached returns a new effect that caches the result of the first execution
  const cachedClient = yield* Effect.cached(createClient);

  return { client: () => cachedClient };
});

/**
 * Live layer for NotionClientService.
 * Requires AuthService to be provided.
 */
export const NotionClientLive = Layer.effect(NotionClientService, make);

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Execute a Notion API call with automatic error mapping and retry.
 * Use this wrapper for all Notion SDK calls.
 *
 * @example
 * ```ts
 * const result = yield* withNotionClient((client) =>
 *   client.databases.query({ database_id: "..." })
 * );
 * ```
 */
export const withNotionClient = <A>(
  fn: (client: NotionSDK) => Promise<A>,
): Effect.Effect<A, NotionApiError, NotionClientService> =>
  Effect.gen(function* () {
    const service = yield* NotionClientService;
    const client = yield* service.client();

    return yield* Effect.tryPromise({
      try: () => fn(client),
      catch: mapNotionError,
    }).pipe(
      Effect.retry(notionRetryPolicy),
      Effect.timeout(NOTION_DEFAULT_TIMEOUT),
      Effect.catchTag("TimeoutException", () =>
        Effect.fail(
          new NotionApiError({
            message: "Notion API request timed out",
            statusCode: 408,
          }),
        ),
      ),
    );
  });
