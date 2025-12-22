import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  OpenCodeError,
  OpenCodeNotRunningError,
  OpenCodeSessionNotFoundError,
} from "../domain/Errors.js";

// === OpenCode Domain Types ===

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

/**
 * Session status indicates the current state of a session.
 * Based on OpenCode SDK types:
 * - idle: Session is not processing
 * - busy: Session is actively processing
 * - retry: Session is retrying after an error
 */
export const SessionStatusType = Schema.Literal("idle", "busy", "retry");
export type SessionStatusType = typeof SessionStatusType.Type;

export const SessionStatus = Schema.Union(
  Schema.Struct({ type: Schema.Literal("idle") }),
  Schema.Struct({ type: Schema.Literal("busy") }),
  Schema.Struct({
    type: Schema.Literal("retry"),
    attempt: Schema.Number,
    message: Schema.String,
    next: Schema.Number,
  }),
);
export type SessionStatus = typeof SessionStatus.Type;

/**
 * OpenCode session representation.
 */
export class Session extends Schema.Class<Session>("Session")({
  id: SessionId,
  title: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  parentID: Schema.optional(Schema.String),
  share: Schema.optional(Schema.String),
}) {}

/**
 * Part of a message - can be text, tool call, etc.
 */
export const MessagePart = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
  // Other part types exist but we only need text for now
});

export type MessagePart = typeof MessagePart.Type;

/**
 * Input for sending an async prompt.
 */
export class PromptAsyncInput extends Schema.Class<PromptAsyncInput>("PromptAsyncInput")({
  parts: Schema.Array(MessagePart),
  model: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  noReply: Schema.optional(Schema.Boolean),
  system: Schema.optional(Schema.String),
}) {}

/** Union of all OpenCode error types */
export type OpenCodeErrors = OpenCodeError | OpenCodeNotRunningError | OpenCodeSessionNotFoundError;

// === OpenCode Service Interface ===

export interface OpenCodeService {
  /**
   * Check if OpenCode server is available at the configured URL.
   */
  readonly isAvailable: () => Effect.Effect<boolean, never>;

  /**
   * List all sessions.
   */
  readonly listSessions: () => Effect.Effect<ReadonlyArray<Session>, OpenCodeErrors>;

  /**
   * Get session status for all sessions.
   * Returns a map of session ID to status.
   */
  readonly getSessionStatuses: () => Effect.Effect<Record<string, SessionStatus>, OpenCodeErrors>;

  /**
   * Get a specific session by ID.
   */
  readonly getSession: (sessionId: SessionId) => Effect.Effect<Session, OpenCodeErrors>;

  /**
   * Send a message to a session asynchronously (don't wait for response).
   * The agent will receive and process the message.
   */
  readonly sendPromptAsync: (
    sessionId: SessionId,
    message: string,
  ) => Effect.Effect<void, OpenCodeErrors>;

  /**
   * Find the best session to send messages to.
   * Prioritizes: 1) running sessions, 2) most recently updated
   */
  readonly findActiveSession: () => Effect.Effect<Session | null, OpenCodeErrors>;
}

export const OpenCodeService = Context.GenericTag<OpenCodeService>("OpenCodeService");
