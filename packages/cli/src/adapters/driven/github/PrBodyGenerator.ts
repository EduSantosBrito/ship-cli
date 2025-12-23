/**
 * PrBodyGenerator - Generates PR body content from task and stack information
 *
 * This module creates well-formatted PR descriptions by combining:
 * - Task description and metadata from Linear
 * - Change stack information from jj (when available)
 * - Extracted acceptance criteria (checkbox patterns)
 *
 * The generated markdown is optimized for GitHub's PR UI.
 */

import * as Option from "effect/Option";
import type { Task } from "../../../domain/Task.js";
import type { Change } from "../../../ports/VcsService.js";

// === Task Identifier Parsing ===

/**
 * Parse a task identifier from a bookmark name.
 *
 * Supports formats like:
 * - `user/BRI-123-feature-name` -> `BRI-123`
 * - `edusantosbrito/bri-123-feature` -> `BRI-123`
 * - `BRI-456-some-task` -> `BRI-456`
 * - `bri-789` -> `BRI-789`
 * - `X-1-fix` -> `X-1` (single letter prefix)
 * - `MYTEAM-456` -> `MYTEAM-456` (longer prefix)
 *
 * @param bookmark - The bookmark name to parse
 * @returns The task identifier in uppercase (e.g., "BRI-123") or null if not found
 */
export const parseTaskIdentifierFromBookmark = (bookmark: string): string | null => {
  // Match patterns like BRI-123, bri-456, X-1, MYTEAM-999, etc.
  // Supports 1-10 letter prefixes to handle various team naming conventions
  // The identifier is typically at the start or after a slash
  const pattern = /(?:^|\/)([a-zA-Z]{1,10}-\d+)/i;
  const match = bookmark.match(pattern);

  return match?.[1]?.toUpperCase() ?? null;
};

// === Types ===

export interface PrBodyInput {
  /** The Linear task associated with this PR */
  task: Task;
  /** Optional stack of changes (from jj) */
  stackChanges?: ReadonlyArray<Change>;
  /** Optional custom summary to override task description */
  customSummary?: string;
}

export interface PrBodyOutput {
  /** Generated PR body markdown */
  body: string;
  /** Extracted acceptance criteria (if found) */
  acceptanceCriteria: ReadonlyArray<string>;
}

// === Acceptance Criteria Extraction ===

/**
 * Extract acceptance criteria from task description.
 * Looks for checkbox patterns like:
 * - [ ] criterion
 * - [x] completed criterion
 * - - [ ] nested criterion
 */
const extractAcceptanceCriteria = (description: string): ReadonlyArray<string> => {
  // Match lines that start with optional whitespace, optional dash, and checkbox pattern
  const checkboxPattern = /^\s*-?\s*\[[ x]\]\s*(.+)$/gim;
  const criteria: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = checkboxPattern.exec(description)) !== null) {
    const criterion = match[1].trim();
    if (criterion) {
      criteria.push(criterion);
    }
  }

  return criteria;
};

/**
 * Check if description contains an "Acceptance Criteria" section
 */
const hasAcceptanceCriteriaSection = (description: string): boolean => {
  return /acceptance\s*criteria/i.test(description);
};

/**
 * Extract summary from description (first paragraph before any section headers).
 * Uses smart truncation to avoid cutting mid-word or mid-sentence.
 *
 * @param description - The full task description
 * @returns A clean summary string
 */
const extractSummary = (description: string): string => {
  // Split by common section headers
  const sectionPattern = /^##?\s+/m;
  const parts = description.split(sectionPattern);

  if (parts.length > 0) {
    // Get the first part (before any headers)
    const firstPart = parts[0].trim();

    // If it's not empty and not just whitespace, use it
    if (firstPart) {
      // Take first paragraph (up to double newline)
      const paragraphs = firstPart.split(/\n\n+/);
      return paragraphs[0].trim();
    }
  }

  // Fallback: smart truncation to avoid cutting mid-word/sentence
  return smartTruncate(description, 500);
};

/**
 * Truncate text intelligently, preferring to cut at sentence or word boundaries.
 *
 * @param text - The text to truncate
 * @param maxLength - Maximum length of the result
 * @returns Truncated text with ellipsis if needed
 */
const smartTruncate = (text: string, maxLength: number): string => {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  const truncated = trimmed.slice(0, maxLength);

  // Try to find a sentence boundary (. followed by space or end)
  const lastSentence = truncated.lastIndexOf(". ");
  if (lastSentence > maxLength * 0.3) {
    return truncated.slice(0, lastSentence + 1);
  }

  // Fall back to word boundary
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.3) {
    return truncated.slice(0, lastSpace) + "...";
  }

  // Last resort: hard cut with ellipsis
  return truncated + "...";
};

// === Changes Section Formatting ===

/**
 * Filter changes to only include meaningful ones (non-empty with descriptions).
 *
 * @param changes - Array of changes to filter
 * @returns Filtered array of meaningful changes
 */
const filterMeaningfulChanges = (changes: ReadonlyArray<Change>): ReadonlyArray<Change> =>
  changes.filter(
    (change) =>
      !change.isEmpty &&
      change.description &&
      change.description.trim() !== "" &&
      change.description !== "(no description)",
  );

/**
 * Format a list of changes into markdown bullet points.
 * Returns an empty array if no meaningful changes exist.
 *
 * @param changes - Array of changes to format
 * @returns Array of markdown lines (including section header if changes exist)
 */
const formatChangesSection = (changes: ReadonlyArray<Change>): string[] => {
  const meaningful = filterMeaningfulChanges(changes);

  if (meaningful.length === 0) {
    return [];
  }

  return [
    "## Changes",
    ...meaningful.map((change) => {
      const firstLine = change.description.split("\n")[0].trim();
      const changeIdShort = change.changeId.slice(0, 8);
      return `- ${firstLine} (\`${changeIdShort}\`)`;
    }),
    "",
  ];
};

// === PR Body Generation ===

/**
 * Generate PR body markdown from task and stack information.
 *
 * Template structure:
 * ```markdown
 * ## Summary
 * {task.description or task.title}
 *
 * ## Task
 * [{task.identifier}]({task.url}): {task.title}
 *
 * ## Changes
 * - {change1.description}
 * - {change2.description}
 *
 * ## Acceptance Criteria
 * {extracted from task.description if present}
 * ```
 */
export const generatePrBody = (input: PrBodyInput): PrBodyOutput => {
  const { task, stackChanges, customSummary } = input;

  const sections: string[] = [];

  // === Summary Section ===
  const description = Option.getOrElse(task.description, () => "");
  const summary = customSummary || (description ? extractSummary(description) : task.title);

  sections.push("## Summary");
  sections.push(summary);
  sections.push("");

  // === Task Section ===
  sections.push("## Task");
  sections.push(`[${task.identifier}](${task.url}): ${task.title}`);
  sections.push("");

  // === Changes Section (if stack provided) ===
  if (stackChanges && stackChanges.length > 0) {
    sections.push(...formatChangesSection(stackChanges));
  }

  // === Acceptance Criteria Section ===
  const acceptanceCriteria = description ? extractAcceptanceCriteria(description) : [];

  if (acceptanceCriteria.length > 0) {
    sections.push("## Acceptance Criteria");
    for (const criterion of acceptanceCriteria) {
      sections.push(`- [ ] ${criterion}`);
    }
    sections.push("");
  } else if (hasAcceptanceCriteriaSection(description)) {
    // If the description has an AC section but we couldn't extract items,
    // include a note pointing to the task
    sections.push("## Acceptance Criteria");
    sections.push(`See task for details: [${task.identifier}](${task.url})`);
    sections.push("");
  }

  // Build final body (trim trailing newlines but ensure one at end)
  const body = sections.join("\n").trim();

  return {
    body,
    acceptanceCriteria,
  };
};

/**
 * Generate a minimal PR body when no task is available.
 * Uses change description as the summary.
 *
 * @param change - The main change to generate PR body for
 * @param stackChanges - Optional array of stack changes to include
 * @returns Generated markdown PR body string
 */
export const generateMinimalPrBody = (
  change: Change,
  stackChanges?: ReadonlyArray<Change>,
): string => {
  const sections: string[] = [];

  // Summary from change description
  sections.push("## Summary");
  sections.push(change.description || "(No description)");
  sections.push("");

  // Changes section if stack provided
  if (stackChanges && stackChanges.length > 0) {
    sections.push(...formatChangesSection(stackChanges));
  }

  return sections.join("\n").trim();
};
