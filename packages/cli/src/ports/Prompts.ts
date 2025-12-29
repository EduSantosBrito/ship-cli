/**
 * Prompts Service Port
 *
 * Effect-based wrapper for @clack/prompts that provides:
 * - Consistent error handling for cancelled prompts
 * - Easy mocking in tests via test layer
 * - Single place to handle cancellation
 *
 * Only wraps interactive prompts (text, select, confirm) since those need
 * Effect integration and testability. Non-interactive UI elements (intro, outro,
 * note, log, spinner) remain as direct clack calls.
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type { PromptCancelledError } from "../domain/Errors.js";

// === Prompt Option Types ===

export interface TextOptions {
  /** The message to display to the user */
  readonly message: string;
  /** Placeholder text shown in the input field */
  readonly placeholder?: string;
  /** Default value if user just presses enter */
  readonly defaultValue?: string;
  /** Validation function - return error message string or undefined if valid */
  readonly validate?: (value: string) => string | undefined;
}

export interface SelectOption<T> {
  /** The value returned when this option is selected */
  readonly value: T;
  /** The label displayed to the user */
  readonly label: string;
  /** Optional hint displayed next to the label */
  readonly hint?: string;
}

export interface SelectOptions<T> {
  /** The message to display to the user */
  readonly message: string;
  /** The options to choose from */
  readonly options: ReadonlyArray<SelectOption<T>>;
  /** Initial cursor position (index) */
  readonly initialValue?: T;
}

export interface ConfirmOptions {
  /** The message to display to the user */
  readonly message: string;
  /** Whether to default to true or false */
  readonly initialValue?: boolean;
}

// === Service Interface ===

export interface Prompts {
  /**
   * Prompt for text input.
   *
   * @example
   * ```typescript
   * const apiKey = yield* prompts.text({
   *   message: "Enter your API key",
   *   placeholder: "lin_api_...",
   *   validate: (v) => v.startsWith("lin_api_") ? undefined : "Invalid format"
   * });
   * ```
   */
  readonly text: (options: TextOptions) => Effect.Effect<string, PromptCancelledError>;

  /**
   * Prompt for selecting from a list of options.
   *
   * @example
   * ```typescript
   * const team = yield* prompts.select({
   *   message: "Select a team",
   *   options: teams.map(t => ({ value: t.id, label: t.name }))
   * });
   * ```
   */
  readonly select: <T>(options: SelectOptions<T>) => Effect.Effect<T, PromptCancelledError>;

  /**
   * Prompt for yes/no confirmation.
   *
   * @example
   * ```typescript
   * const shouldDelete = yield* prompts.confirm({
   *   message: "Delete this bookmark?",
   *   initialValue: true
   * });
   * ```
   */
  readonly confirm: (options: ConfirmOptions) => Effect.Effect<boolean, PromptCancelledError>;
}

export const Prompts = Context.GenericTag<Prompts>("Prompts");
