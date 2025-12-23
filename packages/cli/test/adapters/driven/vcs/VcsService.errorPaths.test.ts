/**
 * VcsService Error Path Tests
 *
 * Tests all error paths in VcsService using the TestVcsServiceLayer.
 * Each error type is tested with at least one scenario that:
 * 1. Triggers the error condition via test layer configuration
 * 2. Verifies error `_tag`
 * 3. Verifies error message/context properties
 */

import { describe, it, expect } from "@effect/vitest";
import { Effect, Exit, Cause, Option } from "effect";

import { VcsService, ChangeId } from "../../../../src/ports/VcsService.js";
import {
  JjNotInstalledError,
  NotARepoError,
  JjConflictError,
  JjPushError,
  JjFetchError,
  JjBookmarkError,
  JjRevisionError,
  JjSquashError,
  JjImmutableError,
  JjStaleWorkingCopyError,
  WorkspaceExistsError,
  WorkspaceNotFoundError,
} from "../../../../src/domain/Errors.js";
import { TestVcsServiceLayer } from "../../../layers/index.js";

// Helper to extract failure from Exit
const getFailure = <E>(exit: Exit.Exit<unknown, E>): E | null => {
  if (Exit.isFailure(exit)) {
    const option = Cause.failureOption(exit.cause);
    return Option.isSome(option) ? option.value : null;
  }
  return null;
};

describe("VcsService Error Paths", () => {
  describe("JjNotInstalledError", () => {
    it.effect("isAvailable returns false when jj is not installed", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const isAvailable = yield* vcs.isAvailable();
        expect(isAvailable).toBe(false);
      }).pipe(Effect.provide(TestVcsServiceLayer({ isAvailable: false }))),
    );

    it.effect("createChange fails with JjNotInstalledError when jj is not available", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.createChange("test message").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("JjNotInstalledError");
        expect((error as JjNotInstalledError).message).toContain("jj is not installed");
      }).pipe(Effect.provide(TestVcsServiceLayer({ isAvailable: false }))),
    );
  });

  describe("NotARepoError", () => {
    it.effect("isRepo returns false when not in a jj repository", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const isRepo = yield* vcs.isRepo();
        expect(isRepo).toBe(false);
      }).pipe(Effect.provide(TestVcsServiceLayer({ isRepo: false }))),
    );

    it.effect("createChange fails with NotARepoError when not in a jj repository", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.createChange("test message").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("NotARepoError");
        expect((error as NotARepoError).message).toContain("Not a jj repository");
      }).pipe(Effect.provide(TestVcsServiceLayer({ isRepo: false }))),
    );

    it.effect("getCurrentChange fails with NotARepoError when not in a jj repository", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.getCurrentChange().pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("NotARepoError");
      }).pipe(Effect.provide(TestVcsServiceLayer({ isRepo: false }))),
    );

    it.effect("getStack fails with NotARepoError when not in a jj repository", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.getStack().pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("NotARepoError");
      }).pipe(Effect.provide(TestVcsServiceLayer({ isRepo: false }))),
    );
  });

  describe("JjConflictError", () => {
    it.effect("createChange fails with JjConflictError when working copy has conflicts", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.createChange("test message").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("JjConflictError");
        expect((error as JjConflictError).message).toContain("conflicts");
        expect((error as JjConflictError).conflictedPaths).toBeDefined();
      }).pipe(Effect.provide(TestVcsServiceLayer({ hasConflicts: true }))),
    );
  });

  describe("JjPushError", () => {
    it.effect("push fails with JjPushError when configured for specific bookmark", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.push("feature-branch").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("JjPushError");
        expect((error as JjPushError).message).toContain("auth");
        expect((error as JjPushError).bookmark).toBe("feature-branch");
      }).pipe(
        Effect.provide(
          TestVcsServiceLayer({
            pushErrors: new Map([
              [
                "feature-branch",
                new JjPushError({
                  message: "Push failed: auth required",
                  bookmark: "feature-branch",
                }),
              ],
            ]),
          }),
        ),
      ),
    );

    it.effect("push succeeds for bookmarks without configured errors", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const result = yield* vcs.push("other-branch");
        expect(result.bookmark).toBe("other-branch");
      }).pipe(
        Effect.provide(
          TestVcsServiceLayer({
            pushErrors: new Map([
              ["feature-branch", new JjPushError({ message: "Push failed", bookmark: "feature-branch" })],
            ]),
          }),
        ),
      ),
    );
  });

  describe("JjFetchError", () => {
    it.effect("fetch fails with JjFetchError when network error occurs", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.fetch().pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("JjFetchError");
        expect((error as JjFetchError).message).toContain("network");
      }).pipe(
        Effect.provide(
          TestVcsServiceLayer({
            fetchError: new JjFetchError({
              message: "Fetch failed: network timeout",
            }),
          }),
        ),
      ),
    );

    it.effect("sync fails with JjFetchError when fetch fails", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.sync("main").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("JjFetchError");
      }).pipe(
        Effect.provide(
          TestVcsServiceLayer({
            fetchError: new JjFetchError({ message: "Fetch failed" }),
          }),
        ),
      ),
    );
  });

  describe("JjBookmarkError", () => {
    it.effect("createBookmark fails with JjBookmarkError when bookmark already exists", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.createBookmark("existing-bookmark").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("JjBookmarkError");
        expect((error as JjBookmarkError).message).toContain("exists");
        expect((error as JjBookmarkError).bookmark).toBe("existing-bookmark");
      }).pipe(
        Effect.provide(
          TestVcsServiceLayer({
            bookmarkErrors: new Map([
              [
                "existing-bookmark",
                new JjBookmarkError({
                  message: "Bookmark already exists",
                  bookmark: "existing-bookmark",
                }),
              ],
            ]),
          }),
        ),
      ),
    );
  });

  describe("JjRevisionError", () => {
    it.effect("editChange fails with JjRevisionError for invalid change ID", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.editChange("nonexistent-change" as ChangeId).pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("JjRevisionError");
        expect((error as JjRevisionError).message).toContain("not found");
        expect((error as JjRevisionError).revision).toBe("nonexistent-change");
      }).pipe(Effect.provide(TestVcsServiceLayer({}))),
    );

    it.effect("abandon fails with JjRevisionError for invalid change ID", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.abandon("nonexistent-change").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("JjRevisionError");
        expect((error as JjRevisionError).revision).toBe("nonexistent-change");
      }).pipe(Effect.provide(TestVcsServiceLayer({}))),
    );
  });

  describe("JjSquashError", () => {
    it.effect("squash fails with JjSquashError when no parent commit exists", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        // With only one change in the map, there's no parent to squash into
        const exit = yield* vcs.squash("squash message").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("JjSquashError");
        expect((error as JjSquashError).message).toContain("no parent");
      }).pipe(Effect.provide(TestVcsServiceLayer({}))), // Default state has only one change
    );
  });

  describe("JjImmutableError", () => {
    it.effect("editChange fails with JjImmutableError for immutable commit", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.editChange("immutable-change-id" as ChangeId).pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("JjImmutableError");
        expect((error as JjImmutableError).message).toContain("immutable");
        expect((error as JjImmutableError).commitId).toBe("immutable-change-id");
      }).pipe(
        Effect.provide(
          TestVcsServiceLayer({
            immutableChangeIds: new Set(["immutable-change-id"]),
          }),
        ),
      ),
    );

    it.effect("abandon fails with JjImmutableError for immutable commit", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.abandon("immutable-change-id").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("JjImmutableError");
        expect((error as JjImmutableError).commitId).toBe("immutable-change-id");
      }).pipe(
        Effect.provide(
          TestVcsServiceLayer({
            immutableChangeIds: new Set(["immutable-change-id"]),
          }),
        ),
      ),
    );

    it.effect("rebase fails with JjImmutableError for immutable source commit", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.rebase("immutable-change-id" as ChangeId, "main").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("JjImmutableError");
        expect((error as JjImmutableError).commitId).toBe("immutable-change-id");
      }).pipe(
        Effect.provide(
          TestVcsServiceLayer({
            immutableChangeIds: new Set(["immutable-change-id"]),
          }),
        ),
      ),
    );
  });

  describe("JjStaleWorkingCopyError", () => {
    it.effect("createChange fails with JjStaleWorkingCopyError when working copy is stale", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.createChange("test").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("JjStaleWorkingCopyError");
        expect((error as JjStaleWorkingCopyError).message).toContain("stale");
      }).pipe(Effect.provide(TestVcsServiceLayer({ staleWorkingCopy: true }))),
    );

    it.effect("describe fails with JjStaleWorkingCopyError when working copy is stale", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.describe("new message").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("JjStaleWorkingCopyError");
      }).pipe(Effect.provide(TestVcsServiceLayer({ staleWorkingCopy: true }))),
    );

    it.effect("push fails with JjStaleWorkingCopyError when working copy is stale", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.push("main").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("JjStaleWorkingCopyError");
      }).pipe(Effect.provide(TestVcsServiceLayer({ staleWorkingCopy: true }))),
    );

    it.effect("squash fails with JjStaleWorkingCopyError when working copy is stale", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.squash("message").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("JjStaleWorkingCopyError");
      }).pipe(Effect.provide(TestVcsServiceLayer({ staleWorkingCopy: true }))),
    );

    it.effect("updateStaleWorkspace recovers from stale working copy", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const result = yield* vcs.updateStaleWorkspace();
        expect(result.updated).toBe(true);
        expect(result.changeId).toBeDefined();
      }).pipe(Effect.provide(TestVcsServiceLayer({ staleWorkingCopy: true }))),
    );
  });

  describe("WorkspaceExistsError", () => {
    it.effect("createWorkspace fails with WorkspaceExistsError for existing workspace", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.createWorkspace("default", "/some/path").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("WorkspaceExistsError");
        expect((error as WorkspaceExistsError).message).toContain("default");
        expect((error as WorkspaceExistsError).name).toBe("default");
      }).pipe(Effect.provide(TestVcsServiceLayer({}))), // Default state has "default" workspace
    );
  });

  describe("WorkspaceNotFoundError", () => {
    it.effect("forgetWorkspace fails with WorkspaceNotFoundError for unknown workspace", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const exit = yield* vcs.forgetWorkspace("nonexistent-workspace").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("WorkspaceNotFoundError");
        expect((error as WorkspaceNotFoundError).message).toContain("nonexistent-workspace");
        expect((error as WorkspaceNotFoundError).name).toBe("nonexistent-workspace");
      }).pipe(Effect.provide(TestVcsServiceLayer({}))),
    );
  });

  describe("Success paths (sanity checks)", () => {
    it.effect("createChange succeeds with valid configuration", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const changeId = yield* vcs.createChange("test message");
        expect(changeId).toBeDefined();
        expect(typeof changeId).toBe("string");
      }).pipe(Effect.provide(TestVcsServiceLayer({}))),
    );

    it.effect("fetch succeeds when no error configured", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        yield* vcs.fetch();
        // No error thrown = success
      }).pipe(Effect.provide(TestVcsServiceLayer({}))),
    );

    it.effect("sync succeeds when no error configured", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const result = yield* vcs.sync("main");
        expect(result.fetched).toBe(true);
        expect(result.rebased).toBe(true);
      }).pipe(Effect.provide(TestVcsServiceLayer({}))),
    );

    it.effect("createWorkspace succeeds for new workspace", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const result = yield* vcs.createWorkspace("new-workspace", "/path/to/workspace");
        expect(result.name).toBe("new-workspace");
        expect(result.path).toBe("/path/to/workspace");
      }).pipe(Effect.provide(TestVcsServiceLayer({}))),
    );

    it.effect("listWorkspaces returns configured workspaces", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const workspaces = yield* vcs.listWorkspaces();
        expect(workspaces.length).toBeGreaterThan(0);
        expect(workspaces.some((w) => w.name === "default")).toBe(true);
      }).pipe(Effect.provide(TestVcsServiceLayer({}))),
    );

    it.effect("undo succeeds", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const result = yield* vcs.undo();
        expect(result.undone).toBe(true);
      }).pipe(Effect.provide(TestVcsServiceLayer({}))),
    );
  });
});
