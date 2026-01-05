import * as Option from "effect/Option";
import type {
  PageObjectResponse,
  RichTextItemResponse,
} from "@notionhq/client/build/src/api-endpoints.js";
import {
  Task,
  TaskId,
  TeamId,
  Priority,
  WorkflowState,
  WorkflowStateType,
  type TaskType,
} from "../../../domain/Task.js";
import { NotionPropertyMapping } from "../../../domain/Config.js";

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Notion property types we handle.
 * These correspond to the Notion API property types.
 */
type NotionPropertyValue = PageObjectResponse["properties"][string];

/**
 * Default property mapping for Notion databases.
 * Uses the Schema class defaults defined in NotionPropertyMapping.
 * Users can customize these via NotionPropertyMapping config.
 */
export const DEFAULT_PROPERTY_MAPPING: NotionPropertyMapping = new NotionPropertyMapping({});

// =============================================================================
// Property Extraction Helpers
// =============================================================================

/**
 * Get a property from a Notion page by name.
 * Returns undefined if the property doesn't exist.
 */
const getProperty = (
  page: PageObjectResponse,
  propertyName: string,
): NotionPropertyValue | undefined => {
  return page.properties[propertyName];
};

/**
 * Extract plain text from Notion rich_text array.
 */
export const extractRichText = (richText: RichTextItemResponse[]): string => {
  return richText.map((item) => item.plain_text).join("");
};

/**
 * Extract title from a Notion title property.
 */
export const extractTitle = (property: NotionPropertyValue | undefined): string => {
  if (!property || property.type !== "title") {
    return "";
  }
  return extractRichText(property.title);
};

/**
 * Extract text from a Notion rich_text property.
 */
export const extractText = (property: NotionPropertyValue | undefined): string | undefined => {
  if (!property || property.type !== "rich_text") {
    return undefined;
  }
  const text = extractRichText(property.rich_text);
  return text || undefined;
};

/**
 * Extract status name from a Notion status property.
 */
export const extractStatus = (property: NotionPropertyValue | undefined): string | undefined => {
  if (!property || property.type !== "status") {
    return undefined;
  }
  return property.status?.name;
};

/**
 * Extract select value from a Notion select property.
 */
export const extractSelect = (property: NotionPropertyValue | undefined): string | undefined => {
  if (!property || property.type !== "select") {
    return undefined;
  }
  return property.select?.name;
};

/**
 * Extract multi-select values from a Notion multi_select property.
 */
export const extractMultiSelect = (property: NotionPropertyValue | undefined): string[] => {
  if (!property || property.type !== "multi_select") {
    return [];
  }
  return property.multi_select.map((item) => item.name);
};

/**
 * Extract relation IDs from a Notion relation property.
 */
export const extractRelation = (property: NotionPropertyValue | undefined): string[] => {
  if (!property || property.type !== "relation") {
    return [];
  }
  return property.relation.map((item) => item.id);
};

/**
 * Extract date from a Notion date property.
 */
export const extractDate = (property: NotionPropertyValue | undefined): Date | undefined => {
  if (!property || property.type !== "date" || !property.date) {
    return undefined;
  }
  return new Date(property.date.start);
};

/**
 * Extract formula result (string, number, boolean, or date).
 */
export const extractFormula = (property: NotionPropertyValue | undefined): string | undefined => {
  if (!property || property.type !== "formula") {
    return undefined;
  }
  const formula = property.formula;
  switch (formula.type) {
    case "string":
      return formula.string ?? undefined;
    case "number":
      return formula.number?.toString();
    case "boolean":
      return formula.boolean?.toString();
    case "date":
      return formula.date?.start;
    default:
      return undefined;
  }
};

/**
 * Extract unique ID (auto-increment ID in Notion).
 */
export const extractUniqueId = (property: NotionPropertyValue | undefined): string | undefined => {
  if (!property || property.type !== "unique_id") {
    return undefined;
  }
  const prefix = property.unique_id.prefix ?? "";
  const number = property.unique_id.number;
  return number !== null ? `${prefix}${number}` : undefined;
};

// =============================================================================
// Status Mapping
// =============================================================================

/**
 * Map Notion status to our WorkflowStateType.
 * Handles common status naming conventions.
 */
export const mapStatusToStateType = (status: string | undefined): WorkflowStateType => {
  if (!status) return "unstarted";

  const normalized = status.toLowerCase().trim();

  // Backlog states
  if (
    normalized.includes("backlog") ||
    normalized.includes("icebox") ||
    normalized.includes("later")
  ) {
    return "backlog";
  }

  // Completed states
  if (
    normalized.includes("done") ||
    normalized.includes("complete") ||
    normalized.includes("shipped") ||
    normalized.includes("released") ||
    normalized.includes("resolved")
  ) {
    return "completed";
  }

  // Canceled states
  if (
    normalized.includes("cancel") ||
    normalized.includes("won't") ||
    normalized.includes("wont") ||
    normalized.includes("duplicate") ||
    normalized.includes("archived")
  ) {
    return "canceled";
  }

  // Started/In Progress states
  if (
    normalized.includes("progress") ||
    normalized.includes("doing") ||
    normalized.includes("active") ||
    normalized.includes("review") ||
    normalized.includes("testing") ||
    normalized.includes("started")
  ) {
    return "started";
  }

  // Default to unstarted (Todo)
  return "unstarted";
};

/**
 * Create a WorkflowState from Notion status.
 */
export const mapStatusToWorkflowState = (status: string | undefined): WorkflowState => {
  return new WorkflowState({
    id: status ?? "unknown",
    name: status ?? "Unknown",
    type: mapStatusToStateType(status),
  });
};

// =============================================================================
// Priority Mapping
// =============================================================================

/**
 * Map Notion priority select value to our Priority enum.
 * Handles common priority naming conventions.
 */
export const mapPriority = (priority: string | undefined): Priority => {
  if (!priority) return "none";

  const normalized = priority.toLowerCase().trim();

  if (normalized.includes("urgent") || normalized.includes("critical") || normalized === "p0") {
    return "urgent";
  }
  if (normalized.includes("high") || normalized === "p1") {
    return "high";
  }
  if (normalized.includes("medium") || normalized.includes("normal") || normalized === "p2") {
    return "medium";
  }
  if (normalized.includes("low") || normalized === "p3" || normalized === "p4") {
    return "low";
  }

  return "none";
};

/**
 * Map our Priority to common Notion priority names.
 * Used when creating/updating tasks.
 */
export const priorityToNotion = (priority: Priority): string => {
  switch (priority) {
    case "urgent":
      return "Urgent";
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    case "none":
      return "None";
  }
};

// =============================================================================
// Type Mapping
// =============================================================================

/**
 * Map Notion type select value to our TaskType enum.
 */
export const mapTaskType = (type: string | undefined): Option.Option<TaskType> => {
  if (!type) return Option.none();

  const normalized = type.toLowerCase().trim();

  if (normalized.includes("bug") || normalized.includes("defect")) {
    return Option.some("bug");
  }
  if (normalized.includes("feature") || normalized.includes("enhancement")) {
    return Option.some("feature");
  }
  if (normalized.includes("epic")) {
    return Option.some("epic");
  }
  if (normalized.includes("chore") || normalized.includes("maintenance")) {
    return Option.some("chore");
  }
  if (normalized.includes("task")) {
    return Option.some("task");
  }

  return Option.none();
};

// =============================================================================
// Page to Task Mapping
// =============================================================================

/**
 * Configuration for mapping a Notion page to a Task.
 */
export interface MapPageToTaskConfig {
  /** Property name mapping */
  propertyMapping: NotionPropertyMapping;
  /** Team ID to assign (Notion doesn't have teams concept) */
  teamId: TeamId;
  /** Database ID (used for generating URL) */
  databaseId: string;
}

/**
 * Generate a task identifier from a Notion page.
 * Uses the unique_id property if available, otherwise generates from page ID.
 */
export const generateIdentifier = (
  page: PageObjectResponse,
  propertyMapping: NotionPropertyMapping,
): string => {
  // Try to get identifier from configured property
  const idProperty = getProperty(page, propertyMapping.identifier);

  // Check various property types that could hold an ID
  const uniqueId = extractUniqueId(idProperty);
  if (uniqueId) return uniqueId;

  const formulaId = extractFormula(idProperty);
  if (formulaId) return formulaId;

  const textId = extractText(idProperty);
  if (textId) return textId;

  // Fall back to shortened page ID
  return `N-${page.id.slice(0, 8)}`;
};

/**
 * Map a Notion page to our Task domain model.
 *
 * @param page - The Notion page object
 * @param config - Mapping configuration
 * @returns The mapped Task
 */
export const mapPageToTask = (page: PageObjectResponse, config: MapPageToTaskConfig): Task => {
  const { propertyMapping, teamId, databaseId } = config;

  // Extract properties using configured names
  const title = extractTitle(getProperty(page, propertyMapping.title));
  const description = extractText(getProperty(page, propertyMapping.description));
  const status = extractStatus(getProperty(page, propertyMapping.status));
  const priority = extractSelect(getProperty(page, propertyMapping.priority));
  const type = extractSelect(getProperty(page, propertyMapping.type));
  const labels = extractMultiSelect(getProperty(page, propertyMapping.labels));
  const blockedByIds = extractRelation(getProperty(page, propertyMapping.blockedBy));
  // Parent relation - reserved for future subtask support
  // const parentIds = extractRelation(getProperty(page, propertyMapping.parent));

  // Generate identifier
  const identifier = generateIdentifier(page, propertyMapping);

  // Generate URL
  const url = page.url || `https://notion.so/${page.id.replace(/-/g, "")}`;

  return new Task({
    id: page.id as TaskId,
    identifier,
    title: title || "Untitled",
    description: description ? Option.some(description) : Option.none(),
    state: mapStatusToWorkflowState(status),
    priority: mapPriority(priority),
    type: mapTaskType(type),
    teamId,
    projectId: Option.some(databaseId as any), // Use database ID as project
    milestoneId: Option.none(), // Notion doesn't have milestones concept
    milestoneName: Option.none(),
    branchName: Option.none(), // Could be extracted from a custom property
    url,
    labels,
    blockedBy: blockedByIds as TaskId[],
    blocks: [], // Would need reverse lookup
    subtasks: [], // Would need separate query for child pages
    createdAt: new Date(page.created_time),
    updatedAt: new Date(page.last_edited_time),
  });
};

/**
 * Map multiple Notion pages to Tasks.
 */
export const mapPagesToTasks = (
  pages: PageObjectResponse[],
  config: MapPageToTaskConfig,
): Task[] => {
  return pages.map((page) => mapPageToTask(page, config));
};

// =============================================================================
// Task to Page Properties Mapping (for create/update)
// =============================================================================

/**
 * Build Notion properties object for creating a task.
 * Uses the property mapping to set the correct property names.
 */
export const buildCreateProperties = (
  input: {
    title: string;
    description?: string;
    priority?: Priority;
    type?: string;
    labels?: string[];
  },
  propertyMapping: NotionPropertyMapping,
): Record<string, unknown> => {
  const properties: Record<string, unknown> = {
    [propertyMapping.title]: {
      title: [{ text: { content: input.title } }],
    },
  };

  if (input.description) {
    properties[propertyMapping.description] = {
      rich_text: [{ text: { content: input.description } }],
    };
  }

  if (input.priority) {
    properties[propertyMapping.priority] = {
      select: { name: priorityToNotion(input.priority) },
    };
  }

  if (input.type) {
    properties[propertyMapping.type] = {
      select: { name: input.type },
    };
  }

  if (input.labels && input.labels.length > 0) {
    properties[propertyMapping.labels] = {
      multi_select: input.labels.map((name) => ({ name })),
    };
  }

  return properties;
};

/**
 * Build Notion properties object for updating a task.
 * Only includes properties that are being changed.
 */
export const buildUpdateProperties = (
  input: {
    title?: string;
    description?: string;
    status?: string;
    priority?: Priority;
    labels?: string[];
  },
  propertyMapping: NotionPropertyMapping,
): Record<string, unknown> => {
  const properties: Record<string, unknown> = {};

  if (input.title !== undefined) {
    properties[propertyMapping.title] = {
      title: [{ text: { content: input.title } }],
    };
  }

  if (input.description !== undefined) {
    properties[propertyMapping.description] = {
      rich_text: [{ text: { content: input.description } }],
    };
  }

  if (input.status !== undefined) {
    properties[propertyMapping.status] = {
      status: { name: input.status },
    };
  }

  if (input.priority !== undefined) {
    properties[propertyMapping.priority] = {
      select: { name: priorityToNotion(input.priority) },
    };
  }

  if (input.labels !== undefined) {
    properties[propertyMapping.labels] = {
      multi_select: input.labels.map((name) => ({ name })),
    };
  }

  return properties;
};
