import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import { loginCommand } from "../../../../../src/adapters/driving/cli/commands/login.js";
import {
  TestAuthServiceLayer,
  type TestAuthState,
} from "../../../../layers/AuthService.testLayer.js";
import { AuthService } from "../../../../../src/ports/AuthService.js";
import { AuthError } from "../../../../../src/domain/Errors.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  note: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn(),
  cancel: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
  outro: vi.fn(),
}));

// Import mocked module for assertions
import * as clack from "@clack/prompts";

const mockedClack = vi.mocked(clack);

describe("login command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("successful login", () => {
    it("validates and saves API key", async () => {
      // Setup: user enters valid API key
      mockedClack.text.mockResolvedValue("lin_api_test123");
      mockedClack.isCancel.mockReturnValue(false);

      const testLayer = TestAuthServiceLayer({ isValid: true });

      const program = Effect.gen(function* () {
        const handler = loginCommand.handler;
        yield* handler({} as never);

        // Access the test service to verify state
        const auth = yield* AuthService;
        const state = yield* (auth as AuthService & { _getState: () => Effect.Effect<TestAuthState> })._getState();

        return state;
      }).pipe(Effect.provide(testLayer));

      const result = await Effect.runPromise(program);

      // Verify clack UI calls
      expect(mockedClack.intro).toHaveBeenCalledWith("ship login");
      expect(mockedClack.note).toHaveBeenCalledWith(
        "Create a personal API key at:\nhttps://linear.app/settings/api",
        "Linear Authentication",
      );
      expect(mockedClack.text).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Paste your API key",
          placeholder: "lin_api_...",
        }),
      );
      expect(mockedClack.outro).toHaveBeenCalledWith("Run 'ship init' to select your team and project.");

      // Verify AuthService was called correctly
      expect(result.methodCalls).toContainEqual({
        method: "saveApiKey",
        args: ["lin_api_test123"],
      });
      expect(Option.getOrNull(result.apiKey)).toBe("lin_api_test123");
    });

    it("shows spinner during validation", async () => {
      const mockSpinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
      mockedClack.spinner.mockReturnValue(mockSpinner);
      mockedClack.text.mockResolvedValue("lin_api_test123");
      mockedClack.isCancel.mockReturnValue(false);

      const testLayer = TestAuthServiceLayer({ isValid: true });

      const program = loginCommand.handler({} as never).pipe(Effect.provide(testLayer));
      await Effect.runPromise(program);

      expect(mockSpinner.start).toHaveBeenCalledWith("Validating API key...");
      expect(mockSpinner.stop).toHaveBeenCalledWith("API key validated");
    });
  });

  describe("prompt cancellation", () => {
    it("handles user cancellation gracefully", async () => {
      // Setup: user cancels prompt (Ctrl+C)
      const cancelSymbol = Symbol("cancel");
      mockedClack.text.mockResolvedValue(cancelSymbol);
      mockedClack.isCancel.mockReturnValue(true);

      const testLayer = TestAuthServiceLayer({ isValid: true });

      const program = Effect.gen(function* () {
        const handler = loginCommand.handler;
        yield* handler({} as never);

        // Access the test service to verify state
        const auth = yield* AuthService;
        const state = yield* (auth as AuthService & { _getState: () => Effect.Effect<TestAuthState> })._getState();

        return state;
      }).pipe(Effect.provide(testLayer));

      const result = await Effect.runPromise(program);

      // Verify cancellation UI
      expect(mockedClack.cancel).toHaveBeenCalledWith("Login cancelled");
      expect(mockedClack.outro).not.toHaveBeenCalled();

      // Verify AuthService.saveApiKey was NOT called
      expect(result.methodCalls).not.toContainEqual(
        expect.objectContaining({ method: "saveApiKey" }),
      );
    });
  });

  describe("error handling", () => {
    it("handles saveApiKey error (invalid API key)", async () => {
      const mockSpinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
      mockedClack.spinner.mockReturnValue(mockSpinner);
      mockedClack.text.mockResolvedValue("lin_api_invalid");
      mockedClack.isCancel.mockReturnValue(false);

      // Configure test layer to fail on saveApiKey
      const authError = new AuthError({ message: "Invalid API key. Please check and try again." });
      const testLayer = TestAuthServiceLayer({ authError });

      const program = loginCommand.handler({} as never).pipe(
        Effect.provide(testLayer),
        Effect.exit,
      );

      const exit = await Effect.runPromise(program);

      // Verify it failed with AuthError
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(AuthError);
        }
      }

      // Verify spinner stopped with error message
      expect(mockSpinner.stop).toHaveBeenCalledWith("Invalid API key");
    });

    it("handles prompt rejection (exception during prompt)", async () => {
      // Setup: prompt throws an error
      mockedClack.text.mockRejectedValue(new Error("Terminal closed"));

      const testLayer = TestAuthServiceLayer({ isValid: true });

      const program = loginCommand.handler({} as never).pipe(
        Effect.provide(testLayer),
        Effect.exit,
      );

      const exit = await Effect.runPromise(program);

      // Should fail with PromptCancelledError (caught by Effect.tryPromise)
      expect(Exit.isFailure(exit)).toBe(true);
    });
  });

  describe("text input validation", () => {
    it("calls text with proper validation function", async () => {
      mockedClack.text.mockResolvedValue("lin_api_test123");
      mockedClack.isCancel.mockReturnValue(false);

      const testLayer = TestAuthServiceLayer({ isValid: true });

      await Effect.runPromise(
        loginCommand.handler({} as never).pipe(Effect.provide(testLayer)),
      );

      // Get the validate function passed to text
      const textCall = mockedClack.text.mock.calls[0][0];
      expect(textCall).toHaveProperty("validate");

      const validate = textCall.validate!;

      // Test validation rules
      expect(validate("")).toBe("API key is required");
      expect(validate("invalid")).toBe("API key should start with lin_api_");
      expect(validate("lin_api_valid")).toBeUndefined();
    });
  });
});
