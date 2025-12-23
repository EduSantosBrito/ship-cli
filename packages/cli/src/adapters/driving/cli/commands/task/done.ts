import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";
import { IssueRepository } from "../../../../../ports/IssueRepository.js";
import { UpdateTaskInput, type TaskId } from "../../../../../domain/Task.js";
import { dryRunOption } from "../shared.js";

const taskIdArg = Args.text({ name: "task-id" }).pipe(
  Args.withDescription("Task identifier (e.g., ENG-123)"),
);

const reasonOption = Options.text("reason").pipe(
  Options.withAlias("r"),
  Options.withDescription("Reason or summary of completion"),
  Options.optional,
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

export const doneTaskCommand = Command.make(
  "done",
  { taskId: taskIdArg, reason: reasonOption, json: jsonOption, dryRun: dryRunOption },
  ({ taskId, reason, json, dryRun }) =>
    Effect.gen(function* () {
      const config = yield* ConfigRepository;
      const issueRepo = yield* IssueRepository;

      yield* config.load(); // Ensure initialized

      // Get the task
      const task = yield* issueRepo
        .getTaskByIdentifier(taskId)
        .pipe(Effect.catchTag("TaskNotFoundError", () => issueRepo.getTask(taskId as TaskId)));

      // Check if already done (Linear's "completed" or "canceled" state type)
      if (task.isDone) {
        if (json) {
          yield* Console.log(
            JSON.stringify({ status: "already_done", task: taskId, ...(dryRun ? { dryRun } : {}) }),
          );
        } else {
          const prefix = dryRun ? "[DRY RUN] " : "";
          yield* Console.log(
            `${prefix}Task ${task.identifier} is already done (${task.state.name}).`,
          );
        }
        return;
      }

      // Get tasks that would be unblocked (for dry run output)
      const blocking = task.blocks;

      // Dry run: output what would happen without making changes
      if (dryRun) {
        if (json) {
          yield* Console.log(
            JSON.stringify({
              dryRun: true,
              wouldComplete: {
                id: task.id,
                identifier: task.identifier,
                title: task.title,
                currentState: task.state.name,
              },
              reason: Option.getOrNull(reason),
              wouldUnblock: blocking,
            }),
          );
        } else {
          yield* Console.log(`[DRY RUN] Would complete task:`);
          yield* Console.log(`  Task: ${task.identifier} - ${task.title}`);
          yield* Console.log(`  Current state: ${task.state.name}`);
          if (Option.isSome(reason)) {
            yield* Console.log(`  Reason: ${reason.value}`);
          }
          if (blocking.length > 0) {
            yield* Console.log(`  Would unblock: ${blocking.join(", ")}`);
          }
        }
        return;
      }

      // Update status to done
      const updateInput = new UpdateTaskInput({
        title: Option.none(),
        description: Option.none(),
        status: Option.some("done"),
        priority: Option.none(),
        assigneeId: Option.none(),
        parentId: Option.none(),
        milestoneId: Option.none(),
      });

      const updatedTask = yield* issueRepo.updateTask(task.id, updateInput);

      // Clear session label from the task and delete if no longer used
      yield* issueRepo.clearSessionLabel(task.id);

      // Auto-unblock: remove this task as a blocker from any tasks it was blocking
      const unblockedTasks = yield* issueRepo.removeAsBlocker(task.id);

      if (json) {
        yield* Console.log(
          JSON.stringify({
            status: "completed",
            task: {
              id: updatedTask.id,
              identifier: updatedTask.identifier,
              title: updatedTask.title,
              state: updatedTask.state.name,
            },
            reason: Option.getOrNull(reason),
            unblocked: unblockedTasks,
          }),
        );
      } else {
        yield* Console.log(`Completed: ${updatedTask.identifier} - ${updatedTask.title}`);
        if (Option.isSome(reason)) {
          yield* Console.log(`Reason: ${reason.value}`);
        }
        if (unblockedTasks.length > 0) {
          yield* Console.log(`\nUnblocked: ${unblockedTasks.join(", ")}`);
        }
        yield* Console.log(`\nRun 'ship task ready' to see the next available task.`);
      }
    }),
);
