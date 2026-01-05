/**
 * Notion adapter exports.
 * Provides integration with the Notion API for task management.
 */

export {
  // Service
  NotionClientService,
  NotionClientLive,
  // Utilities
  withNotionClient,
  mapNotionError,
  notionRetryPolicy,
  // Constants
  NOTION_DEFAULT_TIMEOUT,
} from "./NotionClient.js";

export {
  // Mapping functions
  mapPageToTask,
  mapPagesToTasks,
  // Property extraction
  extractTitle,
  extractText,
  extractStatus,
  extractSelect,
  extractMultiSelect,
  extractRelation,
  extractDate,
  extractRichText,
  // Status/Priority mapping
  mapStatusToStateType,
  mapStatusToWorkflowState,
  mapPriority,
  priorityToNotion,
  mapTaskType,
  // Build properties for create/update
  buildCreateProperties,
  buildUpdateProperties,
  // Constants
  DEFAULT_PROPERTY_MAPPING,
  // Types
  type MapPageToTaskConfig,
} from "./NotionMapper.js";

export {
  // IssueRepository implementation for Notion
  IssueRepositoryNotion,
} from "./IssueRepositoryNotion.js";

export {
  // TeamRepository implementation for Notion
  TeamRepositoryNotion,
  // Constants
  NOTION_TEAM_ID,
  NOTION_TEAM_KEY,
} from "./TeamRepositoryNotion.js";

export {
  // ProjectRepository implementation for Notion
  ProjectRepositoryNotion,
} from "./ProjectRepositoryNotion.js";
