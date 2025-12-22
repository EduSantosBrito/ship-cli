import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import type {
  GhNotInstalledError,
  GhNotAuthenticatedError,
  WebhookError,
  WebhookConnectionError,
  WebhookPermissionError,
  WebhookAlreadyExistsError,
  WebhookRateLimitError,
} from "../domain/Errors.js";

// === Webhook Domain Types ===

export const WebhookId = Schema.Number.pipe(Schema.brand("WebhookId"));
export type WebhookId = typeof WebhookId.Type;

/**
 * A "cli" webhook created via GitHub API that provides WebSocket URL for real-time events.
 * This is an undocumented GitHub feature used by the `gh webhook` CLI extension.
 */
export class CliWebhook extends Schema.Class<CliWebhook>("CliWebhook")({
  /** Webhook ID */
  id: WebhookId,
  /** WebSocket URL for receiving events in real-time */
  wsUrl: Schema.String,
  /** Events this webhook is subscribed to */
  events: Schema.Array(Schema.String),
  /** Whether the webhook is active */
  active: Schema.Boolean,
  /** API URL for this webhook */
  url: Schema.String,
}) {}

/**
 * A webhook event received via WebSocket
 */
export class WebhookEvent extends Schema.Class<WebhookEvent>("WebhookEvent")({
  /** Event type (e.g., "pull_request", "issue_comment") */
  event: Schema.String,
  /** Event action (e.g., "opened", "closed", "merged") */
  action: Schema.optional(Schema.String),
  /** Delivery ID */
  deliveryId: Schema.String,
  /** Raw payload from GitHub */
  payload: Schema.Unknown,
  /** Original headers */
  headers: Schema.Record({ key: Schema.String, value: Schema.String }),
}) {}

/**
 * Input for creating a CLI webhook
 */
export class CreateCliWebhookInput extends Schema.Class<CreateCliWebhookInput>(
  "CreateCliWebhookInput",
)({
  /** Repository in "owner/repo" format */
  repo: Schema.String,
  /** Events to subscribe to */
  events: Schema.Array(Schema.String),
  /** Optional webhook secret for payload validation */
  secret: Schema.optional(Schema.String),
}) {}

/** Union of all Webhook error types */
export type WebhookErrors =
  | GhNotInstalledError
  | GhNotAuthenticatedError
  | WebhookError
  | WebhookConnectionError
  | WebhookPermissionError
  | WebhookAlreadyExistsError
  | WebhookRateLimitError;

export interface WebhookService {
  /**
   * Create a "cli" webhook that returns a WebSocket URL for receiving events.
   * This uses an undocumented GitHub API feature where webhooks with name="cli"
   * return a ws_url field for real-time event streaming.
   */
  readonly createCliWebhook: (
    input: CreateCliWebhookInput,
  ) => Effect.Effect<CliWebhook, WebhookErrors>;

  /**
   * Activate a webhook (start receiving events)
   * @param repo Repository in "owner/repo" format
   * @param webhookId The webhook ID to activate
   */
  readonly activateWebhook: (
    repo: string,
    webhookId: WebhookId,
  ) => Effect.Effect<void, WebhookErrors>;

  /**
   * Deactivate a webhook (pause receiving events)
   * @param repo Repository in "owner/repo" format
   * @param webhookId The webhook ID to deactivate
   */
  readonly deactivateWebhook: (
    repo: string,
    webhookId: WebhookId,
  ) => Effect.Effect<void, WebhookErrors>;

  /**
   * Delete a webhook (cleanup)
   * @param repo Repository in "owner/repo" format
   * @param webhookId The webhook ID to delete
   */
  readonly deleteWebhook: (
    repo: string,
    webhookId: WebhookId,
  ) => Effect.Effect<void, WebhookErrors>;

  /**
   * List existing webhooks for a repository
   */
  readonly listWebhooks: (repo: string) => Effect.Effect<ReadonlyArray<CliWebhook>, WebhookErrors>;

  /**
   * Connect to a webhook's WebSocket URL and stream events.
   * Handles reconnection automatically on disconnect.
   */
  readonly connectAndStream: (wsUrl: string) => Stream.Stream<WebhookEvent, WebhookErrors>;
}

export const WebhookService = Context.GenericTag<WebhookService>("WebhookService");
