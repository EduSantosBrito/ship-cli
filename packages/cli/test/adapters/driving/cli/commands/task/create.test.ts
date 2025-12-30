/**
 * Tests for the `ship task create` command
 *
 * Tests cover:
 * - Creating a task with title and default values
 * - Creating a task with all options (description, priority, type)
 * - Template application (title formatting, description, defaults)
 * - Parent task (subtask) creation
 * - Dry run mode shows what would be created
 */

import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { createTaskCommand } from "../../../../../../src/adapters/driving/cli/commands/task/create.js";
import {
  TestIssueRepositoryLayer,
  TestConfigRepositoryLayer,
  TestTemplateServiceLayer,
  createTestTask,
  createTestTemplate,
  type TestIssueState,
} from "../../../../../layers/index.js";
import { IssueRepository } from "../../../../../../src/ports/IssueRepository.js";

// Helper to create test layer with all dependencies
const createTestLayer = (
  issueState?: Partial<TestIssueState>,
  templates?: Map<string, ReturnType<typeof createTestTemplate>>,
) => {
  const issueLayer = TestIssueRepositoryLayer(issueState);
  const configLayer = TestConfigRepositoryLayer();
  const templateLayer = TestTemplateServiceLayer(
    templates ? { templates } : undefined,
  );

  return Layer.mergeAll(issueLayer, configLayer, templateLayer);
};

describe("task create command", () => {
  describe("dry run mode", () => {
    it.effect("shows what would be created without making changes", () =>
      Effect.gen(function* () {
        // Arrange
        const issueRepo = yield* IssueRepository;

        // Act - dry run should not create task
        yield* createTaskCommand.handler({
          title: "New Task",
          description: Option.none(),
          priority: Option.none(),
          type: Option.none(),
          template: Option.none(),
          parent: Option.none(),
          json: false,
          dryRun: true,
        });

        // Assert - createTask should NOT be called
        const state = yield* (
          issueRepo as IssueRepository & { _getState: () => Effect.Effect<TestIssueState> }
        )._getState();

        const createCalls = state.methodCalls.filter((c) => c.method === "createTask");
        expect(createCalls).toHaveLength(0);
      }).pipe(Effect.provide(createTestLayer())),
    );

  });

  describe("basic creation", () => {
    it.effect("creates task with title and default values", () =>
      Effect.gen(function* () {
        // Arrange
        const issueRepo = yield* IssueRepository;

        // Act - create task with just title
        yield* createTaskCommand.handler({
          title: "Simple Task",
          description: Option.none(),
          priority: Option.none(),
          type: Option.none(),
          template: Option.none(),
          parent: Option.none(),
          json: false,
          dryRun: false,
        });

        // Assert - createTask was called with default priority "medium" and type "task"
        const state = yield* (
          issueRepo as IssueRepository & { _getState: () => Effect.Effect<TestIssueState> }
        )._getState();

        const createCalls = state.methodCalls.filter((c) => c.method === "createTask");
        expect(createCalls).toHaveLength(1);
        expect(createCalls[0].args[1]).toMatchObject({
          title: "Simple Task",
          priority: "medium",
          type: "task",
        });
      }).pipe(Effect.provide(createTestLayer())),
    );

    it.effect("creates task with explicit priority and type", () =>
      Effect.gen(function* () {
        // Arrange
        const issueRepo = yield* IssueRepository;

        // Act - create task with explicit options
        yield* createTaskCommand.handler({
          title: "Urgent Bug",
          description: Option.some("Fix the login issue"),
          priority: Option.some("urgent"),
          type: Option.some("bug"),
          template: Option.none(),
          parent: Option.none(),
          json: false,
          dryRun: false,
        });

        // Assert - createTask was called with specified values
        const state = yield* (
          issueRepo as IssueRepository & { _getState: () => Effect.Effect<TestIssueState> }
        )._getState();

        const createCalls = state.methodCalls.filter((c) => c.method === "createTask");
        expect(createCalls).toHaveLength(1);
        expect(createCalls[0].args[1]).toMatchObject({
          title: "Urgent Bug",
          priority: "urgent",
          type: "bug",
        });
      }).pipe(Effect.provide(createTestLayer())),
    );
  });

  describe("template application", () => {
    it.effect("applies template defaults when using template", () =>
      Effect.gen(function* () {
        // Arrange - default bug template has high priority
        const issueRepo = yield* IssueRepository;

        // Act - create task using template (default layer has bug template)
        yield* createTaskCommand.handler({
          title: "Login broken",
          description: Option.none(),
          priority: Option.none(),
          type: Option.none(),
          template: Option.some("bug"),
          parent: Option.none(),
          json: false,
          dryRun: false,
        });

        // Assert - template defaults were applied
        const state = yield* (
          issueRepo as IssueRepository & { _getState: () => Effect.Effect<TestIssueState> }
        )._getState();

        const createCalls = state.methodCalls.filter((c) => c.method === "createTask");
        expect(createCalls).toHaveLength(1);
        expect(createCalls[0].args[1]).toMatchObject({
          priority: "high",
          type: "bug",
        });
      }).pipe(Effect.provide(createTestLayer())),
    );

    it.effect("user-provided values override template defaults", () =>
      Effect.gen(function* () {
        // Arrange - template with high priority default
        const issueRepo = yield* IssueRepository;

        // Act - create task with template but override priority
        yield* createTaskCommand.handler({
          title: "Minor issue",
          description: Option.none(),
          priority: Option.some("low"),
          type: Option.none(),
          template: Option.some("bug"),
          parent: Option.none(),
          json: false,
          dryRun: false,
        });

        // Assert - user priority overrides template
        const state = yield* (
          issueRepo as IssueRepository & { _getState: () => Effect.Effect<TestIssueState> }
        )._getState();

        const createCalls = state.methodCalls.filter((c) => c.method === "createTask");
        expect(createCalls).toHaveLength(1);
        expect(createCalls[0].args[1]).toMatchObject({
          priority: "low",
        });
      }).pipe(Effect.provide(createTestLayer())),
    );
  });

  describe("subtask creation", () => {
    it.effect("creates task as subtask of parent", () =>
      Effect.gen(function* () {
        // Arrange - parent task exists
        const issueRepo = yield* IssueRepository;

        // Act - create subtask
        yield* createTaskCommand.handler({
          title: "Subtask",
          description: Option.none(),
          priority: Option.none(),
          type: Option.none(),
          template: Option.none(),
          parent: Option.some("BRI-PARENT"),
          json: false,
          dryRun: false,
        });

        // Assert - parent ID was passed to createTask
        const state = yield* (
          issueRepo as IssueRepository & { _getState: () => Effect.Effect<TestIssueState> }
        )._getState();

        const createCalls = state.methodCalls.filter((c) => c.method === "createTask");
        expect(createCalls).toHaveLength(1);

        // getTaskByIdentifier should have been called to resolve parent
        const identifierCalls = state.methodCalls.filter(
          (c) => c.method === "getTaskByIdentifier",
        );
        expect(identifierCalls.some((c) => c.args[0] === "BRI-PARENT")).toBe(true);
      }).pipe(
        Effect.provide(
          createTestLayer({
            tasks: new Map([
              [
                "parent-task",
                createTestTask({
                  id: "parent-task",
                  identifier: "BRI-PARENT",
                  title: "Parent Task",
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

  describe("JSON output", () => {
    it.effect("outputs JSON with task details when json flag is set", () =>
      Effect.gen(function* () {
        // Arrange
        const issueRepo = yield* IssueRepository;

        // Act - create with JSON output
        yield* createTaskCommand.handler({
          title: "JSON Task",
          description: Option.none(),
          priority: Option.none(),
          type: Option.none(),
          template: Option.none(),
          parent: Option.none(),
          json: true,
          dryRun: false,
        });

        // Assert - task was created (JSON output goes to console)
        const state = yield* (
          issueRepo as IssueRepository & { _getState: () => Effect.Effect<TestIssueState> }
        )._getState();

        const createCalls = state.methodCalls.filter((c) => c.method === "createTask");
        expect(createCalls).toHaveLength(1);
      }).pipe(Effect.provide(createTestLayer())),
    );
  });
});
