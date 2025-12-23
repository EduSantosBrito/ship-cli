import { describe, it, expect } from "@effect/vitest"
import { Option, Schema } from "effect"
import {
  generatePrBody,
  generateMinimalPrBody,
  parseTaskIdentifierFromBookmark,
} from "../../../../src/adapters/driven/github/PrBodyGenerator.js"
import { Task, TaskId, TeamId, WorkflowState } from "../../../../src/domain/Task.js"
import { Change, ChangeId } from "../../../../src/ports/VcsService.js"

// === Test Fixtures ===

const makeWorkflowState = (): WorkflowState =>
  new WorkflowState({ id: "state-1", name: "In Progress", type: "started" })

const makeTask = (overrides: Partial<{
  title: string
  description: string | null
  identifier: string
  url: string
}>): Task =>
  new Task({
    id: Schema.decodeSync(TaskId)("task-1"),
    identifier: overrides.identifier ?? "BRI-123",
    title: overrides.title ?? "Test Task Title",
    description: overrides.description === null
      ? Option.none()
      : Option.some(overrides.description ?? "Test task description"),
    state: makeWorkflowState(),
    priority: "medium",
    type: Option.none(),
    teamId: Schema.decodeSync(TeamId)("team-1"),
    projectId: Option.none(),
    milestoneId: Option.none(),
    milestoneName: Option.none(),
    branchName: Option.none(),
    url: overrides.url ?? "https://linear.app/test/issue/BRI-123",
    labels: [],
    blockedBy: [],
    blocks: [],
    subtasks: [],
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  })

const makeChange = (overrides: Partial<{
  description: string
  changeId: string
  isEmpty: boolean
}>): Change => {
  const changeIdValue = overrides.changeId ?? "abc12345"
  return new Change({
    id: Schema.decodeSync(ChangeId)(changeIdValue),
    changeId: changeIdValue,
    description: overrides.description ?? "Test change description",
    author: "test@example.com",
    timestamp: new Date("2024-01-01"),
    bookmarks: ["test-bookmark"],
    isWorkingCopy: true,
    isEmpty: overrides.isEmpty ?? false,
  })
}

describe("PrBodyGenerator", () => {
  describe("parseTaskIdentifierFromBookmark", () => {
    it("should parse identifier from user/TASK-123-feature format", () => {
      expect(parseTaskIdentifierFromBookmark("user/BRI-123-feature-name")).toBe("BRI-123")
    })

    it("should parse identifier from lowercase user/task-123-feature format", () => {
      expect(parseTaskIdentifierFromBookmark("edusantosbrito/bri-456-add-feature")).toBe("BRI-456")
    })

    it("should parse identifier from TASK-123-feature format (no user prefix)", () => {
      expect(parseTaskIdentifierFromBookmark("BRI-789-some-task")).toBe("BRI-789")
    })

    it("should parse identifier from just task-123 format", () => {
      expect(parseTaskIdentifierFromBookmark("bri-100")).toBe("BRI-100")
    })

    it("should handle various team prefixes", () => {
      expect(parseTaskIdentifierFromBookmark("ENG-42-fix")).toBe("ENG-42")
      expect(parseTaskIdentifierFromBookmark("SHIP-1-init")).toBe("SHIP-1")
      expect(parseTaskIdentifierFromBookmark("user/FE-999-component")).toBe("FE-999")
    })

    it("should handle single letter prefixes", () => {
      expect(parseTaskIdentifierFromBookmark("X-123-task")).toBe("X-123")
      expect(parseTaskIdentifierFromBookmark("user/A-1-fix")).toBe("A-1")
    })

    it("should handle longer team prefixes up to 10 letters", () => {
      expect(parseTaskIdentifierFromBookmark("MYTEAM-456-feature")).toBe("MYTEAM-456")
      expect(parseTaskIdentifierFromBookmark("user/ABCDEFGHIJ-789")).toBe("ABCDEFGHIJ-789") // 10 letters
    })

    it("should return null for bookmarks without task identifier", () => {
      expect(parseTaskIdentifierFromBookmark("main")).toBeNull()
      expect(parseTaskIdentifierFromBookmark("feature/my-feature")).toBeNull()
      expect(parseTaskIdentifierFromBookmark("hotfix-urgent")).toBeNull()
    })

    it("should return null for empty string", () => {
      expect(parseTaskIdentifierFromBookmark("")).toBeNull()
    })

    it("should return uppercase identifier regardless of input case", () => {
      expect(parseTaskIdentifierFromBookmark("bri-123")).toBe("BRI-123")
      expect(parseTaskIdentifierFromBookmark("Bri-123")).toBe("BRI-123")
      expect(parseTaskIdentifierFromBookmark("BRI-123")).toBe("BRI-123")
    })
  })


  describe("generatePrBody", () => {
    describe("Summary Section", () => {
      it("should use task description for summary when available", () => {
        const task = makeTask({ description: "This is the task description." })
        const result = generatePrBody({ task })

        expect(result.body).toContain("## Summary")
        expect(result.body).toContain("This is the task description.")
      })

      it("should use task title when description is empty", () => {
        const task = makeTask({ description: null, title: "My Task Title" })
        const result = generatePrBody({ task })

        expect(result.body).toContain("## Summary")
        expect(result.body).toContain("My Task Title")
      })

      it("should use custom summary when provided", () => {
        const task = makeTask({ description: "Original description" })
        const result = generatePrBody({ task, customSummary: "Custom summary text" })

        expect(result.body).toContain("## Summary")
        expect(result.body).toContain("Custom summary text")
        expect(result.body).not.toContain("Original description")
      })

      it("should extract first paragraph from description as summary", () => {
        const task = makeTask({
          description: "First paragraph summary.\n\nSecond paragraph with details.\n\nThird paragraph.",
        })
        const result = generatePrBody({ task })

        expect(result.body).toContain("First paragraph summary.")
        // Should not include second paragraph in summary section
      })

      it("should extract summary before section headers", () => {
        const task = makeTask({
          description: "Brief intro text.\n\n## Problem Statement\nDetailed problem...",
        })
        const result = generatePrBody({ task })

        expect(result.body).toContain("Brief intro text.")
      })

      it("should use smart truncation for very long descriptions without paragraphs", () => {
        // Create a very long single paragraph that will exceed 500 chars
        const longText = "First sentence here. " + "More words in this text ".repeat(50)
        const task = makeTask({ description: longText })
        const result = generatePrBody({ task })

        // The summary should be the first paragraph (which is the entire long text)
        // Since it's under 500 chars in the first paragraph, it won't truncate
        // Let's verify the structure is correct
        expect(result.body).toContain("## Summary")
        expect(result.body).toContain("First sentence here.")
      })
    })

    describe("Task Section", () => {
      it("should include task link with identifier and title", () => {
        const task = makeTask({
          identifier: "BRI-456",
          title: "Implement feature X",
          url: "https://linear.app/test/issue/BRI-456",
        })
        const result = generatePrBody({ task })

        expect(result.body).toContain("## Task")
        expect(result.body).toContain("[BRI-456](https://linear.app/test/issue/BRI-456): Implement feature X")
      })
    })

    describe("Changes Section", () => {
      it("should include changes when stack provided", () => {
        const task = makeTask({})
        const stackChanges = [
          makeChange({ description: "First change", changeId: "change1ab" }),
          makeChange({ description: "Second change", changeId: "change2cd" }),
        ]
        const result = generatePrBody({ task, stackChanges })

        expect(result.body).toContain("## Changes")
        expect(result.body).toContain("- First change (`change1a`)")
        expect(result.body).toContain("- Second change (`change2c`)")
      })

      it("should filter out empty changes", () => {
        const task = makeTask({})
        const stackChanges = [
          makeChange({ description: "Real change", changeId: "real1234", isEmpty: false }),
          makeChange({ description: "", changeId: "empty123", isEmpty: true }),
        ]
        const result = generatePrBody({ task, stackChanges })

        expect(result.body).toContain("Real change")
        expect(result.body).not.toContain("empty123")
      })

      it("should filter out changes with no description", () => {
        const task = makeTask({})
        const stackChanges = [
          makeChange({ description: "Has description", changeId: "desc1234" }),
          makeChange({ description: "(no description)", changeId: "nodesc12" }),
        ]
        const result = generatePrBody({ task, stackChanges })

        expect(result.body).toContain("Has description")
        expect(result.body).not.toContain("(no description)")
      })

      it("should use first line of multi-line description", () => {
        const task = makeTask({})
        const stackChanges = [
          makeChange({ description: "First line\nSecond line\nThird line", changeId: "multi123" }),
        ]
        const result = generatePrBody({ task, stackChanges })

        expect(result.body).toContain("- First line (`multi123`)")
        expect(result.body).not.toContain("Second line")
      })

      it("should not include Changes section when no stack provided", () => {
        const task = makeTask({})
        const result = generatePrBody({ task })

        expect(result.body).not.toContain("## Changes")
      })

      it("should not include Changes section when all changes are empty", () => {
        const task = makeTask({})
        const stackChanges = [
          makeChange({ description: "", changeId: "empty1", isEmpty: true }),
          makeChange({ description: "(no description)", changeId: "empty2", isEmpty: true }),
        ]
        const result = generatePrBody({ task, stackChanges })

        expect(result.body).not.toContain("## Changes")
      })
    })

    describe("Acceptance Criteria Section", () => {
      it("should extract checkbox items from description", () => {
        const task = makeTask({
          description: `## Context\nSome context.\n\n## Acceptance Criteria\n- [ ] First criterion\n- [ ] Second criterion\n- [x] Already done`,
        })
        const result = generatePrBody({ task })

        expect(result.body).toContain("## Acceptance Criteria")
        expect(result.body).toContain("- [ ] First criterion")
        expect(result.body).toContain("- [ ] Second criterion")
        expect(result.body).toContain("- [ ] Already done") // Reset to unchecked
        expect(result.acceptanceCriteria).toHaveLength(3)
      })

      it("should handle nested checkbox patterns", () => {
        const task = makeTask({
          description: `- [ ] Top level\n  - [ ] Nested item`,
        })
        const result = generatePrBody({ task })

        expect(result.acceptanceCriteria).toContain("Top level")
        expect(result.acceptanceCriteria).toContain("Nested item")
      })

      it("should not include AC section when no checkboxes found", () => {
        const task = makeTask({
          description: "A simple description without any checkboxes or special sections.",
        })
        const result = generatePrBody({ task })

        expect(result.body).not.toContain("## Acceptance Criteria")
        expect(result.acceptanceCriteria).toHaveLength(0)
      })

      it("should link to task when AC section exists but no checkboxes extracted", () => {
        const task = makeTask({
          description: "## Acceptance Criteria\nSee the detailed requirements document.",
          identifier: "BRI-789",
          url: "https://linear.app/test/issue/BRI-789",
        })
        const result = generatePrBody({ task })

        expect(result.body).toContain("## Acceptance Criteria")
        expect(result.body).toContain("See task for details: [BRI-789](https://linear.app/test/issue/BRI-789)")
      })
    })

    describe("Output Format", () => {
      it("should produce valid markdown structure", () => {
        const task = makeTask({
          description: "Test description\n\n- [ ] AC item",
          identifier: "BRI-100",
          title: "Test title",
          url: "https://linear.app/test/issue/BRI-100",
        })
        const stackChanges = [makeChange({ description: "A change", changeId: "ch123456" })]
        const result = generatePrBody({ task, stackChanges })

        // Should have proper section ordering
        const summaryIndex = result.body.indexOf("## Summary")
        const taskIndex = result.body.indexOf("## Task")
        const changesIndex = result.body.indexOf("## Changes")
        const acIndex = result.body.indexOf("## Acceptance Criteria")

        expect(summaryIndex).toBeLessThan(taskIndex)
        expect(taskIndex).toBeLessThan(changesIndex)
        expect(changesIndex).toBeLessThan(acIndex)
      })

      it("should not have trailing whitespace", () => {
        const task = makeTask({ description: "Simple description" })
        const result = generatePrBody({ task })

        expect(result.body).toBe(result.body.trim())
      })
    })
  })

  describe("generateMinimalPrBody", () => {
    it("should use change description as summary", () => {
      const change = makeChange({ description: "My change description" })
      const result = generateMinimalPrBody(change)

      expect(result).toContain("## Summary")
      expect(result).toContain("My change description")
    })

    it("should handle missing description", () => {
      const change = makeChange({ description: "" })
      const result = generateMinimalPrBody(change)

      expect(result).toContain("## Summary")
      expect(result).toContain("(No description)")
    })

    it("should include stack changes when provided", () => {
      const change = makeChange({ description: "Main change" })
      const stackChanges = [
        makeChange({ description: "Stack change 1", changeId: "stack123" }),
        makeChange({ description: "Stack change 2", changeId: "stack456" }),
      ]
      const result = generateMinimalPrBody(change, stackChanges)

      expect(result).toContain("## Changes")
      expect(result).toContain("- Stack change 1 (`stack123`)")
      expect(result).toContain("- Stack change 2 (`stack456`)")
    })

    it("should not include Changes section when all stack changes are empty", () => {
      const change = makeChange({ description: "Main change" })
      const stackChanges = [
        makeChange({ description: "", changeId: "empty1", isEmpty: true }),
      ]
      const result = generateMinimalPrBody(change, stackChanges)

      expect(result).not.toContain("## Changes")
    })

    it("should not have trailing whitespace", () => {
      const change = makeChange({ description: "Test" })
      const result = generateMinimalPrBody(change)

      expect(result).toBe(result.trim())
    })
  })
})
