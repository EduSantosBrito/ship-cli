import { describe, it, expect } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import { projectCommand } from "../../../../../src/adapters/driving/cli/commands/project.js";
import { TestAuthServiceLayer } from "../../../../layers/AuthService.testLayer.js";
import {
  TestProjectRepositoryLayer,
  createTestProject,
  type TestProjectState,
} from "../../../../layers/ProjectRepository.testLayer.js";
import {
  TestConfigRepositoryLayer,
  type TestConfigState,
} from "../../../../layers/ConfigRepository.testLayer.js";
import { TestPromptsLayer } from "../../../../layers/Prompts.testLayer.js";
import { ConfigRepository } from "../../../../../src/ports/ConfigRepository.js";
import { ProjectRepository } from "../../../../../src/ports/ProjectRepository.js";
import { ProjectId, TeamId } from "../../../../../src/domain/Task.js";
import { LinearApiError } from "../../../../../src/domain/Errors.js";
import {
  AuthConfig,
  GitConfig,
  PrConfig,
  CommitConfig,
  WorkspaceConfig,
  PartialShipConfig,
} from "../../../../../src/domain/Config.js";

describe("project command", () => {
  describe("authentication check", () => {
    it("shows error when not authenticated", async () => {
      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ apiKey: Option.none() }),
        TestProjectRepositoryLayer(),
        TestConfigRepositoryLayer(),
        TestPromptsLayer(),
      );

      const program = projectCommand.handler({} as never).pipe(Effect.provide(testLayer));
      await Effect.runPromise(program);
      // Command handles unauthenticated case internally without throwing
    });
  });

  describe("team configuration check", () => {
    it("shows error when team not configured", async () => {
      // Create partial config with no linear config
      const partialConfig = new PartialShipConfig({
        linear: Option.none(),
        auth: Option.some(new AuthConfig({ apiKey: "lin_api_test" })),
        git: new GitConfig({}),
        pr: new PrConfig({}),
        commit: new CommitConfig({}),
        workspace: new WorkspaceConfig({}),
      });

      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ apiKey: Option.some("lin_api_test") }),
        TestProjectRepositoryLayer(),
        TestConfigRepositoryLayer({ partialConfig }),
        TestPromptsLayer(),
      );

      const program = projectCommand.handler({} as never).pipe(Effect.provide(testLayer));
      await Effect.runPromise(program);
      // Command handles no team configured case internally without throwing
    });
  });

  describe("project selection", () => {
    it("lists projects and allows selection", async () => {
      const teamId = "test-team-id" as TeamId;
      const project1 = createTestProject({ id: "proj-1", name: "Backend", teamId });
      const project2 = createTestProject({ id: "proj-2", name: "Frontend", teamId });

      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ apiKey: Option.some("lin_api_test") }),
        TestProjectRepositoryLayer({
          projectsByTeam: new Map([[teamId, [project1, project2]]]),
        }),
        TestConfigRepositoryLayer(),
        TestPromptsLayer({ selectResponses: ["proj-2" as ProjectId] }),
      );

      const program = Effect.gen(function* () {
        yield* projectCommand.handler({} as never);

        const config = yield* ConfigRepository;
        const state = yield* (
          config as ConfigRepository & { _getState: () => Effect.Effect<TestConfigState> }
        )._getState();

        return state;
      }).pipe(Effect.provide(testLayer));

      const result = await Effect.runPromise(program);

      // Verify config was saved with selected project
      expect(result.methodCalls).toContainEqual({
        method: "saveLinear",
        args: [expect.objectContaining({ projectId: expect.anything() })],
      });
    });

    it("allows clearing project filter", async () => {
      // NO_PROJECT matches the value used in project.ts for "No project filter" option
      const NO_PROJECT = null;
      const teamId = "test-team-id" as TeamId;
      const project1 = createTestProject({ id: "proj-1", name: "Backend", teamId });

      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ apiKey: Option.some("lin_api_test") }),
        TestProjectRepositoryLayer({
          projectsByTeam: new Map([[teamId, [project1]]]),
        }),
        TestConfigRepositoryLayer(),
        TestPromptsLayer({ selectResponses: [NO_PROJECT] }),
      );

      const program = Effect.gen(function* () {
        yield* projectCommand.handler({} as never);

        const config = yield* ConfigRepository;
        const state = yield* (
          config as ConfigRepository & { _getState: () => Effect.Effect<TestConfigState> }
        )._getState();

        return state;
      }).pipe(Effect.provide(testLayer));

      const result = await Effect.runPromise(program);

      // Verify config was saved with no project
      expect(result.methodCalls).toContainEqual({
        method: "saveLinear",
        args: [expect.objectContaining({ projectId: Option.none() })],
      });
    });

    it("handles prompt cancellation", async () => {
      const teamId = "test-team-id" as TeamId;

      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ apiKey: Option.some("lin_api_test") }),
        TestProjectRepositoryLayer({
          projectsByTeam: new Map([[teamId, []]]),
        }),
        TestConfigRepositoryLayer(),
        TestPromptsLayer({ shouldCancel: true }),
      );

      const program = Effect.gen(function* () {
        yield* projectCommand.handler({} as never);

        const config = yield* ConfigRepository;
        const state = yield* (
          config as ConfigRepository & { _getState: () => Effect.Effect<TestConfigState> }
        )._getState();

        return state;
      }).pipe(
        Effect.catchTag("PromptCancelledError", () => Effect.succeed({ methodCalls: [] })),
        Effect.provide(testLayer),
      );

      const result = await Effect.runPromise(program);

      expect(result.methodCalls).not.toContainEqual(
        expect.objectContaining({ method: "saveLinear" }),
      );
    });
  });

  describe("project creation", () => {
    it("creates new project when selected", async () => {
      const CREATE_NEW = "__create_new__";
      const teamId = "test-team-id" as TeamId;

      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ apiKey: Option.some("lin_api_test") }),
        TestProjectRepositoryLayer({
          projectsByTeam: new Map([[teamId, []]]),
        }),
        TestConfigRepositoryLayer(),
        TestPromptsLayer({
          selectResponses: [CREATE_NEW],
          textResponses: ["New Project", "A cool project"],
        }),
      );

      const program = Effect.gen(function* () {
        yield* projectCommand.handler({} as never);

        const projectRepo = yield* ProjectRepository;
        const state = yield* (
          projectRepo as ProjectRepository & { _getState: () => Effect.Effect<TestProjectState> }
        )._getState();

        return state;
      }).pipe(Effect.provide(testLayer));

      const result = await Effect.runPromise(program);

      // Verify createProject was called
      expect(result.methodCalls).toContainEqual({
        method: "createProject",
        args: [teamId, { name: "New Project", description: "A cool project" }],
      });
    });

    it("creates project without description", async () => {
      const CREATE_NEW = "__create_new__";
      const teamId = "test-team-id" as TeamId;

      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ apiKey: Option.some("lin_api_test") }),
        TestProjectRepositoryLayer({
          projectsByTeam: new Map([[teamId, []]]),
        }),
        TestConfigRepositoryLayer(),
        TestPromptsLayer({
          selectResponses: [CREATE_NEW],
          textResponses: ["New Project", ""], // empty description
        }),
      );

      const program = Effect.gen(function* () {
        yield* projectCommand.handler({} as never);

        const projectRepo = yield* ProjectRepository;
        const state = yield* (
          projectRepo as ProjectRepository & { _getState: () => Effect.Effect<TestProjectState> }
        )._getState();

        return state;
      }).pipe(Effect.provide(testLayer));

      const result = await Effect.runPromise(program);

      // Verify createProject was called without description
      expect(result.methodCalls).toContainEqual({
        method: "createProject",
        args: [teamId, { name: "New Project" }],
      });
    });
  });

  describe("error handling", () => {
    it("handles API error when fetching projects", async () => {
      const apiError = new LinearApiError({ message: "Network error" });

      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ apiKey: Option.some("lin_api_test") }),
        TestProjectRepositoryLayer({ globalApiError: apiError }),
        TestConfigRepositoryLayer(),
        TestPromptsLayer(),
      );

      const program = projectCommand.handler({} as never).pipe(
        Effect.provide(testLayer),
        Effect.exit,
      );

      const exit = await Effect.runPromise(program);

      expect(Exit.isFailure(exit)).toBe(true);
      const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
      expect(Option.isSome(failure)).toBe(true);
      expect(Option.getOrNull(failure)).toBeInstanceOf(LinearApiError);
    });

    it("handles empty projects list", async () => {
      const teamId = "test-team-id" as TeamId;

      // Select "no project filter" option when no projects exist
      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ apiKey: Option.some("lin_api_test") }),
        TestProjectRepositoryLayer({
          projectsByTeam: new Map([[teamId, []]]),
        }),
        TestConfigRepositoryLayer(),
        TestPromptsLayer({ selectResponses: [null] }), // Select "No project filter"
      );

      const program = projectCommand.handler({} as never).pipe(Effect.provide(testLayer));
      await Effect.runPromise(program);
      // Should complete without error
    });
  });
});
