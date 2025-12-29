/**
 * Test Layer for ProjectRepository
 *
 * Provides a mock ProjectRepository implementation for testing that:
 * - Uses in-memory state via Effect Ref
 * - Supports configurable initial state
 * - Exposes _getState() for test assertions
 * - Can simulate both success and failure modes (API errors, etc.)
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type { ProjectRepository as ProjectRepositoryInterface, CreateProjectInput } from "../../src/ports/ProjectRepository.js";
import { ProjectRepository } from "../../src/ports/ProjectRepository.js";
import { Project, ProjectId, TeamId } from "../../src/domain/Task.js";
import { LinearApiError, TaskError } from "../../src/domain/Errors.js";

// === Test State Types ===

export interface TestProjectState {
  /** Map of team ID to projects array */
  projectsByTeam: Map<string, Project[]>;
  /** Global API error (applies to all operations) */
  globalApiError: LinearApiError | null;
  /** Simulated task errors for create operations */
  taskError: TaskError | null;
  /** Track method calls for assertions */
  methodCalls: Array<{ method: string; args: unknown[] }>;
}

// Default test project factory
const createTestProject = (
  overrides: Partial<{
    id: string;
    name: string;
    teamId: string;
  }>,
): Project => {
  return new Project({
    id: (overrides.id ?? "test-project-id") as ProjectId,
    name: overrides.name ?? "Test Project",
    teamId: (overrides.teamId ?? "test-team-id") as TeamId,
  });
};

export const defaultTestProjectState: TestProjectState = {
  projectsByTeam: new Map([["test-team-id", [createTestProject({})]]]),
  globalApiError: null,
  taskError: null,
  methodCalls: [],
};

// === Test Layer Factory ===

/**
 * Creates a test ProjectRepository layer with configurable initial state.
 *
 * @example
 * ```typescript
 * it.effect("lists projects for a team", () =>
 *   Effect.gen(function* () {
 *     const repo = yield* ProjectRepository;
 *     const projects = yield* repo.getProjects("test-team-id" as TeamId);
 *     expect(projects.length).toBe(1);
 *   }).pipe(Effect.provide(TestProjectRepositoryLayer()))
 * );
 * ```
 */
export const TestProjectRepositoryLayer = (
  config?: Partial<TestProjectState>,
): Layer.Layer<ProjectRepository> =>
  Layer.effect(
    ProjectRepository,
    Effect.gen(function* () {
      const initialState: TestProjectState = {
        ...defaultTestProjectState,
        ...config,
        projectsByTeam: config?.projectsByTeam ?? new Map(defaultTestProjectState.projectsByTeam),
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

      const service: ProjectRepositoryInterface = {
        getProjects: (teamId: TeamId) =>
          Effect.gen(function* () {
            yield* trackCall("getProjects", [teamId]);
            yield* checkGlobalApiError;

            const state = yield* Ref.get(stateRef);
            return state.projectsByTeam.get(teamId) ?? [];
          }),

        createProject: (teamId: TeamId, input: CreateProjectInput) =>
          Effect.gen(function* () {
            yield* trackCall("createProject", [teamId, input]);
            yield* checkGlobalApiError;
            yield* checkTaskError;

            const newId = `project-${Date.now()}` as ProjectId;

            const newProject = new Project({
              id: newId,
              name: input.name,
              teamId,
            });

            yield* Ref.update(stateRef, (state) => {
              const projectsByTeam = new Map(state.projectsByTeam);
              const existing = projectsByTeam.get(teamId) ?? [];
              projectsByTeam.set(teamId, [...existing, newProject]);
              return { ...state, projectsByTeam };
            });

            return newProject;
          }),
      };

      // Attach state accessor for test assertions
      return Object.assign(service, {
        _getState: () => Ref.get(stateRef),
        _setState: (update: Partial<TestProjectState>) =>
          Ref.update(stateRef, (s) => ({ ...s, ...update })),
      });
    }),
  );

// Type for the extended service with test helpers
export type TestProjectRepository = ProjectRepositoryInterface & {
  _getState: () => Effect.Effect<TestProjectState>;
  _setState: (update: Partial<TestProjectState>) => Effect.Effect<void>;
};

// Export the test project factory for use in tests
export { createTestProject };
