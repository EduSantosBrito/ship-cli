/**
 * Test Layer for OpenCodeService
 *
 * Provides a mock OpenCodeService implementation for testing that:
 * - Uses in-memory state via Effect Ref
 * - Supports configurable initial state
 * - Exposes _getState() for test assertions
 * - Can simulate both success and failure modes (API errors, not running, etc.)
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type { OpenCodeService as OpenCodeServiceInterface } from "../../src/ports/OpenCodeService.js";
import {
  OpenCodeService,
  Session,
  SessionId,
  type SessionStatus,
} from "../../src/ports/OpenCodeService.js";
import {
  OpenCodeError,
  OpenCodeNotRunningError,
  OpenCodeSessionNotFoundError,
} from "../../src/domain/Errors.js";

// === Test State Types ===

export interface TestOpenCodeState {
  /** Whether OpenCode is available */
  isAvailable: boolean;
  /** Map of session ID to Session objects */
  sessions: Map<string, Session>;
  /** Map of session ID to SessionStatus */
  sessionStatuses: Map<string, SessionStatus>;
  /** Global error (applies to all operations except isAvailable) */
  globalError: OpenCodeError | null;
  /** Track method calls for assertions */
  methodCalls: Array<{ method: string; args: unknown[] }>;
  /** Track sent prompts for verification */
  sentPrompts: Array<{ sessionId: string; message: string }>;
}

// Default test session factory
const createTestSession = (
  overrides: Partial<{
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  }>,
): Session => {
  const now = new Date().toISOString();
  return new Session({
    id: (overrides.id ?? "test-session-id") as SessionId,
    title: overrides.title ?? "Test Session",
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  });
};

export const defaultTestOpenCodeState: TestOpenCodeState = {
  isAvailable: true,
  sessions: new Map([["test-session-id", createTestSession({})]]),
  sessionStatuses: new Map([["test-session-id", { type: "idle" as const }]]),
  globalError: null,
  methodCalls: [],
  sentPrompts: [],
};

// === Test Layer Factory ===

/**
 * Creates a test OpenCodeService layer with configurable initial state.
 *
 * @example
 * ```typescript
 * it.effect("checks availability", () =>
 *   Effect.gen(function* () {
 *     const service = yield* OpenCodeService;
 *     const available = yield* service.isAvailable();
 *     expect(available).toBe(true);
 *   }).pipe(Effect.provide(TestOpenCodeServiceLayer()))
 * );
 * ```
 */
export const TestOpenCodeServiceLayer = (
  config?: Partial<TestOpenCodeState>,
): Layer.Layer<OpenCodeService> =>
  Layer.effect(
    OpenCodeService,
    Effect.gen(function* () {
      const initialState: TestOpenCodeState = {
        ...defaultTestOpenCodeState,
        ...config,
        sessions: config?.sessions ?? new Map(defaultTestOpenCodeState.sessions),
        sessionStatuses: config?.sessionStatuses ?? new Map(defaultTestOpenCodeState.sessionStatuses),
        methodCalls: [],
        sentPrompts: [],
      };

      const stateRef = yield* Ref.make(initialState);

      const trackCall = (method: string, args: unknown[]) =>
        Ref.update(stateRef, (state) => ({
          ...state,
          methodCalls: [...state.methodCalls, { method, args }],
        }));

      const checkAvailable = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (!state.isAvailable) {
          return yield* Effect.fail(
            new OpenCodeNotRunningError({ message: "OpenCode is not running" }),
          );
        }
      });

      const checkGlobalError = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.globalError) {
          return yield* Effect.fail(state.globalError);
        }
      });

      const service: OpenCodeServiceInterface = {
        isAvailable: () =>
          Effect.gen(function* () {
            yield* trackCall("isAvailable", []);
            const state = yield* Ref.get(stateRef);
            return state.isAvailable;
          }),

        listSessions: () =>
          Effect.gen(function* () {
            yield* trackCall("listSessions", []);
            yield* checkAvailable;
            yield* checkGlobalError;

            const state = yield* Ref.get(stateRef);
            return Array.from(state.sessions.values());
          }),

        getSessionStatuses: () =>
          Effect.gen(function* () {
            yield* trackCall("getSessionStatuses", []);
            yield* checkAvailable;
            yield* checkGlobalError;

            const state = yield* Ref.get(stateRef);
            return Object.fromEntries(state.sessionStatuses);
          }),

        getSession: (sessionId: SessionId) =>
          Effect.gen(function* () {
            yield* trackCall("getSession", [sessionId]);
            yield* checkAvailable;
            yield* checkGlobalError;

            const state = yield* Ref.get(stateRef);
            const session = state.sessions.get(sessionId);
            if (!session) {
              return yield* Effect.fail(OpenCodeSessionNotFoundError.forId(sessionId));
            }
            return session;
          }),

        sendPromptAsync: (sessionId: SessionId, message: string) =>
          Effect.gen(function* () {
            yield* trackCall("sendPromptAsync", [sessionId, message]);
            yield* checkAvailable;
            yield* checkGlobalError;

            const state = yield* Ref.get(stateRef);
            if (!state.sessions.has(sessionId)) {
              return yield* Effect.fail(OpenCodeSessionNotFoundError.forId(sessionId));
            }

            yield* Ref.update(stateRef, (s) => ({
              ...s,
              sentPrompts: [...s.sentPrompts, { sessionId, message }],
            }));
          }),

        findActiveSession: () =>
          Effect.gen(function* () {
            yield* trackCall("findActiveSession", []);
            yield* checkAvailable;
            yield* checkGlobalError;

            const state = yield* Ref.get(stateRef);
            const sessions = Array.from(state.sessions.values());

            if (sessions.length === 0) {
              return null;
            }

            // Find running sessions (busy or retry status)
            const runningSessions = sessions.filter((s) => {
              const status = state.sessionStatuses.get(s.id);
              return status && (status.type === "busy" || status.type === "retry");
            });

            if (runningSessions.length > 0) {
              // Return most recently updated running session
              return runningSessions.sort(
                (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
              )[0];
            }

            // Otherwise return most recently updated session
            return sessions.sort(
              (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
            )[0];
          }),
      };

      // Attach state accessor for test assertions
      return Object.assign(service, {
        _getState: () => Ref.get(stateRef),
        _setState: (update: Partial<TestOpenCodeState>) =>
          Ref.update(stateRef, (s) => ({ ...s, ...update })),
      });
    }),
  );

// Type for the extended service with test helpers
export type TestOpenCodeService = OpenCodeServiceInterface & {
  _getState: () => Effect.Effect<TestOpenCodeState>;
  _setState: (update: Partial<TestOpenCodeState>) => Effect.Effect<void>;
};

// Export the test session factory for use in tests
export { createTestSession };
