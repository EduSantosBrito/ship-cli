import * as Command from "@effect/cli/Command";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";
import { IssueRepository } from "../../../../ports/IssueRepository.js";
import { TaskFilter, type Task } from "../../../../domain/Task.js";

const formatTaskCompact = (task: Task): string => {
  const priority = task.priority === "urgent" ? "!" : task.priority === "high" ? "^" : "";
  return `${priority}${task.identifier}: ${task.title} [${task.state.name}]`;
};

export const primeCommand = Command.make("prime", {}, () =>
  Effect.gen(function* () {
    const config = yield* ConfigRepository;
    const issueRepo = yield* IssueRepository;

    const cfg = yield* config.load();
    const projectId = Option.getOrUndefined(cfg.linear.projectId);

    // Get ready and blocked tasks
    const [readyTasks, blockedTasks] = yield* Effect.all([
      issueRepo.getReadyTasks(cfg.linear.teamId, projectId),
      issueRepo.getBlockedTasks(cfg.linear.teamId, projectId),
    ]);

    // Get in-progress tasks (filter by "started" state type)
    const filter = new TaskFilter({
      status: Option.some("in_progress"),
      priority: Option.none(),
      projectId: cfg.linear.projectId,
      assignedToMe: false,
    });
    const allTasks = yield* issueRepo.listTasks(cfg.linear.teamId, filter);

    // Filter to only "started" state type tasks
    const inProgressTasks = allTasks.filter((t: Task) => t.state.type === "started");

    // Build context output (plain markdown, no XML tags - plugin wraps it)
    const lines: string[] = [];

    lines.push(`Team: ${cfg.linear.teamKey}`);
    if (Option.isSome(cfg.linear.projectId)) {
      lines.push(`Project: ${cfg.linear.projectId.value}`);
    }

    if (inProgressTasks.length > 0) {
      lines.push("");
      lines.push("## In Progress");
      for (const task of inProgressTasks) {
        lines.push(`- ${formatTaskCompact(task)}`);
      }
    }

    if (readyTasks.length > 0) {
      lines.push("");
      lines.push("## Ready to Work");
      for (const task of readyTasks.slice(0, 10)) {
        lines.push(`- ${formatTaskCompact(task)}`);
      }
      if (readyTasks.length > 10) {
        lines.push(`  ... and ${readyTasks.length - 10} more`);
      }
    }

    if (blockedTasks.length > 0) {
      lines.push("");
      lines.push("## Blocked");
      for (const task of blockedTasks.slice(0, 5)) {
        lines.push(`- ${formatTaskCompact(task)}`);
        if (task.blockedBy.length > 0) {
          lines.push(`  Blocked by: ${task.blockedBy.join(", ")}`);
        }
      }
      if (blockedTasks.length > 5) {
        lines.push(`  ... and ${blockedTasks.length - 5} more`);
      }
    }

    yield* Console.log(lines.join("\n"));
  }),
);
