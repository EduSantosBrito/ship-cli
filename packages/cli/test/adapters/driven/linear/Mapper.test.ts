import { describe, it, expect } from "@effect/vitest"
import { Option } from "effect"
import type {
  Issue,
  Team as LinearTeam,
  Project as LinearProject,
  ProjectMilestone as LinearProjectMilestone,
  WorkflowState as LinearWorkflowState,
  IssueLabel,
  IssueConnection,
} from "@linear/sdk"
import {
  TYPE_LABEL_PREFIX,
  statusToLinearStateType,
  priorityToLinear,
  mapIssueToTask,
  mapTeam,
  mapProject,
  mapMilestone,
} from "../../../../src/adapters/driven/linear/Mapper.js"

// === Mock Factories ===

const createMockWorkflowState = (
  overrides: Partial<LinearWorkflowState> = {},
): LinearWorkflowState =>
  ({
    id: "state-1",
    name: "In Progress",
    type: "started",
    ...overrides,
  }) as LinearWorkflowState

const createMockLabel = (name: string): IssueLabel =>
  ({
    id: `label-${name}`,
    name,
  }) as IssueLabel

const createMockLabelsConnection = (
  labels: IssueLabel[],
): { nodes: IssueLabel[] } => ({
  nodes: labels,
})

const createMockTeam = (overrides: Partial<LinearTeam> = {}): LinearTeam =>
  ({
    id: "team-123",
    name: "Engineering",
    key: "ENG",
    ...overrides,
  }) as LinearTeam

const createMockChildIssue = (
  id: string,
  identifier: string,
  title: string,
  state: LinearWorkflowState,
  priority: number,
): Partial<Issue> => ({
  id,
  identifier,
  title,
  priority,
  state: Promise.resolve(state),
})

const createMockIssue = (
  overrides: Partial<{
    id: string
    identifier: string
    title: string
    description: string | undefined
    priority: number
    branchName: string | undefined
    url: string
    createdAt: Date
    updatedAt: Date
    state: LinearWorkflowState | undefined
    team: LinearTeam | undefined
    labels: IssueLabel[]
    children: Partial<Issue>[]
  }> = {},
): Issue => {
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

describe("Linear Mapper", () => {
  describe("TYPE_LABEL_PREFIX", () => {
    it("should be 'type:'", () => {
      expect(TYPE_LABEL_PREFIX).toBe("type:")
    })
  })

  describe("statusToLinearStateType", () => {
    it("should map 'backlog' to 'backlog'", () => {
      expect(statusToLinearStateType("backlog")).toBe("backlog")
    })

    it("should map 'todo' to 'unstarted'", () => {
      expect(statusToLinearStateType("todo")).toBe("unstarted")
    })

    it("should map 'in_progress' to 'started'", () => {
      expect(statusToLinearStateType("in_progress")).toBe("started")
    })

    it("should map 'in_review' to 'started'", () => {
      expect(statusToLinearStateType("in_review")).toBe("started")
    })

    it("should map 'done' to 'completed'", () => {
      expect(statusToLinearStateType("done")).toBe("completed")
    })

    it("should map 'cancelled' to 'canceled'", () => {
      expect(statusToLinearStateType("cancelled")).toBe("canceled")
    })
  })

  describe("priorityToLinear", () => {
    it("should map 'urgent' to 1", () => {
      expect(priorityToLinear("urgent")).toBe(1)
    })

    it("should map 'high' to 2", () => {
      expect(priorityToLinear("high")).toBe(2)
    })

    it("should map 'medium' to 3", () => {
      expect(priorityToLinear("medium")).toBe(3)
    })

    it("should map 'low' to 4", () => {
      expect(priorityToLinear("low")).toBe(4)
    })

    it("should map 'none' to 0", () => {
      expect(priorityToLinear("none")).toBe(0)
    })
  })

  describe("mapIssueToTask", () => {
    it("should map basic issue properties", async () => {
      const issue = createMockIssue({
        id: "issue-abc",
        identifier: "ENG-999",
        title: "Fix bug",
        url: "https://linear.app/test",
        priority: 2, // high
      })

      const task = await mapIssueToTask(issue)

      expect(task.id).toBe("issue-abc")
      expect(task.identifier).toBe("ENG-999")
      expect(task.title).toBe("Fix bug")
      expect(task.url).toBe("https://linear.app/test")
      expect(task.priority).toBe("high")
    })

    it("should map description as Some when present", async () => {
      const issue = createMockIssue({
        description: "This is a description",
      })

      const task = await mapIssueToTask(issue)

      expect(Option.isSome(task.description)).toBe(true)
      expect(Option.getOrElse(task.description, () => "")).toBe(
        "This is a description",
      )
    })

    it("should map description as None when not present", async () => {
      const issue = createMockIssue({
        description: undefined,
      })

      const task = await mapIssueToTask(issue)

      expect(Option.isNone(task.description)).toBe(true)
    })

    it("should map branchName as Some when present", async () => {
      const issue = createMockIssue({
        branchName: "feature/auth",
      })

      const task = await mapIssueToTask(issue)

      expect(Option.isSome(task.branchName)).toBe(true)
      expect(Option.getOrElse(task.branchName, () => "")).toBe("feature/auth")
    })

    it("should map branchName as None when not present", async () => {
      const issue = createMockIssue({
        branchName: undefined,
      })

      const task = await mapIssueToTask(issue)

      expect(Option.isNone(task.branchName)).toBe(true)
    })

    it("should map workflow state correctly", async () => {
      const issue = createMockIssue({
        state: createMockWorkflowState({
          id: "state-xyz",
          name: "Done",
          type: "completed",
        }),
      })

      const task = await mapIssueToTask(issue)

      expect(task.state.id).toBe("state-xyz")
      expect(task.state.name).toBe("Done")
      expect(task.state.type).toBe("completed")
    })

    it("should handle undefined state with defaults", async () => {
      const issue = createMockIssue({
        state: undefined,
      })

      const task = await mapIssueToTask(issue)

      expect(task.state.id).toBe("")
      expect(task.state.name).toBe("Unknown")
      expect(task.state.type).toBe("unstarted")
    })

    it("should map team id", async () => {
      const issue = createMockIssue({
        team: createMockTeam({ id: "team-xyz" }),
      })

      const task = await mapIssueToTask(issue)

      expect(task.teamId).toBe("team-xyz")
    })

    it("should handle undefined team with empty id", async () => {
      const issue = createMockIssue({
        team: undefined,
      })

      const task = await mapIssueToTask(issue)

      expect(task.teamId).toBe("")
    })

    it("should map labels", async () => {
      const issue = createMockIssue({
        labels: [createMockLabel("bug"), createMockLabel("urgent")],
      })

      const task = await mapIssueToTask(issue)

      expect(task.labels).toEqual(["bug", "urgent"])
    })

    it("should extract task type from type: label", async () => {
      const issue = createMockIssue({
        labels: [createMockLabel("type:bug"), createMockLabel("priority:high")],
      })

      const task = await mapIssueToTask(issue)

      expect(Option.isSome(task.type)).toBe(true)
      expect(Option.getOrElse(task.type, () => "task" as const)).toBe("bug")
    })

    it("should set type as None when no type: label", async () => {
      const issue = createMockIssue({
        labels: [createMockLabel("bug"), createMockLabel("priority:high")],
      })

      const task = await mapIssueToTask(issue)

      expect(Option.isNone(task.type)).toBe(true)
    })

    it("should map dates correctly", async () => {
      const createdAt = new Date("2024-06-01T10:00:00Z")
      const updatedAt = new Date("2024-06-02T15:30:00Z")

      const issue = createMockIssue({ createdAt, updatedAt })

      const task = await mapIssueToTask(issue)

      expect(task.createdAt).toEqual(createdAt)
      expect(task.updatedAt).toEqual(updatedAt)
    })

    it("should map subtasks when includeSubtasks is true", async () => {
      const childState = createMockWorkflowState({
        id: "child-state",
        name: "In Progress",
        type: "started",
      })

      const issue = createMockIssue({
        children: [
          createMockChildIssue(
            "child-1",
            "ENG-124",
            "Subtask 1",
            childState,
            2,
          ),
        ],
      })

      const task = await mapIssueToTask(issue, true)

      expect(task.subtasks).toHaveLength(1)
      expect(task.subtasks[0].id).toBe("child-1")
      expect(task.subtasks[0].identifier).toBe("ENG-124")
      expect(task.subtasks[0].title).toBe("Subtask 1")
      expect(task.subtasks[0].state).toBe("In Progress")
      expect(task.subtasks[0].stateType).toBe("started")
      expect(task.subtasks[0].priority).toBe("high")
    })

    it("should not map subtasks when includeSubtasks is false", async () => {
      const childState = createMockWorkflowState()
      const issue = createMockIssue({
        children: [
          createMockChildIssue("child-1", "ENG-124", "Subtask 1", childState, 2),
        ],
      })

      const task = await mapIssueToTask(issue, false)

      expect(task.subtasks).toHaveLength(0)
    })

    describe("priority mapping via mapIssueToTask", () => {
      it("should map priority 0 to 'none'", async () => {
        const issue = createMockIssue({ priority: 0 })
        const task = await mapIssueToTask(issue)
        expect(task.priority).toBe("none")
      })

      it("should map priority 1 to 'urgent'", async () => {
        const issue = createMockIssue({ priority: 1 })
        const task = await mapIssueToTask(issue)
        expect(task.priority).toBe("urgent")
      })

      it("should map priority 2 to 'high'", async () => {
        const issue = createMockIssue({ priority: 2 })
        const task = await mapIssueToTask(issue)
        expect(task.priority).toBe("high")
      })

      it("should map priority 3 to 'medium'", async () => {
        const issue = createMockIssue({ priority: 3 })
        const task = await mapIssueToTask(issue)
        expect(task.priority).toBe("medium")
      })

      it("should map priority 4 to 'low'", async () => {
        const issue = createMockIssue({ priority: 4 })
        const task = await mapIssueToTask(issue)
        expect(task.priority).toBe("low")
      })

      it("should map unknown priority to 'none'", async () => {
        const issue = createMockIssue({ priority: 99 })
        const task = await mapIssueToTask(issue)
        expect(task.priority).toBe("none")
      })
    })

    describe("state type mapping via mapIssueToTask", () => {
      it("should map state type 'backlog'", async () => {
        const issue = createMockIssue({
          state: createMockWorkflowState({ type: "backlog" }),
        })
        const task = await mapIssueToTask(issue)
        expect(task.state.type).toBe("backlog")
      })

      it("should map state type 'unstarted'", async () => {
        const issue = createMockIssue({
          state: createMockWorkflowState({ type: "unstarted" }),
        })
        const task = await mapIssueToTask(issue)
        expect(task.state.type).toBe("unstarted")
      })

      it("should map state type 'started'", async () => {
        const issue = createMockIssue({
          state: createMockWorkflowState({ type: "started" }),
        })
        const task = await mapIssueToTask(issue)
        expect(task.state.type).toBe("started")
      })

      it("should map state type 'completed'", async () => {
        const issue = createMockIssue({
          state: createMockWorkflowState({ type: "completed" }),
        })
        const task = await mapIssueToTask(issue)
        expect(task.state.type).toBe("completed")
      })

      it("should map state type 'canceled'", async () => {
        const issue = createMockIssue({
          state: createMockWorkflowState({ type: "canceled" }),
        })
        const task = await mapIssueToTask(issue)
        expect(task.state.type).toBe("canceled")
      })

      it("should map unknown state type to 'unstarted'", async () => {
        const issue = createMockIssue({
          state: createMockWorkflowState({
            type: "unknown" as unknown as string,
          }),
        })
        const task = await mapIssueToTask(issue)
        expect(task.state.type).toBe("unstarted")
      })
    })
  })

  describe("mapTeam", () => {
    it("should map team properties", () => {
      const linearTeam = createMockTeam({
        id: "team-abc",
        name: "Product",
        key: "PROD",
      })

      const team = mapTeam(linearTeam)

      expect(team.id).toBe("team-abc")
      expect(team.name).toBe("Product")
      expect(team.key).toBe("PROD")
    })
  })

  describe("mapProject", () => {
    it("should map project properties", () => {
      const linearProject = {
        id: "proj-abc",
        name: "Q1 Roadmap",
      } as LinearProject

      const project = mapProject(linearProject, "team-xyz")

      expect(project.id).toBe("proj-abc")
      expect(project.name).toBe("Q1 Roadmap")
      expect(project.teamId).toBe("team-xyz")
    })
  })

  describe("mapMilestone", () => {
    it("should map milestone properties", () => {
      const linearMilestone = {
        id: "mile-abc",
        name: "v1.0 Release",
        description: "First major release",
        targetDate: "2024-06-30",
        sortOrder: 1,
      } as LinearProjectMilestone

      const milestone = mapMilestone(linearMilestone, "proj-xyz")

      expect(milestone.id).toBe("mile-abc")
      expect(milestone.name).toBe("v1.0 Release")
      expect(Option.isSome(milestone.description)).toBe(true)
      expect(Option.getOrElse(milestone.description, () => "")).toBe(
        "First major release",
      )
      expect(milestone.projectId).toBe("proj-xyz")
      expect(milestone.sortOrder).toBe(1)
    })

    it("should map targetDate as Some when present", () => {
      const linearMilestone = {
        id: "mile-abc",
        name: "v1.0",
        description: undefined,
        targetDate: "2024-12-31",
        sortOrder: 0,
      } as unknown as LinearProjectMilestone

      const milestone = mapMilestone(linearMilestone, "proj-xyz")

      expect(Option.isSome(milestone.targetDate)).toBe(true)
    })

    it("should map targetDate as None when not present", () => {
      const linearMilestone = {
        id: "mile-abc",
        name: "v1.0",
        description: undefined,
        targetDate: undefined,
        sortOrder: 0,
      } as unknown as LinearProjectMilestone

      const milestone = mapMilestone(linearMilestone, "proj-xyz")

      expect(Option.isNone(milestone.targetDate)).toBe(true)
    })

    it("should map description as None when not present", () => {
      const linearMilestone = {
        id: "mile-abc",
        name: "v1.0",
        description: undefined,
        targetDate: undefined,
        sortOrder: 0,
      } as unknown as LinearProjectMilestone

      const milestone = mapMilestone(linearMilestone, "proj-xyz")

      expect(Option.isNone(milestone.description)).toBe(true)
    })
  })
})
