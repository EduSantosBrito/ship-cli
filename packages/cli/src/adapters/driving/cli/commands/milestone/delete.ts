import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";
import { MilestoneRepository } from "../../../../../ports/MilestoneRepository.js";
import { resolveMilestone, nameToSlug } from "./shared.js";
import { dryRunOption } from "../shared.js";

const milestoneArg = Args.text({ name: "milestone" }).pipe(
  Args.withDescription("Milestone slug or ID (e.g., q1-release)"),
);

const forceOption = Options.boolean("force").pipe(
  Options.withAlias("f"),
  Options.withDescription("Skip confirmation"),
  Options.withDefault(false),
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

export const deleteMilestoneCommand = Command.make(
  "delete",
  { milestone: milestoneArg, force: forceOption, json: jsonOption, dryRun: dryRunOption },
  ({ milestone, force, json, dryRun }) =>
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

      // Dry run: output what would be deleted without making changes
      if (dryRun) {
        if (json) {
          yield* Console.log(
            JSON.stringify({
              dryRun: true,
              wouldDelete: {
                id: resolved.id,
                name: resolved.name,
                slug: nameToSlug(resolved.name),
              },
            }),
          );
        } else {
          yield* Console.log(`[DRY RUN] Would delete milestone:`);
          yield* Console.log(`  Name: ${resolved.name}`);
          yield* Console.log(`  Slug: ${nameToSlug(resolved.name)}`);
        }
        return;
      }

      if (!force && !json) {
        yield* Console.log(`About to delete milestone: ${resolved.name}`);
        yield* Console.log("Use --force to skip this confirmation.");
        yield* Console.log("");
        yield* Console.log(
          "Note: In a future version, this will prompt for confirmation interactively.",
        );
        return;
      }

      yield* milestoneRepo.deleteMilestone(resolved.id);

      if (json) {
        const output = {
          status: "deleted",
          milestone: {
            id: resolved.id,
            slug: nameToSlug(resolved.name),
            name: resolved.name,
          },
        };
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* Console.log(`Deleted milestone: ${resolved.name}`);
      }
    }),
);
