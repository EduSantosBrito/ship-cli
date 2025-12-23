import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";
import { MilestoneRepository } from "../../../../../ports/MilestoneRepository.js";
import type { Milestone } from "../../../../../domain/Task.js";
import { nameToSlug, formatDate } from "./shared.js";

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

const formatMilestone = (milestone: Milestone): string => {
  const slug = nameToSlug(milestone.name);
  const targetDate = Option.match(milestone.targetDate, {
    onNone: () => "No date".padEnd(15),
    onSome: (d) => formatDate(d).padEnd(15),
  });

  return `${slug.padEnd(25)} ${targetDate} ${milestone.name}`;
};

export const listMilestoneCommand = Command.make(
  "list",
  { json: jsonOption },
  ({ json }) =>
    Effect.gen(function* () {
      const config = yield* ConfigRepository;
      const milestoneRepo = yield* MilestoneRepository;

      const cfg = yield* config.load();

      if (Option.isNone(cfg.linear.projectId)) {
        yield* Console.error("No project configured. Run 'ship project' to select a project.");
        return;
      }

      const milestones = yield* milestoneRepo.listMilestones(cfg.linear.projectId.value);

      // Sort by target date (upcoming first, then no date)
      const sorted = [...milestones].sort((a, b) => {
        const aDate = Option.getOrNull(a.targetDate);
        const bDate = Option.getOrNull(b.targetDate);

        if (!aDate && !bDate) return a.sortOrder - b.sortOrder;
        if (!aDate) return 1;
        if (!bDate) return -1;
        return aDate.getTime() - bDate.getTime();
      });

      if (json) {
        const output = sorted.map((m) => ({
          id: m.id,
          slug: nameToSlug(m.name),
          name: m.name,
          description: Option.getOrNull(m.description),
          targetDate: Option.match(m.targetDate, {
            onNone: () => null,
            onSome: (d) => d.toISOString().split("T")[0],
          }),
          sortOrder: m.sortOrder,
        }));
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        if (sorted.length === 0) {
          yield* Console.log("No milestones found for this project.");
          yield* Console.log("");
          yield* Console.log("Create one with: ship milestone create \"Milestone Name\"");
        } else {
          yield* Console.log("Milestones:\n");
          yield* Console.log("SLUG                      TARGET DATE     NAME");
          yield* Console.log("─".repeat(70));
          for (const milestone of sorted) {
            yield* Console.log(formatMilestone(milestone));
          }
          yield* Console.log("");
          yield* Console.log("Use 'ship milestone show <slug>' to see milestone details.");
        }
      }
    }),
);
