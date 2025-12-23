/**
 * Test layer for IssueRepository with in-memory storage.
 *
 * Provides an IssueRepository that stores tasks in memory,
 * allowing integration tests to test issue operations without
 * connecting to Linear.
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { IssueRepository } from "../../../src/ports/IssueRepository.js";
import {
  Task,
  TaskId,
  TeamId,
  WorkflowState,
  WorkflowStateType,
  type CreateTaskInput,
  type TaskFilter,
  type UpdateTaskInput,
  type TaskType,
} from "../../../src/domain/Task.js";
import { TaskNotFoundError } from "../../../src/domain/Errors.js";

/**
 * Test task data for creating tasks.
 */
export interface TestTaskData {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description?: string;
  readonly stateType?: WorkflowStateType;
  readonly priority?: "urgent" | "high" | "medium" | "low" | "none";
  readonly labels?: ReadonlyArray<string>;
  readonly blockedBy?: ReadonlyArray<string>;
  readonly blocks?: ReadonlyArray<string>;
}

/**
 * Create a test task from test data.
 */
const createTestTask = (data: TestTaskData, teamId: string): Task =>
  new Task({
    id: data.id as TaskId,
    identifier: data.identifier,
    title: data.title,
    description: data.description ? Option.some(data.description) : Option.none(),
    state: new WorkflowState({
      id: `state-${data.stateType ?? "backlog"}`,
      name: data.stateType ?? "Backlog",
      type: data.stateType ?? "backlog",
    }),
    priority: data.priority ?? "medium",
    type: Option.none(),
    teamId: teamId as TeamId,
    projectId: Option.none(),
    milestoneId: Option.none(),
    milestoneName: Option.none(),
    branchName: Option.none(),
    url: `https://linear.app/test/issue/${data.identifier}`,
    labels: data.labels ?? [],
    blockedBy: (data.blockedBy ?? []) as ReadonlyArray<TaskId>,
    blocks: (data.blocks ?? []) as ReadonlyArray<TaskId>,
    subtasks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

/**
 * Options for creating the test issue repository.
 */
export interface TestIssueOptions {
  /** Initial tasks to populate the repository */
  readonly initialTasks?: ReadonlyArray<TestTaskData>;
  /** Default team ID for operations */
  readonly teamId?: string;
}

const DEFAULT_OPTIONS: Required<TestIssueOptions> = {
  initialTasks: [],
  teamId: "test-team-id",
};

/**
 * Create an in-memory IssueRepository for testing.
 */
const makeTestIssueRepository = (
  options: TestIssueOptions = {},
): Effect.Effect<IssueRepository, never> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Initialize tasks map with initial data
  const tasks = new Map<string, Task>();
  const blockerRelations = new Map<string, Set<string>>(); // taskId -> blockerIds
  const sessionLabels = new Map<string, string>(); // taskId -> sessionId
  let nextId = 1;

  for (const data of opts.initialTasks) {
    const task = createTestTask(data, opts.teamId);
    tasks.set(data.id, task);
    if (data.blockedBy && data.blockedBy.length > 0) {
      blockerRelations.set(data.id, new Set(data.blockedBy));
    }
  }

  return Effect.succeed({
    getTask: (id: TaskId) => {
      const task = tasks.get(id);
      if (!task) {
        return Effect.fail(new TaskNotFoundError({ taskId: id }));
      }
      return Effect.succeed(task);
    },

    getTaskByIdentifier: (identifier: string) => {
      for (const task of tasks.values()) {
        if (task.identifier === identifier) {
          return Effect.succeed(task);
        }
      }
      return Effect.fail(new TaskNotFoundError({ taskId: identifier as TaskId }));
    },

    createTask: (teamId: TeamId, input: CreateTaskInput) => {
      const id = `task-${nextId++}`;
      const identifier = `TEST-${nextId}`;
      const task = new Task({
        id: id as TaskId,
        identifier,
        title: input.title,
        description: input.description,
        state: new WorkflowState({
          id: "state-backlog",
          name: "Backlog",
          type: "backlog",
        }),
        priority: input.priority,
        type: input.type ? Option.some(input.type) : Option.none(),
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
      tasks.set(id, task);
      return Effect.succeed(task);
    },

    updateTask: (id: TaskId, input: UpdateTaskInput) => {
      const task = tasks.get(id);
      if (!task) {
        return Effect.fail(new TaskNotFoundError({ taskId: id }));
      }

      // Create updated task (simplified - just update title and status for now)
      const stateType = Option.isSome(input.status)
        ? mapStatusToStateType(input.status.value)
        : task.state.type;

      const updated = new Task({
        ...task,
        title: Option.isSome(input.title) ? input.title.value : task.title,
        description: Option.isSome(input.description) ? input.description : task.description,
        priority: Option.isSome(input.priority) ? input.priority.value : task.priority,
        state: new WorkflowState({
          id: `state-${stateType}`,
          name: stateType,
          type: stateType,
        }),
        updatedAt: new Date(),
      });
      tasks.set(id, updated);
      return Effect.succeed(updated);
    },

    listTasks: (teamId: TeamId, filter: TaskFilter) => {
      const result: Task[] = [];
      for (const task of tasks.values()) {
        if (task.teamId !== teamId) continue;
        if (!filter.includeCompleted && task.isDone) continue;
        if (Option.isSome(filter.status)) {
          const expectedState = mapStatusToStateType(filter.status.value);
          if (task.state.type !== expectedState) continue;
        }
        if (Option.isSome(filter.priority) && task.priority !== filter.priority.value) continue;
        result.push(task);
      }
      return Effect.succeed(result);
    },

    getReadyTasks: (teamId: TeamId) => {
      const result: Task[] = [];
      for (const task of tasks.values()) {
        if (task.teamId !== teamId) continue;
        if (task.isDone) continue;
        // Check if not blocked
        const blockers = blockerRelations.get(task.id) ?? new Set();
        if (blockers.size === 0) {
          result.push(task);
        }
      }
      return Effect.succeed(result);
    },

    getBlockedTasks: (teamId: TeamId) => {
      const result: Task[] = [];
      for (const task of tasks.values()) {
        if (task.teamId !== teamId) continue;
        if (task.isDone) continue;
        const blockers = blockerRelations.get(task.id) ?? new Set();
        if (blockers.size > 0) {
          result.push(task);
        }
      }
      return Effect.succeed(result);
    },

    addBlocker: (blockedId: TaskId, blockerId: TaskId) => {
      if (!tasks.has(blockedId)) {
        return Effect.fail(new TaskNotFoundError({ taskId: blockedId }));
      }
      if (!tasks.has(blockerId)) {
        return Effect.fail(new TaskNotFoundError({ taskId: blockerId }));
      }
      const blockers = blockerRelations.get(blockedId) ?? new Set();
      blockers.add(blockerId);
      blockerRelations.set(blockedId, blockers);
      return Effect.void;
    },

    removeBlocker: (blockedId: TaskId, blockerId: TaskId) => {
      const blockers = blockerRelations.get(blockedId);
      if (blockers) {
        blockers.delete(blockerId);
      }
      return Effect.void;
    },

    addRelated: (_taskId: TaskId, _relatedTaskId: TaskId) => {
      // Related relationships not tracked in test implementation
      return Effect.void;
    },

    getBranchName: (id: TaskId) => {
      const task = tasks.get(id);
      if (!task) {
        return Effect.fail(new TaskNotFoundError({ taskId: id }));
      }
      // Generate a simple branch name
      return Effect.succeed(`test/${task.identifier.toLowerCase()}-${task.title.toLowerCase().replace(/\s+/g, "-")}`);
    },

    setSessionLabel: (id: TaskId, sessionId: string) => {
      if (!tasks.has(id)) {
        return Effect.fail(new TaskNotFoundError({ taskId: id }));
      }
      sessionLabels.set(id, sessionId);
      return Effect.void;
    },

    setTypeLabel: (id: TaskId, _type: TaskType) => {
      if (!tasks.has(id)) {
        return Effect.fail(new TaskNotFoundError({ taskId: id }));
      }
      // Type labels not tracked in test implementation
      return Effect.void;
    },

    clearSessionLabel: (id: TaskId) => {
      sessionLabels.delete(id);
      return Effect.void;
    },

    removeAsBlocker: (blockerId: TaskId) => {
      const unblocked: string[] = [];
      for (const [taskId, blockers] of blockerRelations.entries()) {
        if (blockers.has(blockerId)) {
          blockers.delete(blockerId);
          const task = tasks.get(taskId);
          if (task) {
            unblocked.push(task.identifier);
          }
        }
      }
      return Effect.succeed(unblocked);
    },
  } satisfies IssueRepository);
};

/**
 * Map TaskStatus to WorkflowStateType.
 */
const mapStatusToStateType = (
  status: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled",
): WorkflowStateType => {
  switch (status) {
    case "backlog":
      return "backlog";
    case "todo":
      return "unstarted";
    case "in_progress":
    case "in_review":
      return "started";
    case "done":
      return "completed";
    case "cancelled":
      return "canceled";
  }
};

/**
 * Create a test IssueRepository layer with custom options.
 */
export const makeTestIssueLayer = (options: TestIssueOptions = {}) =>
  Layer.effect(IssueRepository, makeTestIssueRepository(options));

/**
 * Default test IssueRepository layer (empty).
 */
export const TestIssueLayer = makeTestIssueLayer();

/**
 * Test IssueRepository layer with sample tasks.
 */
export const TestIssueLayerWithSampleTasks = makeTestIssueLayer({
  initialTasks: [
    {
      id: "task-1",
      identifier: "TEST-1",
      title: "First Task",
      stateType: "backlog",
    },
    {
      id: "task-2",
      identifier: "TEST-2",
      title: "Second Task",
      stateType: "started",
    },
    {
      id: "task-3",
      identifier: "TEST-3",
      title: "Blocked Task",
      stateType: "backlog",
      blockedBy: ["task-1"],
    },
  ],
});
