import { describe, it, expect } from "vitest";
import {
  extractJson,
  formatTaskList,
  formatTaskDetails,
  addGuidance,
  type ShipTask,
} from "../src/utils.js";

// =============================================================================
// extractJson Tests
// =============================================================================

describe("extractJson", () => {
  describe("basic JSON extraction", () => {
    it("returns valid JSON when input is only JSON", () => {
      const input = '{"key": "value"}';
      const result = extractJson(input);
      expect(result).toBe('{"key": "value"}');
    });

    it("returns valid array when input is JSON array", () => {
      const input = '[1, 2, 3]';
      const result = extractJson(input);
      expect(result).toBe('[1, 2, 3]');
    });

    it("returns original output when no JSON found", () => {
      const input = "This is plain text with no JSON";
      const result = extractJson(input);
      expect(result).toBe(input);
    });
  });

  describe("extracting JSON from mixed output", () => {
    it("extracts JSON when prefixed with spinner output", () => {
      const input = `Loading...
Fetching data...
{"tasks": [{"id": "1", "title": "Test"}]}`;
      const result = extractJson(input);
      expect(result).toBe('{"tasks": [{"id": "1", "title": "Test"}]}');
    });

    it("extracts JSON when prefixed with ANSI codes", () => {
      const input = `\x1b[32mSuccess\x1b[0m
[{"id": "task-1", "name": "Test Task"}]`;
      const result = extractJson(input);
      expect(result).toBe('[{"id": "task-1", "name": "Test Task"}]');
    });

    it("extracts JSON after loading message", () => {
      const input = `Loading...
{"result": "ok"}`;
      const result = extractJson(input);
      expect(JSON.parse(result)).toEqual({ result: "ok" });
    });
  });

  describe("prioritizes top-level JSON over nested", () => {
    it("extracts top-level array, not nested object in description", () => {
      const input = `[
  {
    "id": "task-1",
    "title": "Implement parser",
    "description": "Parse JSON like: {\\"example\\": true}"
  }
]`;
      const result = extractJson(input);
      const parsed = JSON.parse(result);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].id).toBe("task-1");
    });

    it("ignores escaped JSON in description field", () => {
      const input = `{
  "task": "Process data",
  "description": "Handle objects like:\\n  {\\n    \\"nested\\": true\\n  }"
}`;
      const result = extractJson(input);
      const parsed = JSON.parse(result);
      expect(parsed.task).toBe("Process data");
    });
  });

  describe("edge cases", () => {
    it("returns original when JSON is invalid", () => {
      const input = '{"invalid": json}';
      const result = extractJson(input);
      expect(result).toBe(input);
    });

    it("returns original when brace is not JSON (function syntax)", () => {
      const input = "function() { return 1; }";
      const result = extractJson(input);
      expect(result).toBe(input);
    });

    it("handles empty input", () => {
      const result = extractJson("");
      expect(result).toBe("");
    });

    it("handles whitespace-only input", () => {
      const input = "   \n\t  ";
      const result = extractJson(input);
      expect(result).toBe(input);
    });

    it("extracts indented JSON when no top-level JSON exists", () => {
      const input = `Status: OK
   {"nested": "value"}`;
      const result = extractJson(input);
      expect(result).toBe('{"nested": "value"}');
    });

    it("returns last valid JSON when multiple blocks exist", () => {
      // When first candidate includes trailing content that makes it invalid,
      // extractJson falls back to subsequent candidates
      const input = `{"first": 1}
{"second": 2}`;
      const result = extractJson(input);
      expect(JSON.parse(result)).toEqual({ second: 2 });
    });
  });

  describe("real-world CLI output scenarios", () => {
    it("extracts JSON from typical ship CLI output with pnpm prefix", () => {
      const input = `
> ship-monorepo@ ship /path/to/project
> tsx packages/cli/src/bin.ts task ready --json

[
  {
    "id": "123",
    "identifier": "BRI-123",
    "title": "Test task"
  }
]`;
      const result = extractJson(input);
      const parsed = JSON.parse(result);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].identifier).toBe("BRI-123");
    });

    it("extracts object from status command output", () => {
      const input = `Checking configuration...
{"configured": true, "teamId": "team-1", "teamKey": "TEAM"}`;
      const result = extractJson(input);
      const parsed = JSON.parse(result);
      expect(parsed.configured).toBe(true);
      expect(parsed.teamKey).toBe("TEAM");
    });
  });
});

// =============================================================================
// formatTaskList Tests
// =============================================================================

describe("formatTaskList", () => {
  const makeTask = (overrides: Partial<ShipTask> = {}): ShipTask => ({
    identifier: "BRI-123",
    title: "Default Task",
    priority: "medium",
    status: "todo",
    labels: [],
    url: "https://example.com",
    ...overrides,
  });

  describe("priority formatting", () => {
    it("shows [!] indicator for urgent tasks", () => {
      const tasks = [makeTask({ priority: "urgent", identifier: "BRI-1" })];
      const result = formatTaskList(tasks);
      expect(result).toContain("[!]");
      expect(result).toContain("BRI-1");
    });

    it("shows [^] indicator for high priority tasks", () => {
      const tasks = [makeTask({ priority: "high", identifier: "BRI-2" })];
      const result = formatTaskList(tasks);
      expect(result).toContain("[^]");
    });

    it("shows no indicator for medium priority tasks", () => {
      const tasks = [makeTask({ priority: "medium", identifier: "BRI-3" })];
      const result = formatTaskList(tasks);
      expect(result).toMatch(/^\s{3}\s+BRI-3/);
    });

    it("shows no indicator for low priority tasks", () => {
      const tasks = [makeTask({ priority: "low", identifier: "BRI-4" })];
      const result = formatTaskList(tasks);
      expect(result).toMatch(/^\s{3}\s+BRI-4/);
    });
  });

  describe("status display", () => {
    it("uses state when available", () => {
      const tasks = [makeTask({ state: "In Progress", status: "in_progress" })];
      const result = formatTaskList(tasks);
      expect(result).toContain("In Progress");
    });

    it("falls back to status when state is undefined", () => {
      const tasks = [makeTask({ state: undefined, status: "backlog" })];
      const result = formatTaskList(tasks);
      expect(result).toContain("backlog");
    });
  });

  describe("formatting multiple tasks", () => {
    it("joins tasks with newlines", () => {
      const tasks = [
        makeTask({ identifier: "BRI-1", title: "First" }),
        makeTask({ identifier: "BRI-2", title: "Second" }),
        makeTask({ identifier: "BRI-3", title: "Third" }),
      ];
      const result = formatTaskList(tasks);
      const lines = result.split("\n");
      expect(lines).toHaveLength(3);
    });

    it("returns empty string for empty array", () => {
      const result = formatTaskList([]);
      expect(result).toBe("");
    });
  });

  describe("column alignment", () => {
    it("pads identifier to 10 characters", () => {
      const tasks = [makeTask({ identifier: "BRI-1" })];
      const result = formatTaskList(tasks);
      expect(result).toMatch(/BRI-1\s{5}/);
    });

    it("pads status to 12 characters", () => {
      const tasks = [makeTask({ state: "Todo" })];
      const result = formatTaskList(tasks);
      expect(result).toMatch(/Todo\s{8}/);
    });
  });
});

// =============================================================================
// formatTaskDetails Tests
// =============================================================================

describe("formatTaskDetails", () => {
  const makeTask = (overrides: Partial<ShipTask> = {}): ShipTask => ({
    identifier: "BRI-123",
    title: "Test Task",
    priority: "medium",
    status: "todo",
    state: "Todo",
    labels: [],
    url: "https://linear.app/team/issue/BRI-123",
    ...overrides,
  });

  describe("basic fields", () => {
    it("includes identifier and title as header", () => {
      const task = makeTask({ identifier: "BRI-99", title: "Important Task" });
      const result = formatTaskDetails(task);
      expect(result).toContain("# BRI-99: Important Task");
    });

    it("includes status field", () => {
      const task = makeTask({ state: "In Review" });
      const result = formatTaskDetails(task);
      expect(result).toContain("**Status:** In Review");
    });

    it("falls back to status when state is undefined", () => {
      const task = makeTask({ state: undefined, status: "in_progress" });
      const result = formatTaskDetails(task);
      expect(result).toContain("**Status:** in_progress");
    });

    it("includes priority field", () => {
      const task = makeTask({ priority: "urgent" });
      const result = formatTaskDetails(task);
      expect(result).toContain("**Priority:** urgent");
    });

    it("includes URL field", () => {
      const task = makeTask({ url: "https://linear.app/my-issue" });
      const result = formatTaskDetails(task);
      expect(result).toContain("**URL:** https://linear.app/my-issue");
    });
  });

  describe("labels", () => {
    it("shows 'none' when no labels", () => {
      const task = makeTask({ labels: [] });
      const result = formatTaskDetails(task);
      expect(result).toContain("**Labels:** none");
    });

    it("joins multiple labels with commas", () => {
      const task = makeTask({ labels: ["bug", "frontend", "urgent"] });
      const result = formatTaskDetails(task);
      expect(result).toContain("**Labels:** bug, frontend, urgent");
    });

    it("shows single label without comma", () => {
      const task = makeTask({ labels: ["feature"] });
      const result = formatTaskDetails(task);
      expect(result).toContain("**Labels:** feature");
    });
  });

  describe("optional fields", () => {
    it("includes branch when present", () => {
      const task = makeTask({ branchName: "feature/bri-123-new-feature" });
      const result = formatTaskDetails(task);
      expect(result).toContain("**Branch:** feature/bri-123-new-feature");
    });

    it("omits branch when absent", () => {
      const task = makeTask({ branchName: undefined });
      const result = formatTaskDetails(task);
      expect(result).not.toContain("**Branch:**");
    });

    it("includes description section when present", () => {
      const task = makeTask({ description: "This is a detailed description." });
      const result = formatTaskDetails(task);
      expect(result).toContain("## Description");
      expect(result).toContain("This is a detailed description.");
    });

    it("omits description section when absent", () => {
      const task = makeTask({ description: undefined });
      const result = formatTaskDetails(task);
      expect(result).not.toContain("## Description");
    });
  });

  describe("subtasks", () => {
    it("includes subtasks section with checkboxes", () => {
      const task = makeTask({
        subtasks: [
          {
            id: "sub-1",
            identifier: "BRI-124",
            title: "Subtask 1",
            state: "Done",
            stateType: "completed",
            isDone: true,
          },
          {
            id: "sub-2",
            identifier: "BRI-125",
            title: "Subtask 2",
            state: "Todo",
            stateType: "unstarted",
            isDone: false,
          },
        ],
      });
      const result = formatTaskDetails(task);
      expect(result).toContain("## Subtasks");
      expect(result).toContain("[x] BRI-124: Subtask 1 (Done)");
      expect(result).toContain("[ ] BRI-125: Subtask 2 (Todo)");
    });

    it("omits subtasks section when empty", () => {
      const task = makeTask({ subtasks: [] });
      const result = formatTaskDetails(task);
      expect(result).not.toContain("## Subtasks");
    });

    it("omits subtasks section when undefined", () => {
      const task = makeTask({ subtasks: undefined });
      const result = formatTaskDetails(task);
      expect(result).not.toContain("## Subtasks");
    });
  });

  describe("output structure", () => {
    it("maintains correct section order", () => {
      const task = makeTask({
        identifier: "BRI-1",
        title: "Full Task",
        state: "In Progress",
        priority: "high",
        labels: ["important"],
        url: "https://example.com",
        branchName: "feat/task",
        description: "A description",
        subtasks: [
          {
            id: "1",
            identifier: "BRI-2",
            title: "Sub",
            state: "Todo",
            stateType: "unstarted",
            isDone: false,
          },
        ],
      });
      const result = formatTaskDetails(task);

      const headerIndex = result.indexOf("# BRI-1");
      const statusIndex = result.indexOf("**Status:**");
      const branchIndex = result.indexOf("**Branch:**");
      const descIndex = result.indexOf("## Description");
      const subtasksIndex = result.indexOf("## Subtasks");

      expect(headerIndex).toBeLessThan(statusIndex);
      expect(statusIndex).toBeLessThan(branchIndex);
      expect(branchIndex).toBeLessThan(descIndex);
      expect(descIndex).toBeLessThan(subtasksIndex);
    });
  });
});

// =============================================================================
// addGuidance Tests
// =============================================================================

describe("addGuidance", () => {
  describe("basic guidance", () => {
    it("includes next actions in output", () => {
      const result = addGuidance("action=ready | action=create");
      expect(result).toContain("Next: action=ready | action=create");
    });

    it("starts with separator line", () => {
      const result = addGuidance("any action");
      expect(result.startsWith("\n---\n")).toBe(true);
    });
  });

  describe("optional fields", () => {
    it("includes workdir when provided", () => {
      const result = addGuidance("action=test", { workdir: "/path/to/workspace" });
      expect(result).toContain("Workdir: /path/to/workspace");
    });

    it("omits workdir when not provided", () => {
      const result = addGuidance("action=test", {});
      expect(result).not.toContain("Workdir:");
    });

    it("includes skill reference when true", () => {
      const result = addGuidance("action=test", { skill: true });
      expect(result).toContain('IMPORTANT: Load skill first → skill(name="ship-cli")');
    });

    it("omits skill when false", () => {
      const result = addGuidance("action=test", { skill: false });
      expect(result).not.toContain("IMPORTANT: Load skill first");
    });

    it("omits skill when not provided", () => {
      const result = addGuidance("action=test", {});
      expect(result).not.toContain("IMPORTANT: Load skill first");
    });

    it("includes note when provided", () => {
      const result = addGuidance("action=test", { note: "Important reminder" });
      expect(result).toContain("Note: Important reminder");
    });

    it("omits note when not provided", () => {
      const result = addGuidance("action=test", {});
      expect(result).not.toContain("Note:");
    });
  });

  describe("combining options", () => {
    it("includes all options when provided", () => {
      const result = addGuidance("action=next", {
        workdir: "/workspace",
        skill: true,
        note: "Check docs",
      });

      expect(result).toContain("Next: action=next");
      expect(result).toContain("Workdir: /workspace");
      expect(result).toContain('IMPORTANT: Load skill first → skill(name="ship-cli")');
      expect(result).toContain("Note: Check docs");
    });

    it("maintains correct field order", () => {
      const result = addGuidance("action=test", {
        workdir: "/path",
        skill: true,
        note: "A note",
      });

      const nextIndex = result.indexOf("Next:");
      const workdirIndex = result.indexOf("Workdir:");
      const skillIndex = result.indexOf("IMPORTANT:");
      const noteIndex = result.indexOf("Note:");

      expect(nextIndex).toBeLessThan(workdirIndex);
      expect(workdirIndex).toBeLessThan(skillIndex);
      expect(skillIndex).toBeLessThan(noteIndex);
    });
  });
});
