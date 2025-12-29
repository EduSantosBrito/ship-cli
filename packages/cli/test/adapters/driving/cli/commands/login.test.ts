import { describe, it, expect } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import { loginCommand } from "../../../../../src/adapters/driving/cli/commands/login.js";
import {
  TestAuthServiceLayer,
  type TestAuthState,
} from "../../../../layers/AuthService.testLayer.js";
import { TestPromptsLayer } from "../../../../layers/Prompts.testLayer.js";
import { AuthService } from "../../../../../src/ports/AuthService.js";
import { AuthError } from "../../../../../src/domain/Errors.js";

describe("login command", () => {
  describe("successful login", () => {
    it("validates and saves API key", async () => {
      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ isValid: true }),
        TestPromptsLayer({ textResponses: ["lin_api_test123"] }),
      );

      const program = Effect.gen(function* () {
        yield* loginCommand.handler({} as never);

        const auth = yield* AuthService;
        const state = yield* (
          auth as AuthService & { _getState: () => Effect.Effect<TestAuthState> }
        )._getState();

        return state;
      }).pipe(Effect.provide(testLayer));

      const result = await Effect.runPromise(program);

      // Verify AuthService was called correctly
      expect(result.methodCalls).toContainEqual({
        method: "saveApiKey",
        args: ["lin_api_test123"],
      });
      expect(Option.getOrNull(result.apiKey)).toBe("lin_api_test123");
    });
  });

  describe("prompt cancellation", () => {
    it("handles user cancellation gracefully", async () => {
      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ isValid: true }),
        TestPromptsLayer({ shouldCancel: true }),
      );

      const program = Effect.gen(function* () {
        yield* loginCommand.handler({} as never);

        const auth = yield* AuthService;
        const state = yield* (
          auth as AuthService & { _getState: () => Effect.Effect<TestAuthState> }
        )._getState();

        return state;
      }).pipe(
        Effect.catchTag("PromptCancelledError", () =>
          Effect.succeed({ methodCalls: [], apiKey: Option.none() }),
        ),
        Effect.provide(testLayer),
      );

      const result = await Effect.runPromise(program);

      // Verify AuthService.saveApiKey was NOT called
      expect(result.methodCalls).not.toContainEqual(
        expect.objectContaining({ method: "saveApiKey" }),
      );
    });
  });

  describe("error handling", () => {
    it("handles saveApiKey error (invalid API key)", async () => {
      const authError = new AuthError({
        message: "Invalid API key. Please check and try again.",
      });

      const testLayer = Layer.mergeAll(
        TestAuthServiceLayer({ authError }),
        TestPromptsLayer({ textResponses: ["lin_api_invalid"] }),
      );

      const program = loginCommand.handler({} as never).pipe(
        Effect.provide(testLayer),
        Effect.exit,
      );

      const exit = await Effect.runPromise(program);

      expect(Exit.isFailure(exit)).toBe(true);
      const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
      expect(Option.isSome(failure)).toBe(true);
      expect(Option.getOrNull(failure)).toBeInstanceOf(AuthError);
    });
  });
});
