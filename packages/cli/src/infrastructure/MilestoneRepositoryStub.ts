import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { MilestoneRepository } from "../ports/MilestoneRepository.js";
import type { MilestoneId, ProjectId } from "../domain/Task.js";
import { NotionApiError } from "../domain/Errors.js";

/**
 * Stub implementation of MilestoneRepository for providers that don't support milestones.
 *
 * This is used for Notion, which doesn't have a concept of milestones.
 * Users who need milestone functionality should use Linear.
 *
 * Design decisions:
 * - `listMilestones` returns `[]` to allow UI to render an empty state gracefully
 * - Other operations fail with clear errors to prevent accidental usage
 * - Errors are NotionApiError for consistency with other Notion adapter errors
 */
const make = Effect.succeed({
  getMilestone: (_id: MilestoneId) =>
    Effect.fail(
      new NotionApiError({
        message: "Milestones are not supported in Notion. Use Linear for milestone functionality.",
      }),
    ),

  /**
   * Returns empty array for listing - allows UI to show "no milestones" state
   * rather than an error when milestones aren't supported.
   */
  listMilestones: (_projectId: ProjectId) => Effect.succeed([] as const),

  createMilestone: () =>
    Effect.fail(
      new NotionApiError({
        message: "Creating milestones is not supported in Notion. Use Linear for milestone functionality.",
      }),
    ),

  updateMilestone: () =>
    Effect.fail(
      new NotionApiError({
        message: "Updating milestones is not supported in Notion. Use Linear for milestone functionality.",
      }),
    ),

  deleteMilestone: () =>
    Effect.fail(
      new NotionApiError({
        message: "Deleting milestones is not supported in Notion. Use Linear for milestone functionality.",
      }),
    ),
});

/**
 * Stub layer for MilestoneRepository.
 * Provides a minimal implementation that fails gracefully for unsupported operations.
 */
export const MilestoneRepositoryStub = Layer.effect(MilestoneRepository, make);
