/**
 * IssueRepository Error Path Tests
 *
 * Tests all error paths in IssueRepository using the TestIssueRepositoryLayer.
 * Each error type is tested with at least one scenario that:
 * 1. Triggers the error condition via test layer configuration
 * 2. Verifies error `_tag`
 * 3. Verifies error message/context properties
 */

import { describe, it, expect } from "@effect/vitest";
import { Effect, Exit, Cause, Option } from "effect";

import { IssueRepository } from "../../../../src/ports/IssueRepository.js";
import {
  TaskId,
  TeamId,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
} from "../../../../src/domain/Task.js";
import {
  TaskNotFoundError,
  LinearApiError,
} from "../../../../src/domain/Errors.js";
import { TestIssueRepositoryLayer, createTestTask } from "../../../layers/index.js";

// Helper to extract failure from Exit
const getFailure = <E>(exit: Exit.Exit<unknown, E>): E | null => {
  if (Exit.isFailure(exit)) {
    const option = Cause.failureOption(exit.cause);
    return Option.isSome(option) ? option.value : null;
  }
  return null;
};

const testTeamId = "test-team-id" as TeamId;

describe("IssueRepository Error Paths", () => {
  describe("TaskNotFoundError", () => {
    it.effect("getTask fails with TaskNotFoundError for unknown task", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo.getTask("nonexistent-task" as TaskId).pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("TaskNotFoundError");
        expect((error as TaskNotFoundError).taskId).toBe("nonexistent-task");
        expect((error as TaskNotFoundError).message).toContain("nonexistent-task");
      }).pipe(Effect.provide(TestIssueRepositoryLayer({ tasks: new Map() }))),
    );

    it.effect("getTaskByIdentifier fails with TaskNotFoundError for unknown identifier", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo.getTaskByIdentifier("UNKNOWN-999").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("TaskNotFoundError");
        expect((error as TaskNotFoundError).taskId).toBe("UNKNOWN-999");
      }).pipe(Effect.provide(TestIssueRepositoryLayer({ tasks: new Map() }))),
    );

    it.effect("updateTask fails with TaskNotFoundError for unknown task", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo
          .updateTask(
            "nonexistent" as TaskId,
            new UpdateTaskInput({
              title: Option.some("New Title"),
              description: Option.none(),
              status: Option.none(),
              priority: Option.none(),
              assigneeId: Option.none(),
              parentId: Option.none(),
              milestoneId: Option.none(),
            }),
          )
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("TaskNotFoundError");
      }).pipe(Effect.provide(TestIssueRepositoryLayer({ tasks: new Map() }))),
    );

    it.effect("addBlocker fails with TaskNotFoundError when blocked task doesn't exist", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo
          .addBlocker("nonexistent" as TaskId, "test-task-id" as TaskId)
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("TaskNotFoundError");
      }).pipe(Effect.provide(TestIssueRepositoryLayer())),
    );

    it.effect("addBlocker fails with TaskNotFoundError when blocker task doesn't exist", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo
          .addBlocker("test-task-id" as TaskId, "nonexistent" as TaskId)
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("TaskNotFoundError");
      }).pipe(Effect.provide(TestIssueRepositoryLayer())),
    );

    it.effect("removeBlocker fails with TaskNotFoundError when task doesn't exist", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo
          .removeBlocker("nonexistent" as TaskId, "test-task-id" as TaskId)
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("TaskNotFoundError");
      }).pipe(Effect.provide(TestIssueRepositoryLayer())),
    );

    it.effect("addRelated fails with TaskNotFoundError when task doesn't exist", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo
          .addRelated("nonexistent" as TaskId, "test-task-id" as TaskId)
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("TaskNotFoundError");
      }).pipe(Effect.provide(TestIssueRepositoryLayer())),
    );

    it.effect("getBranchName fails with TaskNotFoundError for unknown task", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo.getBranchName("nonexistent" as TaskId).pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("TaskNotFoundError");
      }).pipe(Effect.provide(TestIssueRepositoryLayer({ tasks: new Map() }))),
    );

    it.effect("setSessionLabel fails with TaskNotFoundError for unknown task", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo
          .setSessionLabel("nonexistent" as TaskId, "session-123")
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("TaskNotFoundError");
      }).pipe(Effect.provide(TestIssueRepositoryLayer({ tasks: new Map() }))),
    );

    it.effect("setTypeLabel fails with TaskNotFoundError for unknown task", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo
          .setTypeLabel("nonexistent" as TaskId, "bug")
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("TaskNotFoundError");
      }).pipe(Effect.provide(TestIssueRepositoryLayer({ tasks: new Map() }))),
    );

    it.effect("clearSessionLabel fails with TaskNotFoundError for unknown task", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo.clearSessionLabel("nonexistent" as TaskId).pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("TaskNotFoundError");
      }).pipe(Effect.provide(TestIssueRepositoryLayer({ tasks: new Map() }))),
    );

    it.effect("removeAsBlocker fails with TaskNotFoundError for unknown task", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo.removeAsBlocker("nonexistent" as TaskId).pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("TaskNotFoundError");
      }).pipe(Effect.provide(TestIssueRepositoryLayer({ tasks: new Map() }))),
    );
  });

  describe("LinearApiError", () => {
    it.effect("getTask fails with LinearApiError when API error configured", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo.getTask("test-task-id" as TaskId).pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("LinearApiError");
        expect((error as LinearApiError).message).toContain("timeout");
        expect((error as LinearApiError).statusCode).toBe(504);
      }).pipe(
        Effect.provide(
          TestIssueRepositoryLayer({
            apiErrors: new Map([
              [
                "test-task-id",
                new LinearApiError({ message: "API timeout", statusCode: 504 }),
              ],
            ]),
          }),
        ),
      ),
    );

    it.effect("getTaskByIdentifier fails with LinearApiError when global API error set", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo.getTaskByIdentifier("TEST-123").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("LinearApiError");
        expect((error as LinearApiError).message).toContain("rate limit");
      }).pipe(
        Effect.provide(
          TestIssueRepositoryLayer({
            globalApiError: new LinearApiError({ message: "rate limit exceeded" }),
          }),
        ),
      ),
    );

    it.effect("createTask fails with LinearApiError when global API error set", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo
          .createTask(
            testTeamId,
            new CreateTaskInput({
              title: "New Task",
              description: Option.none(),
              projectId: Option.none(),
              parentId: Option.none(),
              milestoneId: Option.none(),
            }),
          )
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("LinearApiError");
      }).pipe(
        Effect.provide(
          TestIssueRepositoryLayer({
            globalApiError: new LinearApiError({ message: "service unavailable" }),
          }),
        ),
      ),
    );

    it.effect("listTasks fails with LinearApiError when global API error set", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo
          .listTasks(
            testTeamId,
            new TaskFilter({
              status: Option.none(),
              priority: Option.none(),
              projectId: Option.none(),
              milestoneId: Option.none(),
            }),
          )
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("LinearApiError");
      }).pipe(
        Effect.provide(
          TestIssueRepositoryLayer({
            globalApiError: new LinearApiError({ message: "unauthorized" }),
          }),
        ),
      ),
    );

    it.effect("getReadyTasks fails with LinearApiError when global API error set", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo.getReadyTasks(testTeamId).pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("LinearApiError");
      }).pipe(
        Effect.provide(
          TestIssueRepositoryLayer({
            globalApiError: new LinearApiError({ message: "forbidden" }),
          }),
        ),
      ),
    );

    it.effect("getBlockedTasks fails with LinearApiError when global API error set", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const exit = yield* repo.getBlockedTasks(testTeamId).pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("LinearApiError");
      }).pipe(
        Effect.provide(
          TestIssueRepositoryLayer({
            globalApiError: new LinearApiError({ message: "server error" }),
          }),
        ),
      ),
    );
  });

  describe("Success paths (sanity checks)", () => {
    it.effect("getTask returns task when it exists", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const task = yield* repo.getTask("test-task-id" as TaskId);
        expect(task.id).toBe("test-task-id");
        expect(task.identifier).toBe("TEST-123");
      }).pipe(Effect.provide(TestIssueRepositoryLayer())),
    );

    it.effect("getTaskByIdentifier returns task when it exists", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const task = yield* repo.getTaskByIdentifier("TEST-123");
        expect(task.identifier).toBe("TEST-123");
      }).pipe(Effect.provide(TestIssueRepositoryLayer())),
    );

    it.effect("createTask creates and returns new task", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const task = yield* repo.createTask(
          testTeamId,
          new CreateTaskInput({
            title: "New Task",
            description: Option.some("Description"),
            projectId: Option.none(),
            parentId: Option.none(),
            milestoneId: Option.none(),
          }),
        );
        expect(task.title).toBe("New Task");
        expect(task.teamId).toBe(testTeamId);
      }).pipe(Effect.provide(TestIssueRepositoryLayer())),
    );

    it.effect("updateTask updates and returns task", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const task = yield* repo.updateTask(
          "test-task-id" as TaskId,
          new UpdateTaskInput({
            title: Option.some("Updated Title"),
            description: Option.none(),
            status: Option.none(),
            priority: Option.none(),
            assigneeId: Option.none(),
            parentId: Option.none(),
            milestoneId: Option.none(),
          }),
        );
        expect(task.title).toBe("Updated Title");
      }).pipe(Effect.provide(TestIssueRepositoryLayer())),
    );

    it.effect("listTasks returns tasks for team", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const tasks = yield* repo.listTasks(
          testTeamId,
          new TaskFilter({
            status: Option.none(),
            priority: Option.none(),
            projectId: Option.none(),
            milestoneId: Option.none(),
          }),
        );
        expect(tasks.length).toBeGreaterThan(0);
      }).pipe(Effect.provide(TestIssueRepositoryLayer())),
    );

    it.effect("getReadyTasks returns tasks without incomplete blockers", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const tasks = yield* repo.getReadyTasks(testTeamId);
        // Default test tasks have no blockers, so all should be ready
        expect(tasks.length).toBeGreaterThan(0);
      }).pipe(Effect.provide(TestIssueRepositoryLayer())),
    );

    it.effect("getReadyTasks excludes tasks with incomplete blockers", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const tasks = yield* repo.getReadyTasks(testTeamId);

        // task-blocked should NOT appear (has incomplete blocker)
        expect(tasks.find((t) => t.id === "task-blocked")).toBeUndefined();
        // task-ready should appear (no blockers)
        expect(tasks.find((t) => t.id === "task-ready")).toBeDefined();
      }).pipe(
        Effect.provide(
          TestIssueRepositoryLayer({
            tasks: new Map([
              [
                "task-blocked",
                createTestTask({
                  id: "task-blocked",
                  identifier: "TEST-1",
                  blockedBy: ["blocker-incomplete"],
                }),
              ],
              [
                "blocker-incomplete",
                createTestTask({
                  id: "blocker-incomplete",
                  identifier: "TEST-2",
                  blocks: ["task-blocked"],
                  stateType: "unstarted",
                }),
              ],
              [
                "task-ready",
                createTestTask({
                  id: "task-ready",
                  identifier: "TEST-3",
                }),
              ],
            ]),
          }),
        ),
      ),
    );

    it.effect("getReadyTasks includes tasks whose blockers are all completed", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const tasks = yield* repo.getReadyTasks(testTeamId);

        // task-with-completed-blocker SHOULD appear (blocker is done)
        expect(tasks.find((t) => t.id === "task-with-completed-blocker")).toBeDefined();
      }).pipe(
        Effect.provide(
          TestIssueRepositoryLayer({
            tasks: new Map([
              [
                "task-with-completed-blocker",
                createTestTask({
                  id: "task-with-completed-blocker",
                  identifier: "TEST-1",
                  blockedBy: ["blocker-completed"],
                }),
              ],
              [
                "blocker-completed",
                createTestTask({
                  id: "blocker-completed",
                  identifier: "TEST-2",
                  blocks: ["task-with-completed-blocker"],
                  stateType: "completed",
                }),
              ],
            ]),
          }),
        ),
      ),
    );

    it.effect("getBlockedTasks returns only tasks with incomplete blockers", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const tasks = yield* repo.getBlockedTasks(testTeamId);

        // task-blocked should appear (has incomplete blocker)
        expect(tasks.find((t) => t.id === "task-blocked")).toBeDefined();
        // task-with-completed-blocker should NOT appear (blocker is done)
        expect(tasks.find((t) => t.id === "task-with-completed-blocker")).toBeUndefined();
      }).pipe(
        Effect.provide(
          TestIssueRepositoryLayer({
            tasks: new Map([
              [
                "task-blocked",
                createTestTask({
                  id: "task-blocked",
                  identifier: "TEST-1",
                  blockedBy: ["blocker-incomplete"],
                }),
              ],
              [
                "blocker-incomplete",
                createTestTask({
                  id: "blocker-incomplete",
                  identifier: "TEST-2",
                  blocks: ["task-blocked"],
                  stateType: "unstarted",
                }),
              ],
              [
                "task-with-completed-blocker",
                createTestTask({
                  id: "task-with-completed-blocker",
                  identifier: "TEST-3",
                  blockedBy: ["blocker-completed"],
                }),
              ],
              [
                "blocker-completed",
                createTestTask({
                  id: "blocker-completed",
                  identifier: "TEST-4",
                  blocks: ["task-with-completed-blocker"],
                  stateType: "completed",
                }),
              ],
            ]),
          }),
        ),
      ),
    );

    it.effect("addBlocker adds blocking relationship", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        // Create two tasks
        const task1 = yield* repo.createTask(
          testTeamId,
          new CreateTaskInput({
            title: "Task 1",
            description: Option.none(),
            projectId: Option.none(),
            parentId: Option.none(),
            milestoneId: Option.none(),
          }),
        );
        const task2 = yield* repo.createTask(
          testTeamId,
          new CreateTaskInput({
            title: "Task 2",
            description: Option.none(),
            projectId: Option.none(),
            parentId: Option.none(),
            milestoneId: Option.none(),
          }),
        );

        // Add blocker
        yield* repo.addBlocker(task1.id, task2.id);

        // Verify
        const updatedTask1 = yield* repo.getTask(task1.id);
        expect(updatedTask1.blockedBy).toContain(task2.id);
      }).pipe(Effect.provide(TestIssueRepositoryLayer())),
    );

    it.effect("removeBlocker removes blocking relationship", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        yield* repo.removeBlocker("blocked-task" as TaskId, "blocker-task" as TaskId);

        const updated = yield* repo.getTask("blocked-task" as TaskId);
        expect(updated.blockedBy).not.toContain("blocker-task");
      }).pipe(
        Effect.provide(
          TestIssueRepositoryLayer({
            tasks: new Map([
              [
                "blocked-task",
                createTestTask({
                  id: "blocked-task",
                  identifier: "TEST-1",
                  blockedBy: ["blocker-task"],
                }),
              ],
              [
                "blocker-task",
                createTestTask({
                  id: "blocker-task",
                  identifier: "TEST-2",
                  blocks: ["blocked-task"],
                }),
              ],
            ]),
          }),
        ),
      ),
    );

    it.effect("getBranchName returns branch name for task", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const branchName = yield* repo.getBranchName("test-task-id" as TaskId);
        expect(branchName).toBeDefined();
        expect(branchName.length).toBeGreaterThan(0);
      }).pipe(Effect.provide(TestIssueRepositoryLayer())),
    );

    it.effect("setSessionLabel adds session label to task", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        yield* repo.setSessionLabel("test-task-id" as TaskId, "session-abc");
        const task = yield* repo.getTask("test-task-id" as TaskId);
        expect(task.labels).toContain("session:session-abc");
      }).pipe(Effect.provide(TestIssueRepositoryLayer())),
    );

    it.effect("setTypeLabel adds type label to task", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        yield* repo.setTypeLabel("test-task-id" as TaskId, "bug");
        const task = yield* repo.getTask("test-task-id" as TaskId);
        expect(task.labels).toContain("type:bug");
        expect(Option.isSome(task.type) && Option.getOrThrow(task.type) === "bug").toBe(true);
      }).pipe(Effect.provide(TestIssueRepositoryLayer())),
    );

    it.effect("clearSessionLabel removes session label from task", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        // First add a session label
        yield* repo.setSessionLabel("test-task-id" as TaskId, "session-xyz");
        // Then clear it
        yield* repo.clearSessionLabel("test-task-id" as TaskId);
        const task = yield* repo.getTask("test-task-id" as TaskId);
        expect(task.labels.some((l) => l.startsWith("session:"))).toBe(false);
      }).pipe(Effect.provide(TestIssueRepositoryLayer())),
    );

    it.effect("removeAsBlocker removes all blocking relationships", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const unblocked = yield* repo.removeAsBlocker("blocker-task" as TaskId);
        expect(unblocked).toContain("TEST-1");
      }).pipe(
        Effect.provide(
          TestIssueRepositoryLayer({
            tasks: new Map([
              [
                "blocked-task",
                createTestTask({
                  id: "blocked-task",
                  identifier: "TEST-1",
                  blockedBy: ["blocker-task"],
                }),
              ],
              [
                "blocker-task",
                createTestTask({
                  id: "blocker-task",
                  identifier: "TEST-2",
                  blocks: ["blocked-task"],
                }),
              ],
            ]),
          }),
        ),
      ),
    );
  });

  describe("Filter behavior", () => {
    it.effect("listTasks filters by priority", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const tasks = yield* repo.listTasks(
          testTeamId,
          new TaskFilter({
            status: Option.none(),
            priority: Option.some("high"),
            projectId: Option.none(),
            milestoneId: Option.none(),
          }),
        );
        expect(tasks.every((t) => t.priority === "high")).toBe(true);
      }).pipe(
        Effect.provide(
          TestIssueRepositoryLayer({
            tasks: new Map([
              [
                "high-task",
                createTestTask({ id: "high-task", identifier: "TEST-1", priority: "high" }),
              ],
              [
                "low-task",
                createTestTask({ id: "low-task", identifier: "TEST-2", priority: "low" }),
              ],
            ]),
          }),
        ),
      ),
    );

    it.effect("listTasks excludes completed tasks by default", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const tasks = yield* repo.listTasks(
          testTeamId,
          new TaskFilter({
            status: Option.none(),
            priority: Option.none(),
            projectId: Option.none(),
            milestoneId: Option.none(),
            includeCompleted: false,
          }),
        );
        expect(tasks.every((t) => !t.isDone)).toBe(true);
      }).pipe(
        Effect.provide(
          TestIssueRepositoryLayer({
            tasks: new Map([
              [
                "active-task",
                createTestTask({
                  id: "active-task",
                  identifier: "TEST-1",
                  stateType: "started",
                }),
              ],
              [
                "done-task",
                createTestTask({
                  id: "done-task",
                  identifier: "TEST-2",
                  stateType: "completed",
                }),
              ],
            ]),
          }),
        ),
      ),
    );

    it.effect("getBlockedTasks returns only tasks with incomplete blockers", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const tasks = yield* repo.getBlockedTasks(testTeamId);
        expect(tasks.length).toBe(1);
        expect(tasks[0].identifier).toBe("TEST-1");
      }).pipe(
        Effect.provide(
          TestIssueRepositoryLayer({
            tasks: new Map([
              [
                "blocked-task",
                createTestTask({
                  id: "blocked-task",
                  identifier: "TEST-1",
                  blockedBy: ["blocker-task"],
                }),
              ],
              [
                "blocker-task",
                createTestTask({
                  id: "blocker-task",
                  identifier: "TEST-3",
                  blocks: ["blocked-task"],
                  stateType: "unstarted", // Blocker is incomplete
                }),
              ],
              [
                "ready-task",
                createTestTask({
                  id: "ready-task",
                  identifier: "TEST-2",
                  blockedBy: [],
                }),
              ],
            ]),
          }),
        ),
      ),
    );
  });
});
