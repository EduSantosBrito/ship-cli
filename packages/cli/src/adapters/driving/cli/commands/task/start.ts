/**
 * ship task start - Start working on a task
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
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";
import { IssueRepository } from "../../../../../ports/IssueRepository.js";
import { UpdateTaskInput, type TaskId } from "../../../../../domain/Task.js";
import { LinearApiError } from "../../../../../domain/Errors.js";
import { LinearClientService } from "../../../../driven/linear/LinearClient.js";
import { dryRunOption } from "../shared.js";

// === Command Definition ===

const taskIdArg = Args.text({ name: "task-id" }).pipe(
  Args.withDescription("Task identifier (e.g., ENG-123)"),
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

const sessionOption = Options.text("session").pipe(
  Options.withDescription(
    "OpenCode session ID to label the task with (for tracking which agent is working on it)",
  ),
  Options.optional,
);

export const startTaskCommand = Command.make(
  "start",
  { taskId: taskIdArg, json: jsonOption, session: sessionOption, dryRun: dryRunOption },
  ({ taskId, json, session, dryRun }) =>
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
        if (json) {
          yield* Console.log(
            JSON.stringify({
              status: "already_in_progress",
              task: taskId,
              ...(dryRun ? { dryRun } : {}),
            }),
          );
        } else {
          const prefix = dryRun ? "[DRY RUN] " : "";
          yield* Console.log(
            `${prefix}Task ${task.identifier} is already in progress (${task.state.name}).`,
          );
        }
        return;
      }

      // Get branch name for reference (useful for stack-create)
      const branchName = yield* issueRepo.getBranchName(task.id);
      const sessionId = Option.getOrUndefined(session);

      // Dry run: output what would happen without making changes
      if (dryRun) {
        if (json) {
          const output: Record<string, unknown> = {
            dryRun: true,
            wouldStart: {
              id: task.id,
              identifier: task.identifier,
              title: task.title,
              currentState: task.state.name,
              branchName,
            },
          };
          if (sessionId) {
            output.sessionLabel = `session:${sessionId}`;
          }
          if (task.blockedBy.length > 0) {
            output.warnings = [`Task is blocked by: ${task.blockedBy.join(", ")}`];
          }
          yield* Console.log(JSON.stringify(output));
        } else {
          yield* Console.log(`[DRY RUN] Would start task:`);
          yield* Console.log(`  Task: ${task.identifier} - ${task.title}`);
          yield* Console.log(`  Current state: ${task.state.name}`);
          if (sessionId) {
            yield* Console.log(`  Session: ${sessionId}`);
          }
          yield* Console.log(`  Branch name: ${branchName}`);
          if (task.blockedBy.length > 0) {
            yield* Console.log(`  Warning: Blocked by: ${task.blockedBy.join(", ")}`);
          }
        }
        return;
      }

      // Warn if blocked (but continue)
      if (task.blockedBy.length > 0 && !json) {
        yield* Console.log(
          `Warning: Task ${task.identifier} is blocked by: ${task.blockedBy.join(", ")}`,
        );
        yield* Console.log("Consider working on the blocking tasks first.\n");
      }

      // Get current user for auto-assignment
      const linearClient = yield* LinearClientService;
      const client = yield* linearClient.client();
      const viewer = yield* Effect.tryPromise({
        try: () => client.viewer,
        catch: (e) => new LinearApiError({ message: `Failed to fetch viewer: ${e}`, cause: e }),
      });

      // Update status to in_progress and assign to current user
      const updatedTask = yield* issueRepo.updateTask(
        task.id,
        new UpdateTaskInput({
          title: Option.none(),
          description: Option.none(),
          status: Option.some("in_progress"),
          priority: Option.none(),
          assigneeId: Option.some(viewer.id),
          parentId: Option.none(),
          milestoneId: Option.none(),
        }),
      );

      // Set session label if provided (for tracking which agent is working on the task)
      if (sessionId) {
        yield* issueRepo.setSessionLabel(task.id, sessionId);
      }

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
        // Include session label info in JSON output
        if (sessionId) {
          output.sessionLabel = `session:${sessionId}`;
        }
        // Include warnings in JSON output
        if (task.blockedBy.length > 0) {
          output.warnings = [`Task is blocked by: ${task.blockedBy.join(", ")}`];
        }
        yield* Console.log(JSON.stringify(output));
      } else {
        yield* Console.log(`Started: ${updatedTask.identifier} - ${updatedTask.title}`);
        yield* Console.log(`Status: ${updatedTask.state.name}`);
        if (sessionId) {
          yield* Console.log(`Session: ${sessionId}`);
        }
        yield* Console.log(`\nTo create a VCS change, use:`);
        yield* Console.log(
          `  ship stack create -m "${updatedTask.identifier}: ${updatedTask.title}" -b ${branchName}`,
        );
      }
    }),
);
