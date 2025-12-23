/**
 * Task domain fixtures for testing.
 *
 * Provides factory functions that produce valid Task domain objects
 * with sensible defaults, supporting partial overrides.
 */

import { Option } from "effect"
import {
  Task,
  TaskId,
  TeamId,
  ProjectId,
  MilestoneId,
  Subtask,
  WorkflowState,
  Dependency,
  Team,
  Project,
  Milestone,
  type WorkflowStateType,
  type Priority,
  type TaskType,
  type DependencyType,
} from "../../src/domain/Task.js"

// === WorkflowState Fixtures ===

export interface WorkflowStateInput {
  id?: string
  name?: string
  type?: WorkflowStateType
}

export const makeWorkflowState = (
  overrides: WorkflowStateInput = {},
): WorkflowState =>
  new WorkflowState({
    id: overrides.id ?? "state-1",
    name: overrides.name ?? "In Progress",
    type: overrides.type ?? "started",
  })

// === Subtask Fixtures ===

export interface SubtaskInput {
  id?: TaskId
  identifier?: string
  title?: string
  state?: string
  stateType?: WorkflowStateType
  priority?: Priority
}

export const makeSubtask = (overrides: SubtaskInput = {}): Subtask =>
  new Subtask({
    id: (overrides.id ?? "subtask-1") as TaskId,
    identifier: overrides.identifier ?? "TEST-SUB-1",
    title: overrides.title ?? "Test Subtask",
    state: overrides.state ?? "In Progress",
    stateType: overrides.stateType ?? "started",
    priority: overrides.priority ?? "medium",
  })

// === Task Fixtures ===

export interface TaskInput {
  id?: TaskId
  identifier?: string
  title?: string
  description?: string | null
  state?: WorkflowState
  stateType?: WorkflowStateType
  priority?: Priority
  type?: TaskType | null
  teamId?: TeamId
  projectId?: ProjectId | null
  milestoneId?: MilestoneId | null
  milestoneName?: string | null
  branchName?: string | null
  url?: string
  labels?: string[]
  blockedBy?: TaskId[]
  blocks?: TaskId[]
  subtasks?: Subtask[]
  createdAt?: Date
  updatedAt?: Date
}

export const makeTask = (overrides: TaskInput = {}): Task => {
  // Build state - use provided state, or create from stateType, or use default
  const state =
    overrides.state ??
    (overrides.stateType !== undefined
      ? makeWorkflowState({ type: overrides.stateType })
      : makeWorkflowState())

  return new Task({
    id: (overrides.id ?? "task-1") as TaskId,
    identifier: overrides.identifier ?? "TEST-1",
    title: overrides.title ?? "Test Task",
    description:
      overrides.description === null
        ? Option.none()
        : Option.fromNullable(overrides.description ?? "Test task description"),
    state,
    priority: overrides.priority ?? "medium",
    type:
      overrides.type === null
        ? Option.none()
        : Option.fromNullable(overrides.type),
    teamId: (overrides.teamId ?? "team-1") as TeamId,
    projectId:
      overrides.projectId === null
        ? Option.none()
        : Option.fromNullable(overrides.projectId as ProjectId | undefined),
    milestoneId:
      overrides.milestoneId === null
        ? Option.none()
        : Option.fromNullable(overrides.milestoneId as MilestoneId | undefined),
    milestoneName:
      overrides.milestoneName === null
        ? Option.none()
        : Option.fromNullable(overrides.milestoneName),
    branchName:
      overrides.branchName === null
        ? Option.none()
        : Option.fromNullable(overrides.branchName),
    url: overrides.url ?? "https://linear.app/test/issue/TEST-1",
    labels: overrides.labels ?? [],
    blockedBy: overrides.blockedBy ?? [],
    blocks: overrides.blocks ?? [],
    subtasks: overrides.subtasks ?? [],
    createdAt: overrides.createdAt ?? new Date("2024-01-01"),
    updatedAt: overrides.updatedAt ?? new Date("2024-01-01"),
  })
}

// === Dependency Fixtures ===

export interface DependencyInput {
  id?: string
  type?: DependencyType
  relatedTaskId?: TaskId
}

export const makeDependency = (overrides: DependencyInput = {}): Dependency =>
  new Dependency({
    id: overrides.id ?? "dep-1",
    type: overrides.type ?? "blocks",
    relatedTaskId: (overrides.relatedTaskId ?? "task-2") as TaskId,
  })

// === Team Fixtures ===

export interface TeamInput {
  id?: TeamId
  name?: string
  key?: string
}

export const makeTeam = (overrides: TeamInput = {}): Team =>
  new Team({
    id: (overrides.id ?? "team-1") as TeamId,
    name: overrides.name ?? "Engineering",
    key: overrides.key ?? "ENG",
  })

// === Project Fixtures ===

export interface ProjectInput {
  id?: ProjectId
  name?: string
  teamId?: TeamId
}

export const makeProject = (overrides: ProjectInput = {}): Project =>
  new Project({
    id: (overrides.id ?? "proj-1") as ProjectId,
    name: overrides.name ?? "Test Project",
    teamId: (overrides.teamId ?? "team-1") as TeamId,
  })

// === Milestone Fixtures ===

export interface MilestoneInput {
  id?: MilestoneId
  name?: string
  description?: string | null
  projectId?: ProjectId
  targetDate?: Date | null
  sortOrder?: number
}

export const makeMilestone = (overrides: MilestoneInput = {}): Milestone =>
  new Milestone({
    id: (overrides.id ?? "mile-1") as MilestoneId,
    name: overrides.name ?? "Q1 Release",
    description:
      overrides.description === null
        ? Option.none()
        : Option.fromNullable(overrides.description),
    projectId: (overrides.projectId ?? "proj-1") as ProjectId,
    targetDate:
      overrides.targetDate === null
        ? Option.none()
        : Option.fromNullable(overrides.targetDate),
    sortOrder: overrides.sortOrder ?? 0,
  })
