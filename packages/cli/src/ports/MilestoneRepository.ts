import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type {
  CreateMilestoneInput,
  Milestone,
  MilestoneId,
  ProjectId,
  UpdateMilestoneInput,
} from "../domain/Task.js";
import type { TaskApiError, MilestoneNotFoundError, TaskError } from "../domain/Errors.js";

export interface MilestoneRepository {
  /** Get a milestone by its Linear ID */
  readonly getMilestone: (
    id: MilestoneId,
  ) => Effect.Effect<Milestone, MilestoneNotFoundError | TaskApiError>;

  /** List all milestones for a project */
  readonly listMilestones: (
    projectId: ProjectId,
  ) => Effect.Effect<ReadonlyArray<Milestone>, TaskApiError>;

  /** Create a new milestone in a project */
  readonly createMilestone: (
    projectId: ProjectId,
    input: CreateMilestoneInput,
  ) => Effect.Effect<Milestone, TaskError | TaskApiError>;

  /** Update an existing milestone */
  readonly updateMilestone: (
    id: MilestoneId,
    input: UpdateMilestoneInput,
  ) => Effect.Effect<Milestone, MilestoneNotFoundError | TaskError | TaskApiError>;

  /** Delete a milestone */
  readonly deleteMilestone: (
    id: MilestoneId,
  ) => Effect.Effect<void, MilestoneNotFoundError | TaskApiError>;
}

export const MilestoneRepository = Context.GenericTag<MilestoneRepository>("MilestoneRepository");
