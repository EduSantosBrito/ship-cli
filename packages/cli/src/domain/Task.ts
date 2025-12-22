import * as Schema from "effect/Schema";

// === Branded Types ===

export const TaskId = Schema.String.pipe(Schema.brand("TaskId"));
export type TaskId = typeof TaskId.Type;

export const TeamId = Schema.String.pipe(Schema.brand("TeamId"));
export type TeamId = typeof TeamId.Type;

export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"));
export type ProjectId = typeof ProjectId.Type;

// === Enums ===

// Linear's workflow state types (not custom state names)
export const WorkflowStateType = Schema.Literal(
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
);
export type WorkflowStateType = typeof WorkflowStateType.Type;

// For backwards compatibility - maps to Linear state types
export const TaskStatus = Schema.Literal(
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
);
export type TaskStatus = typeof TaskStatus.Type;

export const Priority = Schema.Literal("urgent", "high", "medium", "low", "none");
export type Priority = typeof Priority.Type;

export const TaskType = Schema.Literal("bug", "feature", "task", "epic", "chore");
export type TaskType = typeof TaskType.Type;

export const DependencyType = Schema.Literal("blocks", "blocked_by", "related", "duplicate");
export type DependencyType = typeof DependencyType.Type;

// === Domain Models ===

export class Dependency extends Schema.Class<Dependency>("Dependency")({
  id: Schema.String,
  type: DependencyType,
  relatedTaskId: TaskId,
}) {}

// Lightweight representation of a subtask for display purposes
export class Subtask extends Schema.Class<Subtask>("Subtask")({
  id: TaskId,
  identifier: Schema.String, // e.g., "ENG-124"
  title: Schema.String,
  state: Schema.String, // State name (e.g., "In Progress")
  stateType: WorkflowStateType, // For determining completion status
}) {
  get isDone(): boolean {
    return this.stateType === "completed" || this.stateType === "canceled";
  }
}

// Workflow state from Linear (custom states)
export class WorkflowState extends Schema.Class<WorkflowState>("WorkflowState")({
  id: Schema.String,
  name: Schema.String,
  type: WorkflowStateType,
}) {}

export class Task extends Schema.Class<Task>("Task")({
  id: TaskId,
  identifier: Schema.String, // e.g., "ENG-123"
  title: Schema.String,
  description: Schema.OptionFromNullOr(Schema.String),
  state: WorkflowState, // The actual Linear state (custom or default)
  priority: Priority,
  type: Schema.OptionFromNullOr(TaskType),
  teamId: TeamId,
  projectId: Schema.OptionFromNullOr(ProjectId),
  branchName: Schema.OptionFromNullOr(Schema.String),
  url: Schema.String,
  labels: Schema.Array(Schema.String),
  blockedBy: Schema.Array(TaskId),
  blocks: Schema.Array(TaskId),
  subtasks: Schema.Array(Subtask),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {
  // Helper to check if task is in a "done" state (completed or canceled)
  get isDone(): boolean {
    return this.state.type === "completed" || this.state.type === "canceled";
  }

  // Helper to check if task is actionable (not done)
  get isActionable(): boolean {
    return !this.isDone;
  }

  // Helper to check if task has subtasks
  get hasSubtasks(): boolean {
    return this.subtasks.length > 0;
  }
}

export class Team extends Schema.Class<Team>("Team")({
  id: TeamId,
  name: Schema.String,
  key: Schema.String, // e.g., "ENG"
}) {}

export class Project extends Schema.Class<Project>("Project")({
  id: ProjectId,
  name: Schema.String,
  teamId: TeamId,
}) {}

// === Input Types ===

export class CreateTaskInput extends Schema.Class<CreateTaskInput>("CreateTaskInput")({
  title: Schema.String,
  description: Schema.OptionFromNullOr(Schema.String),
  priority: Schema.optionalWith(Priority, { default: () => "medium" as const }),
  type: Schema.optionalWith(TaskType, { default: () => "task" as const }),
  projectId: Schema.OptionFromNullOr(ProjectId),
}) {}

export class UpdateTaskInput extends Schema.Class<UpdateTaskInput>("UpdateTaskInput")({
  title: Schema.OptionFromNullOr(Schema.String),
  description: Schema.OptionFromNullOr(Schema.String),
  status: Schema.OptionFromNullOr(TaskStatus),
  priority: Schema.OptionFromNullOr(Priority),
}) {}

export class TaskFilter extends Schema.Class<TaskFilter>("TaskFilter")({
  status: Schema.OptionFromNullOr(TaskStatus),
  priority: Schema.OptionFromNullOr(Priority),
  projectId: Schema.OptionFromNullOr(ProjectId),
  assignedToMe: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}
