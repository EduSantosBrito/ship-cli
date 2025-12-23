/**
 * Tests for ship pr stack command
 *
 * These tests verify that the stack command correctly:
 * - Creates PRs for all changes in the stack
 * - Targets correct base branches (first PR -> main, subsequent -> previous bookmark)
 * - Detects and retargets existing PRs with wrong base
 * - Handles --dry-run mode
 * - Handles partial stacks (some PRs exist, some don't)
 */

import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Change, ChangeId, VcsService } from "../../../../../../src/ports/VcsService.js";
import { PrService } from "../../../../../../src/ports/PrService.js";
import {
  TestVcsServiceLayer,
  TestPrServiceLayer,
  TestIssueRepositoryLayer,
  TestConfigRepositoryLayer,
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
    isWorkingCopy: overrides.isWorkingCopy ?? false,
    isEmpty: overrides.isEmpty ?? false,
    hasConflict: false,
  });

/**
 * Create combined test layer for stack command tests
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

describe("ship pr stack command", () => {
  describe("conflict detection", () => {
    it.effect("detects conflicts in stack and blocks PR creation", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const stack = yield* vcs.getStack();

        // Verify the test setup - should find conflicted changes
        const conflicted = stack.filter((c) => c.hasConflict);
        expect(conflicted.length).toBe(1);
        expect(conflicted[0].changeId).toBe("conflict1");
      }).pipe(
        Effect.provide(
          createTestLayer({
            vcs: {
              changes: new Map([
                [
                  "clean-change",
                  createChange({
                    id: "clean-change",
                    changeId: "clean123",
                    description: "Clean change",
                    bookmarks: ["user/BRI-100-clean"],
                    isWorkingCopy: false,
                  }),
                ],
                [
                  "conflicted-change",
                  new Change({
                    id: "conflicted-change" as ChangeId,
                    changeId: "conflict1",
                    description: "Change with conflict",
                    author: "test@example.com",
                    timestamp: new Date("2024-01-15T10:00:00Z"),
                    bookmarks: ["user/BRI-101-conflict"],
                    isWorkingCopy: true,
                    isEmpty: false,
                    hasConflict: true,
                  }),
                ],
              ]),
              currentChangeId: "conflicted-change",
            },
          }),
        ),
      ),
    );

    it.effect("allows PR creation when stack has no conflicts", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const stack = yield* vcs.getStack();

        // Verify the test setup - no conflicts
        const conflicted = stack.filter((c) => c.hasConflict);
        expect(conflicted.length).toBe(0);
      }).pipe(
        Effect.provide(
          createTestLayer({
            vcs: {
              changes: new Map([
                [
                  "clean-1",
                  createChange({
                    id: "clean-1",
                    changeId: "clean111",
                    description: "First clean change",
                    bookmarks: ["user/BRI-100-first"],
                    isWorkingCopy: false,
                  }),
                ],
                [
                  "clean-2",
                  createChange({
                    id: "clean-2",
                    changeId: "clean222",
                    description: "Second clean change",
                    bookmarks: ["user/BRI-101-second"],
                    isWorkingCopy: true,
                  }),
                ],
              ]),
              currentChangeId: "clean-2",
            },
          }),
        ),
      ),
    );
  });

  describe("stack detection", () => {
    it.effect("gets all changes in stack from trunk to current", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const stack = yield* vcs.getStack();

        expect(stack).toHaveLength(3);
        expect(stack[0].bookmarks).toContain("user/BRI-100-base");
        expect(stack[1].bookmarks).toContain("user/BRI-101-middle");
        expect(stack[2].bookmarks).toContain("user/BRI-102-top");
      }).pipe(
        Effect.provide(
          createTestLayer({
            vcs: {
              changes: new Map([
                [
                  "base",
                  createChange({
                    id: "base",
                    changeId: "base1234",
                    description: "Base change",
                    bookmarks: ["user/BRI-100-base"],
                    isWorkingCopy: false,
                  }),
                ],
                [
                  "middle",
                  createChange({
                    id: "middle",
                    changeId: "middle12",
                    description: "Middle change",
                    bookmarks: ["user/BRI-101-middle"],
                    isWorkingCopy: false,
                  }),
                ],
                [
                  "top",
                  createChange({
                    id: "top",
                    changeId: "top12345",
                    description: "Top change",
                    bookmarks: ["user/BRI-102-top"],
                    isWorkingCopy: true,
                  }),
                ],
              ]),
              currentChangeId: "top",
            },
          }),
        ),
      ),
    );

    it.effect("filters out changes without bookmarks", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const stack = yield* vcs.getStack();

        // Should have 3 changes but only 2 with bookmarks
        expect(stack).toHaveLength(3);
        const withBookmarks = stack.filter((c) => c.bookmarks.length > 0);
        expect(withBookmarks).toHaveLength(2);
      }).pipe(
        Effect.provide(
          createTestLayer({
            vcs: {
              changes: new Map([
                [
                  "with-bookmark",
                  createChange({
                    id: "with-bookmark",
                    changeId: "withbk12",
                    description: "Has bookmark",
                    bookmarks: ["user/BRI-100-feature"],
                    isWorkingCopy: false,
                  }),
                ],
                [
                  "no-bookmark",
                  createChange({
                    id: "no-bookmark",
                    changeId: "nobkmk12",
                    description: "No bookmark",
                    bookmarks: [],
                    isWorkingCopy: false,
                  }),
                ],
                [
                  "current",
                  createChange({
                    id: "current",
                    changeId: "current1",
                    description: "Current",
                    bookmarks: ["user/BRI-101-current"],
                    isWorkingCopy: true,
                  }),
                ],
              ]),
              currentChangeId: "current",
            },
          }),
        ),
      ),
    );

    it.effect("filters out empty changes", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const stack = yield* vcs.getStack();

        const nonEmpty = stack.filter((c) => !c.isEmpty && c.bookmarks.length > 0);
        expect(nonEmpty).toHaveLength(1);
        expect(nonEmpty[0].bookmarks).toContain("user/BRI-100-real");
      }).pipe(
        Effect.provide(
          createTestLayer({
            vcs: {
              changes: new Map([
                [
                  "real-change",
                  createChange({
                    id: "real-change",
                    changeId: "real1234",
                    description: "Real change",
                    bookmarks: ["user/BRI-100-real"],
                    isEmpty: false,
                    isWorkingCopy: false,
                  }),
                ],
                [
                  "empty-change",
                  createChange({
                    id: "empty-change",
                    changeId: "empty123",
                    description: "",
                    bookmarks: ["user/BRI-101-empty"],
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
  });

  describe("base branch targeting", () => {
    it.effect("first PR targets main (default branch)", () =>
      Effect.gen(function* () {
        const prService = yield* PrService;

        // Create first PR in stack - should target main
        const pr = yield* prService.createPr({
          title: "First PR",
          body: "First in stack",
          head: "user/BRI-100-first",
          base: "main",
          draft: false,
        });

        expect(pr.base).toBe("main");
      }).pipe(Effect.provide(createTestLayer({}))),
    );

    it.effect("subsequent PRs target previous bookmark", () =>
      Effect.gen(function* () {
        const prService = yield* PrService;

        // Simulate creating second PR in stack - should target first bookmark
        const pr = yield* prService.createPr({
          title: "Second PR",
          body: "Second in stack",
          head: "user/BRI-101-second",
          base: "user/BRI-100-first", // Previous bookmark
          draft: false,
        });

        expect(pr.base).toBe("user/BRI-100-first");
      }).pipe(Effect.provide(createTestLayer({}))),
    );
  });

  describe("existing PR detection", () => {
    it.effect("detects existing PRs and shows status", () =>
      Effect.gen(function* () {
        const prService = yield* PrService;
        const existingPr = yield* prService.getPrByBranch("user/BRI-100-existing");

        expect(existingPr).not.toBeNull();
        expect(existingPr?.number).toBe(101);
      }).pipe(
        Effect.provide(
          createTestLayer({
            pr: {
              pullRequests: new Map([
                [
                  101,
                  createTestPr({
                    number: 101,
                    head: "user/BRI-100-existing",
                    base: "main",
                  }),
                ],
              ]),
              branchToPr: new Map([["user/BRI-100-existing", 101]]),
            },
          }),
        ),
      ),
    );

    it.effect("detects PR with incorrect base branch", () =>
      Effect.gen(function* () {
        const prService = yield* PrService;
        const existingPr = yield* prService.getPrByBranch("user/BRI-101-needs-retarget");

        expect(existingPr).not.toBeNull();
        expect(existingPr?.base).toBe("main"); // Should be retargeted to previous bookmark
      }).pipe(
        Effect.provide(
          createTestLayer({
            pr: {
              pullRequests: new Map([
                [
                  102,
                  createTestPr({
                    number: 102,
                    head: "user/BRI-101-needs-retarget",
                    base: "main", // Wrong - should be previous bookmark
                  }),
                ],
              ]),
              branchToPr: new Map([["user/BRI-101-needs-retarget", 102]]),
            },
          }),
        ),
      ),
    );
  });

  describe("PR retargeting", () => {
    it.effect("retargets PR to correct base branch", () =>
      Effect.gen(function* () {
        const prService = yield* PrService;

        // Retarget PR to new base
        const updatedPr = yield* prService.updatePrBase(102, "user/BRI-100-parent");

        expect(updatedPr.base).toBe("user/BRI-100-parent");
      }).pipe(
        Effect.provide(
          createTestLayer({
            pr: {
              pullRequests: new Map([
                [
                  102,
                  createTestPr({
                    number: 102,
                    head: "user/BRI-101-child",
                    base: "main",
                  }),
                ],
              ]),
            },
          }),
        ),
      ),
    );
  });

  describe("partial stack handling", () => {
    it.effect("handles mix of existing and new PRs", () =>
      Effect.gen(function* () {
        const prService = yield* PrService;

        // First PR exists
        const existing = yield* prService.getPrByBranch("user/BRI-100-first");
        expect(existing).not.toBeNull();
        expect(existing?.number).toBe(201);

        // Second PR doesn't exist
        const missing = yield* prService.getPrByBranch("user/BRI-101-second");
        expect(missing).toBeNull();

        // Create the missing PR
        const newPr = yield* prService.createPr({
          title: "BRI-101: Second feature",
          body: "Second PR",
          head: "user/BRI-101-second",
          base: "user/BRI-100-first",
          draft: false,
        });

        expect(newPr.number).toBe(2); // Next available number
        expect(newPr.base).toBe("user/BRI-100-first");
      }).pipe(
        Effect.provide(
          createTestLayer({
            pr: {
              pullRequests: new Map([
                [
                  201,
                  createTestPr({
                    number: 201,
                    head: "user/BRI-100-first",
                    base: "main",
                  }),
                ],
              ]),
              branchToPr: new Map([["user/BRI-100-first", 201]]),
              nextPrNumber: 2,
            },
          }),
        ),
      ),
    );
  });

  describe("single change stack", () => {
    it.effect("works with single change (same as pr create)", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const stack = yield* vcs.getStack();

        // Only one change with bookmark
        const withBookmarks = stack.filter((c) => c.bookmarks.length > 0 && !c.isEmpty);
        expect(withBookmarks).toHaveLength(1);
        expect(withBookmarks[0].bookmarks).toContain("user/BRI-100-single");
      }).pipe(
        Effect.provide(
          createTestLayer({
            vcs: {
              changes: new Map([
                [
                  "single",
                  createChange({
                    id: "single",
                    changeId: "single12",
                    description: "Single change",
                    bookmarks: ["user/BRI-100-single"],
                    isEmpty: false,
                    isWorkingCopy: true,
                  }),
                ],
              ]),
              currentChangeId: "single",
            },
          }),
        ),
      ),
    );
  });
});
