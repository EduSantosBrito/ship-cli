import * as Command from "@effect/cli/Command";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as clack from "@clack/prompts";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";
import { AuthService } from "../../../../ports/AuthService.js";
import { ProjectRepository } from "../../../../ports/ProjectRepository.js";
import { Prompts } from "../../../../ports/Prompts.js";
import { LinearConfig } from "../../../../domain/Config.js";
import type { Project, ProjectId } from "../../../../domain/Task.js";

const CREATE_NEW = "__create_new__" as const;
const NO_PROJECT = null;

export const projectCommand = Command.make("project", {}, () =>
  Effect.gen(function* () {
    const config = yield* ConfigRepository;
    const auth = yield* AuthService;
    const projectRepo = yield* ProjectRepository;
    const prompts = yield* Prompts;

    clack.intro("ship project");

    // Check authentication
    const isAuth = yield* auth.isAuthenticated();
    if (!isAuth) {
      clack.log.error("Not authenticated. Run 'ship login' first.");
      clack.outro("Setup required");
      return;
    }

    // Check team is configured
    const partial = yield* config.loadPartial();
    if (Option.isNone(partial.linear)) {
      clack.log.error("No team configured. Run 'ship init' first.");
      clack.outro("Setup required");
      return;
    }

    const currentConfig = partial.linear.value;
    clack.log.info(`Team: ${currentConfig.teamKey}`);

    if (Option.isSome(currentConfig.projectId)) {
      clack.log.info(`Current project: ${currentConfig.projectId.value}`);
    }

    // Fetch projects
    const spinner = clack.spinner();
    spinner.start("Fetching projects...");
    const projects = yield* projectRepo.getProjects(currentConfig.teamId).pipe(
      Effect.tap(() => Effect.sync(() => spinner.stop("Projects loaded"))),
      Effect.tapError(() => Effect.sync(() => spinner.stop("Failed to fetch projects"))),
    );

    // Select project or create new
    const currentProjectId = Option.isSome(currentConfig.projectId)
      ? currentConfig.projectId.value
      : null;

    const projectOptions: Array<{
      value: ProjectId | typeof CREATE_NEW | typeof NO_PROJECT;
      label: string;
      hint?: string;
    }> = [
      { value: NO_PROJECT, label: "No project filter", hint: "show all team tasks" },
      ...projects.map((p) =>
        currentProjectId === p.id
          ? { value: p.id, label: p.name, hint: "current" as const }
          : { value: p.id, label: p.name },
      ),
      { value: CREATE_NEW, label: "Create new project..." },
    ];

    const projectChoice = yield* prompts.select({
      message: "Select a project",
      options: projectOptions,
    });

    let selectedProject: Project | undefined;

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

      const createInput = { name: projectName } as { name: string; description?: string };
      if (projectDesc) {
        createInput.description = projectDesc;
      }

      selectedProject = yield* projectRepo.createProject(currentConfig.teamId, createInput).pipe(
        Effect.tap((project) =>
          Effect.sync(() => createSpinner.stop(`Created project: ${project.name}`)),
        ),
        Effect.tapError(() => Effect.sync(() => createSpinner.stop("Failed to create project"))),
      );
    } else if (projectChoice !== NO_PROJECT) {
      const found = projects.find((p) => p.id === projectChoice);
      if (!found) {
        clack.log.error("Selected project not found. Please try again.");
        clack.outro("Error");
        return;
      }
      selectedProject = found;
    }

    // Save updated config
    const linearConfig = new LinearConfig({
      teamId: currentConfig.teamId,
      teamKey: currentConfig.teamKey,
      projectId: selectedProject ? Option.some(selectedProject.id) : Option.none(),
    });

    yield* config.saveLinear(linearConfig);

    if (selectedProject) {
      clack.log.success(`Switched to project: ${selectedProject.name}`);
    } else {
      clack.log.success("Cleared project filter");
    }

    clack.outro("Run 'ship task ready' to see available tasks.");
  }),
);
