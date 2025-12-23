/**
 * Test Layer for WebhookService
 *
 * Provides a mock WebhookService implementation for testing that:
 * - Uses in-memory state via Effect Ref
 * - Supports configurable initial state
 * - Exposes _getState() for test assertions
 * - Can simulate both success and failure modes
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { WebhookService as WebhookServiceInterface } from "../../src/ports/WebhookService.js";
import {
  WebhookService,
  CliWebhook,
  WebhookId,
  WebhookEvent,
  CreateCliWebhookInput,
} from "../../src/ports/WebhookService.js";
import {
  GhNotInstalledError,
  GhNotAuthenticatedError,
  WebhookError,
  WebhookConnectionError,
  WebhookPermissionError,
  WebhookAlreadyExistsError,
  WebhookRateLimitError,
} from "../../src/domain/Errors.js";

// === Test State Types ===

export interface TestWebhookState {
  /** Map of webhook ID to CliWebhook objects */
  webhooks: Map<number, CliWebhook>;
  /** Counter for generating webhook IDs */
  nextWebhookId: number;
  /** Whether gh CLI is available */
  ghInstalled: boolean;
  /** Whether gh CLI is authenticated */
  ghAuthenticated: boolean;
  /** Simulated permission errors (repo -> error) */
  permissionErrors: Map<string, WebhookPermissionError>;
  /** Simulated rate limit error */
  rateLimitError: WebhookRateLimitError | null;
  /** Simulated connection error for streaming */
  connectionError: WebhookConnectionError | null;
  /** Global webhook error (applies to all operations) */
  globalError: WebhookError | null;
  /** Queued events to emit via stream */
  eventQueue: WebhookEvent[];
  /** Track method calls for assertions */
  methodCalls: Array<{ method: string; args: unknown[] }>;
}

const createTestWebhook = (overrides: Partial<{
  id: number;
  wsUrl: string;
  events: string[];
  active: boolean;
  url: string;
}>): CliWebhook => {
  const id = overrides.id ?? 1;
  return new CliWebhook({
    id: id as WebhookId,
    wsUrl: overrides.wsUrl ?? `wss://test.github.com/webhook/${id}`,
    events: overrides.events ?? ["pull_request", "issue_comment"],
    active: overrides.active ?? true,
    url: overrides.url ?? `https://api.github.com/repos/test/repo/hooks/${id}`,
  });
};

const createTestEvent = (overrides: Partial<{
  event: string;
  action: string;
  deliveryId: string;
  payload: unknown;
}>): WebhookEvent =>
  new WebhookEvent({
    event: overrides.event ?? "pull_request",
    action: overrides.action ?? "opened",
    deliveryId: overrides.deliveryId ?? `delivery-${Date.now()}`,
    payload: overrides.payload ?? { action: "opened", number: 1 },
    headers: {},
  });

export const defaultTestWebhookState: TestWebhookState = {
  webhooks: new Map(),
  nextWebhookId: 1,
  ghInstalled: true,
  ghAuthenticated: true,
  permissionErrors: new Map(),
  rateLimitError: null,
  connectionError: null,
  globalError: null,
  eventQueue: [],
  methodCalls: [],
};

// === Test Layer Factory ===

/**
 * Creates a test WebhookService layer with configurable initial state.
 *
 * @example
 * ```typescript
 * it.effect("fails with permission error when insufficient permissions", () =>
 *   Effect.gen(function* () {
 *     const webhook = yield* WebhookService;
 *     const exit = yield* Effect.exit(
 *       webhook.createCliWebhook(new CreateCliWebhookInput({
 *         repo: "owner/repo",
 *         events: ["pull_request"],
 *       }))
 *     );
 *     expect(Exit.isFailure(exit)).toBe(true);
 *   }).pipe(Effect.provide(TestWebhookServiceLayer({
 *     permissionErrors: new Map([["owner/repo", WebhookPermissionError.forRepo("owner/repo")]])
 *   })))
 * );
 * ```
 */
export const TestWebhookServiceLayer = (
  config?: Partial<TestWebhookState>,
): Layer.Layer<WebhookService> =>
  Layer.effect(
    WebhookService,
    Effect.gen(function* () {
      const initialState: TestWebhookState = {
        ...defaultTestWebhookState,
        ...config,
        webhooks: config?.webhooks ?? new Map(),
        permissionErrors: config?.permissionErrors ?? new Map(),
        eventQueue: config?.eventQueue ?? [],
        methodCalls: [],
      };

      const stateRef = yield* Ref.make(initialState);

      const trackCall = (method: string, args: unknown[]) =>
        Ref.update(stateRef, (state) => ({
          ...state,
          methodCalls: [...state.methodCalls, { method, args }],
        }));

      const checkGhInstalled = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (!state.ghInstalled) {
          return yield* Effect.fail(GhNotInstalledError.default);
        }
      });

      const checkGhAuthenticated = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (!state.ghAuthenticated) {
          return yield* Effect.fail(GhNotAuthenticatedError.default);
        }
      });

      const checkGlobalError = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.globalError) {
          return yield* Effect.fail(state.globalError);
        }
      });

      const checkRateLimit = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.rateLimitError) {
          return yield* Effect.fail(state.rateLimitError);
        }
      });

      const checkPermission = (repo: string) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          const error = state.permissionErrors.get(repo);
          if (error) {
            return yield* Effect.fail(error);
          }
        });

      const service: WebhookServiceInterface = {
        createCliWebhook: (input: CreateCliWebhookInput) =>
          Effect.gen(function* () {
            yield* trackCall("createCliWebhook", [input]);
            yield* checkGhInstalled;
            yield* checkGhAuthenticated;
            yield* checkGlobalError;
            yield* checkRateLimit;
            yield* checkPermission(input.repo);

            const state = yield* Ref.get(stateRef);

            // Check for existing webhook
            const existingWebhook = Array.from(state.webhooks.values()).find(
              (w) => w.url.includes(input.repo.replace("/", "/repos/")),
            );
            if (existingWebhook) {
              return yield* Effect.fail(WebhookAlreadyExistsError.forRepo(input.repo));
            }

            const webhookId = state.nextWebhookId;
            const newWebhook = new CliWebhook({
              id: webhookId as WebhookId,
              wsUrl: `wss://github.com/_ws/webhook/${webhookId}`,
              events: [...input.events],
              active: true,
              url: `https://api.github.com/repos/${input.repo}/hooks/${webhookId}`,
            });

            yield* Ref.update(stateRef, (s) => {
              const webhooks = new Map(s.webhooks);
              webhooks.set(webhookId, newWebhook);
              return { ...s, webhooks, nextWebhookId: s.nextWebhookId + 1 };
            });

            return newWebhook;
          }),

        activateWebhook: (repo: string, webhookId: WebhookId) =>
          Effect.gen(function* () {
            yield* trackCall("activateWebhook", [repo, webhookId]);
            yield* checkGhInstalled;
            yield* checkGhAuthenticated;
            yield* checkGlobalError;

            yield* Ref.update(stateRef, (s) => {
              const webhooks = new Map(s.webhooks);
              const webhook = webhooks.get(webhookId);
              if (webhook) {
                webhooks.set(webhookId, new CliWebhook({ ...webhook, active: true }));
              }
              return { ...s, webhooks };
            });
          }),

        deactivateWebhook: (repo: string, webhookId: WebhookId) =>
          Effect.gen(function* () {
            yield* trackCall("deactivateWebhook", [repo, webhookId]);
            yield* checkGhInstalled;
            yield* checkGhAuthenticated;
            yield* checkGlobalError;

            yield* Ref.update(stateRef, (s) => {
              const webhooks = new Map(s.webhooks);
              const webhook = webhooks.get(webhookId);
              if (webhook) {
                webhooks.set(webhookId, new CliWebhook({ ...webhook, active: false }));
              }
              return { ...s, webhooks };
            });
          }),

        deleteWebhook: (repo: string, webhookId: WebhookId) =>
          Effect.gen(function* () {
            yield* trackCall("deleteWebhook", [repo, webhookId]);
            yield* checkGhInstalled;
            yield* checkGhAuthenticated;
            yield* checkGlobalError;

            yield* Ref.update(stateRef, (s) => {
              const webhooks = new Map(s.webhooks);
              webhooks.delete(webhookId);
              return { ...s, webhooks };
            });
          }),

        listWebhooks: (repo: string) =>
          Effect.gen(function* () {
            yield* trackCall("listWebhooks", [repo]);
            yield* checkGhInstalled;
            yield* checkGhAuthenticated;
            yield* checkGlobalError;

            const state = yield* Ref.get(stateRef);
            return Array.from(state.webhooks.values()).filter((w) =>
              w.url.includes(repo.replace("/", "/repos/")),
            );
          }),

        connectAndStream: (wsUrl: string) => {
          // Need to track the call synchronously before returning the stream
          const stream = Stream.fromEffect(
            Effect.gen(function* () {
              yield* trackCall("connectAndStream", [wsUrl]);
              const state = yield* Ref.get(stateRef);

              if (state.connectionError) {
                return yield* Effect.fail(state.connectionError);
              }

              return state.eventQueue;
            }),
          ).pipe(Stream.flatMap((events) => Stream.fromIterable(events)));

          return stream;
        },
      };

      // Attach state accessor for test assertions
      return Object.assign(service, {
        _getState: () => Ref.get(stateRef),
        _setState: (update: Partial<TestWebhookState>) =>
          Ref.update(stateRef, (s) => ({ ...s, ...update })),
        _queueEvent: (event: WebhookEvent) =>
          Ref.update(stateRef, (s) => ({
            ...s,
            eventQueue: [...s.eventQueue, event],
          })),
      });
    }),
  );

// Type for the extended service with test helpers
export type TestWebhookService = WebhookServiceInterface & {
  _getState: () => Effect.Effect<TestWebhookState>;
  _setState: (update: Partial<TestWebhookState>) => Effect.Effect<void>;
  _queueEvent: (event: WebhookEvent) => Effect.Effect<void>;
};

// Export factories for use in tests
export { createTestWebhook, createTestEvent };
