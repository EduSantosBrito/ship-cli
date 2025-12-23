import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as clack from "@clack/prompts";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";
import { AuthService } from "../../../../ports/AuthService.js";
import { TeamRepository } from "../../../../ports/TeamRepository.js";
import { ProjectRepository } from "../../../../ports/ProjectRepository.js";
import { LinearConfig } from "../../../../domain/Config.js";
import { PromptCancelledError } from "../../../../domain/Errors.js";
import type { Team, Project } from "../../../../domain/Task.js";

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
          clack.outro("Run 'ship ready' to see available tasks.");
          return;
        }
      }

      // Step 1: Authenticate if needed
      const isAuth = yield* auth.isAuthenticated();
      if (!isAuth) {
        clack.note(
          "Create a personal API key at:\nhttps://linear.app/settings/api",
          "Linear Authentication",
        );

        const apiKey = yield* Effect.tryPromise({
          try: () =>
            clack.text({
              message: "Paste your API key",
              placeholder: "lin_api_...",
              validate: (value) => {
                if (!value) return "API key is required";
                if (!value.startsWith("lin_api_")) return "API key should start with lin_api_";
              },
            }),
          catch: () => PromptCancelledError.default,
        });

        if (clack.isCancel(apiKey)) {
          clack.cancel("Setup cancelled");
          return;
        }

        const spinner = clack.spinner();
        spinner.start("Validating API key...");

        yield* auth.saveApiKey(apiKey as string).pipe(
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

      if (teams.length === 0) {
        clack.log.error("No teams found. Please create a team in Linear first.");
        clack.outro("Setup incomplete");
        return;
      }

      // Select team
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
        const teamChoice = yield* Effect.tryPromise({
          try: () =>
            clack.select({
              message: "Select a team",
              options: teams.map((t) => ({
                value: t.id,
                label: `${t.key} - ${t.name}`,
              })),
            }),
          catch: () => PromptCancelledError.default,
        });

        if (clack.isCancel(teamChoice)) {
          clack.cancel("Setup cancelled");
          return;
        }

        selectedTeam = teams.find((t) => t.id === teamChoice)!;
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
      } else if (projects.length > 0) {
        const projectChoice = yield* Effect.tryPromise({
          try: () =>
            clack.select({
              message: "Select a project (optional)",
              options: [
                { value: null, label: "No project filter" },
                ...projects.map((p) => ({
                  value: p.id,
                  label: p.name,
                })),
              ],
            }),
          catch: () => PromptCancelledError.default,
        });

        if (clack.isCancel(projectChoice)) {
          clack.cancel("Setup cancelled");
          return;
        }

        if (projectChoice) {
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

      clack.outro("Run 'ship ready' to see available tasks.");
    }),
);
