import { describe, it, expect } from "@effect/vitest"
import { Effect } from "effect"
import {
  parseChange,
  parseChangeFromString,
  parseChanges,
  parseChangeIdFromOutput,
  JJ_LOG_JSON_TEMPLATE,
} from "../../../../src/adapters/driven/vcs/JjParser.js"
import { Change } from "../../../../src/ports/VcsService.js"

// === Mock Data ===

/**
 * Create realistic jj commit JSON matching actual jj output format.
 * - commit_id: Full 40-char hex hash (like git)
 * - change_id: 8-12 char alphanumeric (jj's format)
 */
const createJjCommitJson = (overrides: Partial<{
  commit_id: string
  change_id: string
  description: string
  author: { name: string; email: string; timestamp: string }
  bookmarks: Array<{ name: string; target: Array<string | null> }>
  is_working_copy: boolean
  is_empty: boolean
  has_conflict: boolean
}> = {}) => ({
  commit_id: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  change_id: "smukowrz",
  description: "feat: add new feature",
  author: {
    name: "Test User",
    email: "test@example.com",
    timestamp: "2024-01-15T10:30:00Z",
  },
  bookmarks: [],
  is_working_copy: false,
  is_empty: false,
  has_conflict: false,
  ...overrides,
})

// === Tests ===

describe("JjParser", () => {
  describe("JJ_LOG_JSON_TEMPLATE", () => {
    it("should be a non-empty template string with all required fields", () => {
      expect(JJ_LOG_JSON_TEMPLATE).toBeDefined()
      expect(JJ_LOG_JSON_TEMPLATE.length).toBeGreaterThan(0)
      expect(JJ_LOG_JSON_TEMPLATE).toContain("commit_id")
      expect(JJ_LOG_JSON_TEMPLATE).toContain("change_id")
      expect(JJ_LOG_JSON_TEMPLATE).toContain("description")
      expect(JJ_LOG_JSON_TEMPLATE).toContain("author")
      expect(JJ_LOG_JSON_TEMPLATE).toContain("bookmarks")
      expect(JJ_LOG_JSON_TEMPLATE).toContain("is_working_copy")
      expect(JJ_LOG_JSON_TEMPLATE).toContain("is_empty")
      expect(JJ_LOG_JSON_TEMPLATE).toContain("has_conflict")
    })
  })

  describe("parseChange", () => {
    it.effect("should parse a valid jj commit JSON object with all fields", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson()
        const change = yield* parseChange(json)

        expect(change).toBeInstanceOf(Change)
        expect(change.id).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2")
        expect(change.changeId).toBe("smukowrz")
        expect(change.description).toBe("feat: add new feature")
        expect(change.author).toBe("test@example.com")
        expect(change.isWorkingCopy).toBe(false)
        expect(change.isEmpty).toBe(false)
        expect(change.bookmarks).toEqual([])
      }),
    )

    it.effect("should use author name when email is empty", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson({
          author: { name: "John Doe", email: "", timestamp: "2024-01-15T10:30:00Z" },
        })
        const change = yield* parseChange(json)

        expect(change.author).toBe("John Doe")
      }),
    )

    it.effect("should parse bookmarks correctly", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson({
          bookmarks: [
            { name: "main", target: ["abc123def456"] },
            { name: "feature/test", target: ["def456abc789"] },
          ],
        })
        const change = yield* parseChange(json)

        expect(change.bookmarks).toEqual(["main", "feature/test"])
      }),
    )

    it.effect("should handle working copy flag", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson({ is_working_copy: true })
        const change = yield* parseChange(json)

        expect(change.isWorkingCopy).toBe(true)
      }),
    )

    it.effect("should handle empty commit flag", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson({ is_empty: true })
        const change = yield* parseChange(json)

        expect(change.isEmpty).toBe(true)
      }),
    )

    it.effect("should handle conflict flag when false", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson({ has_conflict: false })
        const change = yield* parseChange(json)

        expect(change.hasConflict).toBe(false)
      }),
    )

    it.effect("should handle conflict flag when true", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson({ has_conflict: true })
        const change = yield* parseChange(json)

        expect(change.hasConflict).toBe(true)
      }),
    )

    it.effect("should trim description whitespace", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson({ description: "  some description  \n" })
        const change = yield* parseChange(json)

        expect(change.description).toBe("some description")
      }),
    )

    it.effect("should handle empty description", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson({ description: "" })
        const change = yield* parseChange(json)

        expect(change.description).toBe("")
      }),
    )

    it.effect("should handle description with newlines", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson({ description: "First line\n\nSecond line\nThird line" })
        const change = yield* parseChange(json)

        expect(change.description).toBe("First line\n\nSecond line\nThird line")
      }),
    )

    it.effect("should handle description with special characters", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson({ description: "fix: handle \"quotes\" and 'apostrophes' & <brackets>" })
        const change = yield* parseChange(json)

        expect(change.description).toBe("fix: handle \"quotes\" and 'apostrophes' & <brackets>")
      }),
    )

    it.effect("should handle description with unicode", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson({ description: "feat: add emoji support 🚀 and i18n 日本語" })
        const change = yield* parseChange(json)

        expect(change.description).toBe("feat: add emoji support 🚀 and i18n 日本語")
      }),
    )

    it.effect("should fail on invalid JSON structure with descriptive error", () =>
      Effect.gen(function* () {
        const result = yield* parseChange({ invalid: "data" }).pipe(Effect.either)

        expect(result._tag).toBe("Left")
        if (result._tag === "Left") {
          expect(result.left._tag).toBe("VcsError")
          expect(result.left.message).toContain("Failed to parse jj commit")
        }
      }),
    )

    it.effect("should fail on missing required fields", () =>
      Effect.gen(function* () {
        const json = { commit_id: "abc123" } // missing other fields
        const result = yield* parseChange(json).pipe(Effect.either)

        expect(result._tag).toBe("Left")
        if (result._tag === "Left") {
          expect(result.left._tag).toBe("VcsError")
        }
      }),
    )

    it.effect("should fail on wrong field types", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson()
        // @ts-expect-error - Testing runtime behavior with wrong type
        json.is_empty = "not a boolean"
        const result = yield* parseChange(json).pipe(Effect.either)

        expect(result._tag).toBe("Left")
      }),
    )
  })

  describe("parseChangeFromString", () => {
    it.effect("should parse a valid JSON string", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson()
        const jsonString = JSON.stringify(json)
        const change = yield* parseChangeFromString(jsonString)

        expect(change).toBeInstanceOf(Change)
        expect(change.id).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2")
      }),
    )

    it.effect("should fail on invalid JSON string with descriptive error", () =>
      Effect.gen(function* () {
        const result = yield* parseChangeFromString("not valid json").pipe(Effect.either)

        expect(result._tag).toBe("Left")
        if (result._tag === "Left") {
          expect(result.left._tag).toBe("VcsError")
          expect(result.left.message).toContain("Invalid JSON from jj")
        }
      }),
    )

    it.effect("should fail on empty string", () =>
      Effect.gen(function* () {
        const result = yield* parseChangeFromString("").pipe(Effect.either)

        expect(result._tag).toBe("Left")
        if (result._tag === "Left") {
          expect(result.left.message).toContain("Invalid JSON")
        }
      }),
    )

    it.effect("should fail on truncated JSON", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson()
        const truncated = JSON.stringify(json).slice(0, 50) // Cut off mid-way
        const result = yield* parseChangeFromString(truncated).pipe(Effect.either)

        expect(result._tag).toBe("Left")
      }),
    )
  })

  describe("parseChanges", () => {
    it.effect("should parse multiple newline-separated JSON objects", () =>
      Effect.gen(function* () {
        const json1 = createJjCommitJson({ 
          commit_id: "1111111111111111111111111111111111111111", 
          change_id: "aaaabbbb" 
        })
        const json2 = createJjCommitJson({ 
          commit_id: "2222222222222222222222222222222222222222", 
          change_id: "ccccdddd" 
        })
        const output = `${JSON.stringify(json1)}\n${JSON.stringify(json2)}`

        const changes = yield* parseChanges(output)

        expect(changes).toHaveLength(2)
        expect(changes[0].id).toBe("1111111111111111111111111111111111111111")
        expect(changes[0].changeId).toBe("aaaabbbb")
        expect(changes[1].id).toBe("2222222222222222222222222222222222222222")
        expect(changes[1].changeId).toBe("ccccdddd")
      }),
    )

    it.effect("should return empty array for empty string", () =>
      Effect.gen(function* () {
        const changes = yield* parseChanges("")

        expect(changes).toEqual([])
      }),
    )

    it.effect("should return empty array for whitespace-only string", () =>
      Effect.gen(function* () {
        const changes = yield* parseChanges("   \n\n   ")

        expect(changes).toEqual([])
      }),
    )

    it.effect("should handle single JSON object", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson()
        const output = JSON.stringify(json)

        const changes = yield* parseChanges(output)

        expect(changes).toHaveLength(1)
        expect(changes[0].changeId).toBe("smukowrz")
      }),
    )

    it.effect("should filter empty lines between JSON objects", () =>
      Effect.gen(function* () {
        const json1 = createJjCommitJson({ change_id: "first123" })
        const json2 = createJjCommitJson({ change_id: "second45" })
        const output = `${JSON.stringify(json1)}\n\n\n${JSON.stringify(json2)}\n`

        const changes = yield* parseChanges(output)

        expect(changes).toHaveLength(2)
        expect(changes[0].changeId).toBe("first123")
        expect(changes[1].changeId).toBe("second45")
      }),
    )

    it.effect("should fail if any line is invalid JSON", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson()
        const output = `${JSON.stringify(json)}\ninvalid json`

        const result = yield* parseChanges(output).pipe(Effect.either)

        expect(result._tag).toBe("Left")
        if (result._tag === "Left") {
          expect(result.left._tag).toBe("VcsError")
        }
      }),
    )

    it.effect("should handle many changes (stack scenario)", () =>
      Effect.gen(function* () {
        const changes = Array.from({ length: 10 }, (_, i) => 
          createJjCommitJson({ change_id: `change${i.toString().padStart(2, '0')}` })
        )
        const output = changes.map(c => JSON.stringify(c)).join("\n")

        const result = yield* parseChanges(output)

        expect(result).toHaveLength(10)
        expect(result[0].changeId).toBe("change00")
        expect(result[9].changeId).toBe("change09")
      }),
    )
  })

  describe("parseChangeIdFromOutput", () => {
    it.effect("should parse change ID from standard jj output", () =>
      Effect.gen(function* () {
        const output = "Working copy  (@) now at: smukowrz a1b2c3d4e5f6 (empty) some description"
        const changeId = yield* parseChangeIdFromOutput(output)

        expect(changeId).toBe("smukowrz")
      }),
    )

    it.effect("should parse change ID without (@) marker", () =>
      Effect.gen(function* () {
        const output = "Working copy now at: xyzabc12 def789abcdef some description"
        const changeId = yield* parseChangeIdFromOutput(output)

        expect(changeId).toBe("xyzabc12")
      }),
    )

    it.effect("should parse change ID with extra whitespace", () =>
      Effect.gen(function* () {
        const output = "Working copy    (@)   now at:   abcdef12 xyz789 description"
        const changeId = yield* parseChangeIdFromOutput(output)

        expect(changeId).toBe("abcdef12")
      }),
    )

    it.effect("should handle multiline output (like after rebase)", () =>
      Effect.gen(function* () {
        const output = `Rebased 1 commits
Working copy  (@) now at: newchang abc123def456 (empty) description
Parent commit: oldparen def456abc789 old description`
        const changeId = yield* parseChangeIdFromOutput(output)

        expect(changeId).toBe("newchang")
      }),
    )

    it.effect("should fail when no match found with descriptive error", () =>
      Effect.gen(function* () {
        const output = "Some random jj output without working copy info"
        const result = yield* parseChangeIdFromOutput(output).pipe(Effect.either)

        expect(result._tag).toBe("Left")
        if (result._tag === "Left") {
          expect(result.left._tag).toBe("VcsError")
          expect(result.left.message).toContain("Could not extract change ID")
          expect(result.left.message).toContain(output)
        }
      }),
    )

    it.effect("should fail on empty output", () =>
      Effect.gen(function* () {
        const result = yield* parseChangeIdFromOutput("").pipe(Effect.either)

        expect(result._tag).toBe("Left")
        if (result._tag === "Left") {
          expect(result.left.message).toContain("Could not extract change ID")
        }
      }),
    )
  })

  describe("Change timestamp parsing", () => {
    it.effect("should parse ISO timestamp correctly", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson({
          author: {
            name: "Test",
            email: "test@example.com",
            timestamp: "2024-06-15T14:30:00Z",
          },
        })
        const change = yield* parseChange(json)

        expect(change.timestamp).toBeInstanceOf(Date)
        expect(change.timestamp.getFullYear()).toBe(2024)
        expect(change.timestamp.getMonth()).toBe(5) // June is month 5 (0-indexed)
        expect(change.timestamp.getDate()).toBe(15)
      }),
    )

    it.effect("should handle timestamp with timezone offset", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson({
          author: {
            name: "Test",
            email: "test@example.com",
            timestamp: "2024-06-15T14:30:00+05:30",
          },
        })
        const change = yield* parseChange(json)

        expect(change.timestamp).toBeInstanceOf(Date)
        // The Date object will convert to UTC internally
        expect(change.timestamp.getFullYear()).toBe(2024)
      }),
    )
  })

  describe("Bookmark edge cases", () => {
    it.effect("should handle bookmarks with null targets (divergent bookmarks)", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson({
          bookmarks: [
            { name: "divergent-bookmark", target: [null, "abc123"] },
          ],
        })
        const change = yield* parseChange(json)

        expect(change.bookmarks).toEqual(["divergent-bookmark"])
      }),
    )

    it.effect("should handle bookmark with empty target array", () =>
      Effect.gen(function* () {
        const json = createJjCommitJson({
          bookmarks: [
            { name: "orphan-bookmark", target: [] },
          ],
        })
        const change = yield* parseChange(json)

        expect(change.bookmarks).toEqual(["orphan-bookmark"])
      }),
    )

    it.effect("should handle many bookmarks", () =>
      Effect.gen(function* () {
        const bookmarks = Array.from({ length: 5 }, (_, i) => ({
          name: `bookmark-${i}`,
          target: [`target-${i}`],
        }))
        const json = createJjCommitJson({ bookmarks })
        const change = yield* parseChange(json)

        expect(change.bookmarks).toHaveLength(5)
        expect(change.bookmarks).toContain("bookmark-0")
        expect(change.bookmarks).toContain("bookmark-4")
      }),
    )
  })
})
