import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import * as Match from "effect/Match";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";
import { IssueRepository } from "../../../../ports/IssueRepository.js";
import { VcsService, type ChangeId } from "../../../../ports/VcsService.js";
import { UpdateTaskInput, type TaskId } from "../../../../domain/Task.js";

// === VCS Result Types ===

type VcsResult =
  | { readonly _tag: "Skipped"; readonly reason?: string }
  | { readonly _tag: "Created"; readonly changeId: ChangeId; readonly bookmark: string }
  | { readonly _tag: "PartialFailure"; readonly changeId: ChangeId; readonly warning: string }
  | { readonly _tag: "Failed"; readonly warning: string };

const VcsResult = {
  skipped: (reason?: string): VcsResult =>
    reason !== undefined ? { _tag: "Skipped", reason } : { _tag: "Skipped" },
  created: (changeId: ChangeId, bookmark: string): VcsResult => ({
    _tag: "Created",
    changeId,
    bookmark,
  }),
  partialFailure: (changeId: ChangeId, warning: string): VcsResult => ({
    _tag: "PartialFailure",
    changeId,
    warning,
  }),
  failed: (warning: string): VcsResult => ({ _tag: "Failed", warning }),
};

// === Utilities ===

/**
 * Escape a string for safe use in a single-quoted shell argument.
 * Replaces each ' with '\'' (end quote, escaped quote, start quote).
 */
const escapeShellArg = (arg: string): string => `'${arg.replace(/'/g, "'\"'\"'")}'`;

// === VCS Operations ===

const createVcsChange = (
  vcs: VcsService,
  message: string,
  branchName: string,
): Effect.Effect<VcsResult, never> =>
  Effect.gen(function* () {
    const isAvailable = yield* vcs.isAvailable();
    if (!isAvailable) {
      return VcsResult.skipped("jj is not installed");
    }

    const isRepo = yield* vcs.isRepo().pipe(Effect.orElseSucceed(() => false));
    if (!isRepo) {
      return VcsResult.skipped("Not a jj repository");
    }

    const changeResult = yield* vcs.createChange(message).pipe(Effect.either);
    if (changeResult._tag === "Left") {
      return VcsResult.failed(`Failed to create change: ${changeResult.left.message}`);
    }

    const changeId = changeResult.right;
    const bookmarkResult = yield* vcs.createBookmark(branchName).pipe(Effect.either);

    if (bookmarkResult._tag === "Left") {
      return VcsResult.partialFailure(
        changeId,
        `Bookmark failed: ${bookmarkResult.left.message}`,
      );
    }

    return VcsResult.created(changeId, branchName);
  });

const formatVcsResultText = (
  result: VcsResult,
  fallbackInfo?: { message: string; branchName: string },
): string =>
  Match.value(result).pipe(
    Match.tag("Created", ({ changeId, bookmark }) =>
      `\nCreated jj change: ${changeId}\nCreated bookmark: ${bookmark}`,
    ),
    Match.tag("Skipped", ({ reason }) =>
      reason ? `\nWarning: ${reason}` : `\nVCS operations skipped (--no-vcs)`,
    ),
    Match.tag("PartialFailure", ({ changeId, warning }) =>
      `\nCreated jj change: ${changeId}\nWarning: ${warning}`,
    ),
    Match.tag("Failed", ({ warning }) =>
      fallbackInfo
        ? `\nWarning: ${warning}\n\nBranch name: ${fallbackInfo.branchName}\n\nTo create a jj change manually:\n  jj new -m ${escapeShellArg(fallbackInfo.message)}\n  jj bookmark create ${fallbackInfo.branchName}`
        : `\nWarning: ${warning}`,
    ),
    Match.exhaustive,
  );

const vcsResultToJson = (result: VcsResult): Record<string, unknown> =>
  Match.value(result).pipe(
    Match.tag("Created", ({ changeId, bookmark }) => ({
      status: "created",
      changeId,
      bookmark,
    })),
    Match.tag("Skipped", ({ reason }) => ({
      status: "skipped",
      reason,
    })),
    Match.tag("PartialFailure", ({ changeId, warning }) => ({
      status: "partial_failure",
      changeId,
      warning,
    })),
    Match.tag("Failed", ({ warning }) => ({
      status: "failed",
      warning,
    })),
    Match.exhaustive,
  );

// === Command Definition ===

const taskIdArg = Args.text({ name: "task-id" }).pipe(
  Args.withDescription("Task identifier (e.g., ENG-123)"),
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

const noVcsOption = Options.boolean("no-vcs").pipe(
  Options.withDescription("Skip VCS (jj) operations"),
  Options.withDefault(false),
);

export const startCommand = Command.make(
  "start",
  { taskId: taskIdArg, json: jsonOption, noVcs: noVcsOption },
  ({ taskId, json, noVcs }) =>
    Effect.gen(function* () {
      const config = yield* ConfigRepository;
      const issueRepo = yield* IssueRepository;
      const vcs = yield* VcsService;

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
      if (task.blockedBy.length > 0) {
        yield* json
          ? Console.log(
              JSON.stringify({ status: "blocked", task: taskId, blockedBy: task.blockedBy }),
            )
          : Effect.all([
              Console.log(
                `Warning: Task ${task.identifier} is blocked by: ${task.blockedBy.join(", ")}`,
              ),
              Console.log("Consider working on the blocking tasks first."),
            ]);
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

      const branchName = yield* issueRepo.getBranchName(task.id);
      const changeMessage = `${updatedTask.identifier}: ${updatedTask.title}`;

      // VCS integration
      const vcsResult = yield* noVcs
        ? Effect.succeed(VcsResult.skipped())
        : createVcsChange(vcs, changeMessage, branchName);

      // Output
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
            vcs: vcsResultToJson(vcsResult),
          }),
        );
      } else {
        yield* Console.log(`Started: ${updatedTask.identifier} - ${updatedTask.title}`);
        yield* Console.log(`Status: ${updatedTask.state.name}`);
        yield* Console.log(formatVcsResultText(vcsResult, { message: changeMessage, branchName }));
      }
    }),
);
