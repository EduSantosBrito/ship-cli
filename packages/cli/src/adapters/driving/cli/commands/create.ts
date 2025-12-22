import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";
import { IssueRepository } from "../../../../ports/IssueRepository.js";
import { CreateTaskInput, Priority, TaskType, TaskId } from "../../../../domain/Task.js";
import { TaskError } from "../../../../domain/Errors.js";

const titleArg = Args.text({ name: "title" }).pipe(Args.withDescription("Task title"));

const descriptionOption = Options.text("description").pipe(
  Options.withAlias("d"),
  Options.withDescription("Task description"),
  Options.optional,
);

const priorityOption = Options.choice("priority", ["urgent", "high", "medium", "low", "none"]).pipe(
  Options.withAlias("p"),
  Options.withDescription("Task priority"),
  Options.withDefault("medium" as const),
);

const typeOption = Options.choice("type", ["bug", "feature", "task", "epic", "chore"]).pipe(
  Options.withAlias("t"),
  Options.withDescription("Task type"),
  Options.withDefault("task" as const),
);

const parentOption = Options.text("parent").pipe(
  Options.withDescription("Parent task identifier (e.g., BRI-123) to create as subtask"),
  Options.optional,
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

export const createCommand = Command.make(
  "create",
  {
    title: titleArg,
    description: descriptionOption,
    priority: priorityOption,
    type: typeOption,
    parent: parentOption,
    json: jsonOption,
  },
  ({ title, description, priority, type, parent, json }) =>
    Effect.gen(function* () {
      const config = yield* ConfigRepository;
      const issueRepo = yield* IssueRepository;

      const cfg = yield* config.load();

      // If parent identifier provided, resolve it to a TaskId
      const parentId = yield* Option.match(parent, {
        onNone: () => Effect.succeed(Option.none<TaskId>()),
        onSome: (parentIdentifier) =>
          issueRepo.getTaskByIdentifier(parentIdentifier).pipe(
            Effect.map((task) => Option.some(task.id)),
            Effect.catchTag("TaskNotFoundError", () =>
              Effect.fail(new TaskError({ message: `Parent task not found: ${parentIdentifier}` })),
            ),
          ),
      });

      const input = new CreateTaskInput({
        title,
        description: Option.isSome(description) ? Option.some(description.value) : Option.none(),
        priority: priority as Priority,
        type: type as TaskType,
        projectId: cfg.linear.projectId,
        parentId,
      });

      const task = yield* issueRepo.createTask(cfg.linear.teamId, input);

      if (json) {
        yield* Console.log(
          JSON.stringify({
            status: "created",
            task: {
              id: task.id,
              identifier: task.identifier,
              title: task.title,
              priority: task.priority,
              state: task.state.name,
              url: task.url,
              parentId: Option.isSome(parent) ? parent.value : null,
            },
          }),
        );
      } else {
        if (Option.isSome(parent)) {
          yield* Console.log(`Created subtask: ${task.identifier} - ${task.title}`);
          yield* Console.log(`Parent: ${parent.value}`);
        } else {
          yield* Console.log(`Created: ${task.identifier} - ${task.title}`);
        }
        yield* Console.log(`Priority: ${task.priority}`);
        yield* Console.log(`URL: ${task.url}`);
        yield* Console.log(`\nRun 'ship start ${task.identifier}' to begin work.`);
      }
    }),
);
