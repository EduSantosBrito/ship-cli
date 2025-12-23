import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { IssueRepository } from "../../../../ports/IssueRepository.js";
import { MilestoneRepository } from "../../../../ports/MilestoneRepository.js";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";
import {
  UpdateTaskInput,
  type TaskId,
  type Priority,
  type TaskStatus,
} from "../../../../domain/Task.js";

/**
 * Generate a slug from a milestone name.
 */
const nameToSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const taskIdArg = Args.text({ name: "task-id" }).pipe(
  Args.withDescription("Task identifier (e.g., ENG-123)"),
);

const titleOption = Options.text("title").pipe(
  Options.withAlias("t"),
  Options.withDescription("New task title"),
  Options.optional,
);

const descriptionOption = Options.text("description").pipe(
  Options.withAlias("d"),
  Options.withDescription("New task description (use - to read from stdin)"),
  Options.optional,
);

const priorityOption = Options.choice("priority", ["urgent", "high", "medium", "low", "none"]).pipe(
  Options.withAlias("p"),
  Options.withDescription("New task priority"),
  Options.optional,
);

const statusOption = Options.choice("status", [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
]).pipe(Options.withAlias("s"), Options.withDescription("New task status"), Options.optional);

const parentOption = Options.text("parent").pipe(
  Options.withDescription(
    "Parent task ID (e.g., BRI-42) to reparent, or empty string to remove parent",
  ),
  Options.optional,
);

const milestoneOption = Options.text("milestone").pipe(
  Options.withAlias("M"),
  Options.withDescription("Milestone slug or ID to assign, or empty string to remove"),
  Options.optional,
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

export const updateCommand = Command.make(
  "update",
  {
    taskId: taskIdArg,
    title: titleOption,
    description: descriptionOption,
    priority: priorityOption,
    status: statusOption,
    parent: parentOption,
    milestone: milestoneOption,
    json: jsonOption,
  },
  ({ taskId, title, description, priority, status, parent, milestone, json }) =>
    Effect.gen(function* () {
      const issueRepo = yield* IssueRepository;
      const milestoneRepo = yield* MilestoneRepository;
      const configRepo = yield* ConfigRepository;

      // Check if any update was provided
      const hasUpdate =
        Option.isSome(title) ||
        Option.isSome(description) ||
        Option.isSome(priority) ||
        Option.isSome(status) ||
        Option.isSome(parent) ||
        Option.isSome(milestone);

      if (!hasUpdate) {
        yield* Console.error(
          "No updates provided. Use --title, --description, --priority, --status, --parent, or --milestone.",
        );
        return;
      }

      // Get the task first to resolve identifier to ID
      const existingTask = yield* issueRepo
        .getTaskByIdentifier(taskId)
        .pipe(Effect.catchTag("TaskNotFoundError", () => issueRepo.getTask(taskId as TaskId)));

      // Resolve parent identifier to ID if provided using Option.match
      const parentId = yield* Option.match(parent, {
        onNone: () => Effect.succeed(Option.none<string>()),
        onSome: (value) => {
          // Check for circular reference - task cannot be its own parent
          if (value === taskId || value === existingTask.id || value === existingTask.identifier) {
            return Effect.fail(new Error("Cannot set a task as its own parent"));
          }
          // Empty string means remove parent
          if (value === "") {
            return Effect.succeed(Option.some(""));
          }
          // Resolve parent identifier to ID
          return issueRepo.getTaskByIdentifier(value).pipe(
            Effect.catchTag("TaskNotFoundError", () => issueRepo.getTask(value as TaskId)),
            Effect.map((task) => Option.some(task.id)),
          );
        },
      });

      // Resolve milestone slug to ID if provided
      const milestoneId = yield* Option.match(milestone, {
        onNone: () => Effect.succeed(Option.none<string>()),
        onSome: (value) =>
          Effect.gen(function* () {
            // Empty string means remove milestone
            if (value === "") {
              return Option.some("");
            }

            const cfg = yield* configRepo.load();
            if (Option.isNone(cfg.linear.projectId)) {
              yield* Console.error("No project configured. Cannot resolve milestone.");
              return Option.none<string>();
            }

            const milestones = yield* milestoneRepo.listMilestones(cfg.linear.projectId.value);
            const bySlug = milestones.find((m) => nameToSlug(m.name) === value.toLowerCase());

            if (bySlug) {
              return Option.some(bySlug.id);
            }

            // Try direct ID match
            const byId = milestones.find((m) => m.id === value);
            if (byId) {
              return Option.some(byId.id);
            }

            yield* Console.error(`Milestone not found: ${value}`);
            return Option.none<string>();
          }),
      });

      // Build update input
      const input = new UpdateTaskInput({
        title: Option.isSome(title) ? Option.some(title.value) : Option.none(),
        description: Option.isSome(description) ? Option.some(description.value) : Option.none(),
        priority: Option.isSome(priority) ? Option.some(priority.value as Priority) : Option.none(),
        status: Option.isSome(status) ? Option.some(status.value as TaskStatus) : Option.none(),
        assigneeId: Option.none(),
        parentId,
        milestoneId,
      });

      const task = yield* issueRepo.updateTask(existingTask.id, input);

      if (json) {
        const output = {
          status: "updated",
          task: {
            id: task.id,
            identifier: task.identifier,
            title: task.title,
            description: Option.getOrNull(task.description),
            priority: task.priority,
            state: task.state.name,
            url: task.url,
          },
        };
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* Console.log(`Updated: ${task.identifier} - ${task.title}`);
        if (Option.isSome(title)) {
          yield* Console.log(`Title: ${task.title}`);
        }
        if (Option.isSome(description)) {
          yield* Console.log(`Description updated`);
        }
        if (Option.isSome(priority)) {
          yield* Console.log(`Priority: ${task.priority}`);
        }
        if (Option.isSome(status)) {
          yield* Console.log(`Status: ${task.state.name}`);
        }
        if (Option.isSome(parent)) {
          if (parent.value === "") {
            yield* Console.log(`Parent: removed`);
          } else {
            yield* Console.log(`Parent: ${parent.value}`);
          }
        }
        if (Option.isSome(milestone)) {
          if (milestone.value === "") {
            yield* Console.log(`Milestone: removed`);
          } else {
            yield* Console.log(`Milestone: ${milestone.value}`);
          }
        }
        yield* Console.log(`URL: ${task.url}`);
      }
    }),
);
