/**
 * Test Layer for MilestoneRepository
 *
 * Provides a mock MilestoneRepository implementation for testing that:
 * - Uses in-memory state via Effect Ref
 * - Supports configurable initial state
 * - Exposes _getState() for test assertions
 * - Can simulate both success and failure modes (API errors, not found, etc.)
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";
import type { MilestoneRepository as MilestoneRepositoryInterface } from "../../src/ports/MilestoneRepository.js";
import { MilestoneRepository } from "../../src/ports/MilestoneRepository.js";
import {
  Milestone,
  MilestoneId,
  ProjectId,
  type CreateMilestoneInput,
  type UpdateMilestoneInput,
} from "../../src/domain/Task.js";
import { MilestoneNotFoundError, LinearApiError, TaskError } from "../../src/domain/Errors.js";

// === Test State Types ===

export interface TestMilestoneState {
  /** Map of milestone ID to Milestone objects */
  milestones: Map<string, Milestone>;
  /** Simulated API errors (milestone ID -> error) */
  apiErrors: Map<string, LinearApiError>;
  /** Global API error (applies to all operations) */
  globalApiError: LinearApiError | null;
  /** Simulated task errors for create/update operations */
  taskError: TaskError | null;
  /** Track method calls for assertions */
  methodCalls: Array<{ method: string; args: unknown[] }>;
}

// Default test milestone factory
const createTestMilestone = (
  overrides: Partial<{
    id: string;
    name: string;
    description: string | null;
    projectId: string;
    targetDate: Date | null;
    sortOrder: number;
  }>,
): Milestone => {
  const id = overrides.id ?? "test-milestone-id";

  return new Milestone({
    id: id as MilestoneId,
    name: overrides.name ?? "Test Milestone",
    description: Option.fromNullable(overrides.description ?? null),
    projectId: (overrides.projectId ?? "test-project-id") as ProjectId,
    targetDate: Option.fromNullable(overrides.targetDate ?? null),
    sortOrder: overrides.sortOrder ?? 0,
  });
};

export const defaultTestMilestoneState: TestMilestoneState = {
  milestones: new Map([["test-milestone-id", createTestMilestone({})]]),
  apiErrors: new Map(),
  globalApiError: null,
  taskError: null,
  methodCalls: [],
};

// === Test Layer Factory ===

/**
 * Creates a test MilestoneRepository layer with configurable initial state.
 *
 * @example
 * ```typescript
 * it.effect("fails with MilestoneNotFoundError when milestone doesn't exist", () =>
 *   Effect.gen(function* () {
 *     const repo = yield* MilestoneRepository;
 *     const exit = yield* Effect.exit(repo.getMilestone("nonexistent" as MilestoneId));
 *     expect(Exit.isFailure(exit)).toBe(true);
 *   }).pipe(Effect.provide(TestMilestoneRepositoryLayer({ milestones: new Map() })))
 * );
 * ```
 */
export const TestMilestoneRepositoryLayer = (
  config?: Partial<TestMilestoneState>,
): Layer.Layer<MilestoneRepository> =>
  Layer.effect(
    MilestoneRepository,
    Effect.gen(function* () {
      const initialState: TestMilestoneState = {
        ...defaultTestMilestoneState,
        ...config,
        milestones: config?.milestones ?? new Map(defaultTestMilestoneState.milestones),
        apiErrors: config?.apiErrors ?? new Map(),
        methodCalls: [],
      };

      const stateRef = yield* Ref.make(initialState);

      const trackCall = (method: string, args: unknown[]) =>
        Ref.update(stateRef, (state) => ({
          ...state,
          methodCalls: [...state.methodCalls, { method, args }],
        }));

      const checkGlobalApiError = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.globalApiError) {
          return yield* Effect.fail(state.globalApiError);
        }
      });

      const checkTaskError = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.taskError) {
          return yield* Effect.fail(state.taskError);
        }
      });

      const checkMilestoneApiError = (milestoneId: string) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          const error = state.apiErrors.get(milestoneId);
          if (error) {
            return yield* Effect.fail(error);
          }
        });

      const getMilestoneOrFail = (milestoneId: string) =>
        Effect.gen(function* () {
          yield* checkGlobalApiError;
          yield* checkMilestoneApiError(milestoneId);

          const state = yield* Ref.get(stateRef);
          const milestone = state.milestones.get(milestoneId);
          if (!milestone) {
            return yield* Effect.fail(new MilestoneNotFoundError({ milestoneId }));
          }
          return milestone;
        });

      const service: MilestoneRepositoryInterface = {
        getMilestone: (id: MilestoneId) =>
          Effect.gen(function* () {
            yield* trackCall("getMilestone", [id]);
            return yield* getMilestoneOrFail(id);
          }),

        listMilestones: (projectId: ProjectId) =>
          Effect.gen(function* () {
            yield* trackCall("listMilestones", [projectId]);
            yield* checkGlobalApiError;

            const state = yield* Ref.get(stateRef);
            const milestones = Array.from(state.milestones.values()).filter(
              (m) => m.projectId === projectId,
            );
            return milestones;
          }),

        createMilestone: (projectId: ProjectId, input: CreateMilestoneInput) =>
          Effect.gen(function* () {
            yield* trackCall("createMilestone", [projectId, input]);
            yield* checkGlobalApiError;
            yield* checkTaskError;

            const newId = `milestone-${Date.now()}` as MilestoneId;

            const newMilestone = new Milestone({
              id: newId,
              name: input.name,
              description: input.description,
              projectId,
              targetDate: input.targetDate,
              sortOrder: input.sortOrder,
            });

            yield* Ref.update(stateRef, (state) => {
              const milestones = new Map(state.milestones);
              milestones.set(newId, newMilestone);
              return { ...state, milestones };
            });

            return newMilestone;
          }),

        updateMilestone: (id: MilestoneId, input: UpdateMilestoneInput) =>
          Effect.gen(function* () {
            yield* trackCall("updateMilestone", [id, input]);
            yield* checkTaskError;
            const milestone = yield* getMilestoneOrFail(id);

            const updatedMilestone = new Milestone({
              ...milestone,
              name: Option.getOrElse(input.name, () => milestone.name),
              description: Option.isSome(input.description)
                ? input.description
                : milestone.description,
              targetDate: Option.isSome(input.targetDate) ? input.targetDate : milestone.targetDate,
              sortOrder: Option.getOrElse(input.sortOrder, () => milestone.sortOrder),
            });

            yield* Ref.update(stateRef, (state) => {
              const milestones = new Map(state.milestones);
              milestones.set(id, updatedMilestone);
              return { ...state, milestones };
            });

            return updatedMilestone;
          }),

        deleteMilestone: (id: MilestoneId) =>
          Effect.gen(function* () {
            yield* trackCall("deleteMilestone", [id]);
            yield* getMilestoneOrFail(id);

            yield* Ref.update(stateRef, (state) => {
              const milestones = new Map(state.milestones);
              milestones.delete(id);
              return { ...state, milestones };
            });
          }),
      };

      // Attach state accessor for test assertions
      return Object.assign(service, {
        _getState: () => Ref.get(stateRef),
        _setState: (update: Partial<TestMilestoneState>) =>
          Ref.update(stateRef, (s) => ({ ...s, ...update })),
      });
    }),
  );

// Type for the extended service with test helpers
export type TestMilestoneRepository = MilestoneRepositoryInterface & {
  _getState: () => Effect.Effect<TestMilestoneState>;
  _setState: (update: Partial<TestMilestoneState>) => Effect.Effect<void>;
};

// Export the test milestone factory for use in tests
export { createTestMilestone };
