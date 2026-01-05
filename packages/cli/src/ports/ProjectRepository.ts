import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type { Project, TeamId } from "../domain/Task.js";
import type { TaskApiError, TaskError } from "../domain/Errors.js";

export interface CreateProjectInput {
  readonly name: string;
  readonly description?: string;
}

export interface ProjectRepository {
  readonly getProjects: (teamId: TeamId) => Effect.Effect<ReadonlyArray<Project>, TaskApiError>;
  readonly createProject: (
    teamId: TeamId,
    input: CreateProjectInput,
  ) => Effect.Effect<Project, TaskError | TaskApiError>;
}

export const ProjectRepository = Context.GenericTag<ProjectRepository>("ProjectRepository");
