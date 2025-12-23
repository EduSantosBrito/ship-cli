/**
 * Test Layer for IssueRepository
 *
 * Provides a mock IssueRepository implementation for testing that:
 * - Uses in-memory state via Effect Ref
 * - Supports configurable initial state
 * - Exposes _getState() for test assertions
 * - Can simulate both success and failure modes (API errors, not found, etc.)
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";
import type { IssueRepository as IssueRepositoryInterface } from "../../src/ports/IssueRepository.js";
import { IssueRepository } from "../../src/ports/IssueRepository.js";
import {
  Task,
  TaskId,
  TeamId,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  WorkflowState,
  type TaskType,
  type ProjectId,
} from "../../src/domain/Task.js";
import { TaskNotFoundError, LinearApiError } from "../../src/domain/Errors.js";

// === Test State Types ===

export interface TestIssueState {
  /** Map of task ID to Task objects */
  tasks: Map<string, Task>;
  /** Map of task ID to array of blocker task IDs */
  blockers: Map<string, string[]>;
  /** Map of task ID to array of related task IDs */
  related: Map<string, string[]>;
  /** Simulated API errors (task ID -> error) */
  apiErrors: Map<string, LinearApiError>;
  /** Global API error (applies to all operations) */
  globalApiError: LinearApiError | null;
  /** Track method calls for assertions */
  methodCalls: Array<{ method: string; args: unknown[] }>;
}

// Default test task factory
const createTestTask = (overrides: Partial<{
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  stateType: "backlog" | "unstarted" | "started" | "completed" | "canceled";
  stateName: string;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  type: TaskType | null;
  teamId: string;
  projectId: string | null;
  branchName: string | null;
  labels: string[];
  blockedBy: string[];
  blocks: string[];
}>): Task => {
  const id = overrides.id ?? "test-task-id";
  const stateType = overrides.stateType ?? "unstarted";
  const stateName = overrides.stateName ?? "Todo";

  return new Task({
    id: id as TaskId,
    identifier: overrides.identifier ?? "TEST-123",
    title: overrides.title ?? "Test Task",
    description: Option.fromNullable(overrides.description ?? null),
    state: new WorkflowState({
      id: `state-${stateType}`,
      name: stateName,
      type: stateType,
    }),
    priority: overrides.priority ?? "medium",
    type: Option.fromNullable(overrides.type ?? null),
    teamId: (overrides.teamId ?? "test-team-id") as TeamId,
    projectId: Option.fromNullable(overrides.projectId as ProjectId | null ?? null),
    milestoneId: Option.none(),
    milestoneName: Option.none(),
    branchName: Option.fromNullable(overrides.branchName ?? null),
    url: `https://linear.app/test/issue/${overrides.identifier ?? "TEST-123"}`,
    labels: overrides.labels ?? [],
    blockedBy: (overrides.blockedBy ?? []) as TaskId[],
    blocks: (overrides.blocks ?? []) as TaskId[],
    subtasks: [],
    createdAt: new Date("2024-01-15T10:00:00Z"),
    updatedAt: new Date("2024-01-15T10:00:00Z"),
  });
};

export const defaultTestIssueState: TestIssueState = {
  tasks: new Map([
    ["test-task-id", createTestTask({})],
  ]),
  blockers: new Map(),
  related: new Map(),
  apiErrors: new Map(),
  globalApiError: null,
  methodCalls: [],
};

// === Test Layer Factory ===

/**
 * Creates a test IssueRepository layer with configurable initial state.
 *
 * @example
 * ```typescript
 * it.effect("fails with TaskNotFoundError when task doesn't exist", () =>
 *   Effect.gen(function* () {
 *     const repo = yield* IssueRepository;
 *     const exit = yield* Effect.exit(repo.getTask("nonexistent" as TaskId));
 *     expect(Exit.isFailure(exit)).toBe(true);
 *   }).pipe(Effect.provide(TestIssueRepositoryLayer({ tasks: new Map() })))
 * );
 * ```
 */
export const TestIssueRepositoryLayer = (
  config?: Partial<TestIssueState>,
): Layer.Layer<IssueRepository> =>
  Layer.effect(
    IssueRepository,
    Effect.gen(function* () {
      const initialState: TestIssueState = {
        ...defaultTestIssueState,
        ...config,
        tasks: config?.tasks ?? new Map(defaultTestIssueState.tasks),
        blockers: config?.blockers ?? new Map(),
        related: config?.related ?? new Map(),
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

      const checkTaskApiError = (taskId: string) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          const error = state.apiErrors.get(taskId);
          if (error) {
            return yield* Effect.fail(error);
          }
        });

      const getTaskOrFail = (taskId: string) =>
        Effect.gen(function* () {
          yield* checkGlobalApiError;
          yield* checkTaskApiError(taskId);

          const state = yield* Ref.get(stateRef);
          const task = state.tasks.get(taskId);
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ taskId }));
          }
          return task;
        });

      const service: IssueRepositoryInterface = {
        getTask: (id: TaskId) =>
          Effect.gen(function* () {
            yield* trackCall("getTask", [id]);
            return yield* getTaskOrFail(id);
          }),

        getTaskByIdentifier: (identifier: string) =>
          Effect.gen(function* () {
            yield* trackCall("getTaskByIdentifier", [identifier]);
            yield* checkGlobalApiError;

            const state = yield* Ref.get(stateRef);
            const task = Array.from(state.tasks.values()).find(
              (t) => t.identifier === identifier,
            );
            if (!task) {
              return yield* Effect.fail(new TaskNotFoundError({ taskId: identifier }));
            }
            return task;
          }),

        createTask: (teamId: TeamId, input: CreateTaskInput) =>
          Effect.gen(function* () {
            yield* trackCall("createTask", [teamId, input]);
            yield* checkGlobalApiError;

            const newId = `task-${Date.now()}` as TaskId;
            const identifier = `TEST-${Math.floor(Math.random() * 1000)}`;

            const newTask = new Task({
              id: newId,
              identifier,
              title: input.title,
              description: input.description,
              state: new WorkflowState({
                id: "state-unstarted",
                name: "Todo",
                type: "unstarted",
              }),
              priority: input.priority,
              type: Option.fromNullable(input.type ?? null),
              teamId,
              projectId: input.projectId,
              milestoneId: input.milestoneId,
              milestoneName: Option.none(),
              branchName: Option.none(),
              url: `https://linear.app/test/issue/${identifier}`,
              labels: [],
              blockedBy: [],
              blocks: [],
              subtasks: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            yield* Ref.update(stateRef, (state) => {
              const tasks = new Map(state.tasks);
              tasks.set(newId, newTask);
              return { ...state, tasks };
            });

            return newTask;
          }),

        updateTask: (id: TaskId, input: UpdateTaskInput) =>
          Effect.gen(function* () {
            yield* trackCall("updateTask", [id, input]);
            const task = yield* getTaskOrFail(id);

            const updatedTask = new Task({
              ...task,
              title: Option.getOrElse(input.title, () => task.title),
              description: Option.isSome(input.description) ? input.description : task.description,
              priority: Option.getOrElse(input.priority, () => task.priority),
              updatedAt: new Date(),
            });

            yield* Ref.update(stateRef, (state) => {
              const tasks = new Map(state.tasks);
              tasks.set(id, updatedTask);
              return { ...state, tasks };
            });

            return updatedTask;
          }),

        listTasks: (teamId: TeamId, filter: TaskFilter) =>
          Effect.gen(function* () {
            yield* trackCall("listTasks", [teamId, filter]);
            yield* checkGlobalApiError;

            const state = yield* Ref.get(stateRef);
            let tasks = Array.from(state.tasks.values()).filter(
              (t) => t.teamId === teamId,
            );

            // Apply filters
            if (Option.isSome(filter.priority)) {
              tasks = tasks.filter((t) => t.priority === Option.getOrThrow(filter.priority));
            }
            if (Option.isSome(filter.projectId)) {
              tasks = tasks.filter(
                (t) =>
                  Option.isSome(t.projectId) &&
                  Option.getOrThrow(t.projectId) === Option.getOrThrow(filter.projectId),
              );
            }
            if (!filter.includeCompleted) {
              tasks = tasks.filter((t) => !t.isDone);
            }

            return tasks;
          }),

        getReadyTasks: (teamId: TeamId, projectId?: ProjectId) =>
          Effect.gen(function* () {
            yield* trackCall("getReadyTasks", [teamId, projectId]);
            yield* checkGlobalApiError;

            const state = yield* Ref.get(stateRef);
            let tasks = Array.from(state.tasks.values()).filter(
              (t) => t.teamId === teamId && !t.isDone,
            );

            // Filter to tasks with no blockers
            tasks = tasks.filter((t) => t.blockedBy.length === 0);

            if (projectId) {
              tasks = tasks.filter(
                (t) =>
                  Option.isSome(t.projectId) && Option.getOrThrow(t.projectId) === projectId,
              );
            }

            return tasks;
          }),

        getBlockedTasks: (teamId: TeamId, projectId?: ProjectId) =>
          Effect.gen(function* () {
            yield* trackCall("getBlockedTasks", [teamId, projectId]);
            yield* checkGlobalApiError;

            const state = yield* Ref.get(stateRef);
            let tasks = Array.from(state.tasks.values()).filter(
              (t) => t.teamId === teamId && !t.isDone && t.blockedBy.length > 0,
            );

            if (projectId) {
              tasks = tasks.filter(
                (t) =>
                  Option.isSome(t.projectId) && Option.getOrThrow(t.projectId) === projectId,
              );
            }

            return tasks;
          }),

        addBlocker: (blockedId: TaskId, blockerId: TaskId) =>
          Effect.gen(function* () {
            yield* trackCall("addBlocker", [blockedId, blockerId]);
            yield* getTaskOrFail(blockedId);
            yield* getTaskOrFail(blockerId);

            yield* Ref.update(stateRef, (state) => {
              const tasks = new Map(state.tasks);
              const blocked = tasks.get(blockedId);
              if (blocked) {
                tasks.set(
                  blockedId,
                  new Task({
                    ...blocked,
                    blockedBy: [...blocked.blockedBy, blockerId],
                  }),
                );
              }
              const blocker = tasks.get(blockerId);
              if (blocker) {
                tasks.set(
                  blockerId,
                  new Task({
                    ...blocker,
                    blocks: [...blocker.blocks, blockedId],
                  }),
                );
              }
              return { ...state, tasks };
            });
          }),

        removeBlocker: (blockedId: TaskId, blockerId: TaskId) =>
          Effect.gen(function* () {
            yield* trackCall("removeBlocker", [blockedId, blockerId]);
            yield* getTaskOrFail(blockedId);
            yield* getTaskOrFail(blockerId);

            yield* Ref.update(stateRef, (state) => {
              const tasks = new Map(state.tasks);
              const blocked = tasks.get(blockedId);
              if (blocked) {
                tasks.set(
                  blockedId,
                  new Task({
                    ...blocked,
                    blockedBy: blocked.blockedBy.filter((id) => id !== blockerId),
                  }),
                );
              }
              const blocker = tasks.get(blockerId);
              if (blocker) {
                tasks.set(
                  blockerId,
                  new Task({
                    ...blocker,
                    blocks: blocker.blocks.filter((id) => id !== blockedId),
                  }),
                );
              }
              return { ...state, tasks };
            });
          }),

        addRelated: (taskId: TaskId, relatedTaskId: TaskId) =>
          Effect.gen(function* () {
            yield* trackCall("addRelated", [taskId, relatedTaskId]);
            yield* getTaskOrFail(taskId);
            yield* getTaskOrFail(relatedTaskId);

            yield* Ref.update(stateRef, (state) => {
              const related = new Map(state.related);
              const existing = related.get(taskId) ?? [];
              related.set(taskId, [...existing, relatedTaskId]);
              return { ...state, related };
            });
          }),

        getBranchName: (id: TaskId) =>
          Effect.gen(function* () {
            yield* trackCall("getBranchName", [id]);
            const task = yield* getTaskOrFail(id);

            return Option.getOrElse(task.branchName, () => {
              const slug = task.title.toLowerCase().replace(/\s+/g, "-").slice(0, 30);
              return `${task.identifier.toLowerCase()}-${slug}`;
            });
          }),

        setSessionLabel: (id: TaskId, sessionId: string) =>
          Effect.gen(function* () {
            yield* trackCall("setSessionLabel", [id, sessionId]);
            const task = yield* getTaskOrFail(id);

            yield* Ref.update(stateRef, (state) => {
              const tasks = new Map(state.tasks);
              // Remove old session labels
              const filteredLabels = task.labels.filter((l) => !l.startsWith("session:"));
              tasks.set(
                id,
                new Task({
                  ...task,
                  labels: [...filteredLabels, `session:${sessionId}`],
                }),
              );
              return { ...state, tasks };
            });
          }),

        setTypeLabel: (id: TaskId, type: TaskType) =>
          Effect.gen(function* () {
            yield* trackCall("setTypeLabel", [id, type]);
            const task = yield* getTaskOrFail(id);

            yield* Ref.update(stateRef, (state) => {
              const tasks = new Map(state.tasks);
              // Remove old type labels
              const filteredLabels = task.labels.filter((l) => !l.startsWith("type:"));
              tasks.set(
                id,
                new Task({
                  ...task,
                  labels: [...filteredLabels, `type:${type}`],
                  type: Option.some(type),
                }),
              );
              return { ...state, tasks };
            });
          }),

        clearSessionLabel: (id: TaskId) =>
          Effect.gen(function* () {
            yield* trackCall("clearSessionLabel", [id]);
            const task = yield* getTaskOrFail(id);

            yield* Ref.update(stateRef, (state) => {
              const tasks = new Map(state.tasks);
              tasks.set(
                id,
                new Task({
                  ...task,
                  labels: task.labels.filter((l) => !l.startsWith("session:")),
                }),
              );
              return { ...state, tasks };
            });
          }),

        removeAsBlocker: (blockerId: TaskId) =>
          Effect.gen(function* () {
            yield* trackCall("removeAsBlocker", [blockerId]);
            yield* getTaskOrFail(blockerId);

            const unblockedIdentifiers: string[] = [];

            yield* Ref.update(stateRef, (s) => {
              const tasks = new Map(s.tasks);
              for (const [id, task] of tasks) {
                if (task.blockedBy.includes(blockerId)) {
                  unblockedIdentifiers.push(task.identifier);
                  tasks.set(
                    id,
                    new Task({
                      ...task,
                      blockedBy: task.blockedBy.filter((bid) => bid !== blockerId),
                    }),
                  );
                }
              }
              // Also update the blocker's blocks list
              const blocker = tasks.get(blockerId);
              if (blocker) {
                tasks.set(
                  blockerId,
                  new Task({
                    ...blocker,
                    blocks: [],
                  }),
                );
              }
              return { ...s, tasks };
            });

            return unblockedIdentifiers;
          }),
      };

      // Attach state accessor for test assertions
      return Object.assign(service, {
        _getState: () => Ref.get(stateRef),
        _setState: (update: Partial<TestIssueState>) =>
          Ref.update(stateRef, (s) => ({ ...s, ...update })),
      });
    }),
  );

// Type for the extended service with test helpers
export type TestIssueRepository = IssueRepositoryInterface & {
  _getState: () => Effect.Effect<TestIssueState>;
  _setState: (update: Partial<TestIssueState>) => Effect.Effect<void>;
};

// Export the test task factory for use in tests
export { createTestTask };
