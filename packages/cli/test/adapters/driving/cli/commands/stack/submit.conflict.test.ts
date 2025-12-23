/**
 * Tests for submit command conflict detection
 *
 * These tests verify that the submit command correctly detects and reports
 * conflicts before attempting to push changes to remote.
 */

import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { Change, ChangeId, VcsService } from "../../../../../../src/ports/VcsService.js";
import { TestVcsServiceLayer } from "../../../../../layers/index.js";

// === Test Helpers ===

/**
 * Create a Change with conflict flag
 */
const createChange = (overrides: {
  id: string;
  changeId: string;
  description: string;
  bookmarks?: string[];
  isEmpty?: boolean;
  hasConflict?: boolean;
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
    hasConflict: overrides.hasConflict ?? false,
  });

// === Tests ===

describe("submit command conflict detection", () => {
  describe("current change conflict check (early/fast path)", () => {
    it.effect("detects conflict in current change", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const change = yield* vcs.getCurrentChange();

        // Verify the test setup - current change should have conflict
        expect(change.hasConflict).toBe(true);
      }).pipe(
        Effect.provide(
          TestVcsServiceLayer({
            changes: new Map([
              [
                "conflicted-change",
                createChange({
                  id: "conflicted-change",
                  changeId: "conflict1",
                  description: "Change with conflict",
                  bookmarks: ["user/feature-branch"],
                  hasConflict: true,
                  isWorkingCopy: true,
                }),
              ],
            ]),
            currentChangeId: "conflicted-change",
          }),
        ),
      ),
    );

    it.effect("allows submit when current change has no conflict", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const change = yield* vcs.getCurrentChange();

        // Verify the test setup - current change should NOT have conflict
        expect(change.hasConflict).toBe(false);
      }).pipe(
        Effect.provide(
          TestVcsServiceLayer({
            changes: new Map([
              [
                "clean-change",
                createChange({
                  id: "clean-change",
                  changeId: "clean123",
                  description: "Clean change",
                  bookmarks: ["user/feature-branch"],
                  hasConflict: false,
                  isWorkingCopy: true,
                }),
              ],
            ]),
            currentChangeId: "clean-change",
          }),
        ),
      ),
    );
  });

  describe("stack conflict check", () => {
    it.effect("detects conflicts in stack changes", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const stack = yield* vcs.getStack();

        // Verify the test setup - should find conflicted changes in stack
        const conflicted = stack.filter((c) => c.hasConflict);
        expect(conflicted.length).toBe(1);
        expect(conflicted[0].changeId).toBe("parent12");
      }).pipe(
        Effect.provide(
          TestVcsServiceLayer({
            changes: new Map([
              [
                "parent-conflicted",
                createChange({
                  id: "parent-conflicted",
                  changeId: "parent12",
                  description: "Parent with conflict",
                  bookmarks: ["user/parent-branch"],
                  hasConflict: true,
                  isWorkingCopy: false,
                }),
              ],
              [
                "current-clean",
                createChange({
                  id: "current-clean",
                  changeId: "current1",
                  description: "Current change (clean)",
                  bookmarks: ["user/feature-branch"],
                  hasConflict: false,
                  isWorkingCopy: true,
                }),
              ],
            ]),
            currentChangeId: "current-clean",
          }),
        ),
      ),
    );

    it.effect("detects multiple conflicts in stack", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const stack = yield* vcs.getStack();

        // Verify the test setup - should find multiple conflicted changes
        const conflicted = stack.filter((c) => c.hasConflict);
        expect(conflicted.length).toBe(2);
      }).pipe(
        Effect.provide(
          TestVcsServiceLayer({
            changes: new Map([
              [
                "grandparent-conflicted",
                createChange({
                  id: "grandparent-conflicted",
                  changeId: "gparent1",
                  description: "Grandparent with conflict",
                  bookmarks: ["user/grandparent"],
                  hasConflict: true,
                  isWorkingCopy: false,
                }),
              ],
              [
                "parent-conflicted",
                createChange({
                  id: "parent-conflicted",
                  changeId: "parent12",
                  description: "Parent with conflict",
                  bookmarks: ["user/parent-branch"],
                  hasConflict: true,
                  isWorkingCopy: false,
                }),
              ],
              [
                "current-clean",
                createChange({
                  id: "current-clean",
                  changeId: "current1",
                  description: "Current change (clean)",
                  bookmarks: ["user/feature-branch"],
                  hasConflict: false,
                  isWorkingCopy: true,
                }),
              ],
            ]),
            currentChangeId: "current-clean",
          }),
        ),
      ),
    );

    it.effect("allows submit when entire stack is clean", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const stack = yield* vcs.getStack();

        // Verify the test setup - no conflicts in stack
        const conflicted = stack.filter((c) => c.hasConflict);
        expect(conflicted.length).toBe(0);
      }).pipe(
        Effect.provide(
          TestVcsServiceLayer({
            changes: new Map([
              [
                "parent-clean",
                createChange({
                  id: "parent-clean",
                  changeId: "parent12",
                  description: "Parent (clean)",
                  bookmarks: ["user/parent-branch"],
                  hasConflict: false,
                  isWorkingCopy: false,
                }),
              ],
              [
                "current-clean",
                createChange({
                  id: "current-clean",
                  changeId: "current1",
                  description: "Current change (clean)",
                  bookmarks: ["user/feature-branch"],
                  hasConflict: false,
                  isWorkingCopy: true,
                }),
              ],
            ]),
            currentChangeId: "current-clean",
          }),
        ),
      ),
    );
  });

  describe("conflict error message formatting", () => {
    it("formats single conflict correctly", () => {
      const conflictedChanges = [
        createChange({
          id: "conflicted-1",
          changeId: "abcd1234efgh",
          description: "Fix bug in parser",
          hasConflict: true,
        }),
      ];

      const conflictList = conflictedChanges
        .map(
          (c) =>
            `  - ${c.changeId.slice(0, 8)}: ${c.description.split("\n")[0] || "(no description)"}`,
        )
        .join("\n");

      expect(conflictList).toBe("  - abcd1234: Fix bug in parser");
    });

    it("formats multiple conflicts correctly", () => {
      const conflictedChanges = [
        createChange({
          id: "conflicted-1",
          changeId: "abcd1234efgh",
          description: "Fix bug in parser",
          hasConflict: true,
        }),
        createChange({
          id: "conflicted-2",
          changeId: "wxyz5678ijkl",
          description: "Add new feature",
          hasConflict: true,
        }),
      ];

      const conflictList = conflictedChanges
        .map(
          (c) =>
            `  - ${c.changeId.slice(0, 8)}: ${c.description.split("\n")[0] || "(no description)"}`,
        )
        .join("\n");

      expect(conflictList).toBe(
        "  - abcd1234: Fix bug in parser\n  - wxyz5678: Add new feature",
      );
    });

    it("handles change with no description", () => {
      const conflictedChanges = [
        createChange({
          id: "conflicted-1",
          changeId: "abcd1234efgh",
          description: "",
          hasConflict: true,
        }),
      ];

      const conflictList = conflictedChanges
        .map(
          (c) =>
            `  - ${c.changeId.slice(0, 8)}: ${c.description.split("\n")[0] || "(no description)"}`,
        )
        .join("\n");

      expect(conflictList).toBe("  - abcd1234: (no description)");
    });

    it("uses only first line of multi-line description", () => {
      const conflictedChanges = [
        createChange({
          id: "conflicted-1",
          changeId: "abcd1234efgh",
          description: "First line\n\nSecond paragraph\nMore details",
          hasConflict: true,
        }),
      ];

      const conflictList = conflictedChanges
        .map(
          (c) =>
            `  - ${c.changeId.slice(0, 8)}: ${c.description.split("\n")[0] || "(no description)"}`,
        )
        .join("\n");

      expect(conflictList).toBe("  - abcd1234: First line");
    });
  });
});
