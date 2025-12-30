import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Duration from "effect/Duration";
import {
  ProjectRepository,
  type CreateProjectInput,
} from "../../../ports/ProjectRepository.js";
import { LinearClientService } from "./LinearClient.js";
import { Project, type TeamId } from "../../../domain/Task.js";
import { LinearApiError, TaskError } from "../../../domain/Errors.js";
import { mapProject } from "./Mapper.js";

// Retry policy: exponential backoff with max 3 retries
const retryPolicy = Schedule.intersect(
  Schedule.exponential(Duration.millis(100)),
  Schedule.recurs(3),
);

// Timeout for API calls: 30 seconds
const API_TIMEOUT = Duration.seconds(30);

const withRetryAndTimeout = <A, E>(
  effect: Effect.Effect<A, E>,
  operation: string,
): Effect.Effect<A, E | LinearApiError> =>
  effect.pipe(
    Effect.timeoutFail({
      duration: API_TIMEOUT,
      onTimeout: () =>
        new LinearApiError({
          message: `${operation} timed out after 30 seconds`,
        }),
    }),
    Effect.retry(retryPolicy),
  );

const make = Effect.gen(function* () {
  const linearClient = yield* LinearClientService;

  const getProjects = (
    teamId: TeamId,
  ): Effect.Effect<ReadonlyArray<Project>, LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();
        const team = yield* Effect.tryPromise({
          try: () => client.team(teamId),
          catch: (e) =>
            new LinearApiError({
              message: `Failed to fetch team: ${e}`,
              cause: e,
            }),
        });
        const projects = yield* Effect.tryPromise({
          try: () => team.projects(),
          catch: (e) =>
            new LinearApiError({
              message: `Failed to fetch projects: ${e}`,
              cause: e,
            }),
        });
        return projects.nodes.map((p) => mapProject(p, teamId));
      }),
      "Fetching projects",
    );

  const createProject = (
    teamId: TeamId,
    input: CreateProjectInput,
  ): Effect.Effect<Project, TaskError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const createInput: {
          name: string;
          description?: string;
          teamIds: string[];
        } = {
          name: input.name,
          teamIds: [teamId],
        };
        if (input.description) {
          createInput.description = input.description;
        }

        const result = yield* Effect.tryPromise({
          try: () => client.createProject(createInput),
          catch: (e) =>
            new LinearApiError({
              message: `Failed to create project: ${e}`,
              cause: e,
            }),
        });

        if (!result.success) {
          return yield* Effect.fail(
            new TaskError({ message: "Failed to create project" }),
          );
        }

        if (!result.project) {
          return yield* Effect.fail(
            new TaskError({ message: "Project not returned after create" }),
          );
        }
        const project = yield* Effect.tryPromise({
          try: () => result.project!,
          catch: (e) =>
            new LinearApiError({
              message: `Failed to get created project: ${e}`,
              cause: e,
            }),
        });

        return mapProject(project, teamId);
      }),
      "Creating project",
    );

  return {
    getProjects,
    createProject,
  };
});

export const ProjectRepositoryLive = Layer.effect(ProjectRepository, make);
