import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { Milestone, MilestoneId, ProjectId } from "../../../../../domain/Task.js";
import { MilestoneRepository } from "../../../../../ports/MilestoneRepository.js";
import { MilestoneNotFoundError, type TaskApiError } from "../../../../../domain/Errors.js";

/**
 * Generate a slug from a milestone name.
 * e.g., "Q1 Release" -> "q1-release"
 */
export const nameToSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Resolve a milestone by slug or ID.
 * First tries to match by slug, then falls back to direct ID lookup.
 */
export const resolveMilestone = (
  slugOrId: string,
  projectId: ProjectId,
): Effect.Effect<Milestone, MilestoneNotFoundError | TaskApiError, MilestoneRepository> =>
  Effect.gen(function* () {
    const milestoneRepo = yield* MilestoneRepository;

    // First, try to find by slug
    const milestones = yield* milestoneRepo.listMilestones(projectId);

    const bySlug = milestones.find((m) => nameToSlug(m.name) === slugOrId.toLowerCase());
    if (bySlug) {
      return bySlug;
    }

    // Try direct ID lookup (for UUIDs)
    return yield* milestoneRepo.getMilestone(slugOrId as MilestoneId);
  });

/**
 * Format a date for display.
 */
export const formatDate = (date: Date): string => {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

/**
 * Format a milestone for list display.
 */
export const formatMilestoneRow = (milestone: Milestone): string => {
  const slug = nameToSlug(milestone.name);
  const targetDate = Option.match(milestone.targetDate, {
    onNone: () => "No date",
    onSome: (d) => formatDate(d),
  });

  return `${slug.padEnd(25)} ${targetDate.padEnd(15)} ${milestone.name}`;
};
