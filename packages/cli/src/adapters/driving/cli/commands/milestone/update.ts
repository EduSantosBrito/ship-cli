import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";
import { MilestoneRepository } from "../../../../../ports/MilestoneRepository.js";
import { UpdateMilestoneInput } from "../../../../../domain/Task.js";
import { resolveMilestone, nameToSlug } from "./shared.js";
import { dryRunOption } from "../shared.js";

const milestoneArg = Args.text({ name: "milestone" }).pipe(
  Args.withDescription("Milestone slug or ID (e.g., q1-release)"),
);

const nameOption = Options.text("name").pipe(
  Options.withAlias("n"),
  Options.withDescription("New milestone name"),
  Options.optional,
);

const descriptionOption = Options.text("description").pipe(
  Options.withAlias("d"),
  Options.withDescription("New milestone description"),
  Options.optional,
);

const targetDateOption = Options.text("target-date").pipe(
  Options.withAlias("t"),
  Options.withDescription("New target date (YYYY-MM-DD format)"),
  Options.optional,
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

export const updateMilestoneCommand = Command.make(
  "update",
  {
    milestone: milestoneArg,
    name: nameOption,
    description: descriptionOption,
    targetDate: targetDateOption,
    json: jsonOption,
    dryRun: dryRunOption,
  },
  ({ milestone, name, description, targetDate, json, dryRun }) =>
    Effect.gen(function* () {
      const config = yield* ConfigRepository;
      const milestoneRepo = yield* MilestoneRepository;

      const cfg = yield* config.load();

      if (Option.isNone(cfg.linear.projectId)) {
        yield* Console.error("No project configured. Run 'ship project' to select a project.");
        return;
      }

      // Resolve milestone by slug or ID
      const resolved = yield* resolveMilestone(milestone, cfg.linear.projectId.value);

      // Parse target date if provided
      const parsedDate = Option.match(targetDate, {
        onNone: () => Option.none<Date>(),
        onSome: (dateStr) => {
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) {
            return Option.none<Date>();
          }
          return Option.some(date);
        },
      });

      // Warn if date parsing failed
      if (Option.isSome(targetDate) && Option.isNone(parsedDate)) {
        yield* Console.error(
          `Warning: Could not parse date "${targetDate.value}". Expected format: YYYY-MM-DD`,
        );
      }

      const input = new UpdateMilestoneInput({
        name: Option.match(name, {
          onNone: () => Option.none(),
          onSome: (n) => Option.some(n),
        }),
        description: Option.match(description, {
          onNone: () => Option.none(),
          onSome: (d) => Option.some(d),
        }),
        targetDate: parsedDate,
        sortOrder: Option.none(),
      });

      // Dry run: output what would be updated without making changes
      if (dryRun) {
        const changes: Record<string, unknown> = {};
        if (Option.isSome(name)) changes.name = name.value;
        if (Option.isSome(description)) changes.description = description.value;
        if (Option.isSome(parsedDate)) {
          changes.targetDate = parsedDate.value.toISOString().split("T")[0];
        }

        if (json) {
          yield* Console.log(
            JSON.stringify({
              dryRun: true,
              milestone: {
                id: resolved.id,
                name: resolved.name,
                slug: nameToSlug(resolved.name),
              },
              wouldUpdate: changes,
            }),
          );
        } else {
          yield* Console.log(`[DRY RUN] Would update milestone: ${resolved.name}`);
          if (Option.isSome(name)) {
            yield* Console.log(`  Name: ${name.value}`);
          }
          if (Option.isSome(description)) {
            yield* Console.log(`  Description: ${description.value}`);
          }
          if (Option.isSome(parsedDate)) {
            yield* Console.log(
              `  Target Date: ${parsedDate.value.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}`,
            );
          }
        }
        return;
      }

      const updated = yield* milestoneRepo.updateMilestone(resolved.id, input);

      if (json) {
        const output = {
          status: "updated",
          milestone: {
            id: updated.id,
            slug: nameToSlug(updated.name),
            name: updated.name,
            description: Option.getOrNull(updated.description),
            targetDate: Option.match(updated.targetDate, {
              onNone: () => null,
              onSome: (d) => d.toISOString().split("T")[0],
            }),
          },
        };
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* Console.log(`Updated milestone: ${updated.name}`);
        yield* Console.log(`Slug: ${nameToSlug(updated.name)}`);
        if (Option.isSome(updated.targetDate)) {
          yield* Console.log(
            `Target Date: ${updated.targetDate.value.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}`,
          );
        }
      }
    }),
);
