/**
 * Test Layer for TeamRepository
 *
 * Provides a mock TeamRepository implementation for testing that:
 * - Uses in-memory state via Effect Ref
 * - Supports configurable initial state
 * - Exposes _getState() for test assertions
 * - Can simulate both success and failure modes (API errors, etc.)
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type { TeamRepository as TeamRepositoryInterface, CreateTeamInput } from "../../src/ports/TeamRepository.js";
import { TeamRepository } from "../../src/ports/TeamRepository.js";
import { Team, TeamId } from "../../src/domain/Task.js";
import { LinearApiError, TaskError, TeamNotFoundError } from "../../src/domain/Errors.js";

// === Test State Types ===

export interface TestTeamState {
  /** Array of Team objects */
  teams: Team[];
  /** Global API error (applies to all operations) */
  globalApiError: LinearApiError | null;
  /** Simulated task errors for create operations */
  taskError: TaskError | null;
  /** Track method calls for assertions */
  methodCalls: Array<{ method: string; args: unknown[] }>;
}

// Default test team factory
const createTestTeam = (
  overrides: Partial<{
    id: string;
    name: string;
    key: string;
  }>,
): Team => {
  return new Team({
    id: (overrides.id ?? "test-team-id") as TeamId,
    name: overrides.name ?? "Test Team",
    key: overrides.key ?? "TEST",
  });
};

export const defaultTestTeamState: TestTeamState = {
  teams: [createTestTeam({})],
  globalApiError: null,
  taskError: null,
  methodCalls: [],
};

// === Test Layer Factory ===

/**
 * Creates a test TeamRepository layer with configurable initial state.
 *
 * @example
 * ```typescript
 * it.effect("lists teams successfully", () =>
 *   Effect.gen(function* () {
 *     const repo = yield* TeamRepository;
 *     const teams = yield* repo.getTeams();
 *     expect(teams.length).toBe(1);
 *   }).pipe(Effect.provide(TestTeamRepositoryLayer()))
 * );
 * ```
 */
export const TestTeamRepositoryLayer = (
  config?: Partial<TestTeamState>,
): Layer.Layer<TeamRepository> =>
  Layer.effect(
    TeamRepository,
    Effect.gen(function* () {
      const initialState: TestTeamState = {
        ...defaultTestTeamState,
        ...config,
        teams: config?.teams ?? [...defaultTestTeamState.teams],
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

      const service: TeamRepositoryInterface = {
        getTeams: () =>
          Effect.gen(function* () {
            yield* trackCall("getTeams", []);
            yield* checkGlobalApiError;

            const state = yield* Ref.get(stateRef);
            return state.teams;
          }),

        getTeam: (id: TeamId) =>
          Effect.gen(function* () {
            yield* trackCall("getTeam", [id]);
            yield* checkGlobalApiError;

            const state = yield* Ref.get(stateRef);
            const team = state.teams.find((t) => t.id === id);
            if (!team) {
              return yield* Effect.fail(new TeamNotFoundError({ teamId: id }));
            }
            return team;
          }),

        createTeam: (input: CreateTeamInput) =>
          Effect.gen(function* () {
            yield* trackCall("createTeam", [input]);
            yield* checkGlobalApiError;
            yield* checkTaskError;

            const newId = `team-${Date.now()}` as TeamId;

            const newTeam = new Team({
              id: newId,
              name: input.name,
              key: input.key,
            });

            yield* Ref.update(stateRef, (state) => ({
              ...state,
              teams: [...state.teams, newTeam],
            }));

            return newTeam;
          }),
      };

      // Attach state accessor for test assertions
      return Object.assign(service, {
        _getState: () => Ref.get(stateRef),
        _setState: (update: Partial<TestTeamState>) =>
          Ref.update(stateRef, (s) => ({ ...s, ...update })),
      });
    }),
  );

// Type for the extended service with test helpers
export type TestTeamRepository = TeamRepositoryInterface & {
  _getState: () => Effect.Effect<TestTeamState>;
  _setState: (update: Partial<TestTeamState>) => Effect.Effect<void>;
};

// Export the test team factory for use in tests
export { createTestTeam };
