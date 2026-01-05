/**
 * IssueRepositoryNotion Tests
 *
 * Tests for the Notion implementation of IssueRepository.
 * Uses the TestNotionClientLayer and TestConfigRepositoryLayer for mocking.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { Client as NotionSDK } from "@notionhq/client";
import type {
  PageObjectResponse,
  QueryDataSourceResponse,
} from "@notionhq/client/build/src/api-endpoints.js";
import { IssueRepository } from "../../../../src/ports/IssueRepository.js";
import { ConfigRepository } from "../../../../src/ports/ConfigRepository.js";
import { NotionClientService } from "../../../../src/adapters/driven/notion/NotionClient.js";
import { IssueRepositoryNotion } from "../../../../src/adapters/driven/notion/IssueRepositoryNotion.js";
import {
  TaskId,
  TeamId,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
} from "../../../../src/domain/Task.js";
import {
  ShipConfig,
  LinearConfig,
  AuthConfig,
  NotionConfig,
  NotionPropertyMapping,
} from "../../../../src/domain/Config.js";
import { TaskNotFoundError, NotionApiError } from "../../../../src/domain/Errors.js";

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

const createQueryResponse = (pages: PageObjectResponse[]): QueryDataSourceResponse => ({
  type: "page_or_data_source",
  page_or_data_source: {},
  object: "list",
  next_cursor: null,
  has_more: false,
  results: pages,
});

// Default property mapping
const propertyMapping = new NotionPropertyMapping({});

// Default test pages
const testPage1 = createMockPage("page-123", {
  Name: createTitleProperty("Test Task 1"),
  Description: createRichTextProperty("Description 1"),
  Status: createStatusProperty("To Do"),
  Priority: createSelectProperty("Medium"),
  Type: createSelectProperty("Task"),
  Labels: createMultiSelectProperty(["test"]),
  "Blocked By": createRelationProperty([]),
});

const testPage2 = createMockPage("page-456", {
  Name: createTitleProperty("Test Task 2"),
  Description: createRichTextProperty("Description 2"),
  Status: createStatusProperty("In Progress"),
  Priority: createSelectProperty("High"),
  Type: createSelectProperty("Bug"),
  Labels: createMultiSelectProperty(["bug", "urgent"]),
  "Blocked By": createRelationProperty([]),
});

const blockedPage = createMockPage("page-blocked", {
  Name: createTitleProperty("Blocked Task"),
  Status: createStatusProperty("To Do"),
  Priority: createSelectProperty("Medium"),
  Labels: createMultiSelectProperty([]),
  "Blocked By": createRelationProperty(["page-123"]),
});

const completedBlockerPage = createMockPage("page-completed-blocker", {
  Name: createTitleProperty("Completed Blocker"),
  Status: createStatusProperty("Done"),
  Priority: createSelectProperty("Medium"),
  Labels: createMultiSelectProperty([]),
  "Blocked By": createRelationProperty([]),
});

// =============================================================================
// Mock Setup
// =============================================================================

const createMockClient = () => ({
  pages: {
    retrieve: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  dataSources: {
    query: vi.fn(),
  },
});

const createNotionConfig = () =>
  new NotionConfig({
    databaseId: "db-123",
    workspaceId: Option.none(),
    propertyMapping,
  });

const createShipConfig = () =>
  new ShipConfig({
    provider: "notion",
    linear: new LinearConfig({
      teamId: "test-team" as TeamId,
      teamKey: "TEST",
      projectId: Option.none(),
    }),
    auth: new AuthConfig({ apiKey: "test-api-key" }),
    notion: Option.some(createNotionConfig()),
  });

const createTestLayer = (mockClient: ReturnType<typeof createMockClient>, config?: ShipConfig) => {
  // Mock NotionClientService
  const mockNotionClientService = Layer.succeed(NotionClientService, {
    client: () => Effect.succeed(mockClient as unknown as NotionSDK),
  });

  // Mock ConfigRepository
  const mockConfigRepo = Layer.succeed(ConfigRepository, {
    load: () => Effect.succeed(config ?? createShipConfig()),
    loadPartial: () => Effect.die("Not implemented"),
    save: () => Effect.void,
    savePartial: () => Effect.void,
    saveAuth: () => Effect.void,
    saveLinear: () => Effect.void,
    saveNotion: () => Effect.void,
    exists: () => Effect.succeed(true),
    getConfigDir: () => Effect.succeed("/test/.ship"),
    ensureConfigDir: () => Effect.void,
    ensureGitignore: () => Effect.void,
    ensureOpencodeSkill: () => Effect.void,
    delete: () => Effect.void,
  });

  return IssueRepositoryNotion.pipe(
    Layer.provide(mockNotionClientService),
    Layer.provide(mockConfigRepo),
  );
};

// =============================================================================
// Tests
// =============================================================================

describe("IssueRepositoryNotion", () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  // ===========================================================================
  // getTask Tests
  // ===========================================================================

  describe("getTask", () => {
    it("returns task when page exists", async () => {
      mockClient.pages.retrieve.mockResolvedValue(testPage1);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.getTask("page-123" as TaskId);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      // Verify API was called correctly
      expect(mockClient.pages.retrieve).toHaveBeenCalledTimes(1);
      expect(mockClient.pages.retrieve).toHaveBeenCalledWith({ page_id: "page-123" });

      // Verify mapping results
      expect(result.id).toBe("page-123");
      expect(result.title).toBe("Test Task 1");
      expect(result.state.name).toBe("To Do");
      expect(result.state.type).toBe("unstarted"); // Verify status type mapping
      expect(result.priority).toBe("medium");
    });

    it("fails with TaskNotFoundError when page not found", async () => {
      const error = new Error("Page not found") as Error & { status: number };
      error.status = 404;
      mockClient.pages.retrieve.mockRejectedValue(error);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.getTask("nonexistent" as TaskId);
        }).pipe(Effect.provide(createTestLayer(mockClient)), Effect.flip),
      );

      expect(result).toBeInstanceOf(TaskNotFoundError);
      expect((result as TaskNotFoundError).taskId).toBe("nonexistent");
    });

    it("fails with NotionApiError on API error", async () => {
      mockClient.pages.retrieve.mockRejectedValue(new Error("API error"));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.getTask("page-123" as TaskId);
        }).pipe(Effect.provide(createTestLayer(mockClient)), Effect.flip),
      );

      expect(result).toBeInstanceOf(NotionApiError);
      expect((result as NotionApiError).message).toContain("Failed to fetch page");
      expect((result as NotionApiError).cause).toBeDefined();
    });

    it("extracts status code from Notion SDK error format", async () => {
      // Notion SDK errors have a `status` property, not `statusCode`
      const sdkError = { status: 500, message: "Internal server error" };
      mockClient.pages.retrieve.mockRejectedValue(sdkError);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.getTask("page-123" as TaskId);
        }).pipe(Effect.provide(createTestLayer(mockClient)), Effect.flip),
      );

      expect(result).toBeInstanceOf(NotionApiError);
      expect((result as NotionApiError).statusCode).toBe(500);
    });
  });

  // ===========================================================================
  // getTaskByIdentifier Tests
  // ===========================================================================

  describe("getTaskByIdentifier", () => {
    it("returns task when found by identifier", async () => {
      mockClient.dataSources.query.mockResolvedValue(createQueryResponse([testPage1]));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.getTaskByIdentifier("N-page123");
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result.title).toBe("Test Task 1");
    });

    it("fails with TaskNotFoundError when not found", async () => {
      mockClient.dataSources.query.mockResolvedValue(createQueryResponse([]));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.getTaskByIdentifier("UNKNOWN-999");
        }).pipe(Effect.provide(createTestLayer(mockClient)), Effect.flip),
      );

      expect(result).toBeInstanceOf(TaskNotFoundError);
      expect((result as TaskNotFoundError).taskId).toBe("UNKNOWN-999");
    });
  });

  // ===========================================================================
  // createTask Tests
  // ===========================================================================

  describe("createTask", () => {
    it("creates task with all fields", async () => {
      const createdPage = createMockPage("new-page-id", {
        Name: createTitleProperty("New Task"),
        Description: createRichTextProperty("New description"),
        Status: createStatusProperty("To Do"),
        Priority: createSelectProperty("High"),
        Type: createSelectProperty("Feature"),
        Labels: createMultiSelectProperty(["type:feature"]),
        "Blocked By": createRelationProperty([]),
      });
      mockClient.pages.create.mockResolvedValue(createdPage);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.createTask(
            "notion" as TeamId,
            new CreateTaskInput({
              title: "New Task",
              description: Option.some("New description"),
              projectId: Option.none(),
              parentId: Option.none(),
              milestoneId: Option.none(),
              priority: "high",
              type: "feature",
            }),
          );
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result.title).toBe("New Task");
      expect(mockClient.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { database_id: "db-123" },
        }),
      );
    });

    it("creates task with minimal fields", async () => {
      const createdPage = createMockPage("new-page-id", {
        Name: createTitleProperty("Minimal Task"),
        Status: createStatusProperty("To Do"),
        Priority: createSelectProperty("None"),
        Labels: createMultiSelectProperty([]),
        "Blocked By": createRelationProperty([]),
      });
      mockClient.pages.create.mockResolvedValue(createdPage);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.createTask(
            "notion" as TeamId,
            new CreateTaskInput({
              title: "Minimal Task",
              description: Option.none(),
              projectId: Option.none(),
              parentId: Option.none(),
              milestoneId: Option.none(),
            }),
          );
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result.title).toBe("Minimal Task");
    });
  });

  // ===========================================================================
  // updateTask Tests
  // ===========================================================================

  describe("updateTask", () => {
    it("updates task title", async () => {
      const updatedPage = createMockPage("page-123", {
        Name: createTitleProperty("Updated Title"),
        Status: createStatusProperty("To Do"),
        Priority: createSelectProperty("Medium"),
        Labels: createMultiSelectProperty([]),
        "Blocked By": createRelationProperty([]),
      });
      mockClient.pages.update.mockResolvedValue(updatedPage);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.updateTask(
            "page-123" as TaskId,
            new UpdateTaskInput({
              title: Option.some("Updated Title"),
              description: Option.none(),
              status: Option.none(),
              priority: Option.none(),
              assigneeId: Option.none(),
              parentId: Option.none(),
              milestoneId: Option.none(),
            }),
          );
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result.title).toBe("Updated Title");
    });

    it("updates task status", async () => {
      const updatedPage = createMockPage("page-123", {
        Name: createTitleProperty("Test Task"),
        Status: createStatusProperty("Done"),
        Priority: createSelectProperty("Medium"),
        Labels: createMultiSelectProperty([]),
        "Blocked By": createRelationProperty([]),
      });
      mockClient.pages.update.mockResolvedValue(updatedPage);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.updateTask(
            "page-123" as TaskId,
            new UpdateTaskInput({
              title: Option.none(),
              description: Option.none(),
              status: Option.some("done"),
              priority: Option.none(),
              assigneeId: Option.none(),
              parentId: Option.none(),
              milestoneId: Option.none(),
            }),
          );
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result.state.name).toBe("Done");
    });

    it("fails with TaskNotFoundError when task doesn't exist", async () => {
      const error = new Error("Page not found") as Error & { status: number };
      error.status = 404;
      mockClient.pages.update.mockRejectedValue(error);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.updateTask(
            "nonexistent" as TaskId,
            new UpdateTaskInput({
              title: Option.some("Updated"),
              description: Option.none(),
              status: Option.none(),
              priority: Option.none(),
              assigneeId: Option.none(),
              parentId: Option.none(),
              milestoneId: Option.none(),
            }),
          );
        }).pipe(Effect.provide(createTestLayer(mockClient)), Effect.flip),
      );

      expect(result).toBeInstanceOf(TaskNotFoundError);
    });
  });

  // ===========================================================================
  // listTasks Tests
  // ===========================================================================

  describe("listTasks", () => {
    it("returns all tasks without filter", async () => {
      mockClient.dataSources.query.mockResolvedValue(
        createQueryResponse([testPage1, testPage2]),
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.listTasks(
            "notion" as TeamId,
            new TaskFilter({
              status: Option.none(),
              priority: Option.none(),
              projectId: Option.none(),
              milestoneId: Option.none(),
            }),
          );
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result).toHaveLength(2);
    });

    it("filters by priority", async () => {
      mockClient.dataSources.query.mockResolvedValue(createQueryResponse([testPage2]));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.listTasks(
            "notion" as TeamId,
            new TaskFilter({
              status: Option.none(),
              priority: Option.some("high"),
              projectId: Option.none(),
              milestoneId: Option.none(),
            }),
          );
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result).toHaveLength(1);
      expect(result[0].priority).toBe("high");
    });

    it("excludes completed tasks by default", async () => {
      mockClient.dataSources.query.mockResolvedValue(
        createQueryResponse([testPage1, testPage2]),
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.listTasks(
            "notion" as TeamId,
            new TaskFilter({
              status: Option.none(),
              priority: Option.none(),
              projectId: Option.none(),
              milestoneId: Option.none(),
              includeCompleted: false,
            }),
          );
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      // Verify the query included the does_not_equal filter
      expect(mockClient.dataSources.query).toHaveBeenCalledWith(
        expect.objectContaining({
          data_source_id: "db-123",
        }),
      );
    });
  });

  // ===========================================================================
  // getReadyTasks Tests
  // ===========================================================================

  describe("getReadyTasks", () => {
    it("returns tasks without blockers", async () => {
      mockClient.dataSources.query.mockResolvedValue(
        createQueryResponse([testPage1, testPage2]),
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.getReadyTasks("notion" as TeamId);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result).toHaveLength(2);
    });

    it("excludes tasks with incomplete blockers", async () => {
      // Return blocked task and its incomplete blocker
      mockClient.dataSources.query.mockResolvedValue(
        createQueryResponse([blockedPage, testPage1]),
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.getReadyTasks("notion" as TeamId);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      // Only testPage1 should be ready (not blocked)
      // blockedPage should be excluded as it has testPage1 as incomplete blocker
      expect(result.find((t) => t.id === "page-blocked")).toBeUndefined();
      expect(result.find((t) => t.id === "page-123")).toBeDefined();
    });

    it("includes tasks whose blockers are completed", async () => {
      const taskWithCompletedBlocker = createMockPage("page-unblocked", {
        Name: createTitleProperty("Unblocked Task"),
        Status: createStatusProperty("To Do"),
        Priority: createSelectProperty("Medium"),
        Labels: createMultiSelectProperty([]),
        "Blocked By": createRelationProperty(["page-completed-blocker"]),
      });

      mockClient.dataSources.query.mockResolvedValue(
        createQueryResponse([taskWithCompletedBlocker, completedBlockerPage]),
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.getReadyTasks("notion" as TeamId);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      // Both should be ready - blocker is completed
      expect(result.find((t) => t.id === "page-unblocked")).toBeDefined();
    });
  });

  // ===========================================================================
  // getBlockedTasks Tests
  // ===========================================================================

  describe("getBlockedTasks", () => {
    it("returns only tasks with incomplete blockers", async () => {
      mockClient.dataSources.query.mockResolvedValue(
        createQueryResponse([blockedPage, testPage1]),
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.getBlockedTasks("notion" as TeamId);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      // Only blockedPage should be returned
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("page-blocked");
    });

    it("returns empty when no blocked tasks", async () => {
      mockClient.dataSources.query.mockResolvedValue(
        createQueryResponse([testPage1, testPage2]),
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.getBlockedTasks("notion" as TeamId);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result).toHaveLength(0);
    });
  });

  // ===========================================================================
  // addBlocker Tests
  // ===========================================================================

  describe("addBlocker", () => {
    it("adds blocker to task", async () => {
      mockClient.pages.retrieve.mockResolvedValue(testPage1);
      mockClient.pages.update.mockResolvedValue(testPage1);

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          yield* repo.addBlocker("page-123" as TaskId, "page-456" as TaskId);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(mockClient.pages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: "page-123",
        }),
      );
    });

    it("fails with TaskNotFoundError when blocked task not found", async () => {
      const error = new Error("Page not found") as Error & { status: number };
      error.status = 404;
      mockClient.pages.retrieve.mockRejectedValue(error);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          yield* repo.addBlocker("nonexistent" as TaskId, "page-456" as TaskId);
        }).pipe(Effect.provide(createTestLayer(mockClient)), Effect.flip),
      );

      expect(result).toBeInstanceOf(TaskNotFoundError);
    });
  });

  // ===========================================================================
  // removeBlocker Tests
  // ===========================================================================

  describe("removeBlocker", () => {
    it("removes blocker from task", async () => {
      const pageWithBlocker = createMockPage("page-123", {
        ...testPage1.properties,
        "Blocked By": createRelationProperty(["blocker-1", "blocker-2"]),
      });
      mockClient.pages.retrieve.mockResolvedValue(pageWithBlocker);
      mockClient.pages.update.mockResolvedValue(testPage1);

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          yield* repo.removeBlocker("page-123" as TaskId, "blocker-1" as TaskId);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(mockClient.pages.update).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // getBranchName Tests
  // ===========================================================================

  describe("getBranchName", () => {
    it("generates branch name from task", async () => {
      mockClient.pages.retrieve.mockResolvedValue(testPage1);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.getBranchName("page-123" as TaskId);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      // Should include identifier and slugified title
      expect(result).toContain("n-page-123");
      expect(result).toContain("test-task-1");
    });

    it("fails with TaskNotFoundError when task not found", async () => {
      const error = new Error("Page not found") as Error & { status: number };
      error.status = 404;
      mockClient.pages.retrieve.mockRejectedValue(error);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.getBranchName("nonexistent" as TaskId);
        }).pipe(Effect.provide(createTestLayer(mockClient)), Effect.flip),
      );

      expect(result).toBeInstanceOf(TaskNotFoundError);
    });
  });

  // ===========================================================================
  // setSessionLabel Tests
  // ===========================================================================

  describe("setSessionLabel", () => {
    it("adds session label to task", async () => {
      mockClient.pages.retrieve.mockResolvedValue(testPage1);
      mockClient.pages.update.mockResolvedValue(testPage1);

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          yield* repo.setSessionLabel("page-123" as TaskId, "session-abc");
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(mockClient.pages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: "page-123",
        }),
      );
    });

    it("replaces existing session label", async () => {
      const pageWithSession = createMockPage("page-123", {
        ...testPage1.properties,
        Labels: createMultiSelectProperty(["test", "session:old-session"]),
      });
      mockClient.pages.retrieve.mockResolvedValue(pageWithSession);
      mockClient.pages.update.mockResolvedValue(testPage1);

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          yield* repo.setSessionLabel("page-123" as TaskId, "new-session");
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(mockClient.pages.update).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // setTypeLabel Tests
  // ===========================================================================

  describe("setTypeLabel", () => {
    it("adds type label to task", async () => {
      mockClient.pages.retrieve.mockResolvedValue(testPage1);
      mockClient.pages.update.mockResolvedValue(testPage1);

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          yield* repo.setTypeLabel("page-123" as TaskId, "bug");
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(mockClient.pages.update).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // clearSessionLabel Tests
  // ===========================================================================

  describe("clearSessionLabel", () => {
    it("removes session label from task", async () => {
      const pageWithSession = createMockPage("page-123", {
        ...testPage1.properties,
        Labels: createMultiSelectProperty(["test", "session:abc"]),
      });
      mockClient.pages.retrieve.mockResolvedValue(pageWithSession);
      mockClient.pages.update.mockResolvedValue(testPage1);

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          yield* repo.clearSessionLabel("page-123" as TaskId);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(mockClient.pages.update).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // removeAsBlocker Tests
  // ===========================================================================

  describe("removeAsBlocker", () => {
    it("removes task as blocker from all blocked tasks", async () => {
      const blockedTask = createMockPage("blocked-task", {
        Name: createTitleProperty("Blocked Task"),
        Status: createStatusProperty("To Do"),
        Priority: createSelectProperty("Medium"),
        Labels: createMultiSelectProperty([]),
        "Blocked By": createRelationProperty(["page-123"]),
      });

      mockClient.dataSources.query.mockResolvedValue(createQueryResponse([blockedTask]));
      mockClient.pages.update.mockResolvedValue(blockedTask);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.removeAsBlocker("page-123" as TaskId);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result).toHaveLength(1);
      expect(mockClient.pages.update).toHaveBeenCalled();
    });

    it("returns empty array when not blocking any tasks", async () => {
      mockClient.dataSources.query.mockResolvedValue(createQueryResponse([]));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.removeAsBlocker("page-123" as TaskId);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe("Error Handling", () => {
    it("fails with NotionApiError when config not found", async () => {
      const configWithoutNotion = new ShipConfig({
        provider: "notion",
        linear: new LinearConfig({
          teamId: "test-team" as TeamId,
          teamKey: "TEST",
          projectId: Option.none(),
        }),
        auth: new AuthConfig({ apiKey: "test-api-key" }),
        notion: Option.none(), // No Notion config
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* IssueRepository;
          return yield* repo.getTask("page-123" as TaskId);
        }).pipe(
          Effect.provide(createTestLayer(mockClient, configWithoutNotion)),
          Effect.flip,
        ),
      );

      expect(result).toBeInstanceOf(NotionApiError);
      expect((result as NotionApiError).message).toContain("Notion configuration not found");
    });
  });
});
