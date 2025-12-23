/**
 * Test Layer for DaemonService
 *
 * Provides a mock DaemonService implementation for testing that:
 * - Uses in-memory state via Effect Ref
 * - Supports configurable initial state
 * - Exposes _getState() for test assertions
 * - Can simulate both success and failure modes
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type { DaemonService as DaemonServiceInterface } from "../../src/ports/DaemonService.js";
import {
  DaemonService,
  DaemonStatus,
  SessionSubscription,
  DaemonError,
  DaemonNotRunningError,
  DaemonAlreadyRunningError,
  PrNumber,
} from "../../src/ports/DaemonService.js";

// === Test State Types ===

export interface TestDaemonState {
  /** Whether the daemon is running */
  running: boolean;
  /** Daemon process ID (if running) */
  pid: number | null;
  /** Current repository */
  repo: string | null;
  /** Whether connected to GitHub */
  connectedToGitHub: boolean;
  /** Map of session ID to subscribed PR numbers */
  subscriptions: Map<string, number[]>;
  /** Daemon start time (for uptime calculation) */
  startTime: Date | null;
  /** Simulated daemon error */
  daemonError: DaemonError | null;
  /** Track method calls for assertions */
  methodCalls: Array<{ method: string; args: unknown[] }>;
}

export const defaultTestDaemonState: TestDaemonState = {
  running: true,
  pid: 12345,
  repo: "test/repo",
  connectedToGitHub: true,
  subscriptions: new Map(),
  startTime: new Date(),
  daemonError: null,
  methodCalls: [],
};

// === Test Layer Factory ===

/**
 * Creates a test DaemonService layer with configurable initial state.
 *
 * @example
 * ```typescript
 * it.effect("fails when daemon not running", () =>
 *   Effect.gen(function* () {
 *     const daemon = yield* DaemonService;
 *     const exit = yield* Effect.exit(daemon.getStatus());
 *     expect(Exit.isFailure(exit)).toBe(true);
 *   }).pipe(Effect.provide(TestDaemonServiceLayer({ running: false })))
 * );
 * ```
 */
export const TestDaemonServiceLayer = (
  config?: Partial<TestDaemonState>,
): Layer.Layer<DaemonService> =>
  Layer.effect(
    DaemonService,
    Effect.gen(function* () {
      const initialState: TestDaemonState = {
        ...defaultTestDaemonState,
        ...config,
        subscriptions: config?.subscriptions ?? new Map(),
        methodCalls: [],
      };

      const stateRef = yield* Ref.make(initialState);

      const trackCall = (method: string, args: unknown[]) =>
        Ref.update(stateRef, (state) => ({
          ...state,
          methodCalls: [...state.methodCalls, { method, args }],
        }));

      const checkRunning = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (!state.running) {
          return yield* Effect.fail(DaemonNotRunningError.default);
        }
      });

      const checkDaemonError = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.daemonError) {
          return yield* Effect.fail(state.daemonError);
        }
      });

      const service: DaemonServiceInterface = {
        isRunning: () =>
          Effect.gen(function* () {
            yield* trackCall("isRunning", []);
            const state = yield* Ref.get(stateRef);
            return state.running;
          }),

        getStatus: () =>
          Effect.gen(function* () {
            yield* trackCall("getStatus", []);
            yield* checkRunning;
            yield* checkDaemonError;

            const state = yield* Ref.get(stateRef);
            const subscriptions = Array.from(state.subscriptions.entries()).map(
              ([sessionId, prNumbers]) =>
                new SessionSubscription({
                  sessionId,
                  prNumbers: prNumbers as PrNumber[],
                  subscribedAt: new Date().toISOString(),
                }),
            );

            const uptime = state.startTime
              ? Math.floor((Date.now() - state.startTime.getTime()) / 1000)
              : undefined;

            return new DaemonStatus({
              running: state.running,
              pid: state.pid ?? undefined,
              repo: state.repo ?? undefined,
              connectedToGitHub: state.connectedToGitHub,
              subscriptions,
              uptime,
            });
          }),

        subscribe: (sessionId: string, prNumbers: ReadonlyArray<number>) =>
          Effect.gen(function* () {
            yield* trackCall("subscribe", [sessionId, prNumbers]);
            yield* checkRunning;
            yield* checkDaemonError;

            yield* Ref.update(stateRef, (state) => {
              const subscriptions = new Map(state.subscriptions);
              const existing = subscriptions.get(sessionId) ?? [];
              const merged = [...new Set([...existing, ...prNumbers])];
              subscriptions.set(sessionId, merged);
              return { ...state, subscriptions };
            });
          }),

        unsubscribe: (sessionId: string, prNumbers: ReadonlyArray<number>) =>
          Effect.gen(function* () {
            yield* trackCall("unsubscribe", [sessionId, prNumbers]);
            yield* checkRunning;
            yield* checkDaemonError;

            yield* Ref.update(stateRef, (state) => {
              const subscriptions = new Map(state.subscriptions);
              const existing = subscriptions.get(sessionId) ?? [];
              const filtered = existing.filter((n) => !prNumbers.includes(n));
              if (filtered.length === 0) {
                subscriptions.delete(sessionId);
              } else {
                subscriptions.set(sessionId, filtered);
              }
              return { ...state, subscriptions };
            });
          }),

        shutdown: () =>
          Effect.gen(function* () {
            yield* trackCall("shutdown", []);
            yield* checkRunning;

            yield* Ref.update(stateRef, (state) => ({
              ...state,
              running: false,
              pid: null,
              startTime: null,
              subscriptions: new Map(),
            }));
          }),

        cleanup: () =>
          Effect.gen(function* () {
            yield* trackCall("cleanup", []);
            yield* checkRunning;
            yield* checkDaemonError;

            // In test, just return empty list (no stale sessions)
            return [];
          }),

        startDaemon: (repo: string, events: ReadonlyArray<string>) =>
          Effect.gen(function* () {
            yield* trackCall("startDaemon", [repo, events]);

            const state = yield* Ref.get(stateRef);
            if (state.running) {
              return yield* Effect.fail(
                new DaemonAlreadyRunningError({
                  message: "Daemon is already running",
                  pid: state.pid ?? undefined,
                }),
              );
            }

            yield* Ref.update(stateRef, (s) => ({
              ...s,
              running: true,
              pid: 12345,
              repo,
              connectedToGitHub: true,
              startTime: new Date(),
            }));

            // In test, just return immediately (daemon doesn't block)
          }),
      };

      // Attach state accessor for test assertions
      return Object.assign(service, {
        _getState: () => Ref.get(stateRef),
        _setState: (update: Partial<TestDaemonState>) =>
          Ref.update(stateRef, (s) => ({ ...s, ...update })),
      });
    }),
  );

// Type for the extended service with test helpers
export type TestDaemonService = DaemonServiceInterface & {
  _getState: () => Effect.Effect<TestDaemonState>;
  _setState: (update: Partial<TestDaemonState>) => Effect.Effect<void>;
};
