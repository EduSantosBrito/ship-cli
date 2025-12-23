import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";
import { IssueRepository } from "../../../../ports/IssueRepository.js";
import { VcsService, type Change } from "../../../../ports/VcsService.js";
import { PrService } from "../../../../ports/PrService.js";
import { TaskFilter, type Task } from "../../../../domain/Task.js";

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

/**
 * Extract task identifier from bookmark name.
 * Requires identifier at start or after a slash to avoid false positives.
 * @example
 * parseTaskIdentifier("bri-123-feature") // "BRI-123"
 * parseTaskIdentifier("user/bri-123-feature") // "BRI-123"
 * parseTaskIdentifier("feature-add-123-items") // null (not at start or after /)
 */
export const parseTaskIdentifier = (bookmark: string): string | null => {
  // Match 2-5 letter prefix followed by dash and number, at start or after /
  const match = bookmark.match(/(?:^|\/)([a-zA-Z]{2,5}-\d+)/i);
  return match ? match[1].toUpperCase() : null;
};

/** Truncate string with ellipsis if too long */
const truncate = (str: string, maxLen: number): string =>
  str.length > maxLen ? str.slice(0, maxLen - 3) + "..." : str;

/** PR status info */
interface PrInfo {
  number: number;
  state: "open" | "closed" | "merged";
  url: string;
}

/** Result of matching tasks with VCS changes */
interface TaskChangeMapping {
  task: Task;
  change: Change | null;
  bookmark: string | null;
  pr: PrInfo | null;
}

/** Orphaned change (has bookmark with task pattern but no matching task) */
interface OrphanedChange {
  change: Change;
  bookmark: string;
  taskIdentifier: string;
}

/** Format status column based on task, change, and PR state */
const formatStatus = (mapping: TaskChangeMapping): string => {
  const taskState = mapping.task.state.name;

  if (!mapping.change) {
    return `${taskState} (no change)`;
  }

  if (!mapping.pr) {
    return `${taskState} (no PR)`;
  }

  // Include PR state
  const prState = mapping.pr.state;
  if (prState === "merged") {
    return `${taskState} (PR merged)`;
  } else if (prState === "closed") {
    return `${taskState} (PR closed)`;
  } else {
    return `${taskState} (PR open)`;
  }
};

/**
 * ship wip - Show work in progress
 *
 * Displays in-progress tasks alongside their jj changes and PR status.
 * Helps identify:
 * - Tasks without associated changes
 * - Orphaned changes (bookmarks without matching tasks)
 * - PR status for each task
 */
export const wipCommand = Command.make("wip", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const config = yield* ConfigRepository;
    const issueRepo = yield* IssueRepository;
    const vcs = yield* VcsService;
    const prService = yield* PrService;

    const cfg = yield* config.load();

    // Get in-progress tasks from Linear
    const filter = new TaskFilter({
      status: Option.some("in_progress"),
      priority: Option.none(),
      projectId: cfg.linear.projectId,
      milestoneId: Option.none(),
      assignedToMe: false,
      includeCompleted: false,
    });

    const tasks = yield* issueRepo.listTasks(cfg.linear.teamId, filter);

    // Check if jj is available
    const jjAvailable = yield* vcs.isAvailable();

    let changes: ReadonlyArray<Change> = [];
    if (jjAvailable) {
      // Get all changes with bookmarks (use a revset that includes all bookmarks)
      changes = yield* vcs
        .getLog("bookmarks()")
        .pipe(Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<Change>)));
    }

    // Build a map of task identifier -> change
    const bookmarkToChange = new Map<string, { change: Change; bookmark: string }>();
    for (const change of changes) {
      for (const bookmark of change.bookmarks) {
        const taskId = parseTaskIdentifier(bookmark);
        if (taskId) {
          bookmarkToChange.set(taskId, { change, bookmark });
        }
      }
    }

    // Check if gh CLI is available for PR lookups
    const ghAvailable = yield* prService.isAvailable();

    // Match tasks with changes and fetch PR status
    const mappings: TaskChangeMapping[] = yield* Effect.all(
      tasks.map((task) =>
        Effect.gen(function* () {
          const match = bookmarkToChange.get(task.identifier);
          const bookmark = match?.bookmark ?? null;

          // Try to get PR status if we have a bookmark and gh is available
          let pr: PrInfo | null = null;
          if (bookmark && ghAvailable) {
            const prResult = yield* prService
              .getPrByBranch(bookmark)
              .pipe(Effect.catchAll(() => Effect.succeed(null)));
            if (prResult) {
              pr = {
                number: prResult.number,
                state: prResult.state,
                url: prResult.url,
              };
            }
          }

          return {
            task,
            change: match?.change ?? null,
            bookmark,
            pr,
          };
        }),
      ),
      { concurrency: 5 }, // Limit concurrent PR lookups
    );

    // Find orphaned changes (bookmarks with task pattern but no matching in-progress task)
    const inProgressIdentifiers = new Set(tasks.map((t) => t.identifier));
    const orphanedChanges: OrphanedChange[] = [];

    for (const change of changes) {
      for (const bookmark of change.bookmarks) {
        const taskId = parseTaskIdentifier(bookmark);
        if (taskId && !inProgressIdentifiers.has(taskId)) {
          orphanedChanges.push({
            change,
            bookmark,
            taskIdentifier: taskId,
          });
        }
      }
    }

    if (json) {
      const output = {
        jjAvailable,
        ghAvailable,
        tasks: mappings.map((m) => ({
          identifier: m.task.identifier,
          title: m.task.title,
          state: m.task.state.name,
          changeId: m.change?.changeId ?? null,
          bookmark: m.bookmark,
          hasChange: m.change !== null,
          pr: m.pr,
        })),
        orphanedChanges: orphanedChanges.map((o) => ({
          changeId: o.change.changeId,
          bookmark: o.bookmark,
          taskIdentifier: o.taskIdentifier,
          description: o.change.description,
        })),
      };
      yield* Console.log(JSON.stringify(output, null, 2));
    } else {
      if (!jjAvailable) {
        yield* Console.log("Note: jj is not available. Showing tasks only.\n");
      }
      if (!ghAvailable) {
        yield* Console.log("Note: gh CLI is not available. PR status not shown.\n");
      }

      if (tasks.length === 0) {
        yield* Console.log("No in-progress tasks found.");
      } else {
        yield* Console.log(`Found ${tasks.length} in-progress task(s):\n`);
        yield* Console.log(
          "TASK        CHANGE      PR       BOOKMARK                       STATUS",
        );
        yield* Console.log("─".repeat(85));

        for (const mapping of mappings) {
          const taskId = mapping.task.identifier.padEnd(10);
          const changeId = mapping.change?.changeId.slice(0, 8).padEnd(10) ?? "(none)".padEnd(10);
          const prStatus = mapping.pr ? `#${mapping.pr.number}`.padEnd(7) : "-".padEnd(7);
          const bookmark = truncate(mapping.bookmark ?? "-", 28).padEnd(30);
          const status = formatStatus(mapping);
          yield* Console.log(`${taskId}  ${changeId}  ${prStatus}  ${bookmark} ${status}`);
        }
      }

      if (orphanedChanges.length > 0) {
        yield* Console.log("\n");
        yield* Console.log(
          "Warning: Found orphaned changes (bookmarks without matching in-progress tasks):\n",
        );
        yield* Console.log("CHANGE      BOOKMARK                       TASK ID     DESCRIPTION");
        yield* Console.log("─".repeat(75));

        for (const orphan of orphanedChanges) {
          const changeId = orphan.change.changeId.slice(0, 8).padEnd(10);
          const bookmark = truncate(orphan.bookmark, 28).padEnd(30);
          const taskId = orphan.taskIdentifier.padEnd(10);
          const desc = orphan.change.description.slice(0, 30) || "(empty)";
          yield* Console.log(`${changeId}  ${bookmark} ${taskId}  ${desc}`);
        }
      }
    }
  }),
);
