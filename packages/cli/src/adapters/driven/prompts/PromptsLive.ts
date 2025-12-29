/**
 * Live Implementation of Prompts Service
 *
 * Uses @clack/prompts for interactive terminal prompts.
 * Handles cancellation (Ctrl+C) uniformly by converting to PromptCancelledError.
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as clack from "@clack/prompts";
import {
  Prompts,
  type TextOptions,
  type SelectOptions,
  type ConfirmOptions,
} from "../../../ports/Prompts.js";
import { PromptCancelledError } from "../../../domain/Errors.js";

/**
 * Helper to run a clack prompt and handle cancellation.
 * All clack prompts return the result or a symbol when cancelled.
 */
const runPrompt = <T>(prompt: () => Promise<T | symbol>): Effect.Effect<T, PromptCancelledError> =>
  Effect.tryPromise({
    try: prompt,
    catch: () => PromptCancelledError.default,
  }).pipe(
    Effect.flatMap((result) =>
      clack.isCancel(result)
        ? Effect.fail(PromptCancelledError.default)
        : Effect.succeed(result as T),
    ),
  );

/**
 * Build clack text options, only including defined optional properties.
 */
const buildTextOptions = (options: TextOptions): clack.TextOptions => {
  const result: clack.TextOptions = { message: options.message };
  if (options.placeholder !== undefined) result.placeholder = options.placeholder;
  if (options.defaultValue !== undefined) result.defaultValue = options.defaultValue;
  if (options.validate !== undefined) result.validate = options.validate;
  return result;
};

/**
 * Build clack confirm options, only including defined optional properties.
 */
const buildConfirmOptions = (options: ConfirmOptions): clack.ConfirmOptions => {
  const result: clack.ConfirmOptions = { message: options.message };
  if (options.initialValue !== undefined) result.initialValue = options.initialValue;
  return result;
};

const promptsImpl: Prompts = {
  text: (options: TextOptions) => runPrompt(() => clack.text(buildTextOptions(options))),

  select: <T>(options: SelectOptions<T>) =>
    runPrompt<T>(() => {
      // Build options array - we need to cast through unknown due to exactOptionalPropertyTypes
      // This is safe since our SelectOption type is compatible with clack's Option type
      const clackOpts = options.options.map((opt) => {
        if (opt.hint !== undefined) {
          return { value: opt.value, label: opt.label, hint: opt.hint };
        }
        return { value: opt.value, label: opt.label };
      });

      // Build select options with only defined initialValue
      const selectOpts: clack.SelectOptions<T> = {
        message: options.message,
        options: clackOpts as unknown as clack.SelectOptions<T>["options"],
      };
      if (options.initialValue !== undefined) {
        selectOpts.initialValue = options.initialValue;
      }

      return clack.select(selectOpts);
    }),

  confirm: (options: ConfirmOptions) =>
    runPrompt(() => clack.confirm(buildConfirmOptions(options))),
};

export const PromptsLive = Layer.succeed(Prompts, promptsImpl);
