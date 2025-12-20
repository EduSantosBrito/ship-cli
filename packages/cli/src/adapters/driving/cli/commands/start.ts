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

      yield* config.load(); // Ensure initialized

      // Get the task
      const task = yield* issueRepo
        .getTaskByIdentifier(taskId)
        .pipe(Effect.catchTag("TaskNotFoundError", () => issueRepo.getTask(taskId as TaskId)));

      // Check if already in progress (Linear's "started" state type)
      if (task.state.type === "started") {
        if (json) {
          yield* Console.log(JSON.stringify({ status: "already_in_progress", task: taskId }));
        } else {
          yield* Console.log(`Task ${task.identifier} is already in progress (${task.state.name}).`);
        }
        return;
      }

      // Check if blocked
      if (task.blockedBy.length > 0) {
        if (json) {
          yield* Console.log(
            JSON.stringify({
              status: "blocked",
              task: taskId,
              blockedBy: task.blockedBy,
            }),
          );
        } else {
          yield* Console.log(
            `Warning: Task ${task.identifier} is blocked by: ${task.blockedBy.join(", ")}`,
          );
          yield* Console.log("Consider working on the blocking tasks first.");
        }
        // Continue anyway - user might want to start despite blockers
      }

      // Update status to in_progress
      const updateInput = new UpdateTaskInput({
        title: Option.none(),
        description: Option.none(),
        status: Option.some("in_progress"),
        priority: Option.none(),
      });

      const updatedTask = yield* issueRepo.updateTask(task.id, updateInput);

      // Get branch name
      const branchName = yield* issueRepo.getBranchName(task.id);

      if (json) {
        yield* Console.log(
          JSON.stringify({
            status: "started",
            task: {
              id: updatedTask.id,
              identifier: updatedTask.identifier,
              title: updatedTask.title,
              state: updatedTask.state.name,
              branchName,
            },
          }),
        );
      } else {
        yield* Console.log(`Started: ${updatedTask.identifier} - ${updatedTask.title}`);
        yield* Console.log(`Status: ${updatedTask.state.name}`);
        yield* Console.log(`\nBranch name: ${branchName}`);
        yield* Console.log("\nTo create a jj change with this branch (Phase 2):");
        yield* Console.log(`  jj new -m "${updatedTask.identifier}: ${updatedTask.title}"`);
        yield* Console.log(`  jj bookmark create ${branchName}`);
      }
    }),
);
