import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type {
  Issue,
  Team as LinearTeam,
  Project as LinearProject,
  ProjectMilestone as LinearProjectMilestone,
  WorkflowState as LinearWorkflowState,
} from "@linear/sdk";
import {
  Task,
  TaskId,
  Priority,
  Team,
  TeamId,
  Project,
  ProjectId,
  Milestone,
  MilestoneId,
  WorkflowState,
  WorkflowStateType,
  Subtask,
  type TaskStatus,
  type TaskType,
} from "../../../domain/Task.js";
import { LinearApiError } from "../../../domain/Errors.js";

// Prefix for type labels in Linear
export const TYPE_LABEL_PREFIX = "type:";

// Map Linear state type to our WorkflowStateType
const mapStateType = (stateType: string): WorkflowStateType => {
  switch (stateType) {
    case "backlog":
      return "backlog";
    case "unstarted":
      return "unstarted";
    case "started":
      return "started";
    case "completed":
      return "completed";
    case "canceled":
      return "canceled";
    default:
      return "unstarted"; // Safe default
  }
};

// Map Linear WorkflowState to our WorkflowState
const mapWorkflowState = (state: LinearWorkflowState | undefined): WorkflowState => {
  return new WorkflowState({
    id: state?.id ?? "",
    name: state?.name ?? "Unknown",
    type: mapStateType(state?.type ?? "unstarted"),
  });
};

// Map our TaskStatus to Linear state type for filtering/updating
export const statusToLinearStateType = (status: TaskStatus): WorkflowStateType => {
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

// Map Linear priority (0-4, where 0 = no priority, 1 = urgent, 4 = low)
const mapPriority = (priority: number): Priority => {
  switch (priority) {
    case 0:
      return "none";
    case 1:
      return "urgent";
    case 2:
      return "high";
    case 3:
      return "medium";
    case 4:
      return "low";
    default:
      return "none";
  }
};

// Map our Priority to Linear priority number
export const priorityToLinear = (priority: Priority): number => {
  switch (priority) {
    case "urgent":
      return 1;
    case "high":
      return 2;
    case "medium":
      return 3;
    case "low":
      return 4;
    case "none":
      return 0;
  }
};

/**
 * Map a Linear Issue to our Task domain model.
 * Fetches related data (state, labels, team, milestone) in parallel for performance.
 *
 * @param issue - The Linear Issue to map
 * @param includeSubtasks - Whether to fetch and include subtasks (default: true)
 * @returns Effect that resolves to a Task or fails with LinearApiError
 */
export const mapIssueToTask = (
  issue: Issue,
  includeSubtasks = true,
): Effect.Effect<Task, LinearApiError> =>
  Effect.gen(function* () {
    // Fetch related data in parallel for performance
    // Use Effect.promise with async functions to handle potentially undefined LinearFetch values
    const [state, labels, team, milestone] = yield* Effect.all(
      [
        Effect.promise(async () => (issue.state ? await issue.state : undefined)),
        Effect.promise(() => issue.labels()),
        Effect.promise(async () => (issue.team ? await issue.team : undefined)),
        Effect.promise(async () => {
          const milestonePromise = (
            issue as unknown as { projectMilestone?: Promise<{ id: string; name: string } | null> }
          ).projectMilestone;
          return milestonePromise ? await milestonePromise : undefined;
        }),
      ],
      { concurrency: 4 },
    );

    // Get blocking relations
    // Note: Linear SDK doesn't directly expose relations, we'll handle this in the repository
    const blockedBy: TaskId[] = [];
    const blocks: TaskId[] = [];

    // Fetch subtasks (children) if requested
    const subtasks: Subtask[] = [];
    if (includeSubtasks) {
      const children = yield* Effect.promise(() => issue.children());
      if (children?.nodes) {
        // Fetch child states in parallel
        yield* Effect.forEach(
          children.nodes,
          (child) =>
            Effect.gen(function* () {
              const childState = yield* Effect.promise(async () =>
                child.state ? await child.state : undefined,
              );
              subtasks.push(
                new Subtask({
                  id: child.id as TaskId,
                  identifier: child.identifier,
                  title: child.title,
                  state: childState?.name ?? "Unknown",
                  stateType: mapStateType(childState?.type ?? "unstarted"),
                  priority: mapPriority(child.priority),
                }),
              );
            }),
          { concurrency: 5 },
        );
      }
    }

    // Extract type from labels (look for "type:bug", "type:feature", etc.)
    const typeLabel = labels?.nodes?.find((l) => l.name.startsWith(TYPE_LABEL_PREFIX));
    const taskType: Option.Option<TaskType> = typeLabel
      ? Option.some(typeLabel.name.slice(TYPE_LABEL_PREFIX.length) as TaskType)
      : Option.none();

    return new Task({
      id: issue.id as TaskId,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ? Option.some(issue.description) : Option.none(),
      state: mapWorkflowState(state),
      priority: mapPriority(issue.priority),
      type: taskType,
      teamId: (team?.id ?? "") as TeamId,
      projectId: Option.none(), // Will be populated if needed
      milestoneId: milestone ? Option.some(milestone.id as MilestoneId) : Option.none(),
      milestoneName: milestone ? Option.some(milestone.name) : Option.none(),
      branchName: issue.branchName ? Option.some(issue.branchName) : Option.none(),
      url: issue.url,
      labels: labels?.nodes?.map((l) => l.name) ?? [],
      blockedBy,
      blocks,
      subtasks,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    });
  }).pipe(
    Effect.mapError(
      (e) => new LinearApiError({ message: `Failed to map issue to task: ${e}`, cause: e }),
    ),
  );

export const mapTeam = (team: LinearTeam): Team =>
  new Team({
    id: team.id as TeamId,
    name: team.name,
    key: team.key,
  });

export const mapProject = (project: LinearProject, teamId: string): Project =>
  new Project({
    id: project.id as ProjectId,
    name: project.name,
    teamId: teamId as TeamId,
  });

export const mapMilestone = (milestone: LinearProjectMilestone, projectId: string): Milestone =>
  new Milestone({
    id: milestone.id as MilestoneId,
    name: milestone.name,
    description: milestone.description ? Option.some(milestone.description) : Option.none(),
    projectId: projectId as ProjectId,
    targetDate: milestone.targetDate ? Option.some(new Date(milestone.targetDate)) : Option.none(),
    sortOrder: milestone.sortOrder,
  });
