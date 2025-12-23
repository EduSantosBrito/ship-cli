import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";
import { IssueRepository } from "../../../../../ports/IssueRepository.js";
import type { Task } from "../../../../../domain/Task.js";

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

const formatTaskDetailed = (task: Task): string[] => {
  const lines: string[] = [];
  const priority =
    task.priority === "urgent"
      ? "URGENT"
      : task.priority === "high"
        ? "HIGH"
        : task.priority === "medium"
          ? "MEDIUM"
          : task.priority === "low"
            ? "LOW"
            : "";

  lines.push(`${task.identifier}: ${task.title}`);
  if (priority) lines.push(`  Priority: ${priority}`);
  if (Option.isSome(task.milestoneName)) lines.push(`  Milestone: ${task.milestoneName.value}`);
  if (task.labels.length > 0) lines.push(`  Labels: ${task.labels.join(", ")}`);
  if (Option.isSome(task.branchName)) lines.push(`  Branch: ${task.branchName.value}`);
  lines.push(`  URL: ${task.url}`);
  return lines;
};

export const readyTaskCommand = Command.make("ready", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const config = yield* ConfigRepository;
    const issueRepo = yield* IssueRepository;

    const cfg = yield* config.load();
    const projectId = Option.getOrUndefined(cfg.linear.projectId);
    const readyTasks = yield* issueRepo.getReadyTasks(cfg.linear.teamId, projectId);

    if (json) {
      const output = readyTasks.map((t) => ({
        id: t.id,
        identifier: t.identifier,
        title: t.title,
        priority: t.priority,
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
      if (readyTasks.length === 0) {
        yield* Console.log("No ready tasks found.");
        yield* Console.log("All tasks may be blocked or completed.");
      } else {
        yield* Console.log(`Found ${readyTasks.length} ready task(s):\n`);
        for (const task of readyTasks) {
          for (const line of formatTaskDetailed(task)) {
            yield* Console.log(line);
          }
          yield* Console.log("");
        }
        yield* Console.log("---");
        yield* Console.log('Before starting work, read the skill: skill(name="ship-cli")');
      }
    }
  }),
);
