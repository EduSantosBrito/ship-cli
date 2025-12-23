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

const formatBlockedTask = (task: Task): string[] => {
  const lines: string[] = [];
  lines.push(`${task.identifier}: ${task.title}`);
  lines.push(`  Status: ${task.state.name}`);
  lines.push(`  Priority: ${task.priority}`);
  if (Option.isSome(task.milestoneName)) {
    lines.push(`  Milestone: ${task.milestoneName.value}`);
  }
  if (task.blockedBy.length > 0) {
    lines.push(`  Blocked by: ${task.blockedBy.join(", ")}`);
  }
  return lines;
};

export const blockedTaskCommand = Command.make("blocked", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const config = yield* ConfigRepository;
    const issueRepo = yield* IssueRepository;

    const cfg = yield* config.load();
    const projectId = Option.getOrUndefined(cfg.linear.projectId);
    const blockedTasks = yield* issueRepo.getBlockedTasks(cfg.linear.teamId, projectId);

    if (json) {
      const output = blockedTasks.map((t) => ({
        id: t.id,
        identifier: t.identifier,
        title: t.title,
        priority: t.priority,
        state: t.state.name,
        stateType: t.state.type,
        blockedBy: t.blockedBy,
        url: t.url,
        milestoneId: Option.getOrNull(t.milestoneId),
        milestoneName: Option.getOrNull(t.milestoneName),
      }));
      yield* Console.log(JSON.stringify(output, null, 2));
    } else {
      if (blockedTasks.length === 0) {
        yield* Console.log("No blocked tasks found.");
      } else {
        yield* Console.log(`Found ${blockedTasks.length} blocked task(s):\n`);
        for (const task of blockedTasks) {
          for (const line of formatBlockedTask(task)) {
            yield* Console.log(line);
          }
          yield* Console.log("");
        }
      }
    }
  }),
);
