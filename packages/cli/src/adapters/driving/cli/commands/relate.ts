import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { IssueRepository } from "../../../../ports/IssueRepository.js";
import type { TaskId } from "../../../../domain/Task.js";

const taskAArg = Args.text({ name: "task-a" }).pipe(
  Args.withDescription("First task identifier (e.g., BRI-123)"),
);

const taskBArg = Args.text({ name: "task-b" }).pipe(
  Args.withDescription("Second task identifier (e.g., BRI-456)"),
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

export const relateCommand = Command.make(
  "relate",
  { taskA: taskAArg, taskB: taskBArg, json: jsonOption },
  ({ taskA, taskB, json }) =>
    Effect.gen(function* () {
      const issueRepo = yield* IssueRepository;

      // Resolve identifiers to IDs
      const [resolvedA, resolvedB] = yield* Effect.all([
        issueRepo
          .getTaskByIdentifier(taskA)
          .pipe(Effect.catchTag("TaskNotFoundError", () => issueRepo.getTask(taskA as TaskId))),
        issueRepo
          .getTaskByIdentifier(taskB)
          .pipe(Effect.catchTag("TaskNotFoundError", () => issueRepo.getTask(taskB as TaskId))),
      ]);

      yield* issueRepo.addRelated(resolvedA.id, resolvedB.id);

      if (json) {
        yield* Console.log(
          JSON.stringify({
            status: "related",
            taskA: resolvedA.identifier,
            taskB: resolvedB.identifier,
          }),
        );
      } else {
        yield* Console.log(`Linked ${resolvedA.identifier} ↔ ${resolvedB.identifier} as related`);
        yield* Console.log(
          `\nMentioning ${resolvedA.identifier} in ${resolvedB.identifier}'s description (or vice versa) will now auto-link.`,
        );
      }
    }),
);
