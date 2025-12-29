/**
 * Test Layer for AuthService
 *
 * Provides a mock AuthService implementation for testing that:
 * - Uses in-memory state via Effect Ref
 * - Supports configurable initial state
 * - Exposes _getState() for test assertions
 * - Can simulate both success and failure modes
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";
import type { AuthService as AuthServiceInterface } from "../../src/ports/AuthService.js";
import { AuthService } from "../../src/ports/AuthService.js";
import { AuthConfig } from "../../src/domain/Config.js";
import { AuthError, NotAuthenticatedError, ConfigError } from "../../src/domain/Errors.js";

// === Test State Types ===

export interface TestAuthState {
  /** Stored API key (None if not authenticated) */
  apiKey: Option.Option<string>;
  /** Whether validateApiKey should return true */
  isValid: boolean;
  /** Simulated auth error (applies to saveApiKey and validateApiKey) */
  authError: AuthError | null;
  /** Simulated config error (applies to getApiKey) */
  configError: ConfigError | null;
  /** Track method calls for assertions */
  methodCalls: Array<{ method: string; args: unknown[] }>;
}

export const defaultTestAuthState: TestAuthState = {
  apiKey: Option.some("test-api-key"),
  isValid: true,
  authError: null,
  configError: null,
  methodCalls: [],
};

// === Test Layer Factory ===

/**
 * Creates a test AuthService layer with configurable initial state.
 *
 * @example
 * ```typescript
 * it.effect("fails when not authenticated", () =>
 *   Effect.gen(function* () {
 *     const auth = yield* AuthService;
 *     const exit = yield* Effect.exit(auth.getApiKey());
 *     expect(Exit.isFailure(exit)).toBe(true);
 *   }).pipe(Effect.provide(TestAuthServiceLayer({ apiKey: Option.none() })))
 * );
 * ```
 */
export const TestAuthServiceLayer = (
  config?: Partial<TestAuthState>,
): Layer.Layer<AuthService> =>
  Layer.effect(
    AuthService,
    Effect.gen(function* () {
      const initialState: TestAuthState = {
        ...defaultTestAuthState,
        ...config,
        methodCalls: [],
      };

      const stateRef = yield* Ref.make(initialState);

      const trackCall = (method: string, args: unknown[]) =>
        Ref.update(stateRef, (state) => ({
          ...state,
          methodCalls: [...state.methodCalls, { method, args }],
        }));

      const checkAuthError = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.authError) {
          return yield* Effect.fail(state.authError);
        }
      });

      const service: AuthServiceInterface = {
        saveApiKey: (apiKey: string) =>
          Effect.gen(function* () {
            yield* trackCall("saveApiKey", [apiKey]);
            yield* checkAuthError;

            yield* Ref.update(stateRef, (state) => ({
              ...state,
              apiKey: Option.some(apiKey),
            }));

            return new AuthConfig({ apiKey });
          }),

        validateApiKey: (apiKey: string) =>
          Effect.gen(function* () {
            yield* trackCall("validateApiKey", [apiKey]);
            yield* checkAuthError;

            const state = yield* Ref.get(stateRef);
            return state.isValid;
          }),

        getApiKey: () =>
          Effect.gen(function* () {
            yield* trackCall("getApiKey", []);

            const state = yield* Ref.get(stateRef);

            // Check for config error first
            if (state.configError) {
              return yield* Effect.fail(state.configError);
            }

            // Check if authenticated
            if (Option.isNone(state.apiKey)) {
              return yield* Effect.fail(
                new NotAuthenticatedError({ message: "Not authenticated" }),
              );
            }

            return state.apiKey.value;
          }),

        logout: () =>
          Effect.gen(function* () {
            yield* trackCall("logout", []);

            yield* Ref.update(stateRef, (state) => ({
              ...state,
              apiKey: Option.none(),
            }));
          }),

        isAuthenticated: () =>
          Effect.gen(function* () {
            yield* trackCall("isAuthenticated", []);

            const state = yield* Ref.get(stateRef);
            return Option.isSome(state.apiKey);
          }),
      };

      // Attach state accessor for test assertions
      return Object.assign(service, {
        _getState: () => Ref.get(stateRef),
        _setState: (update: Partial<TestAuthState>) =>
          Ref.update(stateRef, (s) => ({ ...s, ...update })),
      });
    }),
  );

// Type for the extended service with test helpers
export type TestAuthService = AuthServiceInterface & {
  _getState: () => Effect.Effect<TestAuthState>;
  _setState: (update: Partial<TestAuthState>) => Effect.Effect<void>;
};
