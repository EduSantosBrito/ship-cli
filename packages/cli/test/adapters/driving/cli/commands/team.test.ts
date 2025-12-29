import { describe, it, expect } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import { teamCommand } from "../../../../../src/adapters/driving/cli/commands/team.js";
import { TestAuthServiceLayer } from "../../../../layers/AuthService.testLayer.js";
import {
  TestTeamRepositoryLayer,
  createTestTeam,
  type TestTeamState,
} from "../../../../layers/TeamRepository.testLayer.js";
import {
  TestConfigRepositoryLayer,
  type TestConfigState,
} from "../../../../layers/ConfigRepository.testLayer.js";
import { TestPromptsLayer } from "../../../../layers/Prompts.testLayer.js";
import { ConfigRepository } from "../../../../../src/ports/ConfigRepository.js";
import { TeamRepository } from "../../../../../src/ports/TeamRepository.js";
import { TeamId } from "../../../../../src/domain/Task.js";
import { LinearApiError } from "../../../../../src/domain/Errors.js";

describe("team command", () => {
  describe("authentication check", () => {
    it("shows error when not authenticated", async () => {
      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ apiKey: Option.none() }),
        TestTeamRepositoryLayer(),
        TestConfigRepositoryLayer(),
        TestPromptsLayer(),
      );

      const program = teamCommand.handler({} as never).pipe(Effect.provide(testLayer));
      // Command should complete without throwing - it handles unauthenticated case internally
      await Effect.runPromise(program);
    });
  });

  describe("team selection", () => {
    it("lists teams and allows selection", async () => {
      const team1 = createTestTeam({ id: "team-1", name: "Engineering", key: "ENG" });
      const team2 = createTestTeam({ id: "team-2", name: "Design", key: "DSN" });

      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ apiKey: Option.some("lin_api_test") }),
        TestTeamRepositoryLayer({ teams: [team1, team2] }),
        TestConfigRepositoryLayer(),
        TestPromptsLayer({ selectResponses: ["team-2" as TeamId] }),
      );

      const program = Effect.gen(function* () {
        yield* teamCommand.handler({} as never);

        const config = yield* ConfigRepository;
        const state = yield* (
          config as ConfigRepository & { _getState: () => Effect.Effect<TestConfigState> }
        )._getState();

        return state;
      }).pipe(Effect.provide(testLayer));

      const result = await Effect.runPromise(program);

      // Verify config was saved with selected team
      expect(result.methodCalls).toContainEqual({
        method: "saveLinear",
        args: [expect.objectContaining({ teamId: "team-2", teamKey: "DSN" })],
      });
    });

    it("handles prompt cancellation", async () => {
      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ apiKey: Option.some("lin_api_test") }),
        TestTeamRepositoryLayer(),
        TestConfigRepositoryLayer(),
        TestPromptsLayer({ shouldCancel: true }),
      );

      const program = Effect.gen(function* () {
        yield* teamCommand.handler({} as never);

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

      // saveLinear should NOT be called
      expect(result.methodCalls).not.toContainEqual(
        expect.objectContaining({ method: "saveLinear" }),
      );
    });
  });

  describe("team creation", () => {
    it("creates new team when selected", async () => {
      const CREATE_NEW = "__create_new__";

      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ apiKey: Option.some("lin_api_test") }),
        TestTeamRepositoryLayer({ teams: [] }),
        TestConfigRepositoryLayer(),
        TestPromptsLayer({
          selectResponses: [CREATE_NEW],
          textResponses: ["New Team", "NEW"],
        }),
      );

      const program = Effect.gen(function* () {
        yield* teamCommand.handler({} as never);

        const teamRepo = yield* TeamRepository;
        const state = yield* (
          teamRepo as TeamRepository & { _getState: () => Effect.Effect<TestTeamState> }
        )._getState();

        return state;
      }).pipe(Effect.provide(testLayer));

      const result = await Effect.runPromise(program);

      // Verify createTeam was called
      expect(result.methodCalls).toContainEqual({
        method: "createTeam",
        args: [{ name: "New Team", key: "NEW" }],
      });
    });
  });

  describe("error handling", () => {
    it("handles API error when fetching teams", async () => {
      const apiError = new LinearApiError({ message: "Network error" });

      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ apiKey: Option.some("lin_api_test") }),
        TestTeamRepositoryLayer({ globalApiError: apiError }),
        TestConfigRepositoryLayer(),
        TestPromptsLayer(),
      );

      const program = teamCommand.handler({} as never).pipe(
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
