import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Exit from "effect/Exit";
import * as Cause from "effect/Cause";
import { createMilestoneCommand } from "../../../../../../src/adapters/driving/cli/commands/milestone/create.js";
import {
  TestMilestoneRepositoryLayer,
  type TestMilestoneState,
} from "../../../../../layers/MilestoneRepository.testLayer.js";
import { TestConfigRepositoryLayer } from "../../../../../layers/ConfigRepository.testLayer.js";
import { MilestoneRepository } from "../../../../../../src/ports/MilestoneRepository.js";
import { ProjectId } from "../../../../../../src/domain/Task.js";
import { LinearApiError } from "../../../../../../src/domain/Errors.js";
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

describe("milestone create command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("project configuration check", () => {
    it("shows error when no project configured", async () => {
      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer(),
        TestConfigRepositoryLayer({ config: createConfigWithoutProject() }),
      );

      const program = createMilestoneCommand
        .handler({
          name: "Q1 Release",
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

  describe("successful creation", () => {
    it("creates milestone with name only", async () => {
      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({ milestones: new Map() }),
        TestConfigRepositoryLayer({ config: createConfigWithProject("test-project-id") }),
      );

      const program = Effect.gen(function* () {
        yield* createMilestoneCommand.handler({
          name: "Q1 Release",
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

      // Verify createMilestone was called
      expect(result.methodCalls).toContainEqual({
        method: "createMilestone",
        args: [
          "test-project-id",
          expect.objectContaining({ name: "Q1 Release" }),
        ],
      });

      expect(mockedConsole.log).toHaveBeenCalledWith("Created milestone: Q1 Release");
      expect(mockedConsole.log).toHaveBeenCalledWith("Slug: q1-release");
    });

    it("creates milestone with description and target date", async () => {
      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({ milestones: new Map() }),
        TestConfigRepositoryLayer({ config: createConfigWithProject("test-project-id") }),
      );

      const program = Effect.gen(function* () {
        yield* createMilestoneCommand.handler({
          name: "Q1 Release",
          description: Option.some("First quarter milestone"),
          targetDate: Option.some("2024-03-31"),
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
        method: "createMilestone",
        args: [
          "test-project-id",
          expect.objectContaining({
            name: "Q1 Release",
            description: Option.some("First quarter milestone"),
          }),
        ],
      });
    });

    it("outputs JSON when json flag is set", async () => {
      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({ milestones: new Map() }),
        TestConfigRepositoryLayer({ config: createConfigWithProject("test-project-id") }),
      );

      const program = createMilestoneCommand
        .handler({
          name: "Q1 Release",
          description: Option.none(),
          targetDate: Option.none(),
          json: true,
          dryRun: false,
        } as never)
        .pipe(Effect.provide(testLayer));

      await Effect.runPromise(program);

      // Check that JSON output was logged
      expect(mockedConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('"status": "created"'),
      );
    });
  });

  describe("dry run", () => {
    it("shows what would be created without making changes", async () => {
      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({ milestones: new Map() }),
        TestConfigRepositoryLayer({ config: createConfigWithProject("test-project-id") }),
      );

      const program = Effect.gen(function* () {
        yield* createMilestoneCommand.handler({
          name: "Q1 Release",
          description: Option.some("Test description"),
          targetDate: Option.some("2024-03-31"),
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

      // Verify createMilestone was NOT called
      expect(result.methodCalls).not.toContainEqual(
        expect.objectContaining({ method: "createMilestone" }),
      );

      expect(mockedConsole.log).toHaveBeenCalledWith("[DRY RUN] Would create milestone:");
      expect(mockedConsole.log).toHaveBeenCalledWith("  Name: Q1 Release");
      expect(mockedConsole.log).toHaveBeenCalledWith("  Slug: q1-release");
    });

    it("outputs JSON for dry run when json flag is set", async () => {
      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({ milestones: new Map() }),
        TestConfigRepositoryLayer({ config: createConfigWithProject("test-project-id") }),
      );

      const program = createMilestoneCommand
        .handler({
          name: "Q1 Release",
          description: Option.none(),
          targetDate: Option.none(),
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
    it("handles invalid date format", async () => {
      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({ milestones: new Map() }),
        TestConfigRepositoryLayer({ config: createConfigWithProject("test-project-id") }),
      );

      const program = createMilestoneCommand
        .handler({
          name: "Q1 Release",
          description: Option.none(),
          targetDate: Option.some("not-a-date"),
          json: false,
          dryRun: false,
        } as never)
        .pipe(Effect.provide(testLayer));

      await Effect.runPromise(program);

      // Should show error about invalid date
      expect(mockedConsole.error).toHaveBeenCalledWith(
        expect.stringContaining("targetDate"),
      );
    });

    it("handles API error when creating milestone", async () => {
      const apiError = new LinearApiError({ message: "Network error" });

      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({
          milestones: new Map(),
          globalApiError: apiError,
        }),
        TestConfigRepositoryLayer({ config: createConfigWithProject("test-project-id") }),
      );

      const program = createMilestoneCommand
        .handler({
          name: "Q1 Release",
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

      expect(Exit.isFailure(exit)).toBe(true);
      const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
      expect(Option.isSome(failure)).toBe(true);
      expect(Option.getOrNull(failure)).toBeInstanceOf(LinearApiError);
    });
  });
});
