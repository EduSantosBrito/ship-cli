import { describe, it, expect } from "@effect/vitest";
import * as Option from "effect/Option";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints.js";
import {
  extractTitle,
  extractText,
  extractStatus,
  extractSelect,
  extractMultiSelect,
  extractRelation,
  extractRichText,
  mapStatusToStateType,
  mapStatusToWorkflowState,
  mapPriority,
  priorityToNotion,
  mapTaskType,
  mapPageToTask,
  buildCreateProperties,
  buildUpdateProperties,
  DEFAULT_PROPERTY_MAPPING,
  type MapPageToTaskConfig,
} from "../../../../src/adapters/driven/notion/NotionMapper.js";
import type { TeamId } from "../../../../src/domain/Task.js";
import type { NotionPropertyMapping } from "../../../../src/domain/Config.js";

// =============================================================================
// Test Fixtures
// =============================================================================

const createRichText = (text: string) => [
  {
    type: "text" as const,
    text: { content: text, link: null },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: "default" as const,
    },
    plain_text: text,
    href: null,
  },
];

const createTitleProperty = (text: string) => ({
  type: "title" as const,
  title: createRichText(text),
  id: "title",
});

const createRichTextProperty = (text: string) => ({
  type: "rich_text" as const,
  rich_text: createRichText(text),
  id: "rich_text",
});

const createStatusProperty = (name: string) => ({
  type: "status" as const,
  status: { id: "status-id", name, color: "default" as const },
  id: "status",
});

const createSelectProperty = (name: string) => ({
  type: "select" as const,
  select: { id: "select-id", name, color: "default" as const },
  id: "select",
});

const createMultiSelectProperty = (names: string[]) => ({
  type: "multi_select" as const,
  multi_select: names.map((name) => ({ id: `ms-${name}`, name, color: "default" as const })),
  id: "multi_select",
});

const createRelationProperty = (ids: string[]) => ({
  type: "relation" as const,
  relation: ids.map((id) => ({ id })),
  has_more: false,
  id: "relation",
});

const createMockPage = (
  properties: Record<string, unknown>,
  overrides: Partial<PageObjectResponse> = {},
): PageObjectResponse =>
  ({
    object: "page",
    id: "page-123-456-789",
    created_time: "2024-01-01T00:00:00.000Z",
    last_edited_time: "2024-01-02T00:00:00.000Z",
    created_by: { object: "user", id: "user-1" },
    last_edited_by: { object: "user", id: "user-1" },
    cover: null,
    icon: null,
    parent: { type: "database_id", database_id: "db-123" },
    archived: false,
    in_trash: false,
    properties,
    url: "https://notion.so/page-123",
    public_url: null,
    ...overrides,
  }) as PageObjectResponse;

const defaultConfig: MapPageToTaskConfig = {
  propertyMapping: DEFAULT_PROPERTY_MAPPING as unknown as NotionPropertyMapping,
  teamId: "team-notion" as TeamId,
  databaseId: "db-123",
};

// =============================================================================
// Property Extraction Tests
// =============================================================================

describe("NotionMapper", () => {
  describe("extractRichText", () => {
    it("should extract plain text from rich text array", () => {
      const richText = createRichText("Hello World");
      expect(extractRichText(richText)).toBe("Hello World");
    });

    it("should concatenate multiple rich text items", () => {
      const richText = [...createRichText("Hello "), ...createRichText("World")];
      expect(extractRichText(richText)).toBe("Hello World");
    });

    it("should return empty string for empty array", () => {
      expect(extractRichText([])).toBe("");
    });
  });

  describe("extractTitle", () => {
    it("should extract title from title property", () => {
      const property = createTitleProperty("My Task");
      expect(extractTitle(property)).toBe("My Task");
    });

    it("should return empty string for undefined property", () => {
      expect(extractTitle(undefined)).toBe("");
    });

    it("should return empty string for non-title property", () => {
      const property = createRichTextProperty("Not a title");
      expect(extractTitle(property)).toBe("");
    });
  });

  describe("extractText", () => {
    it("should extract text from rich_text property", () => {
      const property = createRichTextProperty("Description text");
      expect(extractText(property)).toBe("Description text");
    });

    it("should return undefined for undefined property", () => {
      expect(extractText(undefined)).toBeUndefined();
    });

    it("should return undefined for empty text", () => {
      const property = { type: "rich_text" as const, rich_text: [], id: "rt" };
      expect(extractText(property)).toBeUndefined();
    });
  });

  describe("extractStatus", () => {
    it("should extract status name", () => {
      const property = createStatusProperty("In Progress");
      expect(extractStatus(property)).toBe("In Progress");
    });

    it("should return undefined for undefined property", () => {
      expect(extractStatus(undefined)).toBeUndefined();
    });
  });

  describe("extractSelect", () => {
    it("should extract select value", () => {
      const property = createSelectProperty("High");
      expect(extractSelect(property)).toBe("High");
    });

    it("should return undefined for undefined property", () => {
      expect(extractSelect(undefined)).toBeUndefined();
    });
  });

  describe("extractMultiSelect", () => {
    it("should extract multi-select values", () => {
      const property = createMultiSelectProperty(["bug", "frontend"]);
      expect(extractMultiSelect(property)).toEqual(["bug", "frontend"]);
    });

    it("should return empty array for undefined property", () => {
      expect(extractMultiSelect(undefined)).toEqual([]);
    });
  });

  describe("extractRelation", () => {
    it("should extract relation IDs", () => {
      const property = createRelationProperty(["page-1", "page-2"]);
      expect(extractRelation(property)).toEqual(["page-1", "page-2"]);
    });

    it("should return empty array for undefined property", () => {
      expect(extractRelation(undefined)).toEqual([]);
    });
  });

  // =============================================================================
  // Status Mapping Tests
  // =============================================================================

  describe("mapStatusToStateType", () => {
    it("should map backlog statuses", () => {
      expect(mapStatusToStateType("Backlog")).toBe("backlog");
      expect(mapStatusToStateType("Icebox")).toBe("backlog");
      expect(mapStatusToStateType("Later")).toBe("backlog");
    });

    it("should map completed statuses", () => {
      expect(mapStatusToStateType("Done")).toBe("completed");
      expect(mapStatusToStateType("Complete")).toBe("completed");
      expect(mapStatusToStateType("Shipped")).toBe("completed");
      expect(mapStatusToStateType("Resolved")).toBe("completed");
    });

    it("should map canceled statuses", () => {
      expect(mapStatusToStateType("Cancelled")).toBe("canceled");
      expect(mapStatusToStateType("Won't Do")).toBe("canceled");
      expect(mapStatusToStateType("Duplicate")).toBe("canceled");
    });

    it("should map in-progress statuses", () => {
      expect(mapStatusToStateType("In Progress")).toBe("started");
      expect(mapStatusToStateType("Doing")).toBe("started");
      expect(mapStatusToStateType("In Review")).toBe("started");
      expect(mapStatusToStateType("Testing")).toBe("started");
    });

    it("should default to unstarted for unknown statuses", () => {
      expect(mapStatusToStateType("Todo")).toBe("unstarted");
      expect(mapStatusToStateType("New")).toBe("unstarted");
      expect(mapStatusToStateType("Open")).toBe("unstarted");
      expect(mapStatusToStateType(undefined)).toBe("unstarted");
    });
  });

  describe("mapStatusToWorkflowState", () => {
    it("should create WorkflowState from status", () => {
      const state = mapStatusToWorkflowState("In Progress");
      expect(state.name).toBe("In Progress");
      expect(state.type).toBe("started");
    });

    it("should handle undefined status", () => {
      const state = mapStatusToWorkflowState(undefined);
      expect(state.name).toBe("Unknown");
      expect(state.type).toBe("unstarted");
    });
  });

  // =============================================================================
  // Priority Mapping Tests
  // =============================================================================

  describe("mapPriority", () => {
    it("should map urgent priorities", () => {
      expect(mapPriority("Urgent")).toBe("urgent");
      expect(mapPriority("Critical")).toBe("urgent");
      expect(mapPriority("P0")).toBe("urgent");
    });

    it("should map high priorities", () => {
      expect(mapPriority("High")).toBe("high");
      expect(mapPriority("P1")).toBe("high");
    });

    it("should map medium priorities", () => {
      expect(mapPriority("Medium")).toBe("medium");
      expect(mapPriority("Normal")).toBe("medium");
      expect(mapPriority("P2")).toBe("medium");
    });

    it("should map low priorities", () => {
      expect(mapPriority("Low")).toBe("low");
      expect(mapPriority("P3")).toBe("low");
    });

    it("should return none for undefined or unknown", () => {
      expect(mapPriority(undefined)).toBe("none");
      expect(mapPriority("Unknown")).toBe("none");
    });
  });

  describe("priorityToNotion", () => {
    it("should convert priorities to Notion format", () => {
      expect(priorityToNotion("urgent")).toBe("Urgent");
      expect(priorityToNotion("high")).toBe("High");
      expect(priorityToNotion("medium")).toBe("Medium");
      expect(priorityToNotion("low")).toBe("Low");
      expect(priorityToNotion("none")).toBe("None");
    });
  });

  // =============================================================================
  // Type Mapping Tests
  // =============================================================================

  describe("mapTaskType", () => {
    it("should map bug types", () => {
      expect(Option.getOrNull(mapTaskType("Bug"))).toBe("bug");
      expect(Option.getOrNull(mapTaskType("Defect"))).toBe("bug");
    });

    it("should map feature types", () => {
      expect(Option.getOrNull(mapTaskType("Feature"))).toBe("feature");
      expect(Option.getOrNull(mapTaskType("Enhancement"))).toBe("feature");
    });

    it("should map other types", () => {
      expect(Option.getOrNull(mapTaskType("Epic"))).toBe("epic");
      expect(Option.getOrNull(mapTaskType("Chore"))).toBe("chore");
      expect(Option.getOrNull(mapTaskType("Task"))).toBe("task");
    });

    it("should return None for unknown types", () => {
      expect(Option.isNone(mapTaskType(undefined))).toBe(true);
      expect(Option.isNone(mapTaskType("Random"))).toBe(true);
    });
  });

  // =============================================================================
  // Page to Task Mapping Tests
  // =============================================================================

  describe("mapPageToTask", () => {
    it("should map a complete page to task", () => {
      const page = createMockPage({
        Name: createTitleProperty("Fix login bug"),
        Description: createRichTextProperty("Users cannot log in"),
        Status: createStatusProperty("In Progress"),
        Priority: createSelectProperty("High"),
        Type: createSelectProperty("Bug"),
        Labels: createMultiSelectProperty(["auth", "urgent"]),
        "Blocked By": createRelationProperty(["blocker-1"]),
      });

      const task = mapPageToTask(page, defaultConfig);

      expect(task.title).toBe("Fix login bug");
      expect(Option.getOrNull(task.description)).toBe("Users cannot log in");
      expect(task.state.name).toBe("In Progress");
      expect(task.state.type).toBe("started");
      expect(task.priority).toBe("high");
      expect(Option.getOrNull(task.type)).toBe("bug");
      expect(task.labels).toEqual(["auth", "urgent"]);
      expect(task.blockedBy).toEqual(["blocker-1"]);
      expect(task.url).toBe("https://notion.so/page-123");
    });

    it("should handle missing optional properties", () => {
      const page = createMockPage({
        Name: createTitleProperty("Simple task"),
      });

      const task = mapPageToTask(page, defaultConfig);

      expect(task.title).toBe("Simple task");
      expect(Option.isNone(task.description)).toBe(true);
      expect(task.state.type).toBe("unstarted");
      expect(task.priority).toBe("none");
      expect(Option.isNone(task.type)).toBe(true);
      expect(task.labels).toEqual([]);
      expect(task.blockedBy).toEqual([]);
    });

    it("should generate identifier from page ID when no ID property", () => {
      const page = createMockPage(
        { Name: createTitleProperty("Task") },
        { id: "abcd1234-5678-90ab-cdef-1234567890ab" },
      );

      const task = mapPageToTask(page, defaultConfig);

      expect(task.identifier).toBe("N-abcd1234");
    });

    it("should use custom property mapping", () => {
      const customMapping = {
        title: "Task Name",
        status: "State",
        priority: "Urgency",
        description: "Details",
        labels: "Tags",
        blockedBy: "Dependencies",
        type: "Category",
        identifier: "Task ID",
        parent: "Parent Task",
      } as unknown as NotionPropertyMapping;

      const page = createMockPage({
        "Task Name": createTitleProperty("Custom task"),
        State: createStatusProperty("Done"),
        Urgency: createSelectProperty("Low"),
      });

      const task = mapPageToTask(page, {
        ...defaultConfig,
        propertyMapping: customMapping,
      });

      expect(task.title).toBe("Custom task");
      expect(task.state.name).toBe("Done");
      expect(task.priority).toBe("low");
    });
  });

  // =============================================================================
  // Build Properties Tests
  // =============================================================================

  describe("buildCreateProperties", () => {
    it("should build properties for creating a task", () => {
      const properties = buildCreateProperties(
        {
          title: "New Task",
          description: "Task description",
          priority: "high",
          labels: ["frontend"],
        },
        DEFAULT_PROPERTY_MAPPING as unknown as NotionPropertyMapping,
      );

      expect(properties).toHaveProperty("Name");
      expect(properties).toHaveProperty("Description");
      expect(properties).toHaveProperty("Priority");
      expect(properties).toHaveProperty("Labels");
    });

    it("should only include provided fields", () => {
      const properties = buildCreateProperties(
        { title: "Minimal Task" },
        DEFAULT_PROPERTY_MAPPING as unknown as NotionPropertyMapping,
      );

      expect(properties).toHaveProperty("Name");
      expect(properties).not.toHaveProperty("Description");
      expect(properties).not.toHaveProperty("Priority");
    });
  });

  describe("buildUpdateProperties", () => {
    it("should build properties for updating a task", () => {
      const properties = buildUpdateProperties(
        {
          title: "Updated Title",
          status: "Done",
        },
        DEFAULT_PROPERTY_MAPPING as unknown as NotionPropertyMapping,
      );

      expect(properties).toHaveProperty("Name");
      expect(properties).toHaveProperty("Status");
      expect(properties).not.toHaveProperty("Priority");
    });

    it("should handle empty update", () => {
      const properties = buildUpdateProperties(
        {},
        DEFAULT_PROPERTY_MAPPING as unknown as NotionPropertyMapping,
      );

      expect(Object.keys(properties)).toHaveLength(0);
    });
  });
});
