import { describe, it, expect } from "vitest";
import { formatDryRunOutput } from "../../../../../src/adapters/driving/cli/commands/shared.js";

describe("shared CLI options", () => {
  describe("formatDryRunOutput", () => {
    it("adds [DRY RUN] prefix for text output", () => {
      const result = formatDryRunOutput("Would create task", false);
      expect(result).toBe("[DRY RUN] Would create task");
    });

    it("returns message unchanged for JSON output", () => {
      const result = formatDryRunOutput("Would create task", true);
      expect(result).toBe("Would create task");
    });

    it("handles empty messages", () => {
      expect(formatDryRunOutput("", false)).toBe("[DRY RUN] ");
      expect(formatDryRunOutput("", true)).toBe("");
    });

    it("handles messages with special characters", () => {
      const message = "Would update: title -> 'New Title'";
      expect(formatDryRunOutput(message, false)).toBe(`[DRY RUN] ${message}`);
    });

    it("handles multiline messages", () => {
      const message = "Would create:\n  Title: Test\n  Priority: high";
      expect(formatDryRunOutput(message, false)).toBe(`[DRY RUN] ${message}`);
    });
  });
});
