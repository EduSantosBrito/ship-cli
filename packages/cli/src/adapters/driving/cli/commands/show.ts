import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { IssueRepository } from "../../../../ports/IssueRepository.js";
import type { Task, TaskId } from "../../../../domain/Task.js";

const taskIdArg = Args.text({ name: "task-id" }).pipe(
  Args.withDescription("Task identifier (e.g., ENG-123)"),
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

const formatTask = (task: Task): string[] => {
  const lines: string[] = [];

  lines.push(`${task.identifier}: ${task.title}`);
  lines.push("─".repeat(50));
  lines.push(`Status:   ${task.state.name}`);
  lines.push(`Priority: ${task.priority}`);

  if (Option.isSome(task.type)) {
    lines.push(`Type:     ${task.type.value}`);
  }

  if (task.labels.length > 0) {
    lines.push(`Labels:   ${task.labels.join(", ")}`);
  }

  if (Option.isSome(task.branchName)) {
    lines.push(`Branch:   ${task.branchName.value}`);
  }

  lines.push(`URL:      ${task.url}`);

  if (Option.isSome(task.description)) {
    lines.push("");
    lines.push("Description:");
    lines.push(task.description.value);
  }

  if (task.blockedBy.length > 0) {
    lines.push("");
    lines.push(`Blocked by: ${task.blockedBy.join(", ")}`);
  }

  if (task.blocks.length > 0) {
    lines.push(`Blocks: ${task.blocks.join(", ")}`);
  }

  if (task.subtasks.length > 0) {
    lines.push("");
    lines.push("Subtasks:");
    for (const subtask of task.subtasks) {
      const statusIndicator = subtask.isDone ? "✓" : "○";
      const priorityDisplay = subtask.priority !== "none" ? ` [${subtask.priority}]` : "";
      lines.push(
        `  ${statusIndicator} ${subtask.identifier}${priorityDisplay}: ${subtask.title} (${subtask.state})`,
      );
    }
  }

  return lines;
};

export const showCommand = Command.make(
  "show",
  { taskId: taskIdArg, json: jsonOption },
  ({ taskId, json }) =>
    Effect.gen(function* () {
      const issueRepo = yield* IssueRepository;

      // Try to get by identifier first (ENG-123 format)
      const task = yield* issueRepo.getTaskByIdentifier(taskId).pipe(
        Effect.catchTag("TaskNotFoundError", () =>
          // Fallback to ID lookup
          issueRepo.getTask(taskId as TaskId),
        ),
      );

      if (json) {
        const output = {
          id: task.id,
          identifier: task.identifier,
          title: task.title,
          description: Option.getOrNull(task.description),
          priority: task.priority,
          type: Option.getOrNull(task.type),
          state: task.state.name,
          stateType: task.state.type,
          labels: task.labels,
          url: task.url,
          branchName: Option.getOrNull(task.branchName),
          blockedBy: task.blockedBy,
          blocks: task.blocks,
          subtasks: task.subtasks.map((s) => ({
            id: s.id,
            identifier: s.identifier,
            title: s.title,
            state: s.state,
            stateType: s.stateType,
            priority: s.priority,
            isDone: s.isDone,
          })),
          createdAt: task.createdAt.toISOString(),
          updatedAt: task.updatedAt.toISOString(),
        };
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        for (const line of formatTask(task)) {
          yield* Console.log(line);
        }
      }
    }),
);
