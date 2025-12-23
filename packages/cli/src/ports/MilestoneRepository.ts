import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type {
  CreateMilestoneInput,
  Milestone,
  MilestoneId,
  ProjectId,
  UpdateMilestoneInput,
} from "../domain/Task.js";
import type { LinearApiError, MilestoneNotFoundError, TaskError } from "../domain/Errors.js";

export interface MilestoneRepository {
  /** Get a milestone by its Linear ID */
  readonly getMilestone: (
    id: MilestoneId,
  ) => Effect.Effect<Milestone, MilestoneNotFoundError | LinearApiError>;

  /** List all milestones for a project */
  readonly listMilestones: (
    projectId: ProjectId,
  ) => Effect.Effect<ReadonlyArray<Milestone>, LinearApiError>;

  /** Create a new milestone in a project */
  readonly createMilestone: (
    projectId: ProjectId,
    input: CreateMilestoneInput,
  ) => Effect.Effect<Milestone, TaskError | LinearApiError>;

  /** Update an existing milestone */
  readonly updateMilestone: (
    id: MilestoneId,
    input: UpdateMilestoneInput,
  ) => Effect.Effect<Milestone, MilestoneNotFoundError | TaskError | LinearApiError>;

  /** Delete a milestone */
  readonly deleteMilestone: (
    id: MilestoneId,
  ) => Effect.Effect<void, MilestoneNotFoundError | LinearApiError>;
}

export const MilestoneRepository = Context.GenericTag<MilestoneRepository>("MilestoneRepository");
