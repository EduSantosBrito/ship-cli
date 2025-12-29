import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Exit from "effect/Exit";
import * as Cause from "effect/Cause";
import { listMilestoneCommand } from "../../../../../../src/adapters/driving/cli/commands/milestone/list.js";
import {
  TestMilestoneRepositoryLayer,
  createTestMilestone,
} from "../../../../../layers/MilestoneRepository.testLayer.js";
import { TestConfigRepositoryLayer } from "../../../../../layers/ConfigRepository.testLayer.js";
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

describe("milestone list command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("project configuration check", () => {
    it("shows error when no project configured", async () => {
      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer(),
        TestConfigRepositoryLayer({ config: createConfigWithoutProject() }),
      );

      const program = listMilestoneCommand
        .handler({ json: false } as never)
        .pipe(Effect.provide(testLayer));

      await Effect.runPromise(program);

      expect(mockedConsole.error).toHaveBeenCalledWith(
        "No project configured. Run 'ship project' to select a project.",
      );
    });
  });

  describe("listing milestones", () => {
    it("lists all milestones for project", async () => {
      const projectId = "test-project-id" as ProjectId;
      const milestone1 = createTestMilestone({
        id: "m1",
        name: "Q1 Release",
        projectId,
        targetDate: new Date("2024-03-31"),
      });
      const milestone2 = createTestMilestone({
        id: "m2",
        name: "Q2 Release",
        projectId,
        targetDate: new Date("2024-06-30"),
      });

      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({
          milestones: new Map([
            ["m1", milestone1],
            ["m2", milestone2],
          ]),
        }),
        TestConfigRepositoryLayer({ config: createConfigWithProject(projectId) }),
      );

      const program = listMilestoneCommand
        .handler({ json: false } as never)
        .pipe(Effect.provide(testLayer));

      await Effect.runPromise(program);

      expect(mockedConsole.log).toHaveBeenCalledWith("Milestones:\n");
      expect(mockedConsole.log).toHaveBeenCalledWith(
        expect.stringContaining("q1-release"),
      );
      expect(mockedConsole.log).toHaveBeenCalledWith(
        expect.stringContaining("q2-release"),
      );
    });

    it("shows message when no milestones found", async () => {
      const projectId = "test-project-id" as ProjectId;

      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({ milestones: new Map() }),
        TestConfigRepositoryLayer({ config: createConfigWithProject(projectId) }),
      );

      const program = listMilestoneCommand
        .handler({ json: false } as never)
        .pipe(Effect.provide(testLayer));

      await Effect.runPromise(program);

      expect(mockedConsole.log).toHaveBeenCalledWith("No milestones found for this project.");
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

      const program = listMilestoneCommand
        .handler({ json: true } as never)
        .pipe(Effect.provide(testLayer));

      await Effect.runPromise(program);

      expect(mockedConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('"slug": "q1-release"'),
      );
    });

    it("sorts milestones by target date", async () => {
      const projectId = "test-project-id" as ProjectId;
      const milestone1 = createTestMilestone({
        id: "m1",
        name: "Later",
        projectId,
        targetDate: new Date("2024-12-31"),
      });
      const milestone2 = createTestMilestone({
        id: "m2",
        name: "Earlier",
        projectId,
        targetDate: new Date("2024-01-31"),
      });
      const milestone3 = createTestMilestone({
        id: "m3",
        name: "No Date",
        projectId,
        targetDate: null,
      });

      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({
          milestones: new Map([
            ["m1", milestone1],
            ["m2", milestone2],
            ["m3", milestone3],
          ]),
        }),
        TestConfigRepositoryLayer({ config: createConfigWithProject(projectId) }),
      );

      const program = listMilestoneCommand
        .handler({ json: true } as never)
        .pipe(Effect.provide(testLayer));

      await Effect.runPromise(program);

      // JSON output should have milestones sorted by date
      const logCall = mockedConsole.log.mock.calls[0][0] as string;
      const parsed = JSON.parse(logCall);
      expect(parsed[0].name).toBe("Earlier");
      expect(parsed[1].name).toBe("Later");
      expect(parsed[2].name).toBe("No Date");
    });
  });

  describe("error handling", () => {
    it("handles API error when listing milestones", async () => {
      const apiError = new LinearApiError({ message: "Network error" });
      const projectId = "test-project-id" as ProjectId;

      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({ globalApiError: apiError }),
        TestConfigRepositoryLayer({ config: createConfigWithProject(projectId) }),
      );

      const program = listMilestoneCommand
        .handler({ json: false } as never)
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
