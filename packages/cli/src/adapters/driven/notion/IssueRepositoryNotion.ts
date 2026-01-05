import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { Client as NotionSDK } from "@notionhq/client";
import type {
  PageObjectResponse,
  QueryDataSourceParameters,
  QueryDataSourceResponse,
  CreatePageParameters,
  UpdatePageParameters,
} from "@notionhq/client/build/src/api-endpoints.js";
import { IssueRepository } from "../../../ports/IssueRepository.js";
import { ConfigRepository } from "../../../ports/ConfigRepository.js";
import { NotionClientService } from "./NotionClient.js";
import {
  mapPageToTask,
  mapStatusToStateType,
  extractRelation,
  extractMultiSelect,
  priorityToNotion,
  type MapPageToTaskConfig,
} from "./NotionMapper.js";
import {
  Task,
  TaskId,
  TeamId,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  type ProjectId,
  type TaskType,
} from "../../../domain/Task.js";
import { NotionApiError, TaskError, TaskNotFoundError } from "../../../domain/Errors.js";
import type { NotionConfig, NotionPropertyMapping } from "../../../domain/Config.js";

// =============================================================================
// Constants
// =============================================================================

const SESSION_LABEL_PREFIX = "session:";
const TYPE_LABEL_PREFIX = "type:";

// =============================================================================
// Property Value Types (matching Notion SDK types)
// =============================================================================

type PageProperties = NonNullable<CreatePageParameters["properties"]>;
type PropertyValue = PageProperties[string];

// Type-safe property value constructors
const titleProperty = (content: string): PropertyValue => ({
  title: [{ text: { content } }],
});

const richTextProperty = (content: string): PropertyValue => ({
  rich_text: [{ text: { content } }],
});

const selectProperty = (name: string): PropertyValue => ({
  select: { name },
});

const multiSelectProperty = (names: string[]): PropertyValue => ({
  multi_select: names.map((name) => ({ name })),
});

const statusProperty = (name: string): PropertyValue => ({
  status: { name },
});

const relationProperty = (ids: string[]): PropertyValue => ({
  relation: ids.map((id) => ({ id })),
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Type guard for PageObjectResponse.
 * Validates that a response from the Notion API is a full page object.
 */
const isPageObjectResponse = (page: unknown): page is PageObjectResponse =>
  page !== null &&
  typeof page === "object" &&
  "object" in page &&
  (page as { object: string }).object === "page" &&
  "properties" in page;

/**
 * Extract status code from various error types.
 * Notion SDK throws errors with a `status` property.
 */
const extractStatusCode = (error: unknown): number | undefined => {
  if (error && typeof error === "object") {
    // Notion SDK APIResponseError has `status` property
    if ("status" in error && typeof error.status === "number") {
      return error.status;
    }
    // Some errors may have statusCode
    if ("statusCode" in error && typeof error.statusCode === "number") {
      return error.statusCode;
    }
  }
  return undefined;
};

/**
 * Create a NotionApiError from a caught error, preserving the status code.
 */
const toNotionApiError = (message: string, cause: unknown): NotionApiError => {
  const statusCode = extractStatusCode(cause);
  return statusCode !== undefined
    ? new NotionApiError({ message, statusCode, cause })
    : new NotionApiError({ message, cause });
};

/**
 * Get the Notion config from the repository.
 */
const getNotionConfig = (
  configRepo: ConfigRepository,
): Effect.Effect<NotionConfig, NotionApiError> =>
  Effect.gen(function* () {
    const config = yield* configRepo.load().pipe(
      Effect.mapError(
        (e) => new NotionApiError({ message: `Failed to load config: ${e.message}`, cause: e }),
      ),
    );

    if (Option.isNone(config.notion)) {
      return yield* Effect.fail(
        new NotionApiError({ message: "Notion configuration not found. Run 'ship init' to configure." }),
      );
    }

    return Option.getOrThrow(config.notion);
  });

/**
 * Create the mapping config from Notion config.
 */
const createMapConfig = (
  notionConfig: NotionConfig,
  teamId: TeamId,
): MapPageToTaskConfig => ({
  propertyMapping: notionConfig.propertyMapping,
  teamId,
  databaseId: notionConfig.databaseId,
});

/**
 * Check if a task is blocked by checking its blockedBy relation.
 */
const isPageBlocked = (
  page: PageObjectResponse,
  propertyMapping: NotionPropertyMapping,
  allPages: PageObjectResponse[],
): boolean => {
  const blockedByIds = extractRelation(page.properties[propertyMapping.blockedBy]);
  if (blockedByIds.length === 0) return false;

  // Check if any blocker is incomplete
  for (const blockerId of blockedByIds) {
    const blockerPage = allPages.find((p) => p.id === blockerId);
    if (blockerPage) {
      const status = blockerPage.properties[propertyMapping.status];
      if (status && status.type === "status" && status.status) {
        const stateType = mapStatusToStateType(status.status.name);
        if (stateType !== "completed" && stateType !== "canceled") {
          return true; // Found an incomplete blocker
        }
      }
    }
  }

  return false;
};

/**
 * Handle Notion API errors with proper type narrowing for 404s.
 */
const handleNotFoundError = (
  taskId: string,
) => (e: NotionApiError): Effect.Effect<never, TaskNotFoundError | NotionApiError> => {
  if (e.statusCode === 404) {
    return Effect.fail(new TaskNotFoundError({ taskId }));
  }
  return Effect.fail(e);
};

/**
 * Query the Notion data source (database) with filters.
 * In SDK v5.6.0+, databases are now called "data sources".
 */
const queryDataSource = (
  client: NotionSDK,
  databaseId: string,
  filter?: QueryDataSourceParameters["filter"],
  pageSize = 100,
): Effect.Effect<QueryDataSourceResponse, NotionApiError> =>
  Effect.tryPromise({
    try: () => {
      const params: QueryDataSourceParameters = {
        data_source_id: databaseId,
        page_size: pageSize,
      };
      if (filter !== undefined) {
        params.filter = filter;
      }
      return client.dataSources.query(params);
    },
    catch: (e) => toNotionApiError(`Failed to query database: ${e}`, e),
  });

/**
 * Extract pages from a query response.
 */
const extractPages = (response: QueryDataSourceResponse): PageObjectResponse[] =>
  response.results.filter(
    (r): r is PageObjectResponse => "properties" in r && r.object === "page",
  );

// =============================================================================
// Implementation
// =============================================================================

const make = Effect.gen(function* () {
  // Yield dependencies at the top - this ensures the layer has the right requirements
  const configRepo = yield* ConfigRepository;
  const notionClientService = yield* NotionClientService;

  // Helper to get client
  const getClient = () => notionClientService.client();

  // Notion doesn't have teams, so we use a constant
  const teamId = "notion" as TeamId;

  const getTask = (id: TaskId): Effect.Effect<Task, TaskNotFoundError | NotionApiError> =>
    Effect.gen(function* () {
      const notionConfig = yield* getNotionConfig(configRepo);
      const client = yield* getClient();

      const page = yield* Effect.tryPromise({
        try: () => client.pages.retrieve({ page_id: id }),
        catch: (e) => toNotionApiError(`Failed to fetch page: ${e}`, e),
      }).pipe(Effect.catchAll(handleNotFoundError(id)));

      if (!isPageObjectResponse(page)) {
        return yield* Effect.fail(new TaskNotFoundError({ taskId: id }));
      }

      return mapPageToTask(page, createMapConfig(notionConfig, teamId));
    });

  const getTaskByIdentifier = (
    identifier: string,
  ): Effect.Effect<Task, TaskNotFoundError | NotionApiError> =>
    Effect.gen(function* () {
      const notionConfig = yield* getNotionConfig(configRepo);
      const { propertyMapping, databaseId } = notionConfig;
      const client = yield* getClient();

      // Search by identifier property or title
      const response = yield* queryDataSource(client, databaseId, {
        or: [
          // Try to match by ID property (if it's a rich_text)
          {
            property: propertyMapping.identifier,
            rich_text: { equals: identifier },
          },
          // Try to match by title
          {
            property: propertyMapping.title,
            title: { equals: identifier },
          },
        ],
      }, 1);

      const pages = extractPages(response);
      const page = pages[0];
      if (!page) {
        return yield* Effect.fail(new TaskNotFoundError({ taskId: identifier }));
      }

      return mapPageToTask(page, createMapConfig(notionConfig, teamId));
    });

  const createTask = (
    _teamId: TeamId, // Ignored for Notion
    input: CreateTaskInput,
  ): Effect.Effect<Task, TaskError | NotionApiError> =>
    Effect.gen(function* () {
      const notionConfig = yield* getNotionConfig(configRepo);
      const { propertyMapping, databaseId } = notionConfig;
      const client = yield* getClient();

      // Build properties for creation using type-safe constructors
      const properties: PageProperties = {
        [propertyMapping.title]: titleProperty(input.title),
        [propertyMapping.priority]: selectProperty(priorityToNotion(input.priority)),
        [propertyMapping.labels]: multiSelectProperty([`${TYPE_LABEL_PREFIX}${input.type}`]),
      };

      if (Option.isSome(input.description)) {
        properties[propertyMapping.description] = richTextProperty(input.description.value);
      }

      const page = yield* Effect.tryPromise({
        try: () =>
          client.pages.create({
            parent: { database_id: databaseId },
            properties,
          }),
        catch: (e) => toNotionApiError(`Failed to create page: ${e}`, e),
      }).pipe(
        Effect.mapError((e) => new TaskError({ message: `Failed to create task: ${e.message}`, cause: e })),
      );

      if (!isPageObjectResponse(page)) {
        return yield* Effect.fail(new TaskError({ message: "Failed to create task: unexpected response" }));
      }

      return mapPageToTask(page, createMapConfig(notionConfig, teamId));
    });

  const updateTask = (
    id: TaskId,
    input: UpdateTaskInput,
  ): Effect.Effect<Task, TaskNotFoundError | TaskError | NotionApiError> =>
    Effect.gen(function* () {
      const notionConfig = yield* getNotionConfig(configRepo);
      const { propertyMapping } = notionConfig;
      const client = yield* getClient();

      // Build update properties using type-safe constructors
      const updateProps: NonNullable<UpdatePageParameters["properties"]> = {};

      if (Option.isSome(input.title)) {
        updateProps[propertyMapping.title] = titleProperty(input.title.value);
      }

      if (Option.isSome(input.description)) {
        updateProps[propertyMapping.description] = richTextProperty(input.description.value);
      }

      if (Option.isSome(input.status)) {
        // Map our status to a Notion status name
        const statusMap: Record<string, string> = {
          backlog: "Backlog",
          todo: "To Do",
          in_progress: "In Progress",
          in_review: "In Review",
          done: "Done",
          cancelled: "Cancelled",
        };
        updateProps[propertyMapping.status] = statusProperty(
          statusMap[input.status.value] ?? input.status.value,
        );
      }

      if (Option.isSome(input.priority)) {
        updateProps[propertyMapping.priority] = selectProperty(priorityToNotion(input.priority.value));
      }

      const page = yield* Effect.tryPromise({
        try: () =>
          client.pages.update({
            page_id: id,
            properties: updateProps,
          }),
        catch: (e) => toNotionApiError(`Failed to update page: ${e}`, e),
      }).pipe(
        Effect.catchAll((e: NotionApiError) => {
          if (e.statusCode === 404) {
            return Effect.fail(new TaskNotFoundError({ taskId: id }) as TaskNotFoundError | TaskError | NotionApiError);
          }
          return Effect.fail(new TaskError({ message: `Failed to update task: ${e.message}`, cause: e }) as TaskNotFoundError | TaskError | NotionApiError);
        }),
      );

      if (!isPageObjectResponse(page)) {
        return yield* Effect.fail(new TaskError({ message: "Failed to update task: unexpected response" }));
      }

      return mapPageToTask(page, createMapConfig(notionConfig, teamId));
    });

  const listTasks = (
    _teamId: TeamId, // Ignored for Notion
    filter: TaskFilter,
  ): Effect.Effect<ReadonlyArray<Task>, NotionApiError> =>
    Effect.gen(function* () {
      const notionConfig = yield* getNotionConfig(configRepo);
      const { propertyMapping, databaseId } = notionConfig;
      const client = yield* getClient();

      // Build Notion filter
      type FilterCondition = {
        property: string;
        status?: { equals?: string; does_not_equal?: string };
        select?: { equals: string };
      };
      const conditions: FilterCondition[] = [];

      if (Option.isSome(filter.status)) {
        const statusMap: Record<string, string> = {
          backlog: "Backlog",
          todo: "To Do",
          in_progress: "In Progress",
          in_review: "In Review",
          done: "Done",
          cancelled: "Cancelled",
        };
        conditions.push({
          property: propertyMapping.status,
          status: { equals: statusMap[filter.status.value] ?? filter.status.value },
        });
      } else if (!filter.includeCompleted) {
        // Exclude completed/cancelled
        conditions.push({
          property: propertyMapping.status,
          status: { does_not_equal: "Done" },
        });
        conditions.push({
          property: propertyMapping.status,
          status: { does_not_equal: "Cancelled" },
        });
      }

      if (Option.isSome(filter.priority)) {
        conditions.push({
          property: propertyMapping.priority,
          select: { equals: priorityToNotion(filter.priority.value) },
        });
      }

      const queryFilter = conditions.length > 0
        ? { and: conditions as QueryDataSourceParameters["filter"] extends { and: infer T } ? T : never }
        : undefined;

      const response = yield* queryDataSource(client, databaseId, queryFilter as QueryDataSourceParameters["filter"]);
      const pages = extractPages(response);

      return pages.map((page) =>
        mapPageToTask(page, createMapConfig(notionConfig, teamId)),
      );
    });

  const getReadyTasks = (
    _teamId: TeamId,
    _projectId?: ProjectId,
  ): Effect.Effect<ReadonlyArray<Task>, NotionApiError> =>
    Effect.gen(function* () {
      const notionConfig = yield* getNotionConfig(configRepo);
      const { propertyMapping, databaseId } = notionConfig;
      const client = yield* getClient();

      // Query for non-completed tasks
      const response = yield* queryDataSource(client, databaseId, {
        and: [
          { property: propertyMapping.status, status: { does_not_equal: "Done" } },
          { property: propertyMapping.status, status: { does_not_equal: "Cancelled" } },
        ],
      });

      const pages = extractPages(response);

      // Filter out blocked tasks
      const readyPages = pages.filter(
        (page) => !isPageBlocked(page, propertyMapping, pages),
      );

      return readyPages.map((page) =>
        mapPageToTask(page, createMapConfig(notionConfig, teamId)),
      );
    });

  const getBlockedTasks = (
    _teamId: TeamId,
    _projectId?: ProjectId,
  ): Effect.Effect<ReadonlyArray<Task>, NotionApiError> =>
    Effect.gen(function* () {
      const notionConfig = yield* getNotionConfig(configRepo);
      const { propertyMapping, databaseId } = notionConfig;
      const client = yield* getClient();

      // Query for non-completed tasks
      const response = yield* queryDataSource(client, databaseId, {
        and: [
          { property: propertyMapping.status, status: { does_not_equal: "Done" } },
          { property: propertyMapping.status, status: { does_not_equal: "Cancelled" } },
        ],
      });

      const pages = extractPages(response);

      // Filter to only blocked tasks
      const blockedPages = pages.filter((page) =>
        isPageBlocked(page, propertyMapping, pages),
      );

      return blockedPages.map((page) =>
        mapPageToTask(page, createMapConfig(notionConfig, teamId)),
      );
    });

  const addBlocker = (
    blockedId: TaskId,
    blockerId: TaskId,
  ): Effect.Effect<void, TaskNotFoundError | TaskError | NotionApiError> =>
    Effect.gen(function* () {
      const notionConfig = yield* getNotionConfig(configRepo);
      const { propertyMapping } = notionConfig;
      const client = yield* getClient();

      // Get current blocked-by relations
      const page = yield* Effect.tryPromise({
        try: () => client.pages.retrieve({ page_id: blockedId }),
        catch: (e) => toNotionApiError(`Failed to fetch page: ${e}`, e),
      }).pipe(Effect.catchAll(handleNotFoundError(blockedId)));

      if (!isPageObjectResponse(page)) {
        return yield* Effect.fail(new TaskNotFoundError({ taskId: blockedId }));
      }

      const currentBlockers = extractRelation(
        (page).properties[propertyMapping.blockedBy],
      );

      // Add new blocker if not already present
      if (currentBlockers.includes(blockerId)) {
        return; // Already blocked by this task
      }

      const newBlockers = [...currentBlockers, blockerId];

      yield* Effect.tryPromise({
        try: () =>
          client.pages.update({
            page_id: blockedId,
            properties: {
              [propertyMapping.blockedBy]: relationProperty(newBlockers),
            },
          }),
        catch: (e) => toNotionApiError(`Failed to update page: ${e}`, e),
      }).pipe(
        Effect.mapError((e) => new TaskError({ message: `Failed to add blocker: ${e.message}`, cause: e })),
      );
    });

  const removeBlocker = (
    blockedId: TaskId,
    blockerId: TaskId,
  ): Effect.Effect<void, TaskNotFoundError | TaskError | NotionApiError> =>
    Effect.gen(function* () {
      const notionConfig = yield* getNotionConfig(configRepo);
      const { propertyMapping } = notionConfig;
      const client = yield* getClient();

      // Get current blocked-by relations
      const page = yield* Effect.tryPromise({
        try: () => client.pages.retrieve({ page_id: blockedId }),
        catch: (e) => toNotionApiError(`Failed to fetch page: ${e}`, e),
      }).pipe(Effect.catchAll(handleNotFoundError(blockedId)));

      if (!isPageObjectResponse(page)) {
        return yield* Effect.fail(new TaskNotFoundError({ taskId: blockedId }));
      }

      const currentBlockers = extractRelation(
        (page).properties[propertyMapping.blockedBy],
      );

      // Remove the blocker
      const newBlockers = currentBlockers.filter((id) => id !== blockerId);

      yield* Effect.tryPromise({
        try: () =>
          client.pages.update({
            page_id: blockedId,
            properties: {
              [propertyMapping.blockedBy]: relationProperty(newBlockers),
            },
          }),
        catch: (e) => toNotionApiError(`Failed to update page: ${e}`, e),
      }).pipe(
        Effect.mapError((e) => new TaskError({ message: `Failed to remove blocker: ${e.message}`, cause: e })),
      );
    });

  const addRelated = (
    _taskId: TaskId,
    _relatedTaskId: TaskId,
  ): Effect.Effect<void, TaskNotFoundError | TaskError | NotionApiError> =>
    // Notion doesn't have a native "related" concept like Linear
    // We could implement this using a custom relation property if needed
    Effect.void;

  const getBranchName = (id: TaskId): Effect.Effect<string, TaskNotFoundError | NotionApiError> =>
    Effect.gen(function* () {
      const task = yield* getTask(id);

      // Generate branch name from identifier and title
      const slug = task.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50);

      return `${task.identifier.toLowerCase()}-${slug}`;
    });

  const setSessionLabel = (
    id: TaskId,
    sessionId: string,
  ): Effect.Effect<void, TaskNotFoundError | TaskError | NotionApiError> =>
    Effect.gen(function* () {
      const notionConfig = yield* getNotionConfig(configRepo);
      const { propertyMapping } = notionConfig;
      const client = yield* getClient();

      // Get current labels
      const page = yield* Effect.tryPromise({
        try: () => client.pages.retrieve({ page_id: id }),
        catch: (e) => toNotionApiError(`Failed to fetch page: ${e}`, e),
      }).pipe(Effect.catchAll(handleNotFoundError(id)));

      if (!isPageObjectResponse(page)) {
        return yield* Effect.fail(new TaskNotFoundError({ taskId: id }));
      }

      const currentLabels = extractMultiSelect(
        (page).properties[propertyMapping.labels],
      );

      // Remove old session labels and add new one
      const nonSessionLabels = currentLabels.filter(
        (l) => !l.startsWith(SESSION_LABEL_PREFIX),
      );
      const newLabels = [...nonSessionLabels, `${SESSION_LABEL_PREFIX}${sessionId}`];

      yield* Effect.tryPromise({
        try: () =>
          client.pages.update({
            page_id: id,
            properties: {
              [propertyMapping.labels]: multiSelectProperty(newLabels),
            },
          }),
        catch: (e) => toNotionApiError(`Failed to update page: ${e}`, e),
      }).pipe(
        Effect.mapError((e) => new TaskError({ message: `Failed to set session label: ${e.message}`, cause: e })),
      );
    });

  const setTypeLabel = (
    id: TaskId,
    type: TaskType,
  ): Effect.Effect<void, TaskNotFoundError | TaskError | NotionApiError> =>
    Effect.gen(function* () {
      const notionConfig = yield* getNotionConfig(configRepo);
      const { propertyMapping } = notionConfig;
      const client = yield* getClient();

      // Get current labels
      const page = yield* Effect.tryPromise({
        try: () => client.pages.retrieve({ page_id: id }),
        catch: (e) => toNotionApiError(`Failed to fetch page: ${e}`, e),
      }).pipe(Effect.catchAll(handleNotFoundError(id)));

      if (!isPageObjectResponse(page)) {
        return yield* Effect.fail(new TaskNotFoundError({ taskId: id }));
      }

      const currentLabels = extractMultiSelect(
        (page).properties[propertyMapping.labels],
      );

      // Remove old type labels and add new one
      const nonTypeLabels = currentLabels.filter(
        (l) => !l.startsWith(TYPE_LABEL_PREFIX),
      );
      const newLabels = [...nonTypeLabels, `${TYPE_LABEL_PREFIX}${type}`];

      yield* Effect.tryPromise({
        try: () =>
          client.pages.update({
            page_id: id,
            properties: {
              [propertyMapping.labels]: multiSelectProperty(newLabels),
            },
          }),
        catch: (e) => toNotionApiError(`Failed to update page: ${e}`, e),
      }).pipe(
        Effect.mapError((e) => new TaskError({ message: `Failed to set type label: ${e.message}`, cause: e })),
      );
    });

  const clearSessionLabel = (
    id: TaskId,
  ): Effect.Effect<void, TaskNotFoundError | TaskError | NotionApiError> =>
    Effect.gen(function* () {
      const notionConfig = yield* getNotionConfig(configRepo);
      const { propertyMapping } = notionConfig;
      const client = yield* getClient();

      // Get current labels
      const page = yield* Effect.tryPromise({
        try: () => client.pages.retrieve({ page_id: id }),
        catch: (e) => toNotionApiError(`Failed to fetch page: ${e}`, e),
      }).pipe(Effect.catchAll(handleNotFoundError(id)));

      if (!isPageObjectResponse(page)) {
        return yield* Effect.fail(new TaskNotFoundError({ taskId: id }));
      }

      const currentLabels = extractMultiSelect(
        (page).properties[propertyMapping.labels],
      );

      // Remove session labels
      const nonSessionLabels = currentLabels.filter(
        (l) => !l.startsWith(SESSION_LABEL_PREFIX),
      );

      yield* Effect.tryPromise({
        try: () =>
          client.pages.update({
            page_id: id,
            properties: {
              [propertyMapping.labels]: multiSelectProperty(nonSessionLabels),
            },
          }),
        catch: (e) => toNotionApiError(`Failed to update page: ${e}`, e),
      }).pipe(
        Effect.mapError((e) => new TaskError({ message: `Failed to clear session label: ${e.message}`, cause: e })),
      );
    });

  const removeAsBlocker = (
    blockerId: TaskId,
  ): Effect.Effect<ReadonlyArray<string>, TaskNotFoundError | NotionApiError> =>
    Effect.gen(function* () {
      const notionConfig = yield* getNotionConfig(configRepo);
      const { propertyMapping, databaseId } = notionConfig;
      const client = yield* getClient();

      // Find all tasks that have this task as a blocker
      const response = yield* queryDataSource(client, databaseId, {
        property: propertyMapping.blockedBy,
        relation: { contains: blockerId },
      });

      const blockedPages = extractPages(response);
      const unblockedIdentifiers: string[] = [];

      // Remove this task as a blocker from each blocked task
      for (const page of blockedPages) {
        const currentBlockers = extractRelation(page.properties[propertyMapping.blockedBy]);
        const newBlockers = currentBlockers.filter((id) => id !== blockerId);

        yield* Effect.tryPromise({
          try: () =>
            client.pages.update({
              page_id: page.id,
              properties: {
                [propertyMapping.blockedBy]: relationProperty(newBlockers),
              },
            }),
          catch: (e) => toNotionApiError(`Failed to update page: ${e}`, e),
        }).pipe(
          Effect.tapError((e) =>
            Effect.logWarning(`Failed to remove blocker from page ${page.id}: ${e.message}`),
          ),
          Effect.ignore, // Continue even if one fails
        );

        const task = mapPageToTask(page, createMapConfig(notionConfig, teamId));
        unblockedIdentifiers.push(task.identifier);
      }

      return unblockedIdentifiers;
    });

  return {
    getTask,
    getTaskByIdentifier,
    createTask,
    updateTask,
    listTasks,
    getReadyTasks,
    getBlockedTasks,
    addBlocker,
    removeBlocker,
    addRelated,
    getBranchName,
    setSessionLabel,
    setTypeLabel,
    clearSessionLabel,
    removeAsBlocker,
  };
});

export const IssueRepositoryNotion = Layer.effect(IssueRepository, make);
