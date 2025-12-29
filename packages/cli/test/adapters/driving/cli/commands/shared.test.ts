import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  formatDryRunOutput,
  parseOptionalDate,
} from "../../../../../src/adapters/driving/cli/commands/shared.js";
import { InvalidDateError } from "../../../../../src/domain/Errors.js";

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

  describe("parseOptionalDate", () => {
    it.effect("returns None for None input", () =>
      Effect.gen(function* () {
        const result = yield* parseOptionalDate(Option.none(), "targetDate");
        expect(Option.isNone(result)).toBe(true);
      }),
    );

    it.effect("parses valid ISO date string", () =>
      Effect.gen(function* () {
        const result = yield* parseOptionalDate(Option.some("2024-12-25"), "targetDate");
        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(result.value.getFullYear()).toBe(2024);
          expect(result.value.getMonth()).toBe(11); // December is 11
          expect(result.value.getDate()).toBe(25);
        }
      }),
    );

    it.effect("fails with InvalidDateError for invalid date string", () =>
      Effect.gen(function* () {
        const result = yield* parseOptionalDate(Option.some("not-a-date"), "targetDate").pipe(
          Effect.flip,
        );
        expect(result).toBeInstanceOf(InvalidDateError);
        expect(result.input).toBe("not-a-date");
        expect(result.field).toBe("targetDate");
      }),
    );

    it.effect("includes field name in error", () =>
      Effect.gen(function* () {
        const result = yield* parseOptionalDate(Option.some("invalid"), "dueDate").pipe(
          Effect.flip,
        );
        expect(result.field).toBe("dueDate");
        expect(result.message).toContain("dueDate");
      }),
    );
  });
});
