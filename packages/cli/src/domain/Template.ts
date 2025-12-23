import * as Schema from "effect/Schema";
import { Priority, TaskType } from "./Task.js";

// === Template Domain Model ===

/**
 * A task template defines default values and patterns for creating tasks.
 *
 * Templates are stored in `.ship/templates/` as YAML files.
 *
 * @example
 * ```yaml
 * # .ship/templates/bug.yaml
 * name: bug
 * title: "fix: {title}"
 * description: |
 *   ## Bug Report
 *
 *   **What happened:**
 *   {title}
 *
 *   **Expected behavior:**
 *
 *   **Steps to reproduce:**
 *   1.
 *
 *   **Environment:**
 *   -
 * priority: high
 * type: bug
 * ```
 */
export class TaskTemplate extends Schema.Class<TaskTemplate>("TaskTemplate")({
  /** Template identifier (filename without extension) */
  name: Schema.String,

  /**
   * Title pattern with optional {title} placeholder.
   * If {title} is present, it will be replaced with user-provided title.
   * If no placeholder, user title is appended.
   *
   * @example "fix: {title}" → "fix: login button broken"
   * @example "[BUG] {title}" → "[BUG] login button broken"
   */
  title: Schema.optional(Schema.String),

  /**
   * Description template with optional {title} placeholder.
   * Supports markdown formatting.
   */
  description: Schema.optional(Schema.String),

  /** Default priority for tasks created with this template */
  priority: Schema.optional(Priority),

  /** Default task type */
  type: Schema.optional(TaskType),
}) {
  /**
   * Apply the template to a user-provided title.
   * @param userTitle The title provided by the user
   * @returns The formatted title
   */
  formatTitle(userTitle: string): string {
    if (this.title === undefined) {
      return userTitle;
    }
    if (this.title.includes("{title}")) {
      return this.title.replace("{title}", userTitle);
    }
    // If no placeholder, append user title
    return `${this.title} ${userTitle}`;
  }

  /**
   * Apply the template to generate a description.
   * @param userTitle The title provided by the user (for placeholder substitution)
   * @returns The formatted description or undefined if no template description
   */
  formatDescription(userTitle: string): string | undefined {
    if (this.description === undefined) {
      return undefined;
    }
    return this.description.replace(/{title}/g, userTitle);
  }
}

// YAML representation for parsing template files
export const YamlTaskTemplate = Schema.Struct({
  name: Schema.optional(Schema.String), // Optional in file, derived from filename
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  priority: Schema.optional(Priority),
  type: Schema.optional(TaskType),
});

export type YamlTaskTemplate = typeof YamlTaskTemplate.Type;
