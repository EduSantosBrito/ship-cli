import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Client as NotionSDK } from "@notionhq/client";
import type {
  GetSelfResponse,
  SearchResponse,
  DataSourceObjectResponse,
} from "@notionhq/client/build/src/api-endpoints.js";
import { TeamRepository } from "../../../../src/ports/TeamRepository.js";
import { ProjectRepository } from "../../../../src/ports/ProjectRepository.js";
import { NotionClientService } from "../../../../src/adapters/driven/notion/NotionClient.js";
import {
  TeamRepositoryNotion,
  NOTION_TEAM_ID,
  NOTION_TEAM_KEY,
} from "../../../../src/adapters/driven/notion/TeamRepositoryNotion.js";
import { ProjectRepositoryNotion } from "../../../../src/adapters/driven/notion/ProjectRepositoryNotion.js";
import { TeamNotFoundError, TaskError } from "../../../../src/domain/Errors.js";
import type { TeamId } from "../../../../src/domain/Task.js";

// =============================================================================
// Test Fixtures
// =============================================================================

const createBotUserResponse = (
  name: string | null = "Test Bot",
  ownerType: "workspace" | "user" = "workspace",
): GetSelfResponse =>
  ({
    object: "user",
    id: "bot-user-id",
    type: "bot",
    name,
    avatar_url: null,
    bot:
      ownerType === "workspace"
        ? {
            owner: {
              type: "workspace",
              workspace: true,
            },
            workspace_id: "workspace-123",
            workspace_name: "Test Workspace",
            workspace_limits: {
              max_file_upload_size_in_bytes: 5000000,
            },
          }
        : {
            owner: {
              type: "user",
              user: {
                object: "user",
                id: "owner-user-id",
                name: "Owner User",
                avatar_url: null,
                type: "person",
                person: { email: "owner@example.com" },
              },
            },
            workspace_id: "workspace-123",
            workspace_name: null,
            workspace_limits: {
              max_file_upload_size_in_bytes: 5000000,
            },
          },
  }) as GetSelfResponse;

const createDataSourceResponse = (
  id: string,
  title: string,
): DataSourceObjectResponse =>
  ({
    object: "data_source",
    id,
    title: [
      {
        type: "text",
        text: { content: title, link: null },
        plain_text: title,
        href: null,
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: "default",
        },
      },
    ],
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

const createSearchResponse = (dataSources: DataSourceObjectResponse[]): SearchResponse => ({
  type: "page_or_data_source",
  page_or_data_source: {},
  object: "list",
  next_cursor: null,
  has_more: false,
  results: dataSources,
});

// =============================================================================
// Mock Setup
// =============================================================================

const createMockClient = () => ({
  users: {
    me: vi.fn(),
  },
  search: vi.fn(),
});

const createTestLayer = (mockClient: ReturnType<typeof createMockClient>) => {
  const mockNotionClientService = Layer.succeed(NotionClientService, {
    client: () => Effect.succeed(mockClient as unknown as NotionSDK),
  });

  return Layer.mergeAll(
    TeamRepositoryNotion.pipe(Layer.provide(mockNotionClientService)),
    ProjectRepositoryNotion.pipe(Layer.provide(mockNotionClientService)),
  );
};

// =============================================================================
// TeamRepositoryNotion Tests
// =============================================================================

describe("TeamRepositoryNotion", () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  describe("getTeams", () => {
    it("returns single team representing the Notion workspace", async () => {
      mockClient.users.me.mockResolvedValue(createBotUserResponse("My Integration"));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* TeamRepository;
          return yield* repo.getTeams();
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(NOTION_TEAM_ID);
      expect(result[0].key).toBe(NOTION_TEAM_KEY);
      expect(result[0].name).toBe("My Integration Workspace");
    });

    it("uses default workspace name when bot has no name", async () => {
      mockClient.users.me.mockResolvedValue(createBotUserResponse(null));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* TeamRepository;
          return yield* repo.getTeams();
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result[0].name).toBe("Notion Workspace");
    });

    it("includes owner name when owner is a user", async () => {
      mockClient.users.me.mockResolvedValue(createBotUserResponse(null, "user"));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* TeamRepository;
          return yield* repo.getTeams();
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result[0].name).toBe("Owner User's Workspace");
    });
  });

  describe("getTeam", () => {
    it("returns team for the constant NOTION_TEAM_ID", async () => {
      mockClient.users.me.mockResolvedValue(createBotUserResponse("Test Bot"));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* TeamRepository;
          return yield* repo.getTeam(NOTION_TEAM_ID);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result.id).toBe(NOTION_TEAM_ID);
      expect(result.key).toBe(NOTION_TEAM_KEY);
    });

    it("accepts 'notion' as team ID", async () => {
      mockClient.users.me.mockResolvedValue(createBotUserResponse("Test Bot"));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* TeamRepository;
          return yield* repo.getTeam("notion" as TeamId);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result.id).toBe(NOTION_TEAM_ID);
    });

    it("accepts 'default' as team ID", async () => {
      mockClient.users.me.mockResolvedValue(createBotUserResponse("Test Bot"));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* TeamRepository;
          return yield* repo.getTeam("default" as TeamId);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result.id).toBe(NOTION_TEAM_ID);
    });

    it("fails with TeamNotFoundError for unknown team ID", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* TeamRepository;
          return yield* repo.getTeam("unknown-team-id" as TeamId);
        }).pipe(
          Effect.provide(createTestLayer(mockClient)),
          Effect.flip,
        ),
      );

      expect(result).toBeInstanceOf(TeamNotFoundError);
      expect((result as TeamNotFoundError).teamId).toBe("unknown-team-id");
    });
  });

  describe("createTeam", () => {
    it("fails with TaskError - not supported in Notion", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* TeamRepository;
          return yield* repo.createTeam({ name: "New Team", key: "NEW" });
        }).pipe(
          Effect.provide(createTestLayer(mockClient)),
          Effect.flip,
        ),
      );

      expect(result).toBeInstanceOf(TaskError);
      expect((result as TaskError).message).toContain("not supported in Notion");
    });
  });
});

// =============================================================================
// ProjectRepositoryNotion Tests
// =============================================================================

describe("ProjectRepositoryNotion", () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  describe("getProjects", () => {
    it("returns databases as projects", async () => {
      const dataSources = [
        createDataSourceResponse("db-1", "Tasks Database"),
        createDataSourceResponse("db-2", "Projects Database"),
      ];
      mockClient.search.mockResolvedValue(createSearchResponse(dataSources));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* ProjectRepository;
          return yield* repo.getProjects(NOTION_TEAM_ID);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("db-1");
      expect(result[0].name).toBe("Tasks Database");
      expect(result[0].teamId).toBe(NOTION_TEAM_ID);
      expect(result[1].id).toBe("db-2");
      expect(result[1].name).toBe("Projects Database");
    });

    it("calls search with correct filter for data sources", async () => {
      mockClient.search.mockResolvedValue(createSearchResponse([]));

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* ProjectRepository;
          return yield* repo.getProjects(NOTION_TEAM_ID);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(mockClient.search).toHaveBeenCalledWith({
        filter: {
          property: "object",
          value: "data_source",
        },
        page_size: 100,
      });
    });

    it("returns empty array when no databases are shared", async () => {
      mockClient.search.mockResolvedValue(createSearchResponse([]));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* ProjectRepository;
          return yield* repo.getProjects(NOTION_TEAM_ID);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result).toHaveLength(0);
    });

    it("handles database with empty title", async () => {
      const dataSource = createDataSourceResponse("db-1", "");
      // Clear title to test empty case
      dataSource.title = [];
      mockClient.search.mockResolvedValue(createSearchResponse([dataSource]));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* ProjectRepository;
          return yield* repo.getProjects(NOTION_TEAM_ID);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      expect(result[0].name).toBe("Untitled Database");
    });

    it("ignores teamId parameter (uses workspace-level search)", async () => {
      mockClient.search.mockResolvedValue(createSearchResponse([]));

      // Call with a different team ID - should still work
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* ProjectRepository;
          return yield* repo.getProjects("different-team-id" as TeamId);
        }).pipe(Effect.provide(createTestLayer(mockClient))),
      );

      // Search should still be called (teamId is ignored for Notion)
      expect(mockClient.search).toHaveBeenCalled();
    });
  });

  describe("createProject", () => {
    it("fails with TaskError - not supported in Notion", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* ProjectRepository;
          return yield* repo.createProject(NOTION_TEAM_ID, { name: "New Project" });
        }).pipe(
          Effect.provide(createTestLayer(mockClient)),
          Effect.flip,
        ),
      );

      expect(result).toBeInstanceOf(TaskError);
      expect((result as TaskError).message).toContain("not supported via ship-cli");
    });
  });
});
