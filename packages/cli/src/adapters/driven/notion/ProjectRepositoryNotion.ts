import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  SearchResponse,
  DataSourceObjectResponse,
} from "@notionhq/client/build/src/api-endpoints.js";
import {
  ProjectRepository,
  type CreateProjectInput,
} from "../../../ports/ProjectRepository.js";
import { NotionClientService } from "./NotionClient.js";
import { Project, type TeamId, type ProjectId } from "../../../domain/Task.js";
import { NotionApiError, TaskError } from "../../../domain/Errors.js";
import { NOTION_TEAM_ID } from "./TeamRepositoryNotion.js";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract plain text from Notion rich text array.
 */
const extractPlainText = (richText: Array<{ plain_text: string }>): string =>
  richText.map((rt) => rt.plain_text).join("");

/**
 * Map a Notion data source (database) to our Project domain model.
 */
const mapDataSourceToProject = (
  dataSource: DataSourceObjectResponse,
  teamId: TeamId,
): Project =>
  new Project({
    id: dataSource.id as ProjectId,
    name: extractPlainText(dataSource.title) || "Untitled Database",
    teamId,
  });

/**
 * Check if a search result is a DataSourceObjectResponse.
 */
const isDataSource = (
  result: SearchResponse["results"][number],
): result is DataSourceObjectResponse =>
  result.object === "data_source" && "title" in result;

// =============================================================================
// Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const notionClientService = yield* NotionClientService;

  const getClient = () => notionClientService.client();

  const getProjects = (
    _teamId: TeamId, // Ignored for Notion - all databases belong to the workspace
  ): Effect.Effect<ReadonlyArray<Project>, NotionApiError> =>
    Effect.gen(function* () {
      const client = yield* getClient();

      // Use search API to find all databases the integration can access
      // In Notion SDK v5.6.0+, databases are called "data_source"
      const response = yield* Effect.tryPromise({
        try: () =>
          client.search({
            filter: {
              property: "object",
              value: "data_source",
            },
            page_size: 100,
          }),
        catch: (e) => new NotionApiError({ message: `Failed to search databases: ${e}`, cause: e }),
      });

      // Filter to only DataSourceObjectResponse (full objects, not partial)
      const dataSources = response.results.filter(isDataSource);

      // Map to Project domain model
      // Use NOTION_TEAM_ID since Notion doesn't have teams
      return dataSources.map((ds) => mapDataSourceToProject(ds, NOTION_TEAM_ID));
    });

  const createProject = (
    _teamId: TeamId,
    _input: CreateProjectInput,
  ): Effect.Effect<Project, TaskError | NotionApiError> =>
    // Creating databases in Notion requires a parent page, which is more complex
    // than what our simple CreateProjectInput supports. For now, fail with an error.
    // Users should create databases directly in Notion and share them with the integration.
    Effect.fail(
      new TaskError({
        message:
          "Creating projects (databases) is not supported via ship-cli for Notion. " +
          "Please create databases directly in Notion and share them with your integration.",
      }),
    );

  return {
    getProjects,
    createProject,
  };
});

export const ProjectRepositoryNotion = Layer.effect(ProjectRepository, make);
