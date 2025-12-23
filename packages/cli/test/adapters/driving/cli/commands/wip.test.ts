import { describe, it, expect } from "vitest";
import { parseTaskIdentifier } from "../../../../../src/adapters/driving/cli/commands/wip.js";

describe("parseTaskIdentifier", () => {
  describe("valid patterns", () => {
    it("extracts identifier at start of string", () => {
      expect(parseTaskIdentifier("bri-123-add-feature")).toBe("BRI-123");
      expect(parseTaskIdentifier("BRI-123-add-feature")).toBe("BRI-123");
      expect(parseTaskIdentifier("eng-45")).toBe("ENG-45");
    });

    it("extracts identifier after slash", () => {
      expect(parseTaskIdentifier("user/bri-123-add-feature")).toBe("BRI-123");
      expect(parseTaskIdentifier("edusantosbrito/bri-456-feature")).toBe("BRI-456");
      expect(parseTaskIdentifier("prefix/ENG-789-something")).toBe("ENG-789");
    });

    it("handles various team key lengths (2-5 chars)", () => {
      expect(parseTaskIdentifier("ab-1")).toBe("AB-1");
      expect(parseTaskIdentifier("abc-12")).toBe("ABC-12");
      expect(parseTaskIdentifier("abcd-123")).toBe("ABCD-123");
      expect(parseTaskIdentifier("abcde-1234")).toBe("ABCDE-1234");
    });

    it("returns uppercase identifier", () => {
      expect(parseTaskIdentifier("bri-123")).toBe("BRI-123");
      expect(parseTaskIdentifier("Bri-123")).toBe("BRI-123");
      expect(parseTaskIdentifier("BRI-123")).toBe("BRI-123");
    });
  });

  describe("invalid patterns - returns null", () => {
    it("rejects identifier in middle of string (false positive prevention)", () => {
      // This was the bug - "feature-add-123-items" would match "ADD-123"
      expect(parseTaskIdentifier("feature-add-123-items")).toBeNull();
      expect(parseTaskIdentifier("my-feature-eng-123")).toBeNull();
    });

    it("rejects team keys that are too short (1 char)", () => {
      expect(parseTaskIdentifier("a-123")).toBeNull();
    });

    it("rejects team keys that are too long (6+ chars)", () => {
      expect(parseTaskIdentifier("abcdef-123")).toBeNull();
    });

    it("returns null for strings without task pattern", () => {
      expect(parseTaskIdentifier("main")).toBeNull();
      expect(parseTaskIdentifier("feature/something")).toBeNull();
      expect(parseTaskIdentifier("")).toBeNull();
    });

    it("rejects patterns without numbers", () => {
      expect(parseTaskIdentifier("bri-abc")).toBeNull();
    });
  });
});
