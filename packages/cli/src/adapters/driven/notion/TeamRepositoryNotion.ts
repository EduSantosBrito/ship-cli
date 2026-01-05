import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { TeamRepository, type CreateTeamInput } from "../../../ports/TeamRepository.js";
import { NotionClientService } from "./NotionClient.js";
import { Team, type TeamId } from "../../../domain/Task.js";
import { NotionApiError, TaskError, TeamNotFoundError } from "../../../domain/Errors.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Default team ID for Notion.
 *
 * Unlike Linear which has multiple teams, Notion integrations operate within
 * a single workspace. This constant ID serves as the canonical team identifier
 * for all Notion operations.
 *
 * @internal The `as TeamId` cast is safe because this is the only valid Notion
 * team ID and it remains constant throughout the application lifecycle.
 */
const NOTION_TEAM_ID = "notion-workspace" as TeamId;

/**
 * Default team key for Notion.
 */
const NOTION_TEAM_KEY = "NOTION";

// =============================================================================
// Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const notionClientService = yield* NotionClientService;

  const getClient = () => notionClientService.client();

  /**
   * Get the workspace team from the bot user info.
   */
  const getWorkspaceTeam = (): Effect.Effect<Team, NotionApiError> =>
    Effect.gen(function* () {
      const client = yield* getClient();

      const botUser = yield* Effect.tryPromise({
        try: () => client.users.me({}),
        catch: (e) => new NotionApiError({ message: `Failed to fetch bot user: ${e}`, cause: e }),
      });

      // Extract workspace/bot name
      let workspaceName = "Notion Workspace";

      if (botUser.type === "bot" && botUser.bot && typeof botUser.bot === "object" && "owner" in botUser.bot) {
        const owner = botUser.bot.owner;
        if (owner.type === "workspace") {
          workspaceName = "Notion Workspace";
        } else if (owner.type === "user" && "user" in owner && owner.user && "name" in owner.user && owner.user.name) {
          workspaceName = `${owner.user.name}'s Workspace`;
        }
      }

      // Use bot name if available
      if (botUser.name) {
        workspaceName = `${botUser.name} Workspace`;
      }

      return new Team({
        id: NOTION_TEAM_ID,
        name: workspaceName,
        key: NOTION_TEAM_KEY,
      });
    });

  const getTeams = (): Effect.Effect<ReadonlyArray<Team>, NotionApiError> =>
    Effect.gen(function* () {
      const team = yield* getWorkspaceTeam();
      return [team];
    });

  const getTeam = (id: TeamId): Effect.Effect<Team, TeamNotFoundError | NotionApiError> =>
    Effect.gen(function* () {
      // Notion only has one "team" (the workspace)
      // Accept the constant ID or any ID (for flexibility)
      if (id !== NOTION_TEAM_ID && id !== "notion" && id !== "default") {
        return yield* Effect.fail(new TeamNotFoundError({ teamId: id }));
      }

      return yield* getWorkspaceTeam();
    });

  const createTeam = (_input: CreateTeamInput): Effect.Effect<Team, TaskError | NotionApiError> =>
    // Notion doesn't support creating teams/workspaces via API
    Effect.fail(
      new TaskError({
        message: "Creating teams is not supported in Notion. Notion integrations operate within a single workspace.",
      }),
    );

  return {
    getTeams,
    getTeam,
    createTeam,
  };
});

export const TeamRepositoryNotion = Layer.effect(TeamRepository, make);

/**
 * The constant team ID used for Notion workspaces.
 * Export for use in other parts of the application.
 */
export { NOTION_TEAM_ID, NOTION_TEAM_KEY };
