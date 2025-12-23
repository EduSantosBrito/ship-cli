import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";
import type { Milestone } from "../../../../../domain/Task.js";
import { resolveMilestone, nameToSlug, formatDate } from "./shared.js";

const milestoneArg = Args.text({ name: "milestone" }).pipe(
  Args.withDescription("Milestone slug or ID (e.g., q1-release)"),
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

const formatMilestone = (milestone: Milestone): string[] => {
  const lines: string[] = [];

  lines.push(`${milestone.name}`);
  lines.push("─".repeat(50));
  lines.push(`Slug:        ${nameToSlug(milestone.name)}`);
  lines.push(`ID:          ${milestone.id}`);

  const targetDate = Option.match(milestone.targetDate, {
    onNone: () => "Not set",
    onSome: (d) => formatDate(d),
  });
  lines.push(`Target Date: ${targetDate}`);

  if (Option.isSome(milestone.description)) {
    lines.push("");
    lines.push("Description:");
    lines.push(milestone.description.value);
  }

  return lines;
};

export const showMilestoneCommand = Command.make(
  "show",
  { milestone: milestoneArg, json: jsonOption },
  ({ milestone, json }) =>
    Effect.gen(function* () {
      const config = yield* ConfigRepository;

      const cfg = yield* config.load();

      if (Option.isNone(cfg.linear.projectId)) {
        yield* Console.error("No project configured. Run 'ship project' to select a project.");
        return;
      }

      const resolved = yield* resolveMilestone(milestone, cfg.linear.projectId.value);

      if (json) {
        const output = {
          id: resolved.id,
          slug: nameToSlug(resolved.name),
          name: resolved.name,
          description: Option.getOrNull(resolved.description),
          targetDate: Option.match(resolved.targetDate, {
            onNone: () => null,
            onSome: (d) => d.toISOString().split("T")[0],
          }),
          projectId: resolved.projectId,
          sortOrder: resolved.sortOrder,
        };
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        for (const line of formatMilestone(resolved)) {
          yield* Console.log(line);
        }
      }
    }),
);
