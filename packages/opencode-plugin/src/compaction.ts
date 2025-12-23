/**
 * Compaction context preservation module.
 *
 * This module provides utilities for tracking task state across sessions
 * and preserving context during OpenCode session compaction.
 */

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// =============================================================================
// Types
// =============================================================================

/**
 * Session task state for compaction context preservation.
 */
export interface SessionTaskState {
  taskId: string;
  workdir?: string;
}

// =============================================================================
// State Management
// =============================================================================

/**
 * Module-level state for tracking the current task per session.
 *
 * This is populated when tasks are started via the ship tool (action=start)
 * and updated when workspaces are created (action=stack-create).
 * Used during compaction to preserve task context.
 */
export const sessionTaskMap = new Map<string, SessionTaskState>();

/**
 * Track when a task is started or updated for a session.
 */
export const trackTask = (sessionId: string, state: Partial<SessionTaskState>): void => {
  const existing = sessionTaskMap.get(sessionId);
  if (existing) {
    // Update existing state
    sessionTaskMap.set(sessionId, { ...existing, ...state });
  } else if (state.taskId) {
    // New task started
    sessionTaskMap.set(sessionId, { taskId: state.taskId, workdir: state.workdir });
  }
};

/**
 * Get the tracked task for a session.
 */
export const getTrackedTask = (sessionId: string): Option.Option<SessionTaskState> => {
  const task = sessionTaskMap.get(sessionId);
  return task ? Option.some(task) : Option.none();
};

/**
 * Clear tracked task for a session. Used for cleanup or when task is completed.
 */
export const clearTrackedTask = (sessionId: string): void => {
  sessionTaskMap.delete(sessionId);
};

// =============================================================================
// Schema Validation
// =============================================================================

/**
 * Schema for parsing ship tool args from metadata.
 * Only includes fields needed for task tracking.
 */
export const ShipToolArgsSchema = Schema.Struct({
  action: Schema.String,
  taskId: Schema.optional(Schema.String),
});

export const decodeShipToolArgs = Schema.decodeUnknownOption(ShipToolArgsSchema);
