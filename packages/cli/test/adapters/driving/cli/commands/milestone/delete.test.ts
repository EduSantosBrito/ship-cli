import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { deleteMilestoneCommand } from "../../../../../../src/adapters/driving/cli/commands/milestone/delete.js";
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

describe("milestone delete command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("project configuration check", () => {
    it("shows error when no project configured", async () => {
      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer(),
        TestConfigRepositoryLayer({ config: createConfigWithoutProject() }),
      );

      const program = deleteMilestoneCommand
        .handler({
          milestone: "q1-release",
          force: false,
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

  describe("confirmation without force", () => {
    it("shows confirmation message when force is not set", async () => {
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
        yield* deleteMilestoneCommand.handler({
          milestone: "q1-release",
          force: false,
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

      // Verify deleteMilestone was NOT called
      expect(result.methodCalls).not.toContainEqual(
        expect.objectContaining({ method: "deleteMilestone" }),
      );

      expect(mockedConsole.log).toHaveBeenCalledWith(
        "About to delete milestone: Q1 Release",
      );
      expect(mockedConsole.log).toHaveBeenCalledWith(
        "Use --force to skip this confirmation.",
      );
    });
  });

  describe("successful deletion", () => {
    it("deletes milestone with force flag", async () => {
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
        yield* deleteMilestoneCommand.handler({
          milestone: "q1-release",
          force: true,
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
        method: "deleteMilestone",
        args: ["m1"],
      });

      expect(mockedConsole.log).toHaveBeenCalledWith("Deleted milestone: Q1 Release");
    });

    it("deletes milestone with json flag (skips confirmation)", async () => {
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
        yield* deleteMilestoneCommand.handler({
          milestone: "q1-release",
          force: false,
          json: true,
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
        method: "deleteMilestone",
        args: ["m1"],
      });

      expect(mockedConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('"status": "deleted"'),
      );
    });
  });

  describe("dry run", () => {
    it("shows what would be deleted without making changes", async () => {
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
        yield* deleteMilestoneCommand.handler({
          milestone: "q1-release",
          force: true,
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

      // Verify deleteMilestone was NOT called
      expect(result.methodCalls).not.toContainEqual(
        expect.objectContaining({ method: "deleteMilestone" }),
      );

      expect(mockedConsole.log).toHaveBeenCalledWith("[DRY RUN] Would delete milestone:");
      expect(mockedConsole.log).toHaveBeenCalledWith("  Name: Q1 Release");
      expect(mockedConsole.log).toHaveBeenCalledWith("  Slug: q1-release");
    });

    it("outputs JSON for dry run when json flag is set", async () => {
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

      const program = deleteMilestoneCommand
        .handler({
          milestone: "q1-release",
          force: true,
          json: true,
          dryRun: true,
        } as never)
        .pipe(Effect.provide(testLayer));

      await Effect.runPromise(program);

      expect(mockedConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('"dryRun":true'),
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

      const program = deleteMilestoneCommand
        .handler({
          milestone: "nonexistent",
          force: true,
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
  });
});
