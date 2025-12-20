import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";
import { IssueRepository } from "../../../../ports/IssueRepository.js";
import { UpdateTaskInput, type TaskId } from "../../../../domain/Task.js";

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

export const doneCommand = Command.make(
  "done",
  { taskId: taskIdArg, reason: reasonOption, json: jsonOption },
  ({ taskId, reason, json }) =>
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
          yield* Console.log(JSON.stringify({ status: "already_done", task: taskId }));
        } else {
          yield* Console.log(`Task ${task.identifier} is already done (${task.state.name}).`);
        }
        return;
      }

      // Update status to done
      const updateInput = new UpdateTaskInput({
        title: Option.none(),
        description: Option.none(),
        status: Option.some("done"),
        priority: Option.none(),
      });

      const updatedTask = yield* issueRepo.updateTask(task.id, updateInput);

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
          }),
        );
      } else {
        yield* Console.log(`Completed: ${updatedTask.identifier} - ${updatedTask.title}`);
        if (Option.isSome(reason)) {
          yield* Console.log(`Reason: ${reason.value}`);
        }
        yield* Console.log(`\nRun 'ship ready' to see the next available task.`);
      }
    }),
);
