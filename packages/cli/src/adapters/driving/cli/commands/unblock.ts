import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";
import { IssueRepository } from "../../../../ports/IssueRepository.js";
import type { TaskId } from "../../../../domain/Task.js";
import { dryRunOption } from "./shared.js";

const blockerArg = Args.text({ name: "blocker" }).pipe(
  Args.withDescription("Task that was blocking (e.g., ENG-123)"),
);

const blockedArg = Args.text({ name: "blocked" }).pipe(
  Args.withDescription("Task that was blocked (e.g., ENG-456)"),
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

export const unblockCommand = Command.make(
  "unblock",
  { blocker: blockerArg, blocked: blockedArg, json: jsonOption, dryRun: dryRunOption },
  ({ blocker, blocked, json, dryRun }) =>
    Effect.gen(function* () {
      const config = yield* ConfigRepository;
      const issueRepo = yield* IssueRepository;

      yield* config.load(); // Ensure initialized

      // Get both tasks to get their IDs
      const blockerTask = yield* issueRepo
        .getTaskByIdentifier(blocker)
        .pipe(Effect.catchTag("TaskNotFoundError", () => issueRepo.getTask(blocker as TaskId)));

      const blockedTask = yield* issueRepo
        .getTaskByIdentifier(blocked)
        .pipe(Effect.catchTag("TaskNotFoundError", () => issueRepo.getTask(blocked as TaskId)));

      // Dry run: output what would happen without making changes
      if (dryRun) {
        if (json) {
          yield* Console.log(
            JSON.stringify({
              dryRun: true,
              wouldUnblock: {
                blocker: {
                  id: blockerTask.id,
                  identifier: blockerTask.identifier,
                },
                blocked: {
                  id: blockedTask.id,
                  identifier: blockedTask.identifier,
                },
              },
            }),
          );
        } else {
          yield* Console.log(
            `[DRY RUN] Would remove ${blockerTask.identifier} as blocker of ${blockedTask.identifier}`,
          );
        }
        return;
      }

      // Remove the blocking relationship
      yield* issueRepo.removeBlocker(blockedTask.id, blockerTask.id);

      if (json) {
        yield* Console.log(
          JSON.stringify({
            status: "unblocked",
            blocker: {
              id: blockerTask.id,
              identifier: blockerTask.identifier,
            },
            blocked: {
              id: blockedTask.id,
              identifier: blockedTask.identifier,
            },
          }),
        );
      } else {
        yield* Console.log(`${blockerTask.identifier} no longer blocks ${blockedTask.identifier}`);
      }
    }),
);
