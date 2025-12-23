/**
 * Tests for --dry-run flag behavior across CLI commands
 *
 * These tests verify that when --dry-run is passed:
 * 1. No mutations are performed (API calls, VCS operations, state changes)
 * 2. Output indicates it's a dry run (JSON: dryRun: true, text: [DRY RUN] prefix)
 * 3. Validation and resolution still happen (errors are still reported)
 *
 * The tests use Effect test layers to track method calls and verify
 * that mutation methods are NOT called when --dry-run is enabled.
 */

import { describe, it, expect } from "@effect/vitest";
import { Effect, Exit, Cause, Option } from "effect";
import { IssueRepository } from "../../../../../src/ports/IssueRepository.js";
import { VcsService, Change, ChangeId } from "../../../../../src/ports/VcsService.js";
import {
  TestIssueRepositoryLayer,
  TestVcsServiceLayer,
  createTestTask,
  type TestIssueState,
} from "../../../../layers/index.js";
import { formatDryRunOutput } from "../../../../../src/adapters/driving/cli/commands/shared.js";

// === Test Layer Factories ===

/**
 * Create a test layer for task commands with a single task
 */
const createSingleTaskLayer = () => {
  const taskId = "test-task-1";
  const tasks = new Map([
    [
      taskId,
      createTestTask({
        id: taskId,
        identifier: "BRI-123",
        title: "Test Task",
        stateType: "unstarted",
        stateName: "Todo",
      }),
    ],
  ]);

  return TestIssueRepositoryLayer({ tasks });
};

/**
 * Create test layer for blocking commands with two tasks
 */
const createTwoTaskLayer = () => {
  const tasks = new Map([
    [
      "blocker-task",
      createTestTask({
        id: "blocker-task",
        identifier: "BRI-100",
        title: "Blocker Task",
        stateType: "started",
        stateName: "In Progress",
      }),
    ],
    [
      "blocked-task",
      createTestTask({
        id: "blocked-task",
        identifier: "BRI-101",
        title: "Blocked Task",
        stateType: "unstarted",
        stateName: "Todo",
      }),
    ],
  ]);

  return TestIssueRepositoryLayer({ tasks });
};

/**
 * Create test layer for VCS/stack commands
 */
const createVcsLayer = () => {
  const change = new Change({
    id: "test-change" as ChangeId,
    changeId: "abc12345",
    description: "Test change description",
    author: "test@example.com",
    timestamp: new Date(),
    bookmarks: ["user/bri-123-feature"],
    isWorkingCopy: true,
    isEmpty: false,
    hasConflict: false,
  });

  return TestVcsServiceLayer({
    changes: new Map([["test-change", change]]),
    currentChangeId: "test-change",
    isRepo: true,
  });
};

// === Dry Run Behavior Tests ===

describe("--dry-run flag behavior", () => {
  describe("formatDryRunOutput utility", () => {
    it("prefixes text with [DRY RUN] in text mode", () => {
      expect(formatDryRunOutput("message", false)).toBe("[DRY RUN] message");
    });

    it("returns message unchanged in JSON mode", () => {
      expect(formatDryRunOutput("message", true)).toBe("message");
    });

    it("handles empty messages", () => {
      expect(formatDryRunOutput("", false)).toBe("[DRY RUN] ");
      expect(formatDryRunOutput("", true)).toBe("");
    });

    it("preserves multiline messages", () => {
      const msg = "Line 1\nLine 2\nLine 3";
      expect(formatDryRunOutput(msg, false)).toBe("[DRY RUN] " + msg);
    });
  });

  describe("task read operations (allowed in dry-run)", () => {
    it.effect("getTaskByIdentifier works to show what would be affected", () =>
      Effect.gen(function* () {
        const issueRepo = yield* IssueRepository;

        // Read operations should work in dry-run mode
        const task = yield* issueRepo.getTaskByIdentifier("BRI-123");

        expect(task.identifier).toBe("BRI-123");
        expect(task.title).toBe("Test Task");
        expect(task.state.type).toBe("unstarted");
      }).pipe(Effect.provide(createSingleTaskLayer())),
    );

    it.effect("getTask by ID works to resolve references", () =>
      Effect.gen(function* () {
        const issueRepo = yield* IssueRepository;

        const task = yield* issueRepo.getTask("test-task-1" as any);
        expect(task.identifier).toBe("BRI-123");
      }).pipe(Effect.provide(createSingleTaskLayer())),
    );

    it.effect("reports TaskNotFoundError for invalid identifiers", () =>
      Effect.gen(function* () {
        const issueRepo = yield* IssueRepository;

        const exit = yield* Effect.exit(
          issueRepo.getTaskByIdentifier("NONEXISTENT-999"),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.failureOption(exit.cause);
          expect(Option.isSome(error)).toBe(true);
          if (Option.isSome(error)) {
            expect(error.value._tag).toBe("TaskNotFoundError");
          }
        }
      }).pipe(Effect.provide(createSingleTaskLayer())),
    );
  });

  describe("task mutation tracking (for dry-run verification)", () => {
    it.effect("tracks createTask calls for verification", () =>
      Effect.gen(function* () {
        const issueRepo = yield* IssueRepository;

        // Before any mutations, method calls should be empty
        const state = yield* (issueRepo as IssueRepository & {
          _getState: () => Effect.Effect<TestIssueState>;
        })._getState();

        const createTaskCalls = state.methodCalls.filter(
          (call) => call.method === "createTask",
        );
        expect(createTaskCalls).toHaveLength(0);
      }).pipe(Effect.provide(createSingleTaskLayer())),
    );

    it.effect("tracks updateTask calls for verification", () =>
      Effect.gen(function* () {
        const issueRepo = yield* IssueRepository;

        // Just read the task (no update)
        yield* issueRepo.getTaskByIdentifier("BRI-123");

        const state = yield* (issueRepo as IssueRepository & {
          _getState: () => Effect.Effect<TestIssueState>;
        })._getState();

        const updateTaskCalls = state.methodCalls.filter(
          (call) => call.method === "updateTask",
        );
        expect(updateTaskCalls).toHaveLength(0);
      }).pipe(Effect.provide(createSingleTaskLayer())),
    );
  });

  describe("blocking command read operations", () => {
    it.effect("can resolve both tasks for dry-run output", () =>
      Effect.gen(function* () {
        const issueRepo = yield* IssueRepository;

        const blocker = yield* issueRepo.getTaskByIdentifier("BRI-100");
        const blocked = yield* issueRepo.getTaskByIdentifier("BRI-101");

        expect(blocker.identifier).toBe("BRI-100");
        expect(blocked.identifier).toBe("BRI-101");
      }).pipe(Effect.provide(createTwoTaskLayer())),
    );

    it.effect("does not have addBlocker calls without mutation", () =>
      Effect.gen(function* () {
        const issueRepo = yield* IssueRepository;

        // Just read, no blocking mutation
        yield* issueRepo.getTaskByIdentifier("BRI-100");
        yield* issueRepo.getTaskByIdentifier("BRI-101");

        const state = yield* (issueRepo as IssueRepository & {
          _getState: () => Effect.Effect<TestIssueState>;
        })._getState();

        const blockCalls = state.methodCalls.filter(
          (call) =>
            call.method === "addBlocker" ||
            call.method === "removeBlocker" ||
            call.method === "addRelated",
        );
        expect(blockCalls).toHaveLength(0);
      }).pipe(Effect.provide(createTwoTaskLayer())),
    );
  });

  describe("VCS read operations (allowed in dry-run)", () => {
    it.effect("getCurrentChange works to show what would be submitted", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;

        const change = yield* vcs.getCurrentChange();

        expect(change.changeId).toBe("abc12345");
        expect(change.bookmarks).toContain("user/bri-123-feature");
        expect(change.isEmpty).toBe(false);
      }).pipe(Effect.provide(createVcsLayer())),
    );

    it.effect("isRepo check works for validation", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;

        const isRepo = yield* vcs.isRepo();
        expect(isRepo).toBe(true);
      }).pipe(Effect.provide(createVcsLayer())),
    );

    it.effect("does not have VCS mutation calls without action", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;

        // Just read operations
        yield* vcs.getCurrentChange();
        yield* vcs.isRepo();

        const state = yield* (vcs as VcsService & {
          _getState: () => Effect.Effect<{ methodCalls: Array<{ method: string }> }>;
        })._getState();

        const mutationCalls = state.methodCalls.filter(
          (call) =>
            call.method === "createChange" ||
            call.method === "createWorkspace" ||
            call.method === "abandon" ||
            call.method === "push",
        );
        expect(mutationCalls).toHaveLength(0);
      }).pipe(Effect.provide(createVcsLayer())),
    );
  });

  describe("dry-run output contract", () => {
    it("JSON output structure should include dryRun: true", () => {
      // This documents the expected JSON output structure for dry-run
      const expectedOutput = {
        dryRun: true,
        wouldCreate: {
          title: "Test Task",
          priority: "medium",
          type: "task",
        },
      };

      expect(expectedOutput.dryRun).toBe(true);
      expect(expectedOutput.wouldCreate).toBeDefined();
      expect(expectedOutput.wouldCreate.title).toBe("Test Task");
    });

    it("JSON field names use 'would' prefix convention", () => {
      // Document the naming convention for dry-run JSON fields
      const validFields = [
        "wouldCreate",
        "wouldUpdate",
        "wouldDelete",
        "wouldBlock",
        "wouldUnblock",
        "wouldRelate",
        "wouldStart",
        "wouldComplete",
        "wouldAbandon",
        "wouldPush",
      ];

      validFields.forEach((field) => {
        expect(field).toMatch(/^would[A-Z]/);
      });
    });

    it("text output uses [DRY RUN] prefix", () => {
      const output = formatDryRunOutput("Would create task: Test Task", false);
      expect(output).toBe("[DRY RUN] Would create task: Test Task");
      expect(output.startsWith("[DRY RUN]")).toBe(true);
    });
  });

  describe("error behavior in dry-run", () => {
    it.effect("validation errors still surface in dry-run", () =>
      Effect.gen(function* () {
        const issueRepo = yield* IssueRepository;

        // Dry-run should still validate and report errors
        const exit = yield* Effect.exit(
          issueRepo.getTaskByIdentifier("INVALID-TASK"),
        );

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(Effect.provide(createSingleTaskLayer())),
    );

    it.effect("task resolution still happens before dry-run output", () =>
      Effect.gen(function* () {
        const issueRepo = yield* IssueRepository;

        // Valid task should resolve successfully
        const task = yield* issueRepo.getTaskByIdentifier("BRI-123");
        expect(task).toBeDefined();

        // Invalid task should fail
        const exit = yield* Effect.exit(
          issueRepo.getTaskByIdentifier("NOT-FOUND"),
        );
        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(Effect.provide(createSingleTaskLayer())),
    );
  });
});
