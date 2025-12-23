import { describe, it, expect, beforeEach } from "vitest";
import * as Option from "effect/Option";
import {
  sessionTaskMap,
  trackTask,
  getTrackedTask,
  clearTrackedTask,
  decodeShipToolArgs,
} from "../src/compaction.js";

describe("Compaction Context", () => {
  beforeEach(() => {
    // Clear the session map before each test
    sessionTaskMap.clear();
  });

  describe("trackTask", () => {
    it("should track a new task with taskId", () => {
      trackTask("session-1", { taskId: "BRI-123" });

      const result = getTrackedTask("session-1");
      expect(Option.isSome(result)).toBe(true);
      expect(Option.getOrThrow(result)).toEqual({ taskId: "BRI-123" });
    });

    it("should track a new task with taskId and workdir", () => {
      trackTask("session-1", { taskId: "BRI-123", workdir: "/path/to/workspace" });

      const result = getTrackedTask("session-1");
      expect(Option.isSome(result)).toBe(true);
      expect(Option.getOrThrow(result)).toEqual({
        taskId: "BRI-123",
        workdir: "/path/to/workspace",
      });
    });

    it("should update existing task with workdir", () => {
      trackTask("session-1", { taskId: "BRI-123" });
      trackTask("session-1", { workdir: "/path/to/workspace" });

      const result = getTrackedTask("session-1");
      expect(Option.isSome(result)).toBe(true);
      expect(Option.getOrThrow(result)).toEqual({
        taskId: "BRI-123",
        workdir: "/path/to/workspace",
      });
    });

    it("should not create entry without taskId for new session", () => {
      trackTask("session-1", { workdir: "/path/to/workspace" });

      const result = getTrackedTask("session-1");
      expect(Option.isNone(result)).toBe(true);
    });

    it("should update existing task's taskId", () => {
      trackTask("session-1", { taskId: "BRI-123" });
      trackTask("session-1", { taskId: "BRI-456" });

      const result = getTrackedTask("session-1");
      expect(Option.isSome(result)).toBe(true);
      expect(Option.getOrThrow(result).taskId).toBe("BRI-456");
    });
  });

  describe("getTrackedTask", () => {
    it("should return Option.none() for unknown session", () => {
      const result = getTrackedTask("unknown-session");
      expect(Option.isNone(result)).toBe(true);
    });

    it("should return Option.some() for tracked session", () => {
      trackTask("session-1", { taskId: "BRI-123" });

      const result = getTrackedTask("session-1");
      expect(Option.isSome(result)).toBe(true);
    });
  });

  describe("clearTrackedTask", () => {
    it("should clear tracked task", () => {
      trackTask("session-1", { taskId: "BRI-123" });
      clearTrackedTask("session-1");

      const result = getTrackedTask("session-1");
      expect(Option.isNone(result)).toBe(true);
    });

    it("should not throw for unknown session", () => {
      expect(() => clearTrackedTask("unknown-session")).not.toThrow();
    });
  });

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
