/**
 * ship start - Start working on a task
 *
 * Updates the task status to "In Progress" in Linear.
 * Does NOT create VCS changes - use `ship stack create` for that.
 *
 * This separation gives AI agents explicit control over:
 * - Task management (start/done)
 * - VCS operations (stack-create, stack-submit)
 */

import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";
import { IssueRepository } from "../../../../ports/IssueRepository.js";
import { UpdateTaskInput, type TaskId } from "../../../../domain/Task.js";

// === Command Definition ===

const taskIdArg = Args.text({ name: "task-id" }).pipe(
  Args.withDescription("Task identifier (e.g., ENG-123)"),
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

export const startCommand = Command.make(
  "start",
  { taskId: taskIdArg, json: jsonOption },
  ({ taskId, json }) =>
    Effect.gen(function* () {
      const config = yield* ConfigRepository;
      const issueRepo = yield* IssueRepository;

      yield* config.load();

      // Get the task
      const task = yield* issueRepo
        .getTaskByIdentifier(taskId)
        .pipe(Effect.catchTag("TaskNotFoundError", () => issueRepo.getTask(taskId as TaskId)));

      // Check if already in progress
      if (task.state.type === "started") {
        yield* json
          ? Console.log(JSON.stringify({ status: "already_in_progress", task: taskId }))
          : Console.log(`Task ${task.identifier} is already in progress (${task.state.name}).`);
        return;
      }

      // Warn if blocked (but continue)
      if (task.blockedBy.length > 0 && !json) {
        yield* Console.log(
          `Warning: Task ${task.identifier} is blocked by: ${task.blockedBy.join(", ")}`,
        );
        yield* Console.log("Consider working on the blocking tasks first.\n");
      }

      // Update status to in_progress
      const updatedTask = yield* issueRepo.updateTask(
        task.id,
        new UpdateTaskInput({
          title: Option.none(),
          description: Option.none(),
          status: Option.some("in_progress"),
          priority: Option.none(),
        }),
      );

      // Get branch name for reference (useful for stack-create)
      const branchName = yield* issueRepo.getBranchName(task.id);

      // Output
      if (json) {
        const output: Record<string, unknown> = {
          status: "started",
          task: {
            id: updatedTask.id,
            identifier: updatedTask.identifier,
            title: updatedTask.title,
            state: updatedTask.state.name,
            branchName,
          },
        };
        // Include warnings in JSON output
        if (task.blockedBy.length > 0) {
          output.warnings = [`Task is blocked by: ${task.blockedBy.join(", ")}`];
        }
        yield* Console.log(JSON.stringify(output));
      } else {
        yield* Console.log(`Started: ${updatedTask.identifier} - ${updatedTask.title}`);
        yield* Console.log(`Status: ${updatedTask.state.name}`);
        yield* Console.log(`\nTo create a VCS change, use:`);
        yield* Console.log(
          `  ship stack create -m "${updatedTask.identifier}: ${updatedTask.title}" -b ${branchName}`,
        );
      }
    }),
);
