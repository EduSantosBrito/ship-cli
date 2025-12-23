/**
 * Test Layer for TemplateService
 *
 * Provides a mock TemplateService implementation for testing that:
 * - Uses in-memory state via Effect Ref
 * - Supports configurable initial state
 * - Exposes _getState() for test assertions
 * - Can simulate both success and failure modes
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type { TemplateService as TemplateServiceInterface } from "../../src/ports/TemplateService.js";
import { TemplateService } from "../../src/ports/TemplateService.js";
import { TaskTemplate } from "../../src/domain/Template.js";
import { TemplateNotFoundError, TemplateError } from "../../src/domain/Errors.js";

// === Test State Types ===

export interface TestTemplateState {
  /** Map of template name to TaskTemplate objects */
  templates: Map<string, TaskTemplate>;
  /** Whether templates directory exists */
  hasTemplates: boolean;
  /** Simulated template errors (name -> error) */
  templateErrors: Map<string, TemplateError>;
  /** Global template error (applies to all operations) */
  globalError: TemplateError | null;
  /** Track method calls for assertions */
  methodCalls: Array<{ method: string; args: unknown[] }>;
}

const createTestTemplate = (
  name: string,
  overrides?: Partial<{
    title: string;
    description: string;
    priority: "urgent" | "high" | "medium" | "low" | "none";
    type: "bug" | "feature" | "task" | "epic" | "chore";
  }>,
): TaskTemplate =>
  new TaskTemplate({
    name,
    title: overrides?.title,
    description: overrides?.description,
    priority: overrides?.priority,
    type: overrides?.type,
  });

export const defaultTestTemplateState: TestTemplateState = {
  templates: new Map([
    ["bug", createTestTemplate("bug", {
      title: "fix: {title}",
      description: "## Bug Report\n\n**What happened:**\n{title}",
      priority: "high",
      type: "bug",
    })],
    ["feature", createTestTemplate("feature", {
      title: "feat: {title}",
      description: "## Feature Request\n\n**Description:**\n{title}",
      priority: "medium",
      type: "feature",
    })],
  ]),
  hasTemplates: true,
  templateErrors: new Map(),
  globalError: null,
  methodCalls: [],
};

// === Test Layer Factory ===

/**
 * Creates a test TemplateService layer with configurable initial state.
 *
 * @example
 * ```typescript
 * it.effect("fails with TemplateNotFoundError when template doesn't exist", () =>
 *   Effect.gen(function* () {
 *     const templateSvc = yield* TemplateService;
 *     const exit = yield* Effect.exit(templateSvc.getTemplate("nonexistent"));
 *     expect(Exit.isFailure(exit)).toBe(true);
 *   }).pipe(Effect.provide(TestTemplateServiceLayer({ templates: new Map() })))
 * );
 * ```
 */
export const TestTemplateServiceLayer = (
  config?: Partial<TestTemplateState>,
): Layer.Layer<TemplateService> =>
  Layer.effect(
    TemplateService,
    Effect.gen(function* () {
      const initialState: TestTemplateState = {
        ...defaultTestTemplateState,
        ...config,
        templates: config?.templates ?? new Map(defaultTestTemplateState.templates),
        templateErrors: config?.templateErrors ?? new Map(),
        methodCalls: [],
      };

      const stateRef = yield* Ref.make(initialState);

      const trackCall = (method: string, args: unknown[]) =>
        Ref.update(stateRef, (state) => ({
          ...state,
          methodCalls: [...state.methodCalls, { method, args }],
        }));

      const checkGlobalError = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.globalError) {
          return yield* Effect.fail(state.globalError);
        }
      });

      const checkTemplateError = (name: string) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          const error = state.templateErrors.get(name);
          if (error) {
            return yield* Effect.fail(error);
          }
        });

      const service: TemplateServiceInterface = {
        getTemplate: (name: string) =>
          Effect.gen(function* () {
            yield* trackCall("getTemplate", [name]);
            yield* checkGlobalError;
            yield* checkTemplateError(name);

            const state = yield* Ref.get(stateRef);
            const template = state.templates.get(name);
            if (!template) {
              return yield* Effect.fail(TemplateNotFoundError.forName(name));
            }
            return template;
          }),

        listTemplates: () =>
          Effect.gen(function* () {
            yield* trackCall("listTemplates", []);
            yield* checkGlobalError;

            const state = yield* Ref.get(stateRef);
            return Array.from(state.templates.values());
          }),

        hasTemplates: () =>
          Effect.gen(function* () {
            yield* trackCall("hasTemplates", []);
            const state = yield* Ref.get(stateRef);
            return state.hasTemplates;
          }),
      };

      // Attach state accessor for test assertions
      return Object.assign(service, {
        _getState: () => Ref.get(stateRef),
        _setState: (update: Partial<TestTemplateState>) =>
          Ref.update(stateRef, (s) => ({ ...s, ...update })),
        _addTemplate: (template: TaskTemplate) =>
          Ref.update(stateRef, (s) => {
            const templates = new Map(s.templates);
            templates.set(template.name, template);
            return { ...s, templates };
          }),
      });
    }),
  );

// Type for the extended service with test helpers
export type TestTemplateService = TemplateServiceInterface & {
  _getState: () => Effect.Effect<TestTemplateState>;
  _setState: (update: Partial<TestTemplateState>) => Effect.Effect<void>;
  _addTemplate: (template: TaskTemplate) => Effect.Effect<void>;
};

// Export factory for use in tests
export { createTestTemplate };
