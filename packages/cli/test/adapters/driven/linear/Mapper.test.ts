import { describe, it, expect } from "@effect/vitest"
import { Effect, Option } from "effect"
import type {
  Issue,
  Project as LinearProject,
  ProjectMilestone as LinearProjectMilestone,
  WorkflowState as LinearWorkflowState,
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
import {
  createMockWorkflowState,
  createMockLabel,
  createMockTeam,
  createMockIssue,
} from "../../../fixtures/index.js"

// === Test Helpers ===
// Local wrapper for child issue creation (specific pattern used in this file)

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
    it.effect("maps basic issue properties", () =>
      Effect.gen(function* () {
        const issue = createMockIssue({
          id: "issue-abc",
          identifier: "ENG-999",
          title: "Fix bug",
          url: "https://linear.app/test",
          priority: 2, // high
        })

        const task = yield* mapIssueToTask(issue)

        expect(task.id).toBe("issue-abc")
        expect(task.identifier).toBe("ENG-999")
        expect(task.title).toBe("Fix bug")
        expect(task.url).toBe("https://linear.app/test")
        expect(task.priority).toBe("high")
      })
    )

    it.effect("maps description as Some when present", () =>
      Effect.gen(function* () {
        const issue = createMockIssue({
          description: "This is a description",
        })

        const task = yield* mapIssueToTask(issue)

        expect(Option.isSome(task.description)).toBe(true)
        expect(Option.getOrElse(task.description, () => "")).toBe(
          "This is a description",
        )
      })
    )

    it.effect("maps description as None when not present", () =>
      Effect.gen(function* () {
        // Create issue without description (uses default undefined from fixture)
        const issue = createMockIssue({})

        const task = yield* mapIssueToTask(issue)

        expect(Option.isNone(task.description)).toBe(true)
      })
    )

    it.effect("maps branchName as Some when present", () =>
      Effect.gen(function* () {
        const issue = createMockIssue({
          branchName: "feature/auth",
        })

        const task = yield* mapIssueToTask(issue)

        expect(Option.isSome(task.branchName)).toBe(true)
        expect(Option.getOrElse(task.branchName, () => "")).toBe("feature/auth")
      })
    )

    it.effect("maps branchName as None when not present", () =>
      Effect.gen(function* () {
        // Create issue without branchName (uses default undefined from fixture)
        const issue = createMockIssue({})

        const task = yield* mapIssueToTask(issue)

        expect(Option.isNone(task.branchName)).toBe(true)
      })
    )

    it.effect("maps workflow state correctly", () =>
      Effect.gen(function* () {
        const issue = createMockIssue({
          state: createMockWorkflowState({
            id: "state-xyz",
            name: "Done",
            type: "completed",
          }),
        })

        const task = yield* mapIssueToTask(issue)

        expect(task.state.id).toBe("state-xyz")
        expect(task.state.name).toBe("Done")
        expect(task.state.type).toBe("completed")
      })
    )

    it.effect("handles undefined state with defaults", () =>
      Effect.gen(function* () {
        // Test with undefined state - need to create issue manually for this edge case
        const issue = {
          ...createMockIssue({}),
          state: Promise.resolve(undefined),
        } as unknown as Issue

        const task = yield* mapIssueToTask(issue)

        expect(task.state.id).toBe("")
        expect(task.state.name).toBe("Unknown")
        expect(task.state.type).toBe("unstarted")
      })
    )

    it.effect("maps team id", () =>
      Effect.gen(function* () {
        const issue = createMockIssue({
          team: createMockTeam({ id: "team-xyz" }),
        })

        const task = yield* mapIssueToTask(issue)

        expect(task.teamId).toBe("team-xyz")
      })
    )

    it.effect("handles undefined team with empty id", () =>
      Effect.gen(function* () {
        // Test with undefined team - need to create issue manually for this edge case
        const issue = {
          ...createMockIssue({}),
          team: Promise.resolve(undefined),
        } as unknown as Issue

        const task = yield* mapIssueToTask(issue)

        expect(task.teamId).toBe("")
      })
    )

    it.effect("maps labels", () =>
      Effect.gen(function* () {
        const issue = createMockIssue({
          labels: [createMockLabel("bug"), createMockLabel("urgent")],
        })

        const task = yield* mapIssueToTask(issue)

        expect(task.labels).toEqual(["bug", "urgent"])
      })
    )

    it.effect("extracts task type from type: label", () =>
      Effect.gen(function* () {
        const issue = createMockIssue({
          labels: [createMockLabel("type:bug"), createMockLabel("priority:high")],
        })

        const task = yield* mapIssueToTask(issue)

        expect(Option.isSome(task.type)).toBe(true)
        expect(Option.getOrElse(task.type, () => "task" as const)).toBe("bug")
      })
    )

    it.effect("sets type as None when no type: label", () =>
      Effect.gen(function* () {
        const issue = createMockIssue({
          labels: [createMockLabel("bug"), createMockLabel("priority:high")],
        })

        const task = yield* mapIssueToTask(issue)

        expect(Option.isNone(task.type)).toBe(true)
      })
    )

    it.effect("maps dates correctly", () =>
      Effect.gen(function* () {
        const createdAt = new Date("2024-06-01T10:00:00Z")
        const updatedAt = new Date("2024-06-02T15:30:00Z")

        const issue = createMockIssue({ createdAt, updatedAt })

        const task = yield* mapIssueToTask(issue)

        expect(task.createdAt).toEqual(createdAt)
        expect(task.updatedAt).toEqual(updatedAt)
      })
    )

    it.effect("maps subtasks when includeSubtasks is true", () =>
      Effect.gen(function* () {
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

        const task = yield* mapIssueToTask(issue, true)

        expect(task.subtasks).toHaveLength(1)
        expect(task.subtasks[0].id).toBe("child-1")
        expect(task.subtasks[0].identifier).toBe("ENG-124")
        expect(task.subtasks[0].title).toBe("Subtask 1")
        expect(task.subtasks[0].state).toBe("In Progress")
        expect(task.subtasks[0].stateType).toBe("started")
        expect(task.subtasks[0].priority).toBe("high")
      })
    )

    it.effect("does not map subtasks when includeSubtasks is false", () =>
      Effect.gen(function* () {
        const childState = createMockWorkflowState()
        const issue = createMockIssue({
          children: [
            createMockChildIssue("child-1", "ENG-124", "Subtask 1", childState, 2),
          ],
        })

        const task = yield* mapIssueToTask(issue, false)

        expect(task.subtasks).toHaveLength(0)
      })
    )

    describe("priority mapping via mapIssueToTask", () => {
      it.effect("maps priority 0 to 'none'", () =>
        Effect.gen(function* () {
          const issue = createMockIssue({ priority: 0 })
          const task = yield* mapIssueToTask(issue)
          expect(task.priority).toBe("none")
        })
      )

      it.effect("maps priority 1 to 'urgent'", () =>
        Effect.gen(function* () {
          const issue = createMockIssue({ priority: 1 })
          const task = yield* mapIssueToTask(issue)
          expect(task.priority).toBe("urgent")
        })
      )

      it.effect("maps priority 2 to 'high'", () =>
        Effect.gen(function* () {
          const issue = createMockIssue({ priority: 2 })
          const task = yield* mapIssueToTask(issue)
          expect(task.priority).toBe("high")
        })
      )

      it.effect("maps priority 3 to 'medium'", () =>
        Effect.gen(function* () {
          const issue = createMockIssue({ priority: 3 })
          const task = yield* mapIssueToTask(issue)
          expect(task.priority).toBe("medium")
        })
      )

      it.effect("maps priority 4 to 'low'", () =>
        Effect.gen(function* () {
          const issue = createMockIssue({ priority: 4 })
          const task = yield* mapIssueToTask(issue)
          expect(task.priority).toBe("low")
        })
      )

      it.effect("maps unknown priority to 'none'", () =>
        Effect.gen(function* () {
          const issue = createMockIssue({ priority: 99 })
          const task = yield* mapIssueToTask(issue)
          expect(task.priority).toBe("none")
        })
      )
    })

    describe("state type mapping via mapIssueToTask", () => {
      it.effect("maps state type 'backlog'", () =>
        Effect.gen(function* () {
          const issue = createMockIssue({
            state: createMockWorkflowState({ type: "backlog" }),
          })
          const task = yield* mapIssueToTask(issue)
          expect(task.state.type).toBe("backlog")
        })
      )

      it.effect("maps state type 'unstarted'", () =>
        Effect.gen(function* () {
          const issue = createMockIssue({
            state: createMockWorkflowState({ type: "unstarted" }),
          })
          const task = yield* mapIssueToTask(issue)
          expect(task.state.type).toBe("unstarted")
        })
      )

      it.effect("maps state type 'started'", () =>
        Effect.gen(function* () {
          const issue = createMockIssue({
            state: createMockWorkflowState({ type: "started" }),
          })
          const task = yield* mapIssueToTask(issue)
          expect(task.state.type).toBe("started")
        })
      )

      it.effect("maps state type 'completed'", () =>
        Effect.gen(function* () {
          const issue = createMockIssue({
            state: createMockWorkflowState({ type: "completed" }),
          })
          const task = yield* mapIssueToTask(issue)
          expect(task.state.type).toBe("completed")
        })
      )

      it.effect("maps state type 'canceled'", () =>
        Effect.gen(function* () {
          const issue = createMockIssue({
            state: createMockWorkflowState({ type: "canceled" }),
          })
          const task = yield* mapIssueToTask(issue)
          expect(task.state.type).toBe("canceled")
        })
      )

      it.effect("maps unknown state type to 'unstarted'", () =>
        Effect.gen(function* () {
          const issue = createMockIssue({
            state: createMockWorkflowState({
              type: "unknown" as unknown as string,
            }),
          })
          const task = yield* mapIssueToTask(issue)
          expect(task.state.type).toBe("unstarted")
        })
      )
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
