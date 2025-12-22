import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { OpenCodeErrors } from "./OpenCodeService.js";
import type { WebhookErrors } from "./WebhookService.js";

// === Daemon Domain Types ===

export const PrNumber = Schema.Number.pipe(Schema.brand("PrNumber"));
export type PrNumber = typeof PrNumber.Type;

/**
 * A session subscription - maps a session to the PRs it's listening to
 */
export class SessionSubscription extends Schema.Class<SessionSubscription>("SessionSubscription")({
  sessionId: Schema.String,
  prNumbers: Schema.Array(PrNumber),
  subscribedAt: Schema.String,
}) {}

/**
 * Daemon status information
 */
export class DaemonStatus extends Schema.Class<DaemonStatus>("DaemonStatus")({
  running: Schema.Boolean,
  pid: Schema.optional(Schema.Number),
  repo: Schema.optional(Schema.String),
  connectedToGitHub: Schema.Boolean,
  subscriptions: Schema.Array(SessionSubscription),
  uptime: Schema.optional(Schema.Number),
}) {}

// === IPC Protocol Types ===

/**
 * Subscribe a session to PR events
 */
export class SubscribeCommand extends Schema.Class<SubscribeCommand>("SubscribeCommand")({
  type: Schema.Literal("subscribe"),
  sessionId: Schema.String,
  prNumbers: Schema.Array(Schema.Number),
}) {}

/**
 * Unsubscribe a session from PR events
 */
export class UnsubscribeCommand extends Schema.Class<UnsubscribeCommand>("UnsubscribeCommand")({
  type: Schema.Literal("unsubscribe"),
  sessionId: Schema.String,
  prNumbers: Schema.Array(Schema.Number),
}) {}

/**
 * Get daemon status
 */
export class StatusCommand extends Schema.Class<StatusCommand>("StatusCommand")({
  type: Schema.Literal("status"),
}) {}

/**
 * Request daemon shutdown
 */
export class ShutdownCommand extends Schema.Class<ShutdownCommand>("ShutdownCommand")({
  type: Schema.Literal("shutdown"),
}) {}

/**
 * Union of all IPC commands
 */
export const IpcCommand = Schema.Union(
  SubscribeCommand,
  UnsubscribeCommand,
  StatusCommand,
  ShutdownCommand,
);
export type IpcCommand = typeof IpcCommand.Type;

/**
 * Success response from daemon
 */
export class SuccessResponse extends Schema.Class<SuccessResponse>("SuccessResponse")({
  type: Schema.Literal("success"),
  message: Schema.optional(Schema.String),
}) {}

/**
 * Error response from daemon
 */
export class ErrorResponse extends Schema.Class<ErrorResponse>("ErrorResponse")({
  type: Schema.Literal("error"),
  error: Schema.String,
}) {}

/**
 * Status response from daemon
 */
export class StatusResponse extends Schema.Class<StatusResponse>("StatusResponse")({
  type: Schema.Literal("status_response"),
  status: DaemonStatus,
}) {}

/**
 * Union of all IPC responses
 */
export const IpcResponse = Schema.Union(SuccessResponse, ErrorResponse, StatusResponse);
export type IpcResponse = typeof IpcResponse.Type;

// === Daemon Errors ===

export class DaemonError extends Schema.TaggedError<DaemonError>()("DaemonError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export class DaemonNotRunningError extends Schema.TaggedError<DaemonNotRunningError>()(
  "DaemonNotRunningError",
  {
    message: Schema.String,
  },
) {
  static readonly default = new DaemonNotRunningError({
    message: "Webhook daemon is not running. Start it with 'ship webhook start'.",
  });
}

export class DaemonAlreadyRunningError extends Schema.TaggedError<DaemonAlreadyRunningError>()(
  "DaemonAlreadyRunningError",
  {
    message: Schema.String,
    pid: Schema.optional(Schema.Number),
  },
) {}

export type DaemonErrors =
  | DaemonError
  | DaemonNotRunningError
  | DaemonAlreadyRunningError
  | OpenCodeErrors
  | WebhookErrors;

// === Daemon Service Interface ===

/**
 * Service for communicating with the webhook daemon.
 * This is used by CLI commands and agent tools to interact with the daemon.
 */
export interface DaemonService {
  /**
   * Check if the daemon is running
   */
  readonly isRunning: () => Effect.Effect<boolean, never>;

  /**
   * Get daemon status
   */
  readonly getStatus: () => Effect.Effect<DaemonStatus, DaemonErrors>;

  /**
   * Subscribe a session to PR events
   */
  readonly subscribe: (
    sessionId: string,
    prNumbers: ReadonlyArray<number>,
  ) => Effect.Effect<void, DaemonErrors>;

  /**
   * Unsubscribe a session from PR events
   */
  readonly unsubscribe: (
    sessionId: string,
    prNumbers: ReadonlyArray<number>,
  ) => Effect.Effect<void, DaemonErrors>;

  /**
   * Request daemon shutdown
   */
  readonly shutdown: () => Effect.Effect<void, DaemonErrors>;

  /**
   * Start the daemon (in current process - for CLI use)
   * Returns an Effect that runs until shutdown is requested
   */
  readonly startDaemon: (
    repo: string,
    events: ReadonlyArray<string>,
  ) => Effect.Effect<void, DaemonErrors>;
}

export const DaemonService = Context.GenericTag<DaemonService>("DaemonService");

// === Constants ===

/** Path to the Unix socket for IPC */
export const DAEMON_SOCKET_PATH = "/tmp/ship-webhook.sock";

/** Path to the PID file */
export const DAEMON_PID_PATH = "/tmp/ship-webhook.pid";
