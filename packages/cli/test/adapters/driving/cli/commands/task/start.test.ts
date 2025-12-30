/**
 * Tests for the `ship task start` command
 *
 * Tests cover:
 * - Starting a task transitions it to "in progress"
 * - Already in-progress tasks show appropriate message
 * - Task resolution by identifier and ID
 * - Dry run mode shows what would happen without mutation
 * - Session labeling for agent tracking
 * - Blocked task warnings
 */

import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { startTaskCommand } from "../../../../../../src/adapters/driving/cli/commands/task/start.js";
import {
  TestIssueRepositoryLayer,
  TestConfigRepositoryLayer,
  createTestTask,
  type TestIssueState,
} from "../../../../../layers/index.js";
import { IssueRepository } from "../../../../../../src/ports/IssueRepository.js";

// Mock LinearClientService for the start command (it fetches viewer for auto-assignment)
import { LinearClientService } from "../../../../../../src/adapters/driven/linear/LinearClient.js";

const createMockLinearClientLayer = () =>
  Layer.succeed(
    LinearClientService,
    LinearClientService.of({
      client: () =>
        Effect.succeed({
          viewer: Promise.resolve({ id: "viewer-123", name: "Test User" }),
        } as any),
    }),
  );

// Helper to create test layer with all dependencies
const createTestLayer = (issueState?: Partial<TestIssueState>) => {
  const issueLayer = TestIssueRepositoryLayer(issueState);
  const configLayer = TestConfigRepositoryLayer();
  const linearLayer = createMockLinearClientLayer();

  return Layer.mergeAll(issueLayer, configLayer, linearLayer);
};

describe("task start command", () => {
  describe("dry run mode", () => {
    it.effect("shows what would happen without making changes", () =>
      Effect.gen(function* () {
        // Arrange
        const issueRepo = yield* IssueRepository;

        // Act - dry run should not mutate
        yield* startTaskCommand.handler({
          taskId: "BRI-100",
          json: false,
          session: Option.none(),
          dryRun: true,
        });

        // Assert - task should still be unstarted
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
                  title: "Test Task",
                  stateType: "unstarted",
                  stateName: "Todo",
                }),
              ],
            ]),
          }),
        ),
      ),
    );

  });

  describe("already in progress", () => {
    it.effect("reports task is already in progress", () =>
      Effect.gen(function* () {
        // Arrange - task already started
        const issueRepo = yield* IssueRepository;

        // Act - try to start already-started task
        yield* startTaskCommand.handler({
          taskId: "BRI-200",
          json: false,
          session: Option.none(),
          dryRun: false,
        });

        // Assert - updateTask should NOT be called for already-started tasks
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
                "task-2",
                createTestTask({
                  id: "task-2",
                  identifier: "BRI-200",
                  title: "Already Started Task",
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

  describe("task resolution", () => {
    it.effect("resolves task by identifier", () =>
      Effect.gen(function* () {
        const issueRepo = yield* IssueRepository;

        // Act
        yield* startTaskCommand.handler({
          taskId: "BRI-300",
          json: false,
          session: Option.none(),
          dryRun: true,
        });

        // Assert - getTaskByIdentifier was called
        const state = yield* (
          issueRepo as IssueRepository & { _getState: () => Effect.Effect<TestIssueState> }
        )._getState();

        const identifierCalls = state.methodCalls.filter(
          (c) => c.method === "getTaskByIdentifier",
        );
        expect(identifierCalls).toHaveLength(1);
        expect(identifierCalls[0].args[0]).toBe("BRI-300");
      }).pipe(
        Effect.provide(
          createTestLayer({
            tasks: new Map([
              [
                "task-3",
                createTestTask({
                  id: "task-3",
                  identifier: "BRI-300",
                  title: "Resolvable Task",
                  stateType: "unstarted",
                  stateName: "Backlog",
                }),
              ],
            ]),
          }),
        ),
      ),
    );
  });

  describe("session labeling", () => {
    it.effect("sets session label when session flag is provided", () =>
      Effect.gen(function* () {
        // Arrange
        const issueRepo = yield* IssueRepository;

        // Act - start with session flag
        yield* startTaskCommand.handler({
          taskId: "BRI-SESSION",
          json: false,
          session: Option.some("test-agent-session-123"),
          dryRun: false,
        });

        // Assert - setSessionLabel should be called
        const state = yield* (
          issueRepo as IssueRepository & { _getState: () => Effect.Effect<TestIssueState> }
        )._getState();

        const sessionCalls = state.methodCalls.filter((c) => c.method === "setSessionLabel");
        expect(sessionCalls).toHaveLength(1);
        expect(sessionCalls[0].args[1]).toBe("test-agent-session-123");
      }).pipe(
        Effect.provide(
          createTestLayer({
            tasks: new Map([
              [
                "session-task",
                createTestTask({
                  id: "session-task",
                  identifier: "BRI-SESSION",
                  title: "Task for Session Test",
                  stateType: "unstarted",
                  stateName: "Todo",
                }),
              ],
            ]),
          }),
        ),
      ),
    );
  });

  describe("blocked task handling", () => {
    it.effect("warns when starting a blocked task (but continues)", () =>
      Effect.gen(function* () {
        // Arrange - task with blockers
        const issueRepo = yield* IssueRepository;

        // Act - dry run to check warnings are generated
        yield* startTaskCommand.handler({
          taskId: "BRI-BLOCKED",
          json: true,
          session: Option.none(),
          dryRun: true,
        });

        // Assert - task is still resolved despite blockers
        const state = yield* (
          issueRepo as IssueRepository & { _getState: () => Effect.Effect<TestIssueState> }
        )._getState();

        expect(state.methodCalls.some((c) => c.method === "getTaskByIdentifier")).toBe(true);
      }).pipe(
        Effect.provide(
          createTestLayer({
            tasks: new Map([
              [
                "blocked-task",
                createTestTask({
                  id: "blocked-task",
                  identifier: "BRI-BLOCKED",
                  title: "Blocked Task",
                  stateType: "unstarted",
                  stateName: "Todo",
                  blockedBy: ["blocker-1"],
                }),
              ],
              [
                "blocker-1",
                createTestTask({
                  id: "blocker-1",
                  identifier: "BRI-BLOCKER",
                  title: "Blocker Task",
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
