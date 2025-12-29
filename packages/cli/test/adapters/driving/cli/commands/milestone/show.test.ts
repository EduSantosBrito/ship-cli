import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { showMilestoneCommand } from "../../../../../../src/adapters/driving/cli/commands/milestone/show.js";
import {
  TestMilestoneRepositoryLayer,
  createTestMilestone,
} from "../../../../../layers/MilestoneRepository.testLayer.js";
import { TestConfigRepositoryLayer } from "../../../../../layers/ConfigRepository.testLayer.js";
import { ProjectId, MilestoneId } from "../../../../../../src/domain/Task.js";
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

describe("milestone show command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("project configuration check", () => {
    it("shows error when no project configured", async () => {
      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer(),
        TestConfigRepositoryLayer({ config: createConfigWithoutProject() }),
      );

      const program = showMilestoneCommand
        .handler({ milestone: "q1-release", json: false } as never)
        .pipe(Effect.provide(testLayer));

      await Effect.runPromise(program);

      expect(mockedConsole.error).toHaveBeenCalledWith(
        "No project configured. Run 'ship project' to select a project.",
      );
    });
  });

  describe("showing milestone details", () => {
    it("shows milestone details by slug", async () => {
      const projectId = "test-project-id" as ProjectId;
      const milestone = createTestMilestone({
        id: "m1",
        name: "Q1 Release",
        description: "First quarter milestone",
        projectId,
        targetDate: new Date("2024-03-31"),
      });

      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({
          milestones: new Map([["m1", milestone]]),
        }),
        TestConfigRepositoryLayer({ config: createConfigWithProject(projectId) }),
      );

      const program = showMilestoneCommand
        .handler({ milestone: "q1-release", json: false } as never)
        .pipe(Effect.provide(testLayer));

      await Effect.runPromise(program);

      expect(mockedConsole.log).toHaveBeenCalledWith("Q1 Release");
      expect(mockedConsole.log).toHaveBeenCalledWith(
        expect.stringContaining("Slug:        q1-release"),
      );
      expect(mockedConsole.log).toHaveBeenCalledWith(
        expect.stringContaining("ID:          m1"),
      );
    });

    it("shows milestone details by ID", async () => {
      const projectId = "test-project-id" as ProjectId;
      const milestoneId = "milestone-uuid-123" as MilestoneId;
      const milestone = createTestMilestone({
        id: milestoneId,
        name: "Q1 Release",
        projectId,
      });

      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({
          milestones: new Map([[milestoneId, milestone]]),
        }),
        TestConfigRepositoryLayer({ config: createConfigWithProject(projectId) }),
      );

      const program = showMilestoneCommand
        .handler({ milestone: milestoneId, json: false } as never)
        .pipe(Effect.provide(testLayer));

      await Effect.runPromise(program);

      expect(mockedConsole.log).toHaveBeenCalledWith("Q1 Release");
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

      const program = showMilestoneCommand
        .handler({ milestone: "q1-release", json: true } as never)
        .pipe(Effect.provide(testLayer));

      await Effect.runPromise(program);

      expect(mockedConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('"id": "m1"'),
      );
      expect(mockedConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('"slug": "q1-release"'),
      );
    });

    it("shows description when present", async () => {
      const projectId = "test-project-id" as ProjectId;
      const milestone = createTestMilestone({
        id: "m1",
        name: "Q1 Release",
        description: "First quarter milestone",
        projectId,
      });

      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({
          milestones: new Map([["m1", milestone]]),
        }),
        TestConfigRepositoryLayer({ config: createConfigWithProject(projectId) }),
      );

      const program = showMilestoneCommand
        .handler({ milestone: "q1-release", json: false } as never)
        .pipe(Effect.provide(testLayer));

      await Effect.runPromise(program);

      expect(mockedConsole.log).toHaveBeenCalledWith("Description:");
      expect(mockedConsole.log).toHaveBeenCalledWith("First quarter milestone");
    });
  });

  describe("error handling", () => {
    it("fails with MilestoneNotFoundError for unknown slug", async () => {
      const projectId = "test-project-id" as ProjectId;

      const testLayer = Layer.mergeAll(
        TestMilestoneRepositoryLayer({ milestones: new Map() }),
        TestConfigRepositoryLayer({ config: createConfigWithProject(projectId) }),
      );

      const program = showMilestoneCommand
        .handler({ milestone: "nonexistent", json: false } as never)
        .pipe(
          Effect.provide(testLayer),
          Effect.exit,
        );

      const exit = await Effect.runPromise(program);

      expect(exit._tag).toBe("Failure");
    });
  });
});
