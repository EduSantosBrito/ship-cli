import { describe, it, expect } from "@effect/vitest"
import { Effect, Schema, Option, Exit } from "effect"
import {
  Task,
  TaskId,
  TeamId,
  ProjectId,
  MilestoneId,
  WorkflowStateType,
  TaskStatus,
  Priority,
  TaskType,
  DependencyType,
  Subtask,
  WorkflowState,
  Dependency,
  Team,
  Project,
  Milestone,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  CreateMilestoneInput,
  UpdateMilestoneInput,
} from "../../src/domain/Task.js"

// === Test Fixtures ===

const makeWorkflowState = (type: WorkflowStateType): WorkflowState =>
  new WorkflowState({ id: "state-1", name: "Test State", type })

const makeSubtask = (stateType: WorkflowStateType): Subtask =>
  new Subtask({
    id: "subtask-1" as TaskId,
    identifier: "TEST-1",
    title: "Test Subtask",
    state: "Test State",
    stateType,
    priority: "medium",
  })

const makeTask = (
  stateType: WorkflowStateType,
  subtasks: Subtask[] = [],
): Task =>
  new Task({
    id: "task-1" as TaskId,
    identifier: "TEST-1",
    title: "Test Task",
    description: Option.none(),
    state: makeWorkflowState(stateType),
    priority: "medium",
    type: Option.none(),
    teamId: "team-1" as TeamId,
    projectId: Option.none(),
    milestoneId: Option.none(),
    milestoneName: Option.none(),
    branchName: Option.none(),
    url: "https://example.com/task-1",
    labels: [],
    blockedBy: [],
    blocks: [],
    subtasks,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  })

describe("Task Domain", () => {
  describe("Task", () => {
    describe("isDone", () => {
      it("should return true when state type is 'completed'", () => {
        const task = makeTask("completed")
        expect(task.isDone).toBe(true)
      })

      it("should return true when state type is 'canceled'", () => {
        const task = makeTask("canceled")
        expect(task.isDone).toBe(true)
      })

      it("should return false when state type is 'backlog'", () => {
        const task = makeTask("backlog")
        expect(task.isDone).toBe(false)
      })

      it("should return false when state type is 'unstarted'", () => {
        const task = makeTask("unstarted")
        expect(task.isDone).toBe(false)
      })

      it("should return false when state type is 'started'", () => {
        const task = makeTask("started")
        expect(task.isDone).toBe(false)
      })
    })

    describe("isActionable", () => {
      it("should return true when task is not done", () => {
        const task = makeTask("started")
        expect(task.isActionable).toBe(true)
      })

      it("should return false when task is done", () => {
        const task = makeTask("completed")
        expect(task.isActionable).toBe(false)
      })
    })

    describe("hasSubtasks", () => {
      it("should return true when subtasks array is not empty", () => {
        const task = makeTask("started", [makeSubtask("started")])
        expect(task.hasSubtasks).toBe(true)
      })

      it("should return false when subtasks array is empty", () => {
        const task = makeTask("started", [])
        expect(task.hasSubtasks).toBe(false)
      })
    })
  })

  describe("Subtask", () => {
    describe("isDone", () => {
      it("should return true when state type is 'completed'", () => {
        const subtask = makeSubtask("completed")
        expect(subtask.isDone).toBe(true)
      })

      it("should return true when state type is 'canceled'", () => {
        const subtask = makeSubtask("canceled")
        expect(subtask.isDone).toBe(true)
      })

      it("should return false when state type is 'backlog'", () => {
        const subtask = makeSubtask("backlog")
        expect(subtask.isDone).toBe(false)
      })

      it("should return false when state type is 'unstarted'", () => {
        const subtask = makeSubtask("unstarted")
        expect(subtask.isDone).toBe(false)
      })

      it("should return false when state type is 'started'", () => {
        const subtask = makeSubtask("started")
        expect(subtask.isDone).toBe(false)
      })
    })
  })

  describe("Branded Types", () => {
    describe("TaskId", () => {
      it.effect("should accept valid string and brand it", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decode(TaskId)("task-123")
          expect(result).toBe("task-123")
        }),
      )

      it.effect("should encode back to string", () =>
        Effect.gen(function* () {
          const id = "task-123" as TaskId
          const result = yield* Schema.encode(TaskId)(id)
          expect(result).toBe("task-123")
        }),
      )
    })

    describe("TeamId", () => {
      it.effect("should accept valid string and brand it", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decode(TeamId)("team-456")
          expect(result).toBe("team-456")
        }),
      )

      it.effect("should encode back to string", () =>
        Effect.gen(function* () {
          const id = "team-456" as TeamId
          const result = yield* Schema.encode(TeamId)(id)
          expect(result).toBe("team-456")
        }),
      )
    })

    describe("ProjectId", () => {
      it.effect("should accept valid string and brand it", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decode(ProjectId)("proj-789")
          expect(result).toBe("proj-789")
        }),
      )

      it.effect("should encode back to string", () =>
        Effect.gen(function* () {
          const id = "proj-789" as ProjectId
          const result = yield* Schema.encode(ProjectId)(id)
          expect(result).toBe("proj-789")
        }),
      )
    })

    describe("MilestoneId", () => {
      it.effect("should accept valid string and brand it", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decode(MilestoneId)("mile-012")
          expect(result).toBe("mile-012")
        }),
      )

      it.effect("should encode back to string", () =>
        Effect.gen(function* () {
          const id = "mile-012" as MilestoneId
          const result = yield* Schema.encode(MilestoneId)(id)
          expect(result).toBe("mile-012")
        }),
      )
    })
  })

  describe("Enums", () => {
    describe("WorkflowStateType", () => {
      it.effect("should accept 'backlog'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(WorkflowStateType)(
            "backlog",
          )
          expect(result).toBe("backlog")
        }),
      )

      it.effect("should accept 'unstarted'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(WorkflowStateType)(
            "unstarted",
          )
          expect(result).toBe("unstarted")
        }),
      )

      it.effect("should accept 'started'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(WorkflowStateType)(
            "started",
          )
          expect(result).toBe("started")
        }),
      )

      it.effect("should accept 'completed'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(WorkflowStateType)(
            "completed",
          )
          expect(result).toBe("completed")
        }),
      )

      it.effect("should accept 'canceled'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(WorkflowStateType)(
            "canceled",
          )
          expect(result).toBe("canceled")
        }),
      )

      it.effect("should reject invalid values", () =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(
            Schema.decodeUnknown(WorkflowStateType)("invalid"),
          )
          expect(Exit.isFailure(exit)).toBe(true)
        }),
      )
    })

    describe("TaskStatus", () => {
      it.effect("should accept 'backlog'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(TaskStatus)("backlog")
          expect(result).toBe("backlog")
        }),
      )

      it.effect("should accept 'todo'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(TaskStatus)("todo")
          expect(result).toBe("todo")
        }),
      )

      it.effect("should accept 'in_progress'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(TaskStatus)("in_progress")
          expect(result).toBe("in_progress")
        }),
      )

      it.effect("should accept 'in_review'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(TaskStatus)("in_review")
          expect(result).toBe("in_review")
        }),
      )

      it.effect("should accept 'done'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(TaskStatus)("done")
          expect(result).toBe("done")
        }),
      )

      it.effect("should accept 'cancelled'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(TaskStatus)("cancelled")
          expect(result).toBe("cancelled")
        }),
      )

      it.effect("should reject invalid values", () =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(
            Schema.decodeUnknown(TaskStatus)("invalid"),
          )
          expect(Exit.isFailure(exit)).toBe(true)
        }),
      )
    })

    describe("Priority", () => {
      it.effect("should accept 'urgent'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(Priority)("urgent")
          expect(result).toBe("urgent")
        }),
      )

      it.effect("should accept 'high'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(Priority)("high")
          expect(result).toBe("high")
        }),
      )

      it.effect("should accept 'medium'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(Priority)("medium")
          expect(result).toBe("medium")
        }),
      )

      it.effect("should accept 'low'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(Priority)("low")
          expect(result).toBe("low")
        }),
      )

      it.effect("should accept 'none'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(Priority)("none")
          expect(result).toBe("none")
        }),
      )

      it.effect("should reject invalid values", () =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(
            Schema.decodeUnknown(Priority)("invalid"),
          )
          expect(Exit.isFailure(exit)).toBe(true)
        }),
      )
    })

    describe("TaskType", () => {
      it.effect("should accept 'bug'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(TaskType)("bug")
          expect(result).toBe("bug")
        }),
      )

      it.effect("should accept 'feature'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(TaskType)("feature")
          expect(result).toBe("feature")
        }),
      )

      it.effect("should accept 'task'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(TaskType)("task")
          expect(result).toBe("task")
        }),
      )

      it.effect("should accept 'epic'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(TaskType)("epic")
          expect(result).toBe("epic")
        }),
      )

      it.effect("should accept 'chore'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(TaskType)("chore")
          expect(result).toBe("chore")
        }),
      )

      it.effect("should reject invalid values", () =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(
            Schema.decodeUnknown(TaskType)("invalid"),
          )
          expect(Exit.isFailure(exit)).toBe(true)
        }),
      )
    })

    describe("DependencyType", () => {
      it.effect("should accept 'blocks'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(DependencyType)("blocks")
          expect(result).toBe("blocks")
        }),
      )

      it.effect("should accept 'blocked_by'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(DependencyType)(
            "blocked_by",
          )
          expect(result).toBe("blocked_by")
        }),
      )

      it.effect("should accept 'related'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(DependencyType)("related")
          expect(result).toBe("related")
        }),
      )

      it.effect("should accept 'duplicate'", () =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(DependencyType)(
            "duplicate",
          )
          expect(result).toBe("duplicate")
        }),
      )

      it.effect("should reject invalid values", () =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(
            Schema.decodeUnknown(DependencyType)("invalid"),
          )
          expect(Exit.isFailure(exit)).toBe(true)
        }),
      )
    })
  })

  describe("Schema Classes", () => {
    describe("Task", () => {
      it.effect("should decode valid task data", () =>
        Effect.gen(function* () {
          const data = {
            id: "task-1",
            identifier: "TEST-1",
            title: "Test Task",
            description: null,
            state: {
              id: "state-1",
              name: "In Progress",
              type: "started" as const,
            },
            priority: "medium" as const,
            type: null,
            teamId: "team-1",
            projectId: null,
            milestoneId: null,
            milestoneName: null,
            branchName: null,
            url: "https://example.com",
            labels: ["label1"],
            blockedBy: [],
            blocks: [],
            subtasks: [],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          }
          const result = yield* Schema.decode(Task)(data)
          expect(result.id).toBe("task-1")
          expect(result.title).toBe("Test Task")
          expect(result.priority).toBe("medium")
        }),
      )

      it.effect("should handle optional description as None", () =>
        Effect.gen(function* () {
          const data = {
            id: "task-1",
            identifier: "TEST-1",
            title: "Test Task",
            description: null,
            state: { id: "state-1", name: "Backlog", type: "backlog" as const },
            priority: "low" as const,
            type: null,
            teamId: "team-1",
            projectId: null,
            milestoneId: null,
            milestoneName: null,
            branchName: null,
            url: "https://example.com",
            labels: [],
            blockedBy: [],
            blocks: [],
            subtasks: [],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          }
          const result = yield* Schema.decode(Task)(data)
          expect(Option.isNone(result.description)).toBe(true)
        }),
      )

      it.effect("should handle optional description as Some", () =>
        Effect.gen(function* () {
          const data = {
            id: "task-1",
            identifier: "TEST-1",
            title: "Test Task",
            description: "A description",
            state: { id: "state-1", name: "Backlog", type: "backlog" as const },
            priority: "low" as const,
            type: null,
            teamId: "team-1",
            projectId: null,
            milestoneId: null,
            milestoneName: null,
            branchName: null,
            url: "https://example.com",
            labels: [],
            blockedBy: [],
            blocks: [],
            subtasks: [],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          }
          const result = yield* Schema.decode(Task)(data)
          expect(Option.isSome(result.description)).toBe(true)
          expect(Option.getOrElse(result.description, () => "")).toBe(
            "A description",
          )
        }),
      )

      it.effect("should handle optional fields with defaults", () =>
        Effect.gen(function* () {
          const data = {
            id: "task-1",
            identifier: "TEST-1",
            title: "Test Task",
            description: null,
            state: { id: "state-1", name: "Backlog", type: "backlog" as const },
            priority: "medium" as const,
            type: null,
            teamId: "team-1",
            projectId: null,
            milestoneId: null,
            milestoneName: null,
            branchName: null,
            url: "https://example.com",
            labels: [],
            blockedBy: [],
            blocks: [],
            subtasks: [],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          }
          const result = yield* Schema.decode(Task)(data)
          expect(Option.isNone(result.projectId)).toBe(true)
          expect(Option.isNone(result.branchName)).toBe(true)
          expect(Option.isNone(result.type)).toBe(true)
        }),
      )
    })

    describe("Subtask", () => {
      it.effect("should decode valid subtask data", () =>
        Effect.gen(function* () {
          const data = {
            id: "subtask-1",
            identifier: "TEST-2",
            title: "Test Subtask",
            state: "In Progress",
            stateType: "started" as const,
            priority: "high" as const,
          }
          const result = yield* Schema.decode(Subtask)(data)
          expect(result.id).toBe("subtask-1")
          expect(result.title).toBe("Test Subtask")
          expect(result.stateType).toBe("started")
        }),
      )
    })

    describe("WorkflowState", () => {
      it.effect("should decode valid workflow state data", () =>
        Effect.gen(function* () {
          const data = {
            id: "state-1",
            name: "In Progress",
            type: "started" as const,
          }
          const result = yield* Schema.decode(WorkflowState)(data)
          expect(result.id).toBe("state-1")
          expect(result.name).toBe("In Progress")
          expect(result.type).toBe("started")
        }),
      )
    })

    describe("Dependency", () => {
      it.effect("should decode valid dependency data", () =>
        Effect.gen(function* () {
          const data = {
            id: "dep-1",
            type: "blocks" as const,
            relatedTaskId: "task-2",
          }
          const result = yield* Schema.decode(Dependency)(data)
          expect(result.id).toBe("dep-1")
          expect(result.type).toBe("blocks")
          expect(result.relatedTaskId).toBe("task-2")
        }),
      )
    })

    describe("Team", () => {
      it.effect("should decode valid team data", () =>
        Effect.gen(function* () {
          const data = {
            id: "team-1",
            name: "Engineering",
            key: "ENG",
          }
          const result = yield* Schema.decode(Team)(data)
          expect(result.id).toBe("team-1")
          expect(result.name).toBe("Engineering")
          expect(result.key).toBe("ENG")
        }),
      )
    })

    describe("Project", () => {
      it.effect("should decode valid project data", () =>
        Effect.gen(function* () {
          const data = {
            id: "proj-1",
            name: "My Project",
            teamId: "team-1",
          }
          const result = yield* Schema.decode(Project)(data)
          expect(result.id).toBe("proj-1")
          expect(result.name).toBe("My Project")
          expect(result.teamId).toBe("team-1")
        }),
      )
    })

    describe("Milestone", () => {
      it.effect("should decode valid milestone data", () =>
        Effect.gen(function* () {
          const data = {
            id: "mile-1",
            name: "Q1 Release",
            description: "First quarter release",
            projectId: "proj-1",
            targetDate: "2024-03-31T00:00:00.000Z",
            sortOrder: 1,
          }
          const result = yield* Schema.decode(Milestone)(data)
          expect(result.id).toBe("mile-1")
          expect(result.name).toBe("Q1 Release")
          expect(result.sortOrder).toBe(1)
        }),
      )

      it.effect("should handle optional targetDate as None", () =>
        Effect.gen(function* () {
          const data = {
            id: "mile-1",
            name: "Q1 Release",
            description: null,
            projectId: "proj-1",
            targetDate: null,
            sortOrder: 0,
          }
          const result = yield* Schema.decode(Milestone)(data)
          expect(Option.isNone(result.targetDate)).toBe(true)
        }),
      )

      it.effect("should handle optional targetDate as Some", () =>
        Effect.gen(function* () {
          const data = {
            id: "mile-1",
            name: "Q1 Release",
            description: null,
            projectId: "proj-1",
            targetDate: "2024-03-31T00:00:00.000Z",
            sortOrder: 0,
          }
          const result = yield* Schema.decode(Milestone)(data)
          expect(Option.isSome(result.targetDate)).toBe(true)
        }),
      )
    })
  })

  describe("Input Types", () => {
    describe("CreateTaskInput", () => {
      it.effect("should decode with required fields only", () =>
        Effect.gen(function* () {
          const data = {
            title: "New Task",
            description: null,
            projectId: null,
            parentId: null,
            milestoneId: null,
          }
          const result = yield* Schema.decode(CreateTaskInput)(data)
          expect(result.title).toBe("New Task")
        }),
      )

      it.effect("should apply default priority 'medium'", () =>
        Effect.gen(function* () {
          const data = {
            title: "New Task",
            description: null,
            projectId: null,
            parentId: null,
            milestoneId: null,
          }
          const result = yield* Schema.decode(CreateTaskInput)(data)
          expect(result.priority).toBe("medium")
        }),
      )

      it.effect("should apply default type 'task'", () =>
        Effect.gen(function* () {
          const data = {
            title: "New Task",
            description: null,
            projectId: null,
            parentId: null,
            milestoneId: null,
          }
          const result = yield* Schema.decode(CreateTaskInput)(data)
          expect(result.type).toBe("task")
        }),
      )

      it.effect("should decode with all optional fields", () =>
        Effect.gen(function* () {
          const data = {
            title: "New Task",
            description: "A description",
            priority: "high" as const,
            type: "bug" as const,
            projectId: "proj-1",
            parentId: "task-parent",
            milestoneId: "mile-1",
          }
          const result = yield* Schema.decode(CreateTaskInput)(data)
          expect(result.title).toBe("New Task")
          expect(result.priority).toBe("high")
          expect(result.type).toBe("bug")
          expect(Option.isSome(result.description)).toBe(true)
          expect(Option.isSome(result.projectId)).toBe(true)
          expect(Option.isSome(result.parentId)).toBe(true)
        }),
      )
    })

    describe("UpdateTaskInput", () => {
      it.effect("should decode with all None values", () =>
        Effect.gen(function* () {
          const data = {
            title: null,
            description: null,
            status: null,
            priority: null,
            assigneeId: null,
            parentId: null,
            milestoneId: null,
          }
          const result = yield* Schema.decode(UpdateTaskInput)(data)
          expect(Option.isNone(result.title)).toBe(true)
          expect(Option.isNone(result.description)).toBe(true)
          expect(Option.isNone(result.status)).toBe(true)
          expect(Option.isNone(result.priority)).toBe(true)
        }),
      )

      it.effect("should decode with Some values", () =>
        Effect.gen(function* () {
          const data = {
            title: "Updated Title",
            description: "Updated description",
            status: "in_progress" as const,
            priority: "urgent" as const,
            assigneeId: null,
            parentId: null,
            milestoneId: null,
          }
          const result = yield* Schema.decode(UpdateTaskInput)(data)
          expect(Option.getOrElse(result.title, () => "")).toBe("Updated Title")
          expect(Option.getOrElse(result.status, () => "backlog" as const)).toBe(
            "in_progress",
          )
          expect(Option.getOrElse(result.priority, () => "none" as const)).toBe(
            "urgent",
          )
        }),
      )
    })

    describe("TaskFilter", () => {
      it.effect("should decode with default assignedToMe false", () =>
        Effect.gen(function* () {
          const data = {
            status: null,
            priority: null,
            projectId: null,
            milestoneId: null,
          }
          const result = yield* Schema.decode(TaskFilter)(data)
          expect(result.assignedToMe).toBe(false)
        }),
      )

      it.effect("should decode with default includeCompleted false", () =>
        Effect.gen(function* () {
          const data = {
            status: null,
            priority: null,
            projectId: null,
            milestoneId: null,
          }
          const result = yield* Schema.decode(TaskFilter)(data)
          expect(result.includeCompleted).toBe(false)
        }),
      )

      it.effect("should decode with explicit filter values", () =>
        Effect.gen(function* () {
          const data = {
            status: "in_progress" as const,
            priority: "high" as const,
            projectId: "proj-1",
            milestoneId: null,
            assignedToMe: true,
            includeCompleted: true,
          }
          const result = yield* Schema.decode(TaskFilter)(data)
          expect(Option.getOrElse(result.status, () => "backlog" as const)).toBe(
            "in_progress",
          )
          expect(Option.getOrElse(result.priority, () => "none" as const)).toBe(
            "high",
          )
          expect(result.assignedToMe).toBe(true)
          expect(result.includeCompleted).toBe(true)
        }),
      )
    })

    describe("CreateMilestoneInput", () => {
      it.effect("should decode with required fields only", () =>
        Effect.gen(function* () {
          const data = {
            name: "Q1 Release",
            description: null,
            targetDate: null,
          }
          const result = yield* Schema.decode(CreateMilestoneInput)(data)
          expect(result.name).toBe("Q1 Release")
        }),
      )

      it.effect("should apply default sortOrder 0", () =>
        Effect.gen(function* () {
          const data = {
            name: "Q1 Release",
            description: null,
            targetDate: null,
          }
          const result = yield* Schema.decode(CreateMilestoneInput)(data)
          expect(result.sortOrder).toBe(0)
        }),
      )
    })

    describe("UpdateMilestoneInput", () => {
      it.effect("should decode with all None values", () =>
        Effect.gen(function* () {
          const data = {
            name: null,
            description: null,
            targetDate: null,
            sortOrder: null,
          }
          const result = yield* Schema.decode(UpdateMilestoneInput)(data)
          expect(Option.isNone(result.name)).toBe(true)
          expect(Option.isNone(result.description)).toBe(true)
          expect(Option.isNone(result.targetDate)).toBe(true)
          expect(Option.isNone(result.sortOrder)).toBe(true)
        }),
      )

      it.effect("should decode with Some values", () =>
        Effect.gen(function* () {
          const data = {
            name: "Updated Milestone",
            description: "New description",
            targetDate: "2024-06-30T00:00:00.000Z",
            sortOrder: 5,
          }
          const result = yield* Schema.decode(UpdateMilestoneInput)(data)
          expect(Option.getOrElse(result.name, () => "")).toBe(
            "Updated Milestone",
          )
          expect(Option.isSome(result.targetDate)).toBe(true)
          expect(Option.getOrElse(result.sortOrder, () => 0)).toBe(5)
        }),
      )
    })
  })
})
