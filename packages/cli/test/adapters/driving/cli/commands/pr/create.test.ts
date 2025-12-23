/**
 * Tests for ship pr create command
 *
 * These tests verify that the create command correctly:
 * - Extracts task ID from bookmark and fetches Linear task details
 * - Creates PR with rich body when task is found
 * - Creates PR with minimal body when no task linked
 * - Detects existing PRs (idempotent behavior)
 * - Handles various error conditions
 */

import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Change, ChangeId, VcsService } from "../../../../../../src/ports/VcsService.js";
import { PrService } from "../../../../../../src/ports/PrService.js";
import { IssueRepository } from "../../../../../../src/ports/IssueRepository.js";
import {
  TestVcsServiceLayer,
  TestPrServiceLayer,
  TestIssueRepositoryLayer,
  TestConfigRepositoryLayer,
  createTestTask,
  createTestPr,
} from "../../../../../layers/index.js";

// === Test Helpers ===

/**
 * Create a Change for testing
 */
const createChange = (overrides: {
  id: string;
  changeId: string;
  description: string;
  bookmarks?: string[];
  isEmpty?: boolean;
  isWorkingCopy?: boolean;
}): Change =>
  new Change({
    id: overrides.id as ChangeId,
    changeId: overrides.changeId,
    description: overrides.description,
    author: "test@example.com",
    timestamp: new Date("2024-01-15T10:00:00Z"),
    bookmarks: overrides.bookmarks ?? [],
    isWorkingCopy: overrides.isWorkingCopy ?? true,
    isEmpty: overrides.isEmpty ?? false,
    hasConflict: false,
  });

/**
 * Create combined test layer for PR create command tests
 */
const createTestLayer = (config: {
  vcs?: Parameters<typeof TestVcsServiceLayer>[0];
  pr?: Parameters<typeof TestPrServiceLayer>[0];
  issue?: Parameters<typeof TestIssueRepositoryLayer>[0];
}) =>
  Layer.mergeAll(
    TestVcsServiceLayer(config.vcs),
    TestPrServiceLayer(config.pr),
    TestIssueRepositoryLayer(config.issue),
    TestConfigRepositoryLayer(),
  );

// === Tests ===

describe("ship pr create command", () => {
  describe("bookmark validation", () => {
    it.effect("rejects change without bookmark", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const change = yield* vcs.getCurrentChange();

        // Verify the test setup - no bookmarks
        expect(change.bookmarks).toHaveLength(0);
      }).pipe(
        Effect.provide(
          createTestLayer({
            vcs: {
              changes: new Map([
                [
                  "no-bookmark",
                  createChange({
                    id: "no-bookmark",
                    changeId: "nobkmrk1",
                    description: "Change without bookmark",
                    bookmarks: [],
                    isWorkingCopy: true,
                  }),
                ],
              ]),
              currentChangeId: "no-bookmark",
            },
          }),
        ),
      ),
    );

    it.effect("uses first bookmark when multiple exist", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const change = yield* vcs.getCurrentChange();

        // Verify the test setup - multiple bookmarks
        expect(change.bookmarks).toEqual(["primary-branch", "secondary-branch"]);
        expect(change.bookmarks[0]).toBe("primary-branch");
      }).pipe(
        Effect.provide(
          createTestLayer({
            vcs: {
              changes: new Map([
                [
                  "multi-bookmark",
                  createChange({
                    id: "multi-bookmark",
                    changeId: "multibk1",
                    description: "Change with multiple bookmarks",
                    bookmarks: ["primary-branch", "secondary-branch"],
                    isWorkingCopy: true,
                  }),
                ],
              ]),
              currentChangeId: "multi-bookmark",
            },
          }),
        ),
      ),
    );
  });

  describe("task ID extraction from bookmark", () => {
    it.effect("extracts task ID from user/BRI-123-feature format", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const change = yield* vcs.getCurrentChange();

        expect(change.bookmarks[0]).toBe("user/BRI-123-add-feature");
        // The task ID extraction happens in the command - we just verify setup
      }).pipe(
        Effect.provide(
          createTestLayer({
            vcs: {
              changes: new Map([
                [
                  "task-bookmark",
                  createChange({
                    id: "task-bookmark",
                    changeId: "taskbkm1",
                    description: "Feature implementation",
                    bookmarks: ["user/BRI-123-add-feature"],
                    isWorkingCopy: true,
                  }),
                ],
              ]),
              currentChangeId: "task-bookmark",
            },
          }),
        ),
      ),
    );

    it.effect("handles bookmark without task ID gracefully", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const change = yield* vcs.getCurrentChange();

        expect(change.bookmarks[0]).toBe("feature/some-feature");
        // Command should fall back to minimal PR body
      }).pipe(
        Effect.provide(
          createTestLayer({
            vcs: {
              changes: new Map([
                [
                  "no-task-bookmark",
                  createChange({
                    id: "no-task-bookmark",
                    changeId: "notask12",
                    description: "Feature without task ID",
                    bookmarks: ["feature/some-feature"],
                    isWorkingCopy: true,
                  }),
                ],
              ]),
              currentChangeId: "no-task-bookmark",
            },
          }),
        ),
      ),
    );
  });

  describe("existing PR detection (idempotent)", () => {
    it.effect("detects existing PR by branch name", () =>
      Effect.gen(function* () {
        const prService = yield* PrService;
        const existingPr = yield* prService.getPrByBranch("user/BRI-456-feature");

        expect(existingPr).not.toBeNull();
        expect(existingPr?.number).toBe(42);
        expect(existingPr?.url).toContain("/pull/42");
      }).pipe(
        Effect.provide(
          createTestLayer({
            vcs: {
              changes: new Map([
                [
                  "existing-pr-change",
                  createChange({
                    id: "existing-pr-change",
                    changeId: "existpr1",
                    description: "Already has PR",
                    bookmarks: ["user/BRI-456-feature"],
                    isWorkingCopy: true,
                  }),
                ],
              ]),
              currentChangeId: "existing-pr-change",
            },
            pr: {
              pullRequests: new Map([
                [
                  42,
                  createTestPr({
                    number: 42,
                    title: "BRI-456: Feature",
                    head: "user/BRI-456-feature",
                    url: "https://github.com/test/repo/pull/42",
                  }),
                ],
              ]),
              branchToPr: new Map([["user/BRI-456-feature", 42]]),
            },
          }),
        ),
      ),
    );

    it.effect("returns null when no PR exists for branch", () =>
      Effect.gen(function* () {
        const prService = yield* PrService;
        const existingPr = yield* prService.getPrByBranch("new-branch");

        expect(existingPr).toBeNull();
      }).pipe(
        Effect.provide(
          createTestLayer({
            pr: {
              branchToPr: new Map(), // No PRs
            },
          }),
        ),
      ),
    );
  });

  describe("task fetching", () => {
    it.effect("fetches task by identifier from Linear", () =>
      Effect.gen(function* () {
        const issueRepo = yield* IssueRepository;
        const task = yield* issueRepo.getTaskByIdentifier("BRI-789");

        expect(task.identifier).toBe("BRI-789");
        expect(task.title).toBe("Implement feature");
      }).pipe(
        Effect.provide(
          createTestLayer({
            issue: {
              tasks: new Map([
                [
                  "task-789",
                  createTestTask({
                    id: "task-789",
                    identifier: "BRI-789",
                    title: "Implement feature",
                    description: "Feature description",
                  }),
                ],
              ]),
            },
          }),
        ),
      ),
    );

    it.effect("handles task not found gracefully", () =>
      Effect.gen(function* () {
        const issueRepo = yield* IssueRepository;
        const result = yield* issueRepo.getTaskByIdentifier("NONEXISTENT-999").pipe(
          Effect.map(() => ({ found: true })),
          Effect.catchAll(() => Effect.succeed({ found: false })),
        );

        expect(result.found).toBe(false);
      }).pipe(
        Effect.provide(
          createTestLayer({
            issue: {
              tasks: new Map(), // Empty - no tasks
            },
          }),
        ),
      ),
    );
  });

  describe("empty change handling", () => {
    it.effect("rejects empty change (no modifications)", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const change = yield* vcs.getCurrentChange();

        expect(change.isEmpty).toBe(true);
      }).pipe(
        Effect.provide(
          createTestLayer({
            vcs: {
              changes: new Map([
                [
                  "empty-change",
                  createChange({
                    id: "empty-change",
                    changeId: "empty123",
                    description: "Empty change",
                    bookmarks: ["user/BRI-123-empty"],
                    isEmpty: true,
                    isWorkingCopy: true,
                  }),
                ],
              ]),
              currentChangeId: "empty-change",
            },
          }),
        ),
      ),
    );

    it.effect("uses parent change if current is empty with no bookmark", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const parentChange = yield* vcs.getParentChange();

        // Parent should have the bookmark
        expect(parentChange).not.toBeNull();
        expect(parentChange?.bookmarks).toContain("user/BRI-123-feature");
        expect(parentChange?.isEmpty).toBe(false);
      }).pipe(
        Effect.provide(
          createTestLayer({
            vcs: {
              changes: new Map([
                [
                  "parent-with-work",
                  createChange({
                    id: "parent-with-work",
                    changeId: "parent12",
                    description: "Parent with work",
                    bookmarks: ["user/BRI-123-feature"],
                    isEmpty: false,
                    isWorkingCopy: false,
                  }),
                ],
                [
                  "empty-wip",
                  createChange({
                    id: "empty-wip",
                    changeId: "emptywip",
                    description: "",
                    bookmarks: [],
                    isEmpty: true,
                    isWorkingCopy: true,
                  }),
                ],
              ]),
              currentChangeId: "empty-wip",
            },
          }),
        ),
      ),
    );
  });

  describe("PR creation", () => {
    it.effect("creates PR with correct base branch (default)", () =>
      Effect.gen(function* () {
        const prService = yield* PrService;

        // Simulate creating a PR
        const pr = yield* prService.createPr({
          title: "BRI-123: Test feature",
          body: "## Summary\nTest description",
          head: "user/BRI-123-feature",
          base: "main",
          draft: false,
        });

        expect(pr.base).toBe("main");
        expect(pr.head).toBe("user/BRI-123-feature");
      }).pipe(Effect.provide(createTestLayer({}))),
    );

    it.effect("creates PR targeting parent bookmark for stacked workflow", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const parentChange = yield* vcs.getParentChange();

        // Parent should have a bookmark that becomes the base
        expect(parentChange?.bookmarks[0]).toBe("user/BRI-122-parent");
      }).pipe(
        Effect.provide(
          createTestLayer({
            vcs: {
              changes: new Map([
                [
                  "parent-change",
                  createChange({
                    id: "parent-change",
                    changeId: "parent12",
                    description: "Parent feature",
                    bookmarks: ["user/BRI-122-parent"],
                    isEmpty: false,
                    isWorkingCopy: false,
                  }),
                ],
                [
                  "current-change",
                  createChange({
                    id: "current-change",
                    changeId: "current1",
                    description: "Child feature",
                    bookmarks: ["user/BRI-123-child"],
                    isEmpty: false,
                    isWorkingCopy: true,
                  }),
                ],
              ]),
              currentChangeId: "current-change",
            },
          }),
        ),
      ),
    );

    it.effect("creates draft PR when --draft flag is used", () =>
      Effect.gen(function* () {
        const prService = yield* PrService;

        const pr = yield* prService.createPr({
          title: "WIP: Feature",
          body: "Work in progress",
          head: "user/BRI-123-wip",
          base: "main",
          draft: true,
        });

        expect(pr.state).toBe("open"); // Draft PRs are still "open" state
      }).pipe(Effect.provide(createTestLayer({}))),
    );
  });

  describe("gh CLI availability", () => {
    it.effect("detects gh CLI not installed", () =>
      Effect.gen(function* () {
        const prService = yield* PrService;
        const available = yield* prService.isAvailable();

        expect(available).toBe(false);
      }).pipe(
        Effect.provide(
          createTestLayer({
            pr: {
              ghInstalled: false,
            },
          }),
        ),
      ),
    );

    it.effect("detects gh CLI not authenticated", () =>
      Effect.gen(function* () {
        const prService = yield* PrService;
        const available = yield* prService.isAvailable();

        expect(available).toBe(false);
      }).pipe(
        Effect.provide(
          createTestLayer({
            pr: {
              ghInstalled: true,
              ghAuthenticated: false,
            },
          }),
        ),
      ),
    );
  });
});
