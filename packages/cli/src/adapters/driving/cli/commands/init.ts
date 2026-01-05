import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { pipe } from "effect/Function";
import * as Match from "effect/Match";
import * as clack from "@clack/prompts";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";
import { AuthService } from "../../../../ports/AuthService.js";
import { TeamRepository } from "../../../../ports/TeamRepository.js";
import { ProjectRepository, type CreateProjectInput } from "../../../../ports/ProjectRepository.js";
import { Prompts } from "../../../../ports/Prompts.js";
import { LinearConfig, NotionConfig, NotionPropertyMapping } from "../../../../domain/Config.js";
import { type TaskApiError, TaskError } from "../../../../domain/Errors.js";
import type { Team, Project, TeamId, ProjectId } from "../../../../domain/Task.js";

const CREATE_NEW = "__create_new__" as const;
const NO_PROJECT = null;

/**
 * Extract error message from task provider API or Task errors.
 * Uses Effect Match for exhaustive pattern matching.
 */
const formatApiError = (error: TaskApiError | TaskError): string =>
  pipe(
    error,
    Match.value,
    Match.tag("LinearApiError", (e) => e.message),
    Match.tag("NotionApiError", (e) => e.message),
    Match.tag("TaskError", (e) => e.message),
    Match.exhaustive,
  );

/**
 * Wrap an Effect that creates a resource, handling errors gracefully.
 * Returns Option.some(resource) on success, Option.none() on failure.
 */
const tryCreate = <A, E extends TaskApiError | TaskError>(
  effect: Effect.Effect<A, E>,
  spinner: ReturnType<typeof clack.spinner>,
  successMsg: (a: A) => string,
  failureContext: string,
): Effect.Effect<Option.Option<A>, never> =>
  effect.pipe(
    Effect.tap((a) => Effect.sync(() => spinner.stop(successMsg(a)))),
    Effect.map(Option.some),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        spinner.stop(`Failed to create ${failureContext}`);
        clack.log.error(
          `Could not create ${failureContext}: ${formatApiError(error)}\nYou may not have permission to create ${failureContext}s.`,
        );
        return Option.none<A>();
      }),
    ),
  );

const teamOption = Options.text("team").pipe(
  Options.withAlias("t"),
  Options.withDescription("Team ID or key to use"),
  Options.optional,
);

const projectOption = Options.text("project").pipe(
  Options.withAlias("p"),
  Options.withDescription("Project ID or name to use"),
  Options.optional,
);

export const initCommand = Command.make(
  "init",
  { team: teamOption, project: projectOption },
  ({ team, project }) =>
    Effect.gen(function* () {
      const config = yield* ConfigRepository;
      const auth = yield* AuthService;
      const teamRepo = yield* TeamRepository;
      const projectRepo = yield* ProjectRepository;
      const prompts = yield* Prompts;

      clack.intro("ship init");

      // Check if already initialized
      const exists = yield* config.exists();
      if (exists) {
        const partial = yield* config.loadPartial();
        if (Option.isSome(partial.auth) && Option.isSome(partial.linear)) {
          clack.note(
            `Team: ${partial.linear.value.teamKey}${Option.isSome(partial.linear.value.projectId) ? `\nProject: ${partial.linear.value.projectId.value}` : ""}`,
            "Already initialized",
          );
          clack.outro("Run 'ship task ready' to see available tasks.");
          return;
        }
        if (Option.isSome(partial.auth) && Option.isSome(partial.notion)) {
          clack.note(
            `Provider: Notion\nDatabase: ${partial.notion.value.databaseId}`,
            "Already initialized",
          );
          clack.outro("Run 'ship task ready' to see available tasks.");
          return;
        }
      }

      // Step 0: Select provider
      const provider = yield* prompts.select({
        message: "Select task provider",
        options: [
          { value: "linear" as const, label: "Linear", hint: "recommended" },
          { value: "notion" as const, label: "Notion", hint: "use Notion database as task backend" },
        ],
      });

      // Notion provider flow
      if (provider === "notion") {
        clack.note(
          "Create an integration at:\nhttps://www.notion.so/my-integrations\n\nThen share your task database with the integration.",
          "Notion Authentication",
        );

        const notionToken = yield* prompts.text({
          message: "Paste your Notion API token",
          placeholder: "ntn_... or secret_...",
          validate: (value) => {
            if (!value) return "API token is required";
            if (!value.startsWith("ntn_") && !value.startsWith("secret_"))
              return "Token should start with ntn_ or secret_";
            return undefined;
          },
        });

        const databaseId = yield* prompts.text({
          message: "Paste your Notion database ID",
          placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
          validate: (value) => {
            if (!value) return "Database ID is required";
            // Basic UUID-like validation (with or without dashes)
            const cleaned = value.replace(/-/g, "");
            if (cleaned.length !== 32) return "Invalid database ID format";
            return undefined;
          },
        });

        // Save Notion config
        yield* config.saveAuth({ apiKey: notionToken });
        yield* config.saveNotion(
          new NotionConfig({
            databaseId: databaseId.replace(/-/g, ""),
            workspaceId: Option.none(),
            propertyMapping: new NotionPropertyMapping({}),
          }),
        );
        yield* config.ensureGitignore();
        yield* config.ensureOpencodeSkill();

        clack.note(
          `Provider: Notion\nDatabase: ${databaseId}\n\nOpenCode skill created at .opencode/skill/ship-cli/SKILL.md`,
          "Workspace initialized",
        );

        clack.outro("Run 'ship task ready' to see available tasks.");
        return;
      }

      // Linear provider flow (existing code)
      // Step 1: Authenticate if needed
      const isAuth = yield* auth.isAuthenticated();
      if (!isAuth) {
        clack.note(
          "Create a personal API key at:\nhttps://linear.app/settings/api",
          "Linear Authentication",
        );

        const apiKey = yield* prompts.text({
          message: "Paste your API key",
          placeholder: "lin_api_...",
          validate: (value) => {
            if (!value) return "API key is required";
            if (!value.startsWith("lin_api_")) return "API key should start with lin_api_";
            return undefined;
          },
        });

        const spinner = clack.spinner();
        spinner.start("Validating API key...");

        yield* auth.saveApiKey(apiKey).pipe(
          Effect.tap(() => Effect.sync(() => spinner.stop("Authenticated"))),
          Effect.tapError(() => Effect.sync(() => spinner.stop("Invalid API key"))),
        );
      } else {
        clack.log.success("Already authenticated");
      }

      // Step 2: Get teams
      const teamSpinner = clack.spinner();
      teamSpinner.start("Fetching teams...");
      const teams = yield* teamRepo.getTeams().pipe(
        Effect.tap(() => Effect.sync(() => teamSpinner.stop("Teams loaded"))),
        Effect.tapError(() => Effect.sync(() => teamSpinner.stop("Failed to fetch teams"))),
      );

      // Select team or create new
      let selectedTeam: Team;
      if (Option.isSome(team)) {
        const found = teams.find((t) => t.id === team.value || t.key === team.value);
        if (!found) {
          clack.log.error(`Team '${team.value}' not found.`);
          clack.note(teams.map((t) => `${t.key} - ${t.name}`).join("\n"), "Available teams");
          clack.outro("Setup incomplete");
          return;
        }
        selectedTeam = found;
        clack.log.success(`Using team: ${selectedTeam.key}`);
      } else if (teams.length === 1) {
        selectedTeam = teams[0]!;
        clack.log.success(`Using team: ${selectedTeam.key} - ${selectedTeam.name}`);
      } else {
        // Build options - always include create option
        const teamOptions: Array<{ value: TeamId | typeof CREATE_NEW; label: string }> = [
          ...teams.map((t) => ({
            value: t.id as TeamId,
            label: `${t.key} - ${t.name}`,
          })),
          { value: CREATE_NEW, label: "Create new team..." },
        ];

        const teamChoice = yield* prompts.select({
          message: "Select a team",
          options: teamOptions,
        });

        if (teamChoice === CREATE_NEW) {
          // Create new team
          const teamName = yield* prompts.text({
            message: "Team name",
            placeholder: "My Team",
            validate: (v) => (!v ? "Name is required" : undefined),
          });

          const teamKey = yield* prompts.text({
            message: "Team key (short identifier, e.g. ENG)",
            placeholder: "ENG",
            validate: (v) => {
              if (!v) return "Key is required";
              if (!/^[A-Z]{2,5}$/.test(v.toUpperCase())) return "Key must be 2-5 uppercase letters";
              return undefined;
            },
          });

          const createSpinner = clack.spinner();
          createSpinner.start("Creating team...");

          const maybeTeam = yield* tryCreate(
            teamRepo.createTeam({ name: teamName, key: teamKey.toUpperCase() }),
            createSpinner,
            (t) => `Created team: ${t.key}`,
            "team",
          );

          if (Option.isNone(maybeTeam)) {
            if (teams.length === 0) {
              clack.log.error("No teams available and could not create one.");
              clack.outro("Setup incomplete");
              return;
            }
            clack.log.info("Please select an existing team instead.");
            const fallbackChoice = yield* prompts.select({
              message: "Select a team",
              options: teams.map((t) => ({
                value: t.id as TeamId,
                label: `${t.key} - ${t.name}`,
              })),
            });
            selectedTeam = teams.find((t) => t.id === fallbackChoice)!;
          } else {
            selectedTeam = maybeTeam.value;
          }
        } else {
          selectedTeam = teams.find((t) => t.id === teamChoice)!;
        }
      }

      // Step 3: Get projects (optional)
      const projectSpinner = clack.spinner();
      projectSpinner.start("Fetching projects...");
      const projects = yield* projectRepo.getProjects(selectedTeam.id).pipe(
        Effect.tap(() => Effect.sync(() => projectSpinner.stop("Projects loaded"))),
        Effect.tapError(() => Effect.sync(() => projectSpinner.stop("Failed to fetch projects"))),
      );

      let selectedProject: Project | undefined;
      if (Option.isSome(project)) {
        selectedProject = projects.find((p) => p.id === project.value || p.name === project.value);
        if (!selectedProject) {
          clack.log.warn(
            `Project '${project.value}' not found, continuing without project filter.`,
          );
        }
      } else {
        // Build options - always include no project and create options
        const projectOptions: Array<{
          value: ProjectId | typeof CREATE_NEW | typeof NO_PROJECT;
          label: string;
          hint?: string;
        }> = [
          { value: NO_PROJECT, label: "No project filter", hint: "show all team tasks" },
          ...projects.map((p) => ({
            value: p.id as ProjectId,
            label: p.name,
          })),
          { value: CREATE_NEW, label: "Create new project..." },
        ];

        const projectChoice = yield* prompts.select({
          message: "Select a project (optional)",
          options: projectOptions,
        });

        if (projectChoice === CREATE_NEW) {
          // Create new project
          const projectName = yield* prompts.text({
            message: "Project name",
            placeholder: "My Project",
            validate: (v) => (!v ? "Name is required" : undefined),
          });

          const projectDesc = yield* prompts.text({
            message: "Description (optional)",
            placeholder: "A brief description of the project",
          });

          const createSpinner = clack.spinner();
          createSpinner.start("Creating project...");

          const createInput: CreateProjectInput = {
            name: projectName,
            ...(projectDesc && { description: projectDesc }),
          };

          const maybeProject = yield* tryCreate(
            projectRepo.createProject(selectedTeam.id, createInput),
            createSpinner,
            (p) => `Created project: ${p.name}`,
            "project",
          );

          if (Option.isSome(maybeProject)) {
            selectedProject = maybeProject.value;
          } else if (projects.length > 0) {
            clack.log.info("Please select an existing project instead, or continue without one.");
            const fallbackChoice = yield* prompts.select({
              message: "Select a project",
              options: [
                { value: NO_PROJECT, label: "No project filter" },
                ...projects.map((p) => ({
                  value: p.id as ProjectId,
                  label: p.name,
                })),
              ],
            });
            if (fallbackChoice !== NO_PROJECT) {
              selectedProject = projects.find((p) => p.id === fallbackChoice);
            }
          } else {
            clack.log.info("Continuing without a project filter.");
          }
        } else if (projectChoice !== NO_PROJECT) {
          selectedProject = projects.find((p) => p.id === projectChoice);
        }
      }

      // Step 4: Save config, update .gitignore, and create OpenCode skill
      const linearConfig = new LinearConfig({
        teamId: selectedTeam.id,
        teamKey: selectedTeam.key,
        projectId: selectedProject ? Option.some(selectedProject.id) : Option.none(),
      });

      yield* config.saveLinear(linearConfig);
      yield* config.ensureGitignore();
      yield* config.ensureOpencodeSkill();

      clack.note(
        `Team: ${selectedTeam.key} - ${selectedTeam.name}${selectedProject ? `\nProject: ${selectedProject.name}` : ""}\n\nOpenCode skill created at .opencode/skill/ship-cli/SKILL.md`,
        "Workspace initialized",
      );

      clack.outro("Run 'ship task ready' to see available tasks.");
    }),
);
