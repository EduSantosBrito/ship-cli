import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type {
  CreateTaskInput,
  Task,
  TaskFilter,
  TaskId,
  TaskType,
  TeamId,
  UpdateTaskInput,
  ProjectId,
} from "../domain/Task.js";
import type { TaskApiError, TaskError, TaskNotFoundError } from "../domain/Errors.js";

export interface IssueRepository {
  /** Get a task by its Linear ID */
  readonly getTask: (id: TaskId) => Effect.Effect<Task, TaskNotFoundError | TaskApiError>;

  /** Get a task by its identifier (e.g., "ENG-123") */
  readonly getTaskByIdentifier: (
    identifier: string,
  ) => Effect.Effect<Task, TaskNotFoundError | TaskApiError>;

  /** Create a new task */
  readonly createTask: (
    teamId: TeamId,
    input: CreateTaskInput,
  ) => Effect.Effect<Task, TaskError | TaskApiError>;

  /** Update an existing task */
  readonly updateTask: (
    id: TaskId,
    input: UpdateTaskInput,
  ) => Effect.Effect<Task, TaskNotFoundError | TaskError | TaskApiError>;

  /** List tasks with optional filters */
  readonly listTasks: (
    teamId: TeamId,
    filter: TaskFilter,
  ) => Effect.Effect<ReadonlyArray<Task>, TaskApiError>;

  /** Get tasks that are ready to work on (not blocked) */
  readonly getReadyTasks: (
    teamId: TeamId,
    projectId?: ProjectId,
  ) => Effect.Effect<ReadonlyArray<Task>, TaskApiError>;

  /** Get tasks that are blocked by other tasks */
  readonly getBlockedTasks: (
    teamId: TeamId,
    projectId?: ProjectId,
  ) => Effect.Effect<ReadonlyArray<Task>, TaskApiError>;

  /** Add a blocking relationship between tasks */
  readonly addBlocker: (
    blockedId: TaskId,
    blockerId: TaskId,
  ) => Effect.Effect<void, TaskNotFoundError | TaskError | TaskApiError>;

  /** Remove a blocking relationship between tasks */
  readonly removeBlocker: (
    blockedId: TaskId,
    blockerId: TaskId,
  ) => Effect.Effect<void, TaskNotFoundError | TaskError | TaskApiError>;

  /** Add a "related" relationship between tasks (enables auto-linking in Linear) */
  readonly addRelated: (
    taskId: TaskId,
    relatedTaskId: TaskId,
  ) => Effect.Effect<void, TaskNotFoundError | TaskError | TaskApiError>;

  /** Get the suggested branch name for a task */
  readonly getBranchName: (id: TaskId) => Effect.Effect<string, TaskNotFoundError | TaskApiError>;

  /** Set the session label on a task (creates label if it doesn't exist, removes old session labels) */
  readonly setSessionLabel: (
    id: TaskId,
    sessionId: string,
  ) => Effect.Effect<void, TaskNotFoundError | TaskError | TaskApiError>;

  /** Set the type label on a task (creates label if it doesn't exist, removes old type labels) */
  readonly setTypeLabel: (
    id: TaskId,
    type: TaskType,
  ) => Effect.Effect<void, TaskNotFoundError | TaskError | TaskApiError>;

  /** Clear session label from a task and delete the label if no other tasks use it */
  readonly clearSessionLabel: (
    id: TaskId,
  ) => Effect.Effect<void, TaskNotFoundError | TaskError | TaskApiError>;

  /** Remove all blocking relationships where this task is the blocker.
   * Returns the identifiers of tasks that were unblocked. */
  readonly removeAsBlocker: (
    blockerId: TaskId,
  ) => Effect.Effect<ReadonlyArray<string>, TaskNotFoundError | TaskApiError>;
}

export const IssueRepository = Context.GenericTag<IssueRepository>("IssueRepository");
