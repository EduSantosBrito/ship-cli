import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { updateMilestoneCommand } from "../../../../../../src/adapters/driving/cli/commands/milestone/update.js";
import {
  TestMilestoneRepositoryLayer,
  createTestMilestone,
  type TestMilestoneState,
} from "../../../../../layers/MilestoneRepository.testLayer.js";
import { TestConfigRepositoryLayer } from "../../../../../layers/ConfigRepository.testLayer.js";
import { MilestoneRepository } from "../../../../../../src/ports/MilestoneRepository.js";
import { ProjectId } from "../../../../../../src/domain/Task.js";
import { makeShipConfig, makeLinearConfig } from "../../../../../fixtures/index.js";

// Mock Console
vi.mock("effect/Console", () => ({
  log: vi.fn((msg: string) => Effect.sync(() => console.log(msg))),
  error: vi.fn((msg: string) => Effect.sync(() => console.error(msg))),
}));

import * as Console from "effect/Console";
const mockedConsole = vi.mocked(Console);

// Shared config helpers using fixtures
const createConfigWithProject = (projectId: string) =>
  makeShipConfig({
    linear: makeLinearConfig({ projectId: projectId as ProjectId }),
  });

const createConfigWithoutProject = () =>
  makeShipConfig({
    linear: makeLinearConfig({ projectId: null }),
  });

describe("milestone update command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("project configuration check", () => {
    it("shows error when no project configured", async () => {
      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer(),
        TestConfigRepositoryLayer({ config: createConfigWithoutProject() }),
      );

      const program = updateMilestoneCommand
        .handler({
          milestone: "q1-release",
          name: Option.none(),
          description: Option.none(),
          targetDate: Option.none(),
          json: false,
          dryRun: false,
        } as never)
        .pipe(Effect.provide(testLayer));

      await Effect.runPromise(program);

      expect(mockedConsole.error).toHaveBeenCalledWith(
        "No project configured. Run 'ship project' to select a project.",
      );
    });
  });

  describe("successful update", () => {
    it("updates milestone name", async () => {
      const projectId = "test-project-id" as ProjectId;
      const milestone = createTestMilestone({
        id: "m1",
        name: "Q1 Release",
        projectId,
      });

      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({
          milestones: new Map([["m1", milestone]]),
        }),
        TestConfigRepositoryLayer({ config: createConfigWithProject(projectId) }),
      );

      const program = Effect.gen(function* () {
        yield* updateMilestoneCommand.handler({
          milestone: "q1-release",
          name: Option.some("Q1 Release Updated"),
          description: Option.none(),
          targetDate: Option.none(),
          json: false,
          dryRun: false,
        } as never);

        const repo = yield* MilestoneRepository;
        const state = yield* (
          repo as MilestoneRepository & { _getState: () => Effect.Effect<TestMilestoneState> }
        )._getState();

        return state;
      }).pipe(Effect.provide(testLayer));

      const result = await Effect.runPromise(program);

      expect(result.methodCalls).toContainEqual({
        method: "updateMilestone",
        args: [
          "m1",
          expect.objectContaining({ name: Option.some("Q1 Release Updated") }),
        ],
      });

      expect(mockedConsole.log).toHaveBeenCalledWith(
        expect.stringContaining("Updated milestone:"),
      );
    });

    it("updates milestone description", async () => {
      const projectId = "test-project-id" as ProjectId;
      const milestone = createTestMilestone({
        id: "m1",
        name: "Q1 Release",
        projectId,
      });

      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({
          milestones: new Map([["m1", milestone]]),
        }),
        TestConfigRepositoryLayer({ config: createConfigWithProject(projectId) }),
      );

      const program = Effect.gen(function* () {
        yield* updateMilestoneCommand.handler({
          milestone: "q1-release",
          name: Option.none(),
          description: Option.some("New description"),
          targetDate: Option.none(),
          json: false,
          dryRun: false,
        } as never);

        const repo = yield* MilestoneRepository;
        const state = yield* (
          repo as MilestoneRepository & { _getState: () => Effect.Effect<TestMilestoneState> }
        )._getState();

        return state;
      }).pipe(Effect.provide(testLayer));

      const result = await Effect.runPromise(program);

      expect(result.methodCalls).toContainEqual({
        method: "updateMilestone",
        args: [
          "m1",
          expect.objectContaining({ description: Option.some("New description") }),
        ],
      });
    });

    it("updates target date", async () => {
      const projectId = "test-project-id" as ProjectId;
      const milestone = createTestMilestone({
        id: "m1",
        name: "Q1 Release",
        projectId,
      });

      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({
          milestones: new Map([["m1", milestone]]),
        }),
        TestConfigRepositoryLayer({ config: createConfigWithProject(projectId) }),
      );

      const program = Effect.gen(function* () {
        yield* updateMilestoneCommand.handler({
          milestone: "q1-release",
          name: Option.none(),
          description: Option.none(),
          targetDate: Option.some("2024-06-30"),
          json: false,
          dryRun: false,
        } as never);

        const repo = yield* MilestoneRepository;
        const state = yield* (
          repo as MilestoneRepository & { _getState: () => Effect.Effect<TestMilestoneState> }
        )._getState();

        return state;
      }).pipe(Effect.provide(testLayer));

      const result = await Effect.runPromise(program);

      expect(result.methodCalls).toContainEqual({
        method: "updateMilestone",
        args: ["m1", expect.anything()],
      });
    });

    it("outputs JSON when json flag is set", async () => {
      const projectId = "test-project-id" as ProjectId;
      const milestone = createTestMilestone({
        id: "m1",
        name: "Q1 Release",
        projectId,
      });

      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({
          milestones: new Map([["m1", milestone]]),
        }),
        TestConfigRepositoryLayer({ config: createConfigWithProject(projectId) }),
      );

      const program = updateMilestoneCommand
        .handler({
          milestone: "q1-release",
          name: Option.some("Updated"),
          description: Option.none(),
          targetDate: Option.none(),
          json: true,
          dryRun: false,
        } as never)
        .pipe(Effect.provide(testLayer));

      await Effect.runPromise(program);

      expect(mockedConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('"status": "updated"'),
      );
    });
  });

  describe("dry run", () => {
    it("shows what would be updated without making changes", async () => {
      const projectId = "test-project-id" as ProjectId;
      const milestone = createTestMilestone({
        id: "m1",
        name: "Q1 Release",
        projectId,
      });

      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({
          milestones: new Map([["m1", milestone]]),
        }),
        TestConfigRepositoryLayer({ config: createConfigWithProject(projectId) }),
      );

      const program = Effect.gen(function* () {
        yield* updateMilestoneCommand.handler({
          milestone: "q1-release",
          name: Option.some("Updated Name"),
          description: Option.none(),
          targetDate: Option.none(),
          json: false,
          dryRun: true,
        } as never);

        const repo = yield* MilestoneRepository;
        const state = yield* (
          repo as MilestoneRepository & { _getState: () => Effect.Effect<TestMilestoneState> }
        )._getState();

        return state;
      }).pipe(Effect.provide(testLayer));

      const result = await Effect.runPromise(program);

      // Verify updateMilestone was NOT called
      expect(result.methodCalls).not.toContainEqual(
        expect.objectContaining({ method: "updateMilestone" }),
      );

      expect(mockedConsole.log).toHaveBeenCalledWith(
        expect.stringContaining("[DRY RUN] Would update milestone:"),
      );
    });
  });

  describe("error handling", () => {
    it("fails with MilestoneNotFoundError for unknown milestone", async () => {
      const projectId = "test-project-id" as ProjectId;

      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({ milestones: new Map() }),
        TestConfigRepositoryLayer({ config: createConfigWithProject(projectId) }),
      );

      const program = updateMilestoneCommand
        .handler({
          milestone: "nonexistent",
          name: Option.some("New Name"),
          description: Option.none(),
          targetDate: Option.none(),
          json: false,
          dryRun: false,
        } as never)
        .pipe(
          Effect.provide(testLayer),
          Effect.exit,
        );

      const exit = await Effect.runPromise(program);

      expect(exit._tag).toBe("Failure");
    });

    it("handles invalid date format", async () => {
      const projectId = "test-project-id" as ProjectId;
      const milestone = createTestMilestone({
        id: "m1",
        name: "Q1 Release",
        projectId,
      });

      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({
          milestones: new Map([["m1", milestone]]),
        }),
        TestConfigRepositoryLayer({ config: createConfigWithProject(projectId) }),
      );

      const program = updateMilestoneCommand
        .handler({
          milestone: "q1-release",
          name: Option.none(),
          description: Option.none(),
          targetDate: Option.some("invalid-date"),
          json: false,
          dryRun: false,
        } as never)
        .pipe(Effect.provide(testLayer));

      await Effect.runPromise(program);

      expect(mockedConsole.error).toHaveBeenCalledWith(
        expect.stringContaining("targetDate"),
      );
    });
  });
});
