import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";
import { IssueRepository } from "../../../../ports/IssueRepository.js";
import { MilestoneRepository } from "../../../../ports/MilestoneRepository.js";
import {
  TaskFilter,
  type TaskStatus,
  type Priority,
  type Task,
  type MilestoneId,
} from "../../../../domain/Task.js";

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

const statusOption = Options.choice("status", [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
]).pipe(Options.withAlias("s"), Options.withDescription("Filter by status"), Options.optional);

const priorityOption = Options.choice("priority", ["urgent", "high", "medium", "low", "none"]).pipe(
  Options.withAlias("P"),
  Options.withDescription("Filter by priority"),
  Options.optional,
);

const mineOption = Options.boolean("mine").pipe(
  Options.withAlias("m"),
  Options.withDescription("Show only tasks assigned to me"),
  Options.withDefault(false),
);

const allOption = Options.boolean("all").pipe(
  Options.withAlias("a"),
  Options.withDescription("Include completed and cancelled tasks"),
  Options.withDefault(false),
);

const milestoneOption = Options.text("milestone").pipe(
  Options.withAlias("M"),
  Options.withDescription("Filter by milestone (slug or ID)"),
  Options.optional,
);

/**
 * Generate a slug from a milestone name.
 * e.g., "Q1 Release" -> "q1-release"
 */
const nameToSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const formatTask = (task: Task): string => {
  const priority = task.priority === "urgent" ? "[!]" : task.priority === "high" ? "[^]" : "   ";
  const stateName = task.state.name.padEnd(11);
  const typeIndicator = Option.isSome(task.type)
    ? task.type.value === "bug"
      ? "(bug)"
      : task.type.value === "feature"
        ? "(feat)"
        : task.type.value === "epic"
          ? "(epic)"
          : task.type.value === "chore"
            ? "(chore)"
            : ""
    : "";
  const typeDisplay = typeIndicator ? `${typeIndicator.padEnd(7)} ` : "        ";
  const milestoneDisplay = Option.isSome(task.milestoneName)
    ? ` [${nameToSlug(task.milestoneName.value)}]`
    : "";
  return `${priority} ${task.identifier.padEnd(10)} ${stateName} ${typeDisplay}${task.title}${milestoneDisplay}`;
};

export const listCommand = Command.make(
  "list",
  {
    json: jsonOption,
    status: statusOption,
    priority: priorityOption,
    mine: mineOption,
    all: allOption,
    milestone: milestoneOption,
  },
  ({ json, status, priority, mine, all, milestone }) =>
    Effect.gen(function* () {
      const config = yield* ConfigRepository;
      const issueRepo = yield* IssueRepository;
      const milestoneRepo = yield* MilestoneRepository;

      const cfg = yield* config.load();

      // Resolve milestone slug to ID if provided
      const milestoneId = yield* Option.match(milestone, {
        onNone: () => Effect.succeed(Option.none<MilestoneId>()),
        onSome: (slugOrId) =>
          Effect.gen(function* () {
            if (Option.isNone(cfg.linear.projectId)) {
              return Option.none<MilestoneId>();
            }

            const milestones = yield* milestoneRepo.listMilestones(cfg.linear.projectId.value);
            const bySlug = milestones.find(
              (m) => nameToSlug(m.name) === slugOrId.toLowerCase(),
            );

            if (bySlug) {
              return Option.some(bySlug.id);
            }

            // Try direct ID match
            const byId = milestones.find((m) => m.id === slugOrId);
            if (byId) {
              return Option.some(byId.id);
            }

            // Not found - return none (will show no tasks)
            yield* Console.error(`Milestone not found: ${slugOrId}`);
            return Option.none<MilestoneId>();
          }),
      });

      const filter = new TaskFilter({
        status: Option.isSome(status) ? Option.some(status.value as TaskStatus) : Option.none(),
        priority: Option.isSome(priority) ? Option.some(priority.value as Priority) : Option.none(),
        projectId: cfg.linear.projectId,
        milestoneId,
        assignedToMe: mine,
        includeCompleted: all,
      });

      const taskList = yield* issueRepo.listTasks(cfg.linear.teamId, filter);

      if (json) {
        const output = taskList.map((t) => ({
          id: t.id,
          identifier: t.identifier,
          title: t.title,
          priority: t.priority,
          type: Option.getOrNull(t.type),
          state: t.state.name,
          stateType: t.state.type,
          labels: t.labels,
          url: t.url,
          branchName: Option.getOrNull(t.branchName),
          milestoneId: Option.getOrNull(t.milestoneId),
          milestoneName: Option.getOrNull(t.milestoneName),
        }));
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        if (taskList.length === 0) {
          yield* Console.log("No tasks found matching the filter.");
        } else {
          yield* Console.log(`Found ${taskList.length} task(s):\n`);
          yield* Console.log("PRI IDENTIFIER  STATUS      TYPE     TITLE");
          yield* Console.log("─".repeat(70));
          for (const task of taskList) {
            yield* Console.log(formatTask(task));
          }
        }
      }
    }),
);
