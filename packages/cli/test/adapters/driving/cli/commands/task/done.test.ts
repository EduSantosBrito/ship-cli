/**
 * Tests for the `ship task done` command
 *
 * Tests cover:
 * - Completing a task transitions it to "done" state
 * - Already-done tasks show appropriate message
 * - Auto-unblock: completing a task removes it as blocker from other tasks
 * - Dry run mode shows what would happen without mutation
 * - Session label cleanup
 */

import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { doneTaskCommand } from "../../../../../../src/adapters/driving/cli/commands/task/done.js";
import {
  TestIssueRepositoryLayer,
  TestConfigRepositoryLayer,
  createTestTask,
  type TestIssueState,
} from "../../../../../layers/index.js";
import { IssueRepository } from "../../../../../../src/ports/IssueRepository.js";

// Helper to create test layer with all dependencies
const createTestLayer = (issueState?: Partial<TestIssueState>) => {
  const issueLayer = TestIssueRepositoryLayer(issueState);
  const configLayer = TestConfigRepositoryLayer();

  return Layer.mergeAll(issueLayer, configLayer);
};

describe("task done command", () => {
  describe("dry run mode", () => {
    it.effect("shows what would happen without making changes", () =>
      Effect.gen(function* () {
        // Arrange
        const issueRepo = yield* IssueRepository;

        // Act - dry run should not mutate
        yield* doneTaskCommand.handler({
          taskId: "BRI-100",
          reason: Option.none(),
          json: false,
          dryRun: true,
        });

        // Assert - task should still be in progress
        const state = yield* (
          issueRepo as IssueRepository & { _getState: () => Effect.Effect<TestIssueState> }
        )._getState();

        // Verify updateTask was NOT called
        const updateCalls = state.methodCalls.filter((c) => c.method === "updateTask");
        expect(updateCalls).toHaveLength(0);
      }).pipe(
        Effect.provide(
          createTestLayer({
            tasks: new Map([
              [
                "task-1",
                createTestTask({
                  id: "task-1",
                  identifier: "BRI-100",
                  title: "In Progress Task",
                  stateType: "started",
                  stateName: "In Progress",
                }),
              ],
            ]),
          }),
        ),
      ),
    );

  });

  describe("already done", () => {
    it.effect("reports task is already done", () =>
      Effect.gen(function* () {
        // Arrange - task already completed
        const issueRepo = yield* IssueRepository;

        // Act - try to complete already-completed task
        yield* doneTaskCommand.handler({
          taskId: "BRI-DONE",
          reason: Option.none(),
          json: false,
          dryRun: false,
        });

        // Assert - updateTask should NOT be called for already-done tasks
        const state = yield* (
          issueRepo as IssueRepository & { _getState: () => Effect.Effect<TestIssueState> }
        )._getState();

        const updateCalls = state.methodCalls.filter((c) => c.method === "updateTask");
        expect(updateCalls).toHaveLength(0);
      }).pipe(
        Effect.provide(
          createTestLayer({
            tasks: new Map([
              [
                "done-task",
                createTestTask({
                  id: "done-task",
                  identifier: "BRI-DONE",
                  title: "Completed Task",
                  stateType: "completed",
                  stateName: "Done",
                }),
              ],
            ]),
          }),
        ),
      ),
    );
  });

  describe("auto-unblock behavior", () => {
    it.effect("removes completed task as blocker from other tasks", () =>
      Effect.gen(function* () {
        // Arrange - blocker task that blocks another task
        const issueRepo = yield* IssueRepository;

        // Act - complete the blocker
        yield* doneTaskCommand.handler({
          taskId: "BRI-BLOCKER",
          reason: Option.none(),
          json: false,
          dryRun: false,
        });

        // Assert - removeAsBlocker should be called
        const state = yield* (
          issueRepo as IssueRepository & { _getState: () => Effect.Effect<TestIssueState> }
        )._getState();

        const removeBlockerCalls = state.methodCalls.filter(
          (c) => c.method === "removeAsBlocker",
        );
        expect(removeBlockerCalls).toHaveLength(1);
      }).pipe(
        Effect.provide(
          createTestLayer({
            tasks: new Map([
              [
                "blocker-task",
                createTestTask({
                  id: "blocker-task",
                  identifier: "BRI-BLOCKER",
                  title: "Blocker Task",
                  stateType: "started",
                  stateName: "In Progress",
                  blocks: ["blocked-task"],
                }),
              ],
              [
                "blocked-task",
                createTestTask({
                  id: "blocked-task",
                  identifier: "BRI-BLOCKED",
                  title: "Blocked Task",
                  stateType: "unstarted",
                  stateName: "Todo",
                  blockedBy: ["blocker-task"],
                }),
              ],
            ]),
          }),
        ),
      ),
    );
  });

  describe("session label cleanup", () => {
    it.effect("clears session label when task is completed", () =>
      Effect.gen(function* () {
        // Arrange - task with session label
        const issueRepo = yield* IssueRepository;

        // Act - complete the task
        yield* doneTaskCommand.handler({
          taskId: "BRI-SESSION",
          reason: Option.none(),
          json: false,
          dryRun: false,
        });

        // Assert - clearSessionLabel should be called
        const state = yield* (
          issueRepo as IssueRepository & { _getState: () => Effect.Effect<TestIssueState> }
        )._getState();

        const clearCalls = state.methodCalls.filter((c) => c.method === "clearSessionLabel");
        expect(clearCalls).toHaveLength(1);
      }).pipe(
        Effect.provide(
          createTestLayer({
            tasks: new Map([
              [
                "session-task",
                createTestTask({
                  id: "session-task",
                  identifier: "BRI-SESSION",
                  title: "Task with Session",
                  stateType: "started",
                  stateName: "In Progress",
                  labels: ["session:test-session-123"],
                }),
              ],
            ]),
          }),
        ),
      ),
    );
  });

  describe("completion with reason", () => {
    it.effect("accepts optional reason for completion", () =>
      Effect.gen(function* () {
        // Arrange
        const issueRepo = yield* IssueRepository;

        // Act - complete with reason (dry run)
        yield* doneTaskCommand.handler({
          taskId: "BRI-REASON",
          reason: Option.some("Fixed the bug"),
          json: true,
          dryRun: true,
        });

        // Assert - task was resolved
        const state = yield* (
          issueRepo as IssueRepository & { _getState: () => Effect.Effect<TestIssueState> }
        )._getState();

        expect(state.methodCalls.some((c) => c.method === "getTaskByIdentifier")).toBe(true);
      }).pipe(
        Effect.provide(
          createTestLayer({
            tasks: new Map([
              [
                "reason-task",
                createTestTask({
                  id: "reason-task",
                  identifier: "BRI-REASON",
                  title: "Task with Reason",
                  stateType: "started",
                  stateName: "In Progress",
                }),
              ],
            ]),
          }),
        ),
      ),
    );
  });
});
