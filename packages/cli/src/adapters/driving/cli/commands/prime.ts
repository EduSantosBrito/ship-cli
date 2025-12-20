import * as Command from "@effect/cli/Command";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";
import { IssueRepository } from "../../../../ports/IssueRepository.js";
import { TaskFilter, type Task } from "../../../../domain/Task.js";

const AGENT_GUIDANCE = `## Agent Restrictions

1. **Never create issues without user confirmation**
2. **Check blockers before starting work** - blocked tasks should be surfaced
3. **Small, focused tasks only** - if a task seems too large, suggest splitting
4. **Always update status** - in_progress when starting, done when complete
5. **Stack blocking tasks** - work on blockers first, stack changes appropriately
6. **Use conventional commits** - format: type(TASK-ID): description

## CLI Commands

- \`ship ready --json\` - List tasks with no blockers
- \`ship show <id> --json\` - Show task details
- \`ship start <id>\` - Begin work (sets status to in_progress)
- \`ship done <id> --reason "msg"\` - Complete task
- \`ship blocked --json\` - Show blocked tasks
- \`ship block <blocker> <blocked>\` - Create blocking relationship
- \`ship unblock <blocker> <blocked>\` - Remove blocking relationship
- \`ship list --json\` - List all tasks
- \`ship create "title" -p priority -t type\` - Create new task

Always use \`--json\` flag for programmatic output.`;

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

    // Build context output
    const lines: string[] = [];

    lines.push("<ship-context>");
    lines.push(`Team: ${cfg.linear.teamKey}`);
    if (Option.isSome(cfg.linear.projectId)) {
      lines.push(`Project: ${cfg.linear.projectId.value}`);
    }
    lines.push("");

    if (inProgressTasks.length > 0) {
      lines.push("## In Progress");
      for (const task of inProgressTasks) {
        lines.push(`- ${formatTaskCompact(task)}`);
      }
      lines.push("");
    }

    if (readyTasks.length > 0) {
      lines.push("## Ready to Work");
      for (const task of readyTasks.slice(0, 10)) {
        lines.push(`- ${formatTaskCompact(task)}`);
      }
      if (readyTasks.length > 10) {
        lines.push(`  ... and ${readyTasks.length - 10} more`);
      }
      lines.push("");
    }

    if (blockedTasks.length > 0) {
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
      lines.push("");
    }

    lines.push("</ship-context>");
    lines.push("");
    lines.push("<ship-guidance>");
    lines.push(AGENT_GUIDANCE);
    lines.push("</ship-guidance>");

    yield* Console.log(lines.join("\n"));
  }),
);
