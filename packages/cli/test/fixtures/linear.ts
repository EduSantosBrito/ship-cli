/**
 * Linear SDK mock fixtures for testing.
 *
 * Provides factory functions that produce mock Linear SDK objects
 * for testing the adapter layer. These are meant to simulate the
 * Linear API responses.
 */

import type {
  Issue,
  Team as LinearTeam,
  Project as LinearProject,
  ProjectMilestone as LinearProjectMilestone,
  WorkflowState as LinearWorkflowState,
  IssueLabel,
  IssueConnection,
} from "@linear/sdk"

// === LinearWorkflowState Mock Fixtures ===

export interface LinearWorkflowStateInput {
  id?: string
  name?: string
  type?: string
}

export const createMockWorkflowState = (
  overrides: LinearWorkflowStateInput = {},
): LinearWorkflowState =>
  ({
    id: overrides.id ?? "state-1",
    name: overrides.name ?? "In Progress",
    type: overrides.type ?? "started",
  }) as LinearWorkflowState

// === IssueLabel Mock Fixtures ===

export interface IssueLabelInput {
  id?: string
  name: string
}

export const createMockLabel = (
  nameOrInput: string | IssueLabelInput,
): IssueLabel => {
  if (typeof nameOrInput === "string") {
    return {
      id: `label-${nameOrInput}`,
      name: nameOrInput,
    } as IssueLabel
  }
  return {
    id: nameOrInput.id ?? `label-${nameOrInput.name}`,
    name: nameOrInput.name,
  } as IssueLabel
}

export const createMockLabelsConnection = (
  labels: IssueLabel[],
): { nodes: IssueLabel[] } => ({
  nodes: labels,
})

// === LinearTeam Mock Fixtures ===

export interface LinearTeamInput {
  id?: string
  name?: string
  key?: string
}

export const createMockTeam = (
  overrides: LinearTeamInput = {},
): LinearTeam =>
  ({
    id: overrides.id ?? "team-123",
    name: overrides.name ?? "Engineering",
    key: overrides.key ?? "ENG",
  }) as LinearTeam

// === Child Issue Mock (for subtasks) ===

export interface ChildIssueInput {
  id: string
  identifier: string
  title: string
  state?: LinearWorkflowState
  priority?: number
}

export const createMockChildIssue = (input: ChildIssueInput): Partial<Issue> => ({
  id: input.id,
  identifier: input.identifier,
  title: input.title,
  priority: input.priority ?? 3,
  state: Promise.resolve(input.state ?? createMockWorkflowState()),
})

// === Issue Mock Fixtures ===

export interface LinearIssueInput {
  id?: string
  identifier?: string
  title?: string
  description?: string
  priority?: number
  branchName?: string
  url?: string
  createdAt?: Date
  updatedAt?: Date
  state?: LinearWorkflowState
  team?: LinearTeam
  labels?: IssueLabel[]
  children?: Partial<Issue>[]
}

export const createMockIssue = (overrides: LinearIssueInput = {}): Issue => {
  const defaults = {
    id: "issue-1",
    identifier: "ENG-123",
    title: "Test Issue",
    description: undefined,
    priority: 3,
    branchName: undefined,
    url: "https://linear.app/team/issue/ENG-123",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    state: createMockWorkflowState(),
    team: createMockTeam(),
    labels: [],
    children: [],
  }

  const config = { ...defaults, ...overrides }

  return {
    id: config.id,
    identifier: config.identifier,
    title: config.title,
    description: config.description,
    priority: config.priority,
    branchName: config.branchName,
    url: config.url,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    state: Promise.resolve(config.state),
    team: Promise.resolve(config.team),
    labels: () => Promise.resolve(createMockLabelsConnection(config.labels)),
    children: () =>
      Promise.resolve({
        nodes: config.children,
      } as IssueConnection),
  } as unknown as Issue
}

// === LinearProject Mock Fixtures ===

export interface LinearProjectInput {
  id?: string
  name?: string
}

export const createMockProject = (
  overrides: LinearProjectInput = {},
): LinearProject =>
  ({
    id: overrides.id ?? "proj-1",
    name: overrides.name ?? "Test Project",
  }) as LinearProject

// === LinearProjectMilestone Mock Fixtures ===

export interface LinearMilestoneInput {
  id?: string
  name?: string
  description?: string
  targetDate?: string
  sortOrder?: number
}

export const createMockMilestone = (
  overrides: LinearMilestoneInput = {},
): LinearProjectMilestone =>
  ({
    id: overrides.id ?? "mile-1",
    name: overrides.name ?? "Q1 Release",
    description: overrides.description,
    targetDate: overrides.targetDate,
    sortOrder: overrides.sortOrder ?? 0,
  }) as unknown as LinearProjectMilestone
