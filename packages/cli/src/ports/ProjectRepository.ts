import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type { Project, TeamId } from "../domain/Task.js";
import type { LinearApiError, TaskError } from "../domain/Errors.js";

export interface CreateProjectInput {
  readonly name: string;
  readonly description?: string;
}

export interface ProjectRepository {
  readonly getProjects: (teamId: TeamId) => Effect.Effect<ReadonlyArray<Project>, LinearApiError>;
  readonly createProject: (
    teamId: TeamId,
    input: CreateProjectInput,
  ) => Effect.Effect<Project, TaskError | LinearApiError>;
}

export const ProjectRepository = Context.GenericTag<ProjectRepository>("ProjectRepository");
