/**
 * Pure utility functions for the Ship OpenCode Plugin.
 * These are separated from the main plugin for testability.
 */

import * as Schema from "effect/Schema";

// =============================================================================
// Types (exported for testing)
// =============================================================================

export interface ShipTask {
  identifier: string;
  title: string;
  description?: string;
  priority: string;
  status: string;
  state?: string;
  labels: string[];
  url: string;
  branchName?: string;
  subtasks?: ShipSubtask[];
  milestoneId?: string | null;
  milestoneName?: string | null;
}

export interface ShipSubtask {
  id: string;
  identifier: string;
  title: string;
  state: string;
  stateType: string;
  isDone: boolean;
}

// =============================================================================
// JSON Extraction
// =============================================================================

/**
 * Schema for validating that a string is valid JSON.
 */
const JsonString = Schema.parseJson();
const validateJson = Schema.decodeUnknownOption(JsonString);

/**
 * Extract JSON from CLI output by finding valid JSON object or array.
 *
 * The CLI may output non-JSON content before the actual JSON response (e.g., spinner
 * output, progress messages). Additionally, task descriptions may contain JSON code
 * blocks which could be incorrectly matched if we search from the start.
 *
 * This function finds all potential JSON start positions and validates each candidate
 * using Schema.parseJson(). We prioritize top-level JSON (no leading whitespace) to
 * avoid matching nested objects inside arrays.
 *
 * @param output - Raw CLI output that may contain JSON
 * @returns Extracted JSON string, or original output if no valid JSON found
 */
export const extractJson = (output: string): string => {
  // Find all potential JSON start positions (lines starting with { or [)
  // The regex captures leading whitespace to distinguish top-level vs nested JSON
  const matches = [...output.matchAll(/^(\s*)([[{])/gm)];
  if (matches.length === 0) {
    return output;
  }

  // Separate top-level matches (no leading whitespace) from nested ones
  const topLevelMatches: Array<{ index: number }> = [];
  const nestedMatches: Array<{ index: number }> = [];

  for (const match of matches) {
    if (match.index === undefined) continue;
    const leadingWhitespace = match[1];
    // Top-level JSON starts at column 0 (no leading whitespace)
    if (leadingWhitespace === "") {
      topLevelMatches.push({ index: match.index });
    } else {
      nestedMatches.push({ index: match.index });
    }
  }

  // Try top-level matches first (most likely to be the actual response)
  // Then fall back to nested matches if needed
  const orderedMatches = [...topLevelMatches, ...nestedMatches];

  for (const match of orderedMatches) {
    const candidate = output.slice(match.index).trim();
    // Validate using Schema.parseJson() - returns Option.some if valid
    if (validateJson(candidate)._tag === "Some") {
      return candidate;
    }
  }

  // Fallback to original output if no valid JSON found
  return output;
};

// =============================================================================
// Formatters
// =============================================================================

/**
 * Format a list of tasks for display.
 *
 * @param tasks - Array of tasks to format
 * @returns Formatted string with priority indicators and aligned columns
 */
export const formatTaskList = (tasks: ShipTask[]): string =>
  tasks
    .map((t) => {
      const priority = t.priority === "urgent" ? "[!]" : t.priority === "high" ? "[^]" : "   ";
      return `${priority} ${t.identifier.padEnd(10)} ${(t.state || t.status).padEnd(12)} ${t.title}`;
    })
    .join("\n");

/**
 * Format task details for display.
 *
 * @param task - Task to format
 * @returns Formatted markdown string with task details
 */
export const formatTaskDetails = (task: ShipTask): string => {
  let output = `# ${task.identifier}: ${task.title}

**Status:** ${task.state || task.status}
**Priority:** ${task.priority}
**Labels:** ${task.labels.length > 0 ? task.labels.join(", ") : "none"}
**URL:** ${task.url}`;

  if (task.branchName) {
    output += `\n**Branch:** ${task.branchName}`;
  }

  if (task.description) {
    output += `\n\n## Description\n\n${task.description}`;
  }

  if (task.subtasks && task.subtasks.length > 0) {
    output += `\n\n## Subtasks\n`;
    for (const subtask of task.subtasks) {
      const statusIndicator = subtask.isDone ? "[x]" : "[ ]";
      output += `\n${statusIndicator} ${subtask.identifier}: ${subtask.title} (${subtask.state})`;
    }
  }

  return output;
};

// =============================================================================
// Guidance Helper
// =============================================================================

/**
 * Options for the addGuidance helper function.
 */
export interface GuidanceOptions {
  /** Explicit working directory path (shown when workspace changes) */
  workdir?: string;
  /** Whether to show skill reminder */
  skill?: boolean;
  /** Contextual note/message */
  note?: string;
}

/**
 * Helper function to format guidance blocks consistently.
 * Reduces repetition and ensures consistent format across all actions.
 *
 * @param next - Suggested next actions (e.g., "action=done | action=ready")
 * @param opts - Optional workdir, skill reminder, and note
 * @returns Formatted guidance string to append to command output
 */
export const addGuidance = (next: string, opts?: GuidanceOptions): string => {
  let g = `\n---\nNext: ${next}`;
  if (opts?.workdir) g += `\nWorkdir: ${opts.workdir}`;
  if (opts?.skill) g += `\nSkill: skill(name="ship-cli")`;
  if (opts?.note) g += `\nNote: ${opts.note}`;
  return g;
};
