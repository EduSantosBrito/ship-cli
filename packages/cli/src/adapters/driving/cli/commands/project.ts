import * as Command from "@effect/cli/Command";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as clack from "@clack/prompts";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";
import { AuthService } from "../../../../ports/AuthService.js";
import { ProjectRepository } from "../../../../ports/ProjectRepository.js";
import { LinearConfig } from "../../../../domain/Config.js";
import { PromptCancelledError } from "../../../../domain/Errors.js";
import type { Project, ProjectId } from "../../../../domain/Task.js";

const CREATE_NEW = "__create_new__" as const;
const NO_PROJECT = null;

export const projectCommand = Command.make("project", {}, () =>
  Effect.gen(function* () {
    const config = yield* ConfigRepository;
    const auth = yield* AuthService;
    const projectRepo = yield* ProjectRepository;

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

    const projectChoice = yield* Effect.tryPromise({
      try: () =>
        clack.select({
          message: "Select a project",
          options: projectOptions,
        }),
      catch: () => PromptCancelledError.default,
    });

    if (clack.isCancel(projectChoice)) {
      clack.cancel("Cancelled");
      return;
    }

    let selectedProject: Project | undefined;

    if (projectChoice === CREATE_NEW) {
      // Create new project
      const projectName = yield* Effect.tryPromise({
        try: () =>
          clack.text({
            message: "Project name",
            placeholder: "My Project",
            validate: (v) => (!v ? "Name is required" : undefined),
          }),
        catch: () => PromptCancelledError.default,
      });

      if (clack.isCancel(projectName)) {
        clack.cancel("Cancelled");
        return;
      }

      const projectDesc = yield* Effect.tryPromise({
        try: () =>
          clack.text({
            message: "Description (optional)",
            placeholder: "A brief description of the project",
          }),
        catch: () => PromptCancelledError.default,
      });

      if (clack.isCancel(projectDesc)) {
        clack.cancel("Cancelled");
        return;
      }

      const createSpinner = clack.spinner();
      createSpinner.start("Creating project...");

      const createInput = { name: projectName as string } as { name: string; description?: string };
      if (projectDesc) {
        createInput.description = projectDesc as string;
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
