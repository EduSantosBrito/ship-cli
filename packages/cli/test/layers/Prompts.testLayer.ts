/**
 * Test Layer for Prompts Service
 *
 * Provides a mock Prompts implementation for testing that:
 * - Uses configurable responses for each prompt type
 * - Supports simulating cancellation
 * - Tracks method calls for assertions
 * - Uses in-memory state via Effect Ref
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type { Prompts as PromptsInterface } from "../../src/ports/Prompts.js";
import { Prompts } from "../../src/ports/Prompts.js";
import { PromptCancelledError } from "../../src/domain/Errors.js";

// === Test State Types ===

export interface TestPromptsState {
  /** Queue of text responses (consumed in order) */
  textResponses: string[];
  /** Queue of select responses (consumed in order) */
  selectResponses: unknown[];
  /** Queue of confirm responses (consumed in order) */
  confirmResponses: boolean[];
  /** Whether prompts should simulate cancellation */
  shouldCancel: boolean;
  /** Track method calls for assertions */
  methodCalls: Array<{ method: string; args: unknown[] }>;
}

export const defaultTestPromptsState: TestPromptsState = {
  textResponses: ["default-text-response"],
  selectResponses: [],
  confirmResponses: [true],
  shouldCancel: false,
  methodCalls: [],
};

// === Test Layer Factory ===

/**
 * Creates a test Prompts layer with configurable responses.
 *
 * @example
 * ```typescript
 * // Test successful prompts
 * it.effect("prompts for API key", () =>
 *   Effect.gen(function* () {
 *     const prompts = yield* Prompts;
 *     const result = yield* prompts.text({ message: "API key" });
 *     expect(result).toBe("lin_api_test");
 *   }).pipe(Effect.provide(TestPromptsLayer({ textResponses: ["lin_api_test"] })))
 * );
 *
 * // Test cancellation
 * it.effect("handles cancellation", () =>
 *   Effect.gen(function* () {
 *     const prompts = yield* Prompts;
 *     const exit = yield* prompts.text({ message: "API key" }).pipe(Effect.exit);
 *     expect(Exit.isFailure(exit)).toBe(true);
 *   }).pipe(Effect.provide(TestPromptsLayer({ shouldCancel: true })))
 * );
 * ```
 */
export const TestPromptsLayer = (config?: Partial<TestPromptsState>): Layer.Layer<Prompts> =>
  Layer.effect(
    Prompts,
    Effect.gen(function* () {
      const initialState: TestPromptsState = {
        ...defaultTestPromptsState,
        ...config,
        methodCalls: [],
      };

      const stateRef = yield* Ref.make(initialState);

      const trackCall = (method: string, args: unknown[]) =>
        Ref.update(stateRef, (state) => ({
          ...state,
          methodCalls: [...state.methodCalls, { method, args }],
        }));

      const checkCancel = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.shouldCancel) {
          return yield* Effect.fail(PromptCancelledError.default);
        }
      });

      const service: PromptsInterface = {
        text: (options) =>
          Effect.gen(function* () {
            yield* trackCall("text", [options]);
            yield* checkCancel;

            const state = yield* Ref.get(stateRef);
            const [response, ...rest] = state.textResponses;

            if (response === undefined) {
              // No more responses queued, return empty string
              return "";
            }

            // Consume the response
            yield* Ref.update(stateRef, (s) => ({
              ...s,
              textResponses: rest,
            }));

            return response;
          }),

        select: <T>(options: { message: string; options: ReadonlyArray<{ value: T; label: string; hint?: string }>; initialValue?: T }) =>
          Effect.gen(function* () {
            yield* trackCall("select", [options]);
            yield* checkCancel;

            const state = yield* Ref.get(stateRef);
            const [response, ...rest] = state.selectResponses;

            if (response === undefined) {
              // No response queued, return first option value or fail
              if (options.options.length > 0) {
                return options.options[0].value;
              }
              return yield* Effect.fail(PromptCancelledError.default);
            }

            // Consume the response
            yield* Ref.update(stateRef, (s) => ({
              ...s,
              selectResponses: rest,
            }));

            return response as T;
          }),

        confirm: (options) =>
          Effect.gen(function* () {
            yield* trackCall("confirm", [options]);
            yield* checkCancel;

            const state = yield* Ref.get(stateRef);
            const [response, ...rest] = state.confirmResponses;

            if (response === undefined) {
              // No more responses queued, return true as default
              return true;
            }

            // Consume the response
            yield* Ref.update(stateRef, (s) => ({
              ...s,
              confirmResponses: rest,
            }));

            return response;
          }),
      };

      // Attach state accessor for test assertions
      return Object.assign(service, {
        _getState: () => Ref.get(stateRef),
        _setState: (update: Partial<TestPromptsState>) =>
          Ref.update(stateRef, (s) => ({ ...s, ...update })),
      });
    }),
  );

// Type for the extended service with test helpers
export type TestPrompts = PromptsInterface & {
  _getState: () => Effect.Effect<TestPromptsState>;
  _setState: (update: Partial<TestPromptsState>) => Effect.Effect<void>;
};
