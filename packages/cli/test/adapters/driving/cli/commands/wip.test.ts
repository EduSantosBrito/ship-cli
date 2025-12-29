import { describe, it, expect } from "vitest";
import * as Option from "effect/Option";
import { parseTaskIdentifier } from "../../../../../src/adapters/driving/cli/commands/wip.js";

describe("parseTaskIdentifier", () => {
  describe("valid patterns", () => {
    it("extracts identifier at start of string", () => {
      expect(parseTaskIdentifier("bri-123-add-feature")).toStrictEqual(Option.some("BRI-123"));
      expect(parseTaskIdentifier("BRI-123-add-feature")).toStrictEqual(Option.some("BRI-123"));
      expect(parseTaskIdentifier("eng-45")).toStrictEqual(Option.some("ENG-45"));
    });

    it("extracts identifier after slash", () => {
      expect(parseTaskIdentifier("user/bri-123-add-feature")).toStrictEqual(Option.some("BRI-123"));
      expect(parseTaskIdentifier("edusantosbrito/bri-456-feature")).toStrictEqual(Option.some("BRI-456"));
      expect(parseTaskIdentifier("prefix/ENG-789-something")).toStrictEqual(Option.some("ENG-789"));
    });

    it("handles various team key lengths (2-5 chars)", () => {
      expect(parseTaskIdentifier("ab-1")).toStrictEqual(Option.some("AB-1"));
      expect(parseTaskIdentifier("abc-12")).toStrictEqual(Option.some("ABC-12"));
      expect(parseTaskIdentifier("abcd-123")).toStrictEqual(Option.some("ABCD-123"));
      expect(parseTaskIdentifier("abcde-1234")).toStrictEqual(Option.some("ABCDE-1234"));
    });

    it("returns uppercase identifier", () => {
      expect(parseTaskIdentifier("bri-123")).toStrictEqual(Option.some("BRI-123"));
      expect(parseTaskIdentifier("Bri-123")).toStrictEqual(Option.some("BRI-123"));
      expect(parseTaskIdentifier("BRI-123")).toStrictEqual(Option.some("BRI-123"));
    });
  });

  describe("invalid patterns - returns None", () => {
    it("rejects identifier in middle of string (false positive prevention)", () => {
      // This was the bug - "feature-add-123-items" would match "ADD-123"
      expect(parseTaskIdentifier("feature-add-123-items")).toStrictEqual(Option.none());
      expect(parseTaskIdentifier("my-feature-eng-123")).toStrictEqual(Option.none());
    });

    it("rejects team keys that are too short (1 char)", () => {
      expect(parseTaskIdentifier("a-123")).toStrictEqual(Option.none());
    });

    it("rejects team keys that are too long (6+ chars)", () => {
      expect(parseTaskIdentifier("abcdef-123")).toStrictEqual(Option.none());
    });

    it("returns None for strings without task pattern", () => {
      expect(parseTaskIdentifier("main")).toStrictEqual(Option.none());
      expect(parseTaskIdentifier("feature/something")).toStrictEqual(Option.none());
      expect(parseTaskIdentifier("")).toStrictEqual(Option.none());
    });

    it("rejects patterns without numbers", () => {
      expect(parseTaskIdentifier("bri-abc")).toStrictEqual(Option.none());
    });
  });
});
