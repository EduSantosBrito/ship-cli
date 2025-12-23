/**
 * Test Layer for PrService
 *
 * Provides a mock PrService implementation for testing that:
 * - Uses in-memory state via Effect Ref
 * - Supports configurable initial state
 * - Exposes _getState() for test assertions
 * - Can simulate both success and failure modes
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type { PrService as PrServiceInterface } from "../../src/ports/PrService.js";
import {
  PrService,
  PullRequest,
  PrId,
  PrReview,
  PrReviewComment,
  PrComment,
  CreatePrInput,
  UpdatePrInput,
} from "../../src/ports/PrService.js";
import {
  GhNotInstalledError,
  GhNotAuthenticatedError,
  PrError,
} from "../../src/domain/Errors.js";

// === Test State Types ===

export interface TestPrState {
  /** Map of PR number to PullRequest objects */
  pullRequests: Map<number, PullRequest>;
  /** Map of branch name to PR number */
  branchToPr: Map<string, number>;
  /** Current repository (owner/repo) */
  currentRepo: string | null;
  /** Whether gh CLI is available */
  ghInstalled: boolean;
  /** Whether gh CLI is authenticated */
  ghAuthenticated: boolean;
  /** Simulated PR errors (PR number -> error) */
  prErrors: Map<number, PrError>;
  /** Global PR error (applies to all operations) */
  globalPrError: PrError | null;
  /** Counter for generating PR numbers */
  nextPrNumber: number;
  /** Track method calls for assertions */
  methodCalls: Array<{ method: string; args: unknown[] }>;
  /** Map of PR number to reviews */
  reviews: Map<number, PrReview[]>;
  /** Map of PR number to inline code comments */
  reviewComments: Map<number, PrReviewComment[]>;
  /** Map of PR number to general conversation comments */
  prComments: Map<number, PrComment[]>;
}

const createTestPr = (overrides: Partial<{
  id: string;
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  head: string;
  base: string;
}>): PullRequest => {
  const number = overrides.number ?? 1;
  return new PullRequest({
    id: (overrides.id ?? `pr-${number}`) as PrId,
    number,
    title: overrides.title ?? "Test PR",
    url: overrides.url ?? `https://github.com/test/repo/pull/${number}`,
    state: overrides.state ?? "open",
    head: overrides.head ?? "feature-branch",
    base: overrides.base ?? "main",
  });
};

export const defaultTestPrState: TestPrState = {
  pullRequests: new Map([
    [1, createTestPr({ number: 1 })],
  ]),
  branchToPr: new Map([["feature-branch", 1]]),
  currentRepo: "test/repo",
  ghInstalled: true,
  ghAuthenticated: true,
  prErrors: new Map(),
  globalPrError: null,
  nextPrNumber: 2,
  methodCalls: [],
  reviews: new Map(),
  reviewComments: new Map(),
  prComments: new Map(),
};

// === Test Layer Factory ===

/**
 * Creates a test PrService layer with configurable initial state.
 *
 * @example
 * ```typescript
 * it.effect("fails when gh CLI not installed", () =>
 *   Effect.gen(function* () {
 *     const pr = yield* PrService;
 *     const exit = yield* Effect.exit(pr.createPr(new CreatePrInput({...})));
 *     expect(exit).toEqual(Exit.fail(GhNotInstalledError.default));
 *   }).pipe(Effect.provide(TestPrServiceLayer({ ghInstalled: false })))
 * );
 * ```
 */
export const TestPrServiceLayer = (
  config?: Partial<TestPrState>,
): Layer.Layer<PrService> =>
  Layer.effect(
    PrService,
    Effect.gen(function* () {
      const initialState: TestPrState = {
        ...defaultTestPrState,
        ...config,
        pullRequests: config?.pullRequests ?? new Map(defaultTestPrState.pullRequests),
        branchToPr: config?.branchToPr ?? new Map(defaultTestPrState.branchToPr),
        prErrors: config?.prErrors ?? new Map(),
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

      const checkGlobalPrError = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.globalPrError) {
          return yield* Effect.fail(state.globalPrError);
        }
      });

      const checkPrError = (prNumber: number) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          const error = state.prErrors.get(prNumber);
          if (error) {
            return yield* Effect.fail(error);
          }
        });

      const service: PrServiceInterface = {
        isAvailable: () =>
          Effect.gen(function* () {
            yield* trackCall("isAvailable", []);
            const state = yield* Ref.get(stateRef);
            return state.ghInstalled && state.ghAuthenticated;
          }),

        getCurrentRepo: () =>
          Effect.gen(function* () {
            yield* trackCall("getCurrentRepo", []);
            yield* checkGhInstalled;
            yield* checkGhAuthenticated;
            yield* checkGlobalPrError;

            const state = yield* Ref.get(stateRef);
            return state.currentRepo;
          }),

        createPr: (input: CreatePrInput) =>
          Effect.gen(function* () {
            yield* trackCall("createPr", [input]);
            yield* checkGhInstalled;
            yield* checkGhAuthenticated;
            yield* checkGlobalPrError;

            const state = yield* Ref.get(stateRef);
            const prNumber = state.nextPrNumber;

            const newPr = new PullRequest({
              id: `pr-${prNumber}` as PrId,
              number: prNumber,
              title: input.title,
              url: `https://github.com/${state.currentRepo}/pull/${prNumber}`,
              state: input.draft ? "open" : "open",
              head: input.head,
              base: input.base,
            });

            yield* Ref.update(stateRef, (s) => {
              const pullRequests = new Map(s.pullRequests);
              pullRequests.set(prNumber, newPr);
              const branchToPr = new Map(s.branchToPr);
              branchToPr.set(input.head, prNumber);
              return {
                ...s,
                pullRequests,
                branchToPr,
                nextPrNumber: s.nextPrNumber + 1,
              };
            });

            return newPr;
          }),

        updatePr: (prNumber: number, input: UpdatePrInput) =>
          Effect.gen(function* () {
            yield* trackCall("updatePr", [prNumber, input]);
            yield* checkGhInstalled;
            yield* checkGhAuthenticated;
            yield* checkGlobalPrError;
            yield* checkPrError(prNumber);

            const state = yield* Ref.get(stateRef);
            const pr = state.pullRequests.get(prNumber);
            if (!pr) {
              return yield* Effect.fail(
                new PrError({ message: `PR #${prNumber} not found` }),
              );
            }

            const updatedPr = new PullRequest({
              ...pr,
              title: input.title ?? pr.title,
            });

            yield* Ref.update(stateRef, (s) => {
              const pullRequests = new Map(s.pullRequests);
              pullRequests.set(prNumber, updatedPr);
              return { ...s, pullRequests };
            });

            return updatedPr;
          }),

        openInBrowser: (url: string) =>
          Effect.gen(function* () {
            yield* trackCall("openInBrowser", [url]);
            // No-op in tests
          }),

        getPrByBranch: (branch: string) =>
          Effect.gen(function* () {
            yield* trackCall("getPrByBranch", [branch]);
            yield* checkGhInstalled;
            yield* checkGhAuthenticated;
            yield* checkGlobalPrError;

            const state = yield* Ref.get(stateRef);
            const prNumber = state.branchToPr.get(branch);
            if (prNumber === undefined) {
              return null;
            }
            return state.pullRequests.get(prNumber) ?? null;
          }),

        updatePrBase: (prNumber: number, base: string) =>
          Effect.gen(function* () {
            yield* trackCall("updatePrBase", [prNumber, base]);
            yield* checkGhInstalled;
            yield* checkGhAuthenticated;
            yield* checkGlobalPrError;
            yield* checkPrError(prNumber);

            const state = yield* Ref.get(stateRef);
            const pr = state.pullRequests.get(prNumber);
            if (!pr) {
              return yield* Effect.fail(
                new PrError({ message: `PR #${prNumber} not found` }),
              );
            }

            const updatedPr = new PullRequest({
              ...pr,
              base,
            });

            yield* Ref.update(stateRef, (s) => {
              const pullRequests = new Map(s.pullRequests);
              pullRequests.set(prNumber, updatedPr);
              return { ...s, pullRequests };
            });

            return updatedPr;
          }),

        getReviews: (prNumber: number) =>
          Effect.gen(function* () {
            yield* trackCall("getReviews", [prNumber]);
            yield* checkGhInstalled;
            yield* checkGhAuthenticated;
            yield* checkGlobalPrError;
            yield* checkPrError(prNumber);

            const state = yield* Ref.get(stateRef);
            return state.reviews.get(prNumber) ?? [];
          }),

        getReviewComments: (prNumber: number) =>
          Effect.gen(function* () {
            yield* trackCall("getReviewComments", [prNumber]);
            yield* checkGhInstalled;
            yield* checkGhAuthenticated;
            yield* checkGlobalPrError;
            yield* checkPrError(prNumber);

            const state = yield* Ref.get(stateRef);
            return state.reviewComments.get(prNumber) ?? [];
          }),

        getPrComments: (prNumber: number) =>
          Effect.gen(function* () {
            yield* trackCall("getPrComments", [prNumber]);
            yield* checkGhInstalled;
            yield* checkGhAuthenticated;
            yield* checkGlobalPrError;
            yield* checkPrError(prNumber);

            const state = yield* Ref.get(stateRef);
            return state.prComments.get(prNumber) ?? [];
          }),
      };

      // Attach state accessor for test assertions
      return Object.assign(service, {
        _getState: () => Ref.get(stateRef),
        _setState: (update: Partial<TestPrState>) =>
          Ref.update(stateRef, (s) => ({ ...s, ...update })),
      });
    }),
  );

// Type for the extended service with test helpers
export type TestPrService = PrServiceInterface & {
  _getState: () => Effect.Effect<TestPrState>;
  _setState: (update: Partial<TestPrState>) => Effect.Effect<void>;
};

// Export the test PR factory for use in tests
export { createTestPr };
