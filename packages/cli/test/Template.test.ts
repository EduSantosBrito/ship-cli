import { describe, expect, it } from "@effect/vitest";
import { TaskTemplate } from "../src/domain/Template.js";

describe("TaskTemplate", () => {
  describe("formatTitle", () => {
    it("should replace {title} placeholder with user title", () => {
      const template = new TaskTemplate({
        name: "bug",
        title: "fix: {title}",
      });

      expect(template.formatTitle("login button broken")).toBe("fix: login button broken");
    });

    it("should append user title when no placeholder", () => {
      const template = new TaskTemplate({
        name: "bug",
        title: "[BUG]",
      });

      expect(template.formatTitle("login button broken")).toBe("[BUG] login button broken");
    });

    it("should return user title when no template title", () => {
      const template = new TaskTemplate({
        name: "empty",
      });

      expect(template.formatTitle("my task")).toBe("my task");
    });

    it("should handle multiple placeholders", () => {
      const template = new TaskTemplate({
        name: "test",
        title: "{title} - {title}",
      });

      // Only first placeholder is replaced (by design)
      expect(template.formatTitle("foo")).toBe("foo - {title}");
    });
  });

  describe("formatDescription", () => {
    it("should replace {title} placeholders in description", () => {
      const template = new TaskTemplate({
        name: "bug",
        description: "## Bug: {title}\n\nDescription of {title}",
      });

      expect(template.formatDescription("login issue")).toBe(
        "## Bug: login issue\n\nDescription of login issue",
      );
    });

    it("should return undefined when no template description", () => {
      const template = new TaskTemplate({
        name: "empty",
      });

      expect(template.formatDescription("my task")).toBeUndefined();
    });

    it("should return description as-is when no placeholders", () => {
      const template = new TaskTemplate({
        name: "static",
        description: "This is a static description",
      });

      expect(template.formatDescription("anything")).toBe("This is a static description");
    });
  });

  describe("default values", () => {
    it("should have optional priority and type", () => {
      const template = new TaskTemplate({
        name: "minimal",
      });

      expect(template.priority).toBeUndefined();
      expect(template.type).toBeUndefined();
    });

    it("should preserve priority and type when set", () => {
      const template = new TaskTemplate({
        name: "full",
        priority: "high",
        type: "bug",
      });

      expect(template.priority).toBe("high");
      expect(template.type).toBe("bug");
    });
  });
});
