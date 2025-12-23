import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";
import { IssueRepository } from "../../../../ports/IssueRepository.js";
import { TemplateService } from "../../../../ports/TemplateService.js";
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
  Options.withDescription("Task priority (overrides template)"),
  Options.optional,
);

const typeOption = Options.choice("type", ["bug", "feature", "task", "epic", "chore"]).pipe(
  Options.withAlias("t"),
  Options.withDescription("Task type (overrides template)"),
  Options.optional,
);

const templateOption = Options.text("template").pipe(
  Options.withAlias("T"),
  Options.withDescription(
    "Use a template (e.g., bug, feature). Run 'ship template list' to see available templates.",
  ),
  Options.optional,
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
    template: templateOption,
    parent: parentOption,
    json: jsonOption,
  },
  ({ title, description, priority, type, template, parent, json }) =>
    Effect.gen(function* () {
      const config = yield* ConfigRepository;
      const issueRepo = yield* IssueRepository;
      const templateService = yield* TemplateService;

      const cfg = yield* config.load();

      // Load template if specified
      const templateData = yield* Option.match(template, {
        onNone: () => Effect.succeed(Option.none()),
        onSome: (templateName) =>
          templateService.getTemplate(templateName).pipe(Effect.map(Option.some)),
      });

      // Apply template to get final values
      // User-provided values override template values
      const finalTitle = Option.match(templateData, {
        onNone: () => title,
        onSome: (tmpl) => tmpl.formatTitle(title),
      });

      const finalDescription = Option.match(description, {
        onSome: (d) => Option.some(d),
        onNone: () =>
          Option.match(templateData, {
            onNone: () => Option.none<string>(),
            onSome: (tmpl) => Option.fromNullable(tmpl.formatDescription(title)),
          }),
      });

      // User priority overrides template priority, with fallback to "medium"
      const finalPriority: Priority = Option.match(priority, {
        onSome: (p) => p as Priority,
        onNone: () =>
          Option.match(templateData, {
            onNone: () => "medium" as Priority,
            onSome: (tmpl) => tmpl.priority ?? ("medium" as Priority),
          }),
      });

      // User type overrides template type, with fallback to "task"
      const finalType: TaskType = Option.match(type, {
        onSome: (t) => t as TaskType,
        onNone: () =>
          Option.match(templateData, {
            onNone: () => "task" as TaskType,
            onSome: (tmpl) => tmpl.type ?? ("task" as TaskType),
          }),
      });

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
        title: finalTitle,
        description: finalDescription,
        priority: finalPriority,
        type: finalType,
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
              type: Option.getOrNull(task.type),
              state: task.state.name,
              url: task.url,
              parentId: Option.isSome(parent) ? parent.value : null,
              template: Option.isSome(template) ? template.value : null,
            },
          }),
        );
      } else {
        if (Option.isSome(template)) {
          yield* Console.log(`Using template: ${template.value}`);
        }
        if (Option.isSome(parent)) {
          yield* Console.log(`Created subtask: ${task.identifier} - ${task.title}`);
          yield* Console.log(`Parent: ${parent.value}`);
        } else {
          yield* Console.log(`Created: ${task.identifier} - ${task.title}`);
        }
        yield* Console.log(`Priority: ${task.priority}`);
        yield* Console.log(`Type: ${finalType}`);
        yield* Console.log(`URL: ${task.url}`);
        yield* Console.log(`\nRun 'ship start ${task.identifier}' to begin work.`);
      }
    }),
);
