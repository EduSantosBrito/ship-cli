import * as Option from "effect/Option";
import type {
  Issue,
  Team as LinearTeam,
  Project as LinearProject,
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
  WorkflowState,
  WorkflowStateType,
  Subtask,
  type TaskStatus,
} from "../../../domain/Task.js";

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

export const mapIssueToTask = async (issue: Issue, includeSubtasks = true): Promise<Task> => {
  // Fetch related data
  const state = await issue.state;
  const labels = await issue.labels();
  const team = await issue.team;

  // Get blocking relations
  // Note: Linear SDK doesn't directly expose relations, we'll handle this in the repository
  const blockedBy: TaskId[] = [];
  const blocks: TaskId[] = [];

  // Fetch subtasks (children) if requested
  const subtasks: Subtask[] = [];
  if (includeSubtasks) {
    const children = await issue.children();
    if (children?.nodes) {
      for (const child of children.nodes) {
        const childState = await child.state;
        subtasks.push(
          new Subtask({
            id: child.id as TaskId,
            identifier: child.identifier,
            title: child.title,
            state: childState?.name ?? "Unknown",
            stateType: mapStateType(childState?.type ?? "unstarted"),
          }),
        );
      }
    }
  }

  return new Task({
    id: issue.id as TaskId,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ? Option.some(issue.description) : Option.none(),
    state: mapWorkflowState(state),
    priority: mapPriority(issue.priority),
    type: Option.none(), // Linear doesn't have issue types in the same way
    teamId: (team?.id ?? "") as TeamId,
    projectId: Option.none(), // Will be populated if needed
    branchName: issue.branchName ? Option.some(issue.branchName) : Option.none(),
    url: issue.url,
    labels: labels?.nodes?.map((l) => l.name) ?? [],
    blockedBy,
    blocks,
    subtasks,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  });
};

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
