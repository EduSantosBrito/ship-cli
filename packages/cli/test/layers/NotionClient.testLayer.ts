/**
 * Test Layer for NotionClient
 *
 * Provides a mock NotionClient implementation for testing that:
 * - Uses configurable mock responses
 * - Supports simulating API errors
 * - Tracks method calls for assertions
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Client as NotionSDK } from "@notionhq/client";
import type {
  PageObjectResponse,
  GetSelfResponse,
  SearchResponse,
  QueryDataSourceResponse,
  DataSourceObjectResponse,
} from "@notionhq/client/build/src/api-endpoints.js";
import { NotionClientService } from "../../src/adapters/driven/notion/NotionClient.js";
import { NotionApiError } from "../../src/domain/Errors.js";

// =============================================================================
// Test State Types
// =============================================================================

export interface MockNotionResponses {
  /** Pages keyed by ID */
  pages: Map<string, PageObjectResponse>;
  /** Data source query responses keyed by database ID */
  queryResponses: Map<string, QueryDataSourceResponse>;
  /** Search responses */
  searchResponse: SearchResponse;
  /** User/bot self response */
  selfResponse: GetSelfResponse;
  /** Simulated errors by operation type */
  errors: {
    retrieve?: NotionApiError;
    query?: NotionApiError;
    create?: NotionApiError;
    update?: NotionApiError;
    search?: NotionApiError;
    self?: NotionApiError;
  };
}

export interface TestNotionClientState {
  responses: MockNotionResponses;
  methodCalls: Array<{ method: string; args: unknown[] }>;
}

// =============================================================================
// Default Fixtures
// =============================================================================

export const createRichText = (text: string) => [
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

export const createTitleProperty = (text: string) => ({
  type: "title" as const,
  title: createRichText(text),
  id: "title",
});

export const createRichTextProperty = (text: string) => ({
  type: "rich_text" as const,
  rich_text: createRichText(text),
  id: "rich_text",
});

export const createStatusProperty = (name: string) => ({
  type: "status" as const,
  status: { id: "status-id", name, color: "default" as const },
  id: "status",
});

export const createSelectProperty = (name: string) => ({
  type: "select" as const,
  select: { id: "select-id", name, color: "default" as const },
  id: "select",
});

export const createMultiSelectProperty = (names: string[]) => ({
  type: "multi_select" as const,
  multi_select: names.map((name) => ({ id: `ms-${name}`, name, color: "default" as const })),
  id: "multi_select",
});

export const createRelationProperty = (ids: string[]) => ({
  type: "relation" as const,
  relation: ids.map((id) => ({ id })),
  has_more: false,
  id: "relation",
});

export const createMockPage = (
  id: string,
  properties: Record<string, unknown>,
  overrides: Partial<PageObjectResponse> = {},
): PageObjectResponse =>
  ({
    object: "page",
    id,
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
    url: `https://notion.so/${id}`,
    public_url: null,
    ...overrides,
  }) as PageObjectResponse;

export const createMockDataSource = (
  id: string,
  title: string,
): DataSourceObjectResponse =>
  ({
    object: "data_source",
    id,
    title: createRichText(title),
    description: [],
    parent: { type: "database_id", database_id: "parent-db-123" },
    database_parent: { type: "database_id", database_id: "parent-db-123" },
    is_inline: false,
    archived: false,
    in_trash: false,
    created_time: "2024-01-01T00:00:00.000Z",
    last_edited_time: "2024-01-02T00:00:00.000Z",
    created_by: { object: "user", id: "user-1" },
    last_edited_by: { object: "user", id: "user-1" },
    properties: {},
    icon: null,
    cover: null,
    url: `https://notion.so/${id}`,
    public_url: null,
  }) as DataSourceObjectResponse;

export const createBotUserResponse = (
  name: string | null = "Test Bot",
  workspaceName: string | null = "Test Workspace",
): GetSelfResponse =>
  ({
    object: "user",
    id: "bot-user-id",
    type: "bot",
    name,
    avatar_url: null,
    bot: {
      owner: {
        type: "workspace",
        workspace: true,
      },
      workspace_id: "workspace-123",
      workspace_name: workspaceName,
      workspace_limits: {
        max_file_upload_size_in_bytes: 5000000,
      },
    },
  }) as GetSelfResponse;

export const createQueryResponse = (
  pages: PageObjectResponse[],
): QueryDataSourceResponse => ({
  type: "page_or_data_source",
  page_or_data_source: {},
  object: "list",
  next_cursor: null,
  has_more: false,
  results: pages,
});

export const createSearchResponse = (
  results: DataSourceObjectResponse[],
): SearchResponse => ({
  type: "page_or_data_source",
  page_or_data_source: {},
  object: "list",
  next_cursor: null,
  has_more: false,
  results,
});

// Default test page
export const defaultTestPage = createMockPage("page-123", {
  Name: createTitleProperty("Test Task"),
  Description: createRichTextProperty("Test description"),
  Status: createStatusProperty("To Do"),
  Priority: createSelectProperty("Medium"),
  Type: createSelectProperty("Task"),
  Labels: createMultiSelectProperty(["test"]),
  "Blocked By": createRelationProperty([]),
});

export const defaultTestResponses: MockNotionResponses = {
  pages: new Map([["page-123", defaultTestPage]]),
  queryResponses: new Map([
    ["db-123", createQueryResponse([defaultTestPage])],
  ]),
  searchResponse: createSearchResponse([createMockDataSource("db-123", "Test Database")]),
  selfResponse: createBotUserResponse(),
  errors: {},
};

export const defaultTestNotionClientState: TestNotionClientState = {
  responses: defaultTestResponses,
  methodCalls: [],
};

// =============================================================================
// Test Layer Factory
// =============================================================================

/**
 * Creates a test NotionClient layer with configurable mock responses.
 *
 * @example
 * ```typescript
 * it.effect("gets a task", () =>
 *   Effect.gen(function* () {
 *     const client = yield* NotionClientService;
 *     const sdk = yield* client.client();
 *     const page = await sdk.pages.retrieve({ page_id: "page-123" });
 *     expect(page.id).toBe("page-123");
 *   }).pipe(Effect.provide(TestNotionClientLayer()))
 * );
 * ```
 */
export const TestNotionClientLayer = (
  config?: Partial<MockNotionResponses>,
): Layer.Layer<NotionClientService> => {
  const responses: MockNotionResponses = {
    ...defaultTestResponses,
    ...config,
    pages: config?.pages ?? new Map(defaultTestResponses.pages),
    queryResponses: config?.queryResponses ?? new Map(defaultTestResponses.queryResponses),
    errors: { ...defaultTestResponses.errors, ...config?.errors },
  };

  const methodCalls: Array<{ method: string; args: unknown[] }> = [];

  // Create mock SDK
  const mockSDK = {
    pages: {
      retrieve: async ({ page_id }: { page_id: string }) => {
        methodCalls.push({ method: "pages.retrieve", args: [page_id] });

        if (responses.errors.retrieve) {
          const error = new Error(responses.errors.retrieve.message) as Error & { status: number };
          error.status = responses.errors.retrieve.statusCode ?? 500;
          throw error;
        }

        const page = responses.pages.get(page_id);
        if (!page) {
          const error = new Error("Page not found") as Error & { status: number };
          error.status = 404;
          throw error;
        }
        return page;
      },
      create: async (params: { parent: { database_id: string }; properties: unknown }) => {
        methodCalls.push({ method: "pages.create", args: [params] });

        if (responses.errors.create) {
          throw new Error(responses.errors.create.message);
        }

        const newId = `page-${Date.now()}`;
        const newPage = createMockPage(newId, params.properties as Record<string, unknown>);
        responses.pages.set(newId, newPage);
        return newPage;
      },
      update: async (params: { page_id: string; properties: unknown }) => {
        methodCalls.push({ method: "pages.update", args: [params] });

        if (responses.errors.update) {
          const error = new Error(responses.errors.update.message) as Error & { status: number };
          error.status = responses.errors.update.statusCode ?? 500;
          throw error;
        }

        const page = responses.pages.get(params.page_id);
        if (!page) {
          const error = new Error("Page not found") as Error & { status: number };
          error.status = 404;
          throw error;
        }

        // Merge properties
        const updatedPage = {
          ...page,
          properties: { ...page.properties, ...(params.properties as Record<string, unknown>) },
          last_edited_time: new Date().toISOString(),
        } as PageObjectResponse;

        responses.pages.set(params.page_id, updatedPage);
        return updatedPage;
      },
    },
    dataSources: {
      query: async (params: { data_source_id: string; filter?: unknown; page_size?: number }) => {
        methodCalls.push({ method: "dataSources.query", args: [params] });

        if (responses.errors.query) {
          throw new Error(responses.errors.query.message);
        }

        const response = responses.queryResponses.get(params.data_source_id);
        if (response) {
          return response;
        }

        // Return all pages as default
        return createQueryResponse(Array.from(responses.pages.values()));
      },
    },
    search: async (params: unknown) => {
      methodCalls.push({ method: "search", args: [params] });

      if (responses.errors.search) {
        throw new Error(responses.errors.search.message);
      }

      return responses.searchResponse;
    },
    users: {
      me: async () => {
        methodCalls.push({ method: "users.me", args: [] });

        if (responses.errors.self) {
          throw new Error(responses.errors.self.message);
        }

        return responses.selfResponse;
      },
    },
  } as unknown as NotionSDK;

  return Layer.succeed(NotionClientService, {
    client: () => Effect.succeed(mockSDK),
  });
};

// Export types
export type { NotionSDK };
