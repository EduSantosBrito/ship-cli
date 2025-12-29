import { describe, it, expect } from "vitest";
import * as Option from "effect/Option";
import {
  sessionTaskMap,
  trackTask,
  getTrackedTask,
  clearTrackedTask,
  decodeShipToolArgs,
} from "../src/compaction.js";

/**
 * Test helper that ensures sessionTaskMap is cleared before and after the test.
 * Use this for tests that interact with the module-level sessionTaskMap.
 *
 * Note: Only tests that mutate sessionTaskMap need this wrapper.
 * Pure function tests (like decodeShipToolArgs) don't need it.
 */
const withCleanSessionMap = (testFn: () => void): void => {
  sessionTaskMap.clear();
  try {
    testFn();
  } finally {
    sessionTaskMap.clear();
  }
};

describe("Compaction Context", () => {
  describe("trackTask", () => {
    it("should track a new task with taskId", () =>
      withCleanSessionMap(() => {
        trackTask("session-1", { taskId: "BRI-123" });

        const result = getTrackedTask("session-1");
        expect(Option.isSome(result)).toBe(true);
        expect(Option.getOrThrow(result)).toEqual({ taskId: "BRI-123" });
      }));

    it("should track a new task with taskId and workdir", () =>
      withCleanSessionMap(() => {
        trackTask("session-1", { taskId: "BRI-123", workdir: "/path/to/workspace" });

        const result = getTrackedTask("session-1");
        expect(Option.isSome(result)).toBe(true);
        expect(Option.getOrThrow(result)).toEqual({
          taskId: "BRI-123",
          workdir: "/path/to/workspace",
        });
      }));

    it("should update existing task with workdir", () =>
      withCleanSessionMap(() => {
        trackTask("session-1", { taskId: "BRI-123" });
        trackTask("session-1", { workdir: "/path/to/workspace" });

        const result = getTrackedTask("session-1");
        expect(Option.isSome(result)).toBe(true);
        expect(Option.getOrThrow(result)).toEqual({
          taskId: "BRI-123",
          workdir: "/path/to/workspace",
        });
      }));

    it("should not create entry without taskId for new session", () =>
      withCleanSessionMap(() => {
        trackTask("session-1", { workdir: "/path/to/workspace" });

        const result = getTrackedTask("session-1");
        expect(Option.isNone(result)).toBe(true);
      }));

    it("should update existing task's taskId", () =>
      withCleanSessionMap(() => {
        trackTask("session-1", { taskId: "BRI-123" });
        trackTask("session-1", { taskId: "BRI-456" });

        const result = getTrackedTask("session-1");
        expect(Option.isSome(result)).toBe(true);
        expect(Option.getOrThrow(result).taskId).toBe("BRI-456");
      }));
  });

  describe("getTrackedTask", () => {
    it("should return Option.none() for unknown session", () =>
      withCleanSessionMap(() => {
        const result = getTrackedTask("unknown-session");
        expect(Option.isNone(result)).toBe(true);
      }));

    it("should return Option.some() for tracked session", () =>
      withCleanSessionMap(() => {
        trackTask("session-1", { taskId: "BRI-123" });

        const result = getTrackedTask("session-1");
        expect(Option.isSome(result)).toBe(true);
      }));
  });

  describe("clearTrackedTask", () => {
    it("should clear tracked task", () =>
      withCleanSessionMap(() => {
        trackTask("session-1", { taskId: "BRI-123" });
        clearTrackedTask("session-1");

        const result = getTrackedTask("session-1");
        expect(Option.isNone(result)).toBe(true);
      }));

    it("should not throw for unknown session", () =>
      withCleanSessionMap(() => {
        expect(() => clearTrackedTask("unknown-session")).not.toThrow();
      }));
  });

  // decodeShipToolArgs tests don't need withCleanSessionMap - they're pure functions
  describe("decodeShipToolArgs", () => {
    it("should decode valid args with action only", () => {
      const result = decodeShipToolArgs({ action: "start" });
      expect(Option.isSome(result)).toBe(true);
      expect(Option.getOrThrow(result)).toEqual({ action: "start" });
    });

    it("should decode valid args with action and taskId", () => {
      const result = decodeShipToolArgs({ action: "start", taskId: "BRI-123" });
      expect(Option.isSome(result)).toBe(true);
      expect(Option.getOrThrow(result)).toEqual({
        action: "start",
        taskId: "BRI-123",
      });
    });

    it("should return Option.none() for missing action", () => {
      const result = decodeShipToolArgs({ taskId: "BRI-123" });
      expect(Option.isNone(result)).toBe(true);
    });

    it("should return Option.none() for invalid action type", () => {
      const result = decodeShipToolArgs({ action: 123 });
      expect(Option.isNone(result)).toBe(true);
    });

    it("should return Option.none() for null input", () => {
      const result = decodeShipToolArgs(null);
      expect(Option.isNone(result)).toBe(true);
    });

    it("should return Option.none() for undefined input", () => {
      const result = decodeShipToolArgs(undefined);
      expect(Option.isNone(result)).toBe(true);
    });

    it("should ignore extra fields", () => {
      const result = decodeShipToolArgs({
        action: "start",
        taskId: "BRI-123",
        extraField: "ignored",
      });
      expect(Option.isSome(result)).toBe(true);
      // Extra fields are preserved by default in Schema.Struct
    });
  });
});
