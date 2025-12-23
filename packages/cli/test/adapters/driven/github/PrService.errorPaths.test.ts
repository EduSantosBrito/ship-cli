/**
 * PrService Error Path Tests
 *
 * Tests all error paths in PrService using the TestPrServiceLayer.
 * Each error type is tested with at least one scenario that:
 * 1. Triggers the error condition via test layer configuration
 * 2. Verifies error `_tag`
 * 3. Verifies error message/context properties
 */

import { describe, it, expect } from "@effect/vitest";
import { Effect, Exit, Cause, Option } from "effect";

import {
  PrService,
  CreatePrInput,
  UpdatePrInput,
  PrReview,
  PrReviewComment,
  PrComment,
} from "../../../../src/ports/PrService.js";
import {
  GhNotInstalledError,
  GhNotAuthenticatedError,
  PrError,
} from "../../../../src/domain/Errors.js";
import { TestPrServiceLayer } from "../../../layers/index.js";

// Helper to extract failure from Exit
const getFailure = <E>(exit: Exit.Exit<unknown, E>): E | null => {
  if (Exit.isFailure(exit)) {
    const option = Cause.failureOption(exit.cause);
    return Option.isSome(option) ? option.value : null;
  }
  return null;
};

describe("PrService Error Paths", () => {
  describe("GhNotInstalledError", () => {
    it.effect("isAvailable returns false when gh CLI not installed", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const isAvailable = yield* pr.isAvailable();
        expect(isAvailable).toBe(false);
      }).pipe(Effect.provide(TestPrServiceLayer({ ghInstalled: false }))),
    );

    it.effect("getCurrentRepo fails with GhNotInstalledError when gh not installed", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const exit = yield* pr.getCurrentRepo().pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("GhNotInstalledError");
        expect((error as GhNotInstalledError).message).toContain("gh CLI is not installed");
      }).pipe(Effect.provide(TestPrServiceLayer({ ghInstalled: false }))),
    );

    it.effect("createPr fails with GhNotInstalledError when gh not installed", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const exit = yield* pr
          .createPr(
            new CreatePrInput({
              title: "Test PR",
              body: "Test body",
              head: "feature-branch",
            }),
          )
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("GhNotInstalledError");
      }).pipe(Effect.provide(TestPrServiceLayer({ ghInstalled: false }))),
    );

    it.effect("updatePr fails with GhNotInstalledError when gh not installed", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const exit = yield* pr
          .updatePr(1, new UpdatePrInput({ title: "Updated" }))
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("GhNotInstalledError");
      }).pipe(Effect.provide(TestPrServiceLayer({ ghInstalled: false }))),
    );

    it.effect("getPrByBranch fails with GhNotInstalledError when gh not installed", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const exit = yield* pr.getPrByBranch("feature-branch").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("GhNotInstalledError");
      }).pipe(Effect.provide(TestPrServiceLayer({ ghInstalled: false }))),
    );

    it.effect("updatePrBase fails with GhNotInstalledError when gh not installed", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const exit = yield* pr.updatePrBase(1, "main").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("GhNotInstalledError");
      }).pipe(Effect.provide(TestPrServiceLayer({ ghInstalled: false }))),
    );
  });

  describe("GhNotAuthenticatedError", () => {
    it.effect("isAvailable returns false when gh not authenticated", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const isAvailable = yield* pr.isAvailable();
        expect(isAvailable).toBe(false);
      }).pipe(Effect.provide(TestPrServiceLayer({ ghAuthenticated: false }))),
    );

    it.effect("getCurrentRepo fails with GhNotAuthenticatedError when not authenticated", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const exit = yield* pr.getCurrentRepo().pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("GhNotAuthenticatedError");
        expect((error as GhNotAuthenticatedError).message).toContain("not authenticated");
      }).pipe(Effect.provide(TestPrServiceLayer({ ghAuthenticated: false }))),
    );

    it.effect("createPr fails with GhNotAuthenticatedError when not authenticated", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const exit = yield* pr
          .createPr(
            new CreatePrInput({
              title: "Test PR",
              body: "Test body",
              head: "feature-branch",
            }),
          )
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("GhNotAuthenticatedError");
      }).pipe(Effect.provide(TestPrServiceLayer({ ghAuthenticated: false }))),
    );
  });

  describe("PrError", () => {
    it.effect("updatePr fails with PrError when PR not found", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const exit = yield* pr
          .updatePr(999, new UpdatePrInput({ title: "Updated" }))
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("PrError");
        expect((error as PrError).message).toContain("999");
        expect((error as PrError).message).toContain("not found");
      }).pipe(Effect.provide(TestPrServiceLayer())),
    );

    it.effect("updatePrBase fails with PrError when PR not found", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const exit = yield* pr.updatePrBase(999, "main").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("PrError");
        expect((error as PrError).message).toContain("999");
      }).pipe(Effect.provide(TestPrServiceLayer())),
    );

    it.effect("updatePr fails with configured PrError for specific PR", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const exit = yield* pr
          .updatePr(1, new UpdatePrInput({ title: "Updated" }))
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("PrError");
        expect((error as PrError).message).toContain("merge conflict");
      }).pipe(
        Effect.provide(
          TestPrServiceLayer({
            prErrors: new Map([
              [1, new PrError({ message: "Cannot update: merge conflict" })],
            ]),
          }),
        ),
      ),
    );

    it.effect("operations fail with globalPrError when configured", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const exit = yield* pr.getCurrentRepo().pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("PrError");
        expect((error as PrError).message).toContain("GitHub API");
      }).pipe(
        Effect.provide(
          TestPrServiceLayer({
            globalPrError: new PrError({ message: "GitHub API unavailable" }),
          }),
        ),
      ),
    );
  });

  describe("Success paths (sanity checks)", () => {
    it.effect("isAvailable returns true when gh installed and authenticated", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const isAvailable = yield* pr.isAvailable();
        expect(isAvailable).toBe(true);
      }).pipe(Effect.provide(TestPrServiceLayer())),
    );

    it.effect("getCurrentRepo returns configured repository", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const repo = yield* pr.getCurrentRepo();
        expect(repo).toBe("test/repo");
      }).pipe(Effect.provide(TestPrServiceLayer())),
    );

    it.effect("getCurrentRepo returns null when no repo configured", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const repo = yield* pr.getCurrentRepo();
        expect(repo).toBeNull();
      }).pipe(Effect.provide(TestPrServiceLayer({ currentRepo: null }))),
    );

    it.effect("createPr creates and returns new PR", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const result = yield* pr.createPr(
          new CreatePrInput({
            title: "New Feature",
            body: "Feature description",
            head: "feature-branch",
            base: "main",
          }),
        );
        expect(result.title).toBe("New Feature");
        expect(result.head).toBe("feature-branch");
        expect(result.base).toBe("main");
        expect(result.state).toBe("open");
      }).pipe(Effect.provide(TestPrServiceLayer())),
    );

    it.effect("createPr creates draft PR when draft flag is set", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const result = yield* pr.createPr(
          new CreatePrInput({
            title: "Draft Feature",
            body: "WIP",
            head: "draft-branch",
            draft: true,
          }),
        );
        expect(result.title).toBe("Draft Feature");
        expect(result.state).toBe("open");
      }).pipe(Effect.provide(TestPrServiceLayer())),
    );

    it.effect("updatePr updates existing PR", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const result = yield* pr.updatePr(
          1,
          new UpdatePrInput({ title: "Updated Title" }),
        );
        expect(result.title).toBe("Updated Title");
        expect(result.number).toBe(1);
      }).pipe(Effect.provide(TestPrServiceLayer())),
    );

    it.effect("getPrByBranch returns PR for existing branch", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const result = yield* pr.getPrByBranch("feature-branch");
        expect(result).not.toBeNull();
        expect(result!.number).toBe(1);
      }).pipe(Effect.provide(TestPrServiceLayer())),
    );

    it.effect("getPrByBranch returns null for unknown branch", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const result = yield* pr.getPrByBranch("unknown-branch");
        expect(result).toBeNull();
      }).pipe(Effect.provide(TestPrServiceLayer())),
    );

    it.effect("updatePrBase updates base branch of PR", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const result = yield* pr.updatePrBase(1, "develop");
        expect(result.base).toBe("develop");
      }).pipe(Effect.provide(TestPrServiceLayer())),
    );

    it.effect("openInBrowser succeeds without error", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        yield* pr.openInBrowser("https://github.com/test/repo/pull/1");
        // No error = success
      }).pipe(Effect.provide(TestPrServiceLayer())),
    );

    it.effect("getReviews returns empty array when no reviews", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const reviews = yield* pr.getReviews(1);
        expect(reviews).toEqual([]);
      }).pipe(Effect.provide(TestPrServiceLayer())),
    );

    it.effect("getReviews returns configured reviews", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const reviews = yield* pr.getReviews(1);
        expect(reviews).toHaveLength(1);
        expect(reviews[0].author).toBe("reviewer1");
        expect(reviews[0].state).toBe("CHANGES_REQUESTED");
      }).pipe(
        Effect.provide(
          TestPrServiceLayer({
            reviews: new Map([
              [
                1,
                [
                  new PrReview({
                    id: 1,
                    author: "reviewer1",
                    state: "CHANGES_REQUESTED",
                    body: "Please fix the type error",
                    submittedAt: "2024-01-01T00:00:00Z",
                  }),
                ],
              ],
            ]),
          }),
        ),
      ),
    );

    it.effect("getReviewComments returns empty array when no comments", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const comments = yield* pr.getReviewComments(1);
        expect(comments).toEqual([]);
      }).pipe(Effect.provide(TestPrServiceLayer())),
    );

    it.effect("getReviewComments returns configured comments", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const comments = yield* pr.getReviewComments(1);
        expect(comments).toHaveLength(1);
        expect(comments[0].path).toBe("src/index.ts");
        expect(comments[0].line).toBe(42);
      }).pipe(
        Effect.provide(
          TestPrServiceLayer({
            reviewComments: new Map([
              [
                1,
                [
                  new PrReviewComment({
                    id: 1,
                    path: "src/index.ts",
                    line: 42,
                    body: "Consider renaming this variable",
                    author: "reviewer1",
                    createdAt: "2024-01-01T00:00:00Z",
                    inReplyToId: null,
                  }),
                ],
              ],
            ]),
          }),
        ),
      ),
    );

    it.effect("getPrComments returns empty array when no comments", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const comments = yield* pr.getPrComments(1);
        expect(comments).toEqual([]);
      }).pipe(Effect.provide(TestPrServiceLayer())),
    );

    it.effect("getPrComments returns configured comments", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const comments = yield* pr.getPrComments(1);
        expect(comments).toHaveLength(1);
        expect(comments[0].body).toBe("Overall looks good!");
      }).pipe(
        Effect.provide(
          TestPrServiceLayer({
            prComments: new Map([
              [
                1,
                [
                  new PrComment({
                    id: 1,
                    body: "Overall looks good!",
                    author: "reviewer1",
                    createdAt: "2024-01-01T00:00:00Z",
                  }),
                ],
              ],
            ]),
          }),
        ),
      ),
    );
  });

  describe("Review methods error paths", () => {
    it.effect("getReviews fails with GhNotInstalledError when gh not installed", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const exit = yield* pr.getReviews(1).pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("GhNotInstalledError");
      }).pipe(Effect.provide(TestPrServiceLayer({ ghInstalled: false }))),
    );

    it.effect("getReviewComments fails with GhNotAuthenticatedError when not authenticated", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const exit = yield* pr.getReviewComments(1).pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("GhNotAuthenticatedError");
      }).pipe(Effect.provide(TestPrServiceLayer({ ghAuthenticated: false }))),
    );

    it.effect("getPrComments fails with globalPrError when configured", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const exit = yield* pr.getPrComments(1).pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("PrError");
        expect((error as PrError).message).toContain("GitHub API");
      }).pipe(
        Effect.provide(
          TestPrServiceLayer({
            globalPrError: new PrError({ message: "GitHub API unavailable" }),
          }),
        ),
      ),
    );
  });
});
