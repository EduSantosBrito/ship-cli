import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Duration from "effect/Duration";
import { MilestoneRepository } from "../../../ports/MilestoneRepository.js";
import { LinearClientService } from "./LinearClient.js";
import {
  Milestone,
  type MilestoneId,
  type ProjectId,
  type CreateMilestoneInput,
  type UpdateMilestoneInput,
} from "../../../domain/Task.js";
import { LinearApiError, MilestoneNotFoundError, TaskError } from "../../../domain/Errors.js";
import { mapMilestone } from "./Mapper.js";

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
      onTimeout: () => new LinearApiError({ message: `${operation} timed out after 30 seconds` }),
    }),
    Effect.retry(retryPolicy),
  );

const make = Effect.gen(function* () {
  const linearClient = yield* LinearClientService;

  const getMilestone = (
    id: MilestoneId,
  ): Effect.Effect<Milestone, MilestoneNotFoundError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const milestone = yield* Effect.tryPromise({
          try: () => client.projectMilestone(id),
          catch: (e) =>
            new LinearApiError({ message: `Failed to fetch milestone: ${e}`, cause: e }),
        });

        if (!milestone) {
          return yield* new MilestoneNotFoundError({ milestoneId: id });
        }

        // Get the project ID from the milestone
        const project = yield* Effect.tryPromise({
          try: async () => {
            const p = await (milestone.project as Promise<unknown>);
            return p as { id?: string } | undefined;
          },
          catch: (e) =>
            new LinearApiError({ message: `Failed to fetch milestone project: ${e}`, cause: e }),
        });

        if (!project?.id) {
          return yield* new LinearApiError({ message: "Milestone has no associated project" });
        }

        return mapMilestone(milestone, project.id);
      }),
      "Fetching milestone",
    );

  const listMilestones = (
    projectId: ProjectId,
  ): Effect.Effect<ReadonlyArray<Milestone>, LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const project = yield* Effect.tryPromise({
          try: () => client.project(projectId),
          catch: (e) => new LinearApiError({ message: `Failed to fetch project: ${e}`, cause: e }),
        });

        const milestones = yield* Effect.tryPromise({
          try: () => project.projectMilestones(),
          catch: (e) =>
            new LinearApiError({ message: `Failed to fetch milestones: ${e}`, cause: e }),
        });

        return milestones.nodes.map((m) => mapMilestone(m, projectId));
      }),
      "Listing milestones",
    );

  const createMilestone = (
    projectId: ProjectId,
    input: CreateMilestoneInput,
  ): Effect.Effect<Milestone, TaskError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const createInput: {
          name: string;
          projectId: string;
          description?: string;
          targetDate?: string;
          sortOrder?: number;
        } = {
          name: input.name,
          projectId: projectId,
        };

        if (Option.isSome(input.description)) {
          createInput.description = input.description.value;
        }

        if (Option.isSome(input.targetDate)) {
          // Format date as YYYY-MM-DD for Linear's TimelessDate
          createInput.targetDate = input.targetDate.value.toISOString().split("T")[0];
        }

        if (input.sortOrder !== undefined) {
          createInput.sortOrder = input.sortOrder;
        }

        const result = yield* Effect.tryPromise({
          try: () => client.createProjectMilestone(createInput),
          catch: (e) =>
            new LinearApiError({ message: `Failed to create milestone: ${e}`, cause: e }),
        });

        if (!result.success) {
          return yield* new TaskError({ message: "Failed to create milestone" });
        }

        const milestone = yield* Effect.tryPromise({
          try: async () => {
            const m = await (result.projectMilestone as Promise<unknown>);
            if (!m) throw new Error("Milestone not returned");
            return m as typeof result extends { projectMilestone: infer T } ? Awaited<T> : never;
          },
          catch: (e) =>
            new LinearApiError({ message: `Failed to get created milestone: ${e}`, cause: e }),
        });

        return mapMilestone(milestone!, projectId);
      }),
      "Creating milestone",
    );

  const updateMilestone = (
    id: MilestoneId,
    input: UpdateMilestoneInput,
  ): Effect.Effect<Milestone, MilestoneNotFoundError | TaskError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const updateInput: {
          name?: string;
          description?: string;
          targetDate?: string | null;
          sortOrder?: number;
        } = {};

        if (Option.isSome(input.name)) {
          updateInput.name = input.name.value;
        }

        if (Option.isSome(input.description)) {
          updateInput.description = input.description.value;
        }

        if (Option.isSome(input.targetDate)) {
          // Format date as YYYY-MM-DD for Linear's TimelessDate
          updateInput.targetDate = input.targetDate.value.toISOString().split("T")[0];
        }

        if (Option.isSome(input.sortOrder)) {
          updateInput.sortOrder = input.sortOrder.value;
        }

        const result = yield* Effect.tryPromise({
          try: () => client.updateProjectMilestone(id, updateInput),
          catch: (e) =>
            new LinearApiError({ message: `Failed to update milestone: ${e}`, cause: e }),
        });

        if (!result.success) {
          return yield* new TaskError({ message: "Failed to update milestone" });
        }

        const milestone = yield* Effect.tryPromise({
          try: async () => {
            const m = await (result.projectMilestone as Promise<unknown>);
            if (!m) throw new Error("Milestone not returned");
            return m as typeof result extends { projectMilestone: infer T } ? Awaited<T> : never;
          },
          catch: (e) =>
            new LinearApiError({ message: `Failed to get updated milestone: ${e}`, cause: e }),
        });

        // Get the project ID from the milestone
        const project = yield* Effect.tryPromise({
          try: async () => {
            const p = await (milestone!.project as Promise<unknown>);
            return p as { id?: string } | undefined;
          },
          catch: (e) =>
            new LinearApiError({ message: `Failed to fetch milestone project: ${e}`, cause: e }),
        });

        if (!project?.id) {
          return yield* new LinearApiError({ message: "Milestone has no associated project" });
        }

        return mapMilestone(milestone!, project.id);
      }),
      "Updating milestone",
    );

  const deleteMilestone = (
    id: MilestoneId,
  ): Effect.Effect<void, MilestoneNotFoundError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const result = yield* Effect.tryPromise({
          try: () => client.deleteProjectMilestone(id),
          catch: (e) =>
            new LinearApiError({ message: `Failed to delete milestone: ${e}`, cause: e }),
        });

        if (!result.success) {
          return yield* new MilestoneNotFoundError({ milestoneId: id });
        }
      }),
      "Deleting milestone",
    );

  return {
    getMilestone,
    listMilestones,
    createMilestone,
    updateMilestone,
    deleteMilestone,
  };
});

export const MilestoneRepositoryLive = Layer.effect(MilestoneRepository, make);
