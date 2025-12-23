import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";
import { MilestoneRepository } from "../../../../../ports/MilestoneRepository.js";
import { CreateMilestoneInput } from "../../../../../domain/Task.js";
import { nameToSlug } from "./shared.js";
import { dryRunOption } from "../shared.js";

const nameArg = Args.text({ name: "name" }).pipe(Args.withDescription("Milestone name"));

const descriptionOption = Options.text("description").pipe(
  Options.withAlias("d"),
  Options.withDescription("Milestone description"),
  Options.optional,
);

const targetDateOption = Options.text("target-date").pipe(
  Options.withAlias("t"),
  Options.withDescription("Target date (YYYY-MM-DD format)"),
  Options.optional,
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

export const createMilestoneCommand = Command.make(
  "create",
  {
    name: nameArg,
    description: descriptionOption,
    targetDate: targetDateOption,
    json: jsonOption,
    dryRun: dryRunOption,
  },
  ({ name, description, targetDate, json, dryRun }) =>
    Effect.gen(function* () {
      const config = yield* ConfigRepository;
      const milestoneRepo = yield* MilestoneRepository;

      const cfg = yield* config.load();

      if (Option.isNone(cfg.linear.projectId)) {
        yield* Console.error("No project configured. Run 'ship project' to select a project.");
        return;
      }

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

      const input = new CreateMilestoneInput({
        name,
        description: Option.match(description, {
          onNone: () => Option.none(),
          onSome: (d) => Option.some(d),
        }),
        targetDate: parsedDate,
        sortOrder: 0,
      });

      // Dry run: output what would be created without making changes
      if (dryRun) {
        if (json) {
          yield* Console.log(
            JSON.stringify({
              dryRun: true,
              wouldCreate: {
                name,
                slug: nameToSlug(name),
                description: Option.getOrNull(description),
                targetDate: Option.match(parsedDate, {
                  onNone: () => null,
                  onSome: (d) => d.toISOString().split("T")[0],
                }),
              },
            }),
          );
        } else {
          yield* Console.log(`[DRY RUN] Would create milestone:`);
          yield* Console.log(`  Name: ${name}`);
          yield* Console.log(`  Slug: ${nameToSlug(name)}`);
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

      const milestone = yield* milestoneRepo.createMilestone(cfg.linear.projectId.value, input);

      if (json) {
        const output = {
          status: "created",
          milestone: {
            id: milestone.id,
            slug: nameToSlug(milestone.name),
            name: milestone.name,
            description: Option.getOrNull(milestone.description),
            targetDate: Option.match(milestone.targetDate, {
              onNone: () => null,
              onSome: (d) => d.toISOString().split("T")[0],
            }),
          },
        };
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* Console.log(`Created milestone: ${milestone.name}`);
        yield* Console.log(`Slug: ${nameToSlug(milestone.name)}`);
        if (Option.isSome(milestone.targetDate)) {
          yield* Console.log(
            `Target Date: ${milestone.targetDate.value.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}`,
          );
        }
        yield* Console.log("");
        yield* Console.log(
          `Use 'ship milestone show ${nameToSlug(milestone.name)}' to view details.`,
        );
      }
    }),
);
