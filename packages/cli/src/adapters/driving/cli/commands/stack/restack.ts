/**
 * ship stack restack - Fetch, rebase, and push entire stack
 *
 * This command:
 * 1. Fetches latest changes from remote
 * 2. Rebases the entire stack onto updated trunk
 * 3. Pushes all bookmarks in the stack to update PRs
 *
 * Use cases:
 * - After a parent PR is merged and you need to update dependent PRs
 * - When you want to sync your stack and push all changes in one command
 */

import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import {
  checkVcsAvailability,
  outputError,
  formatEffectError,
  getDefaultBranch,
} from "./shared.js";

// === Options ===

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

// === Output Types ===

interface PushedBookmark {
  bookmark: string;
  success: boolean;
  error?: string | undefined;
}

interface RestackOutput {
  fetched: boolean;
  restacked: boolean;
  pushed: boolean;
  stackSize?: number | undefined;
  trunkChangeId?: string | undefined;
  conflicted?: boolean | undefined;
  pushedBookmarks?: PushedBookmark[] | undefined;
  error?: string | undefined;
}

// === Command ===

export const restackCommand = Command.make("restack", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    // Check VCS availability (jj installed and in repo)
    const vcsCheck = yield* checkVcsAvailability();
    if (!vcsCheck.available) {
      yield* outputError(vcsCheck.error, json);
      return;
    }
    const { vcs } = vcsCheck;

    // Get configured default branch (trunk)
    const defaultBranch = yield* getDefaultBranch();

    // Step 1: Fetch from remote
    if (!json) {
      yield* Console.log("Fetching from remote...");
    }
    const fetchResult = yield* vcs.fetch().pipe(
      Effect.map(() => ({ success: true as const })),
      Effect.catchAll((e) => Effect.succeed({ success: false as const, error: formatEffectError(e) })),
    );

    if (!fetchResult.success) {
      const output: RestackOutput = {
        fetched: false,
        restacked: false,
        pushed: false,
        error: fetchResult.error,
      };
      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* outputError(`Fetch failed: ${fetchResult.error}`, json);
      }
      return;
    }

    // Get current stack
    const stack = yield* vcs.getStack().pipe(
      Effect.catchAll((e) => {
        return Effect.succeed({ error: formatEffectError(e), changes: [] as const });
      }),
    );

    if ("error" in stack && stack.error) {
      yield* outputError(`Failed to get stack: ${stack.error}`, json);
      return;
    }

    const changes = "error" in stack ? [] : stack;

    // If no stack (already on trunk), nothing to do
    if (changes.length === 0) {
      const trunkResult = yield* vcs.getTrunkInfo().pipe(
        Effect.map((trunk) => ({ success: true as const, trunk })),
        Effect.catchAll(() => Effect.succeed({ success: false as const })),
      );

      const output: RestackOutput = trunkResult.success
        ? {
            fetched: true,
            restacked: false,
            pushed: false,
            stackSize: 0,
            trunkChangeId: trunkResult.trunk.shortChangeId,
          }
        : {
            fetched: true,
            restacked: false,
            pushed: false,
            stackSize: 0,
          };

      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* Console.log("Nothing to restack (working copy is on trunk).");
        if (trunkResult.success) {
          yield* Console.log(`  Trunk: ${trunkResult.trunk.shortChangeId.slice(0, 12)}`);
        }
      }
      return;
    }

    // Step 2: Rebase stack onto trunk
    if (!json) {
      yield* Console.log("Rebasing stack onto trunk...");
    }

    // Get the first change in stack (oldest, closest to trunk)
    // Stack is returned with newest first, so last element is the base
    const firstInStack = changes[changes.length - 1];

    // Rebase stack onto trunk (using configured default branch)
    const rebaseResult = yield* vcs.rebase(firstInStack.id, defaultBranch).pipe(
      Effect.map(() => ({ success: true as const, conflicted: false })),
      Effect.catchTag("JjConflictError", () =>
        Effect.succeed({ success: true as const, conflicted: true }),
      ),
      Effect.catchAll((e) => {
        return Effect.succeed({ success: false as const, error: formatEffectError(e) });
      }),
    );

    if (!rebaseResult.success) {
      const output: RestackOutput = {
        fetched: true,
        restacked: false,
        pushed: false,
        error: rebaseResult.error,
      };
      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* outputError(`Restack failed: ${rebaseResult.error}`, json);
      }
      return;
    }

    // If there are conflicts, don't push
    if (rebaseResult.conflicted) {
      const stackAfter = yield* vcs.getStack().pipe(
        Effect.map((s) => s.length),
        Effect.catchAll(() => Effect.succeed(changes.length)),
      );

      const trunkResult = yield* vcs.getTrunkInfo().pipe(
        Effect.map((trunk) => ({ success: true as const, trunk })),
        Effect.catchAll(() => Effect.succeed({ success: false as const })),
      );

      const output: RestackOutput = {
        fetched: true,
        restacked: true,
        pushed: false,
        stackSize: stackAfter,
        trunkChangeId: trunkResult.success ? trunkResult.trunk.shortChangeId : undefined,
        conflicted: true,
      };

      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* Console.log("Restack completed with conflicts!");
        yield* Console.log(`  Fetched: yes`);
        yield* Console.log(`  Rebased: yes (with conflicts)`);
        if (trunkResult.success) {
          yield* Console.log(`  Trunk:   ${trunkResult.trunk.shortChangeId.slice(0, 12)}`);
        }
        yield* Console.log(`  Stack:   ${stackAfter} change(s)`);
        yield* Console.log(`  Pushed:  no (conflicts must be resolved first)`);
        yield* Console.log("");
        yield* Console.log("Resolve conflicts with 'jj status' and edit the conflicted files.");
        yield* Console.log("Then run 'ship stack restack' again to push.");
      }
      return;
    }

    // Step 3: Push all bookmarks in the stack
    if (!json) {
      yield* Console.log("Pushing bookmarks...");
    }

    // Get updated stack after rebase
    const stackAfter = yield* vcs.getStack().pipe(
      Effect.catchAll(() => Effect.succeed([] as typeof changes)),
    );

    // Collect all bookmarks from the stack
    const bookmarksToPush = stackAfter
      .flatMap((c) => c.bookmarks)
      .filter((b) => b && b.length > 0);

    const pushedBookmarks: PushedBookmark[] = [];

    for (const bookmark of bookmarksToPush) {
      const pushResult = yield* vcs.push(bookmark).pipe(
        Effect.map(() => ({ success: true as const })),
        Effect.catchAll((e) => Effect.succeed({ success: false as const, error: formatEffectError(e) })),
      );

      pushedBookmarks.push({
        bookmark,
        success: pushResult.success,
        error: "error" in pushResult ? pushResult.error : undefined,
      });
    }

    const allPushed = pushedBookmarks.every((p) => p.success);
    const anyPushed = pushedBookmarks.some((p) => p.success);

    const trunkResult = yield* vcs.getTrunkInfo().pipe(
      Effect.map((trunk) => ({ success: true as const, trunk })),
      Effect.catchAll(() => Effect.succeed({ success: false as const })),
    );

    const output: RestackOutput = {
      fetched: true,
      restacked: true,
      pushed: anyPushed,
      stackSize: stackAfter.length,
      trunkChangeId: trunkResult.success ? trunkResult.trunk.shortChangeId : undefined,
      conflicted: false,
      pushedBookmarks: pushedBookmarks.length > 0 ? pushedBookmarks : undefined,
    };

    if (json) {
      yield* Console.log(JSON.stringify(output, null, 2));
    } else {
      yield* Console.log("Restack completed successfully.");
      yield* Console.log(`  Fetched: yes`);
      yield* Console.log(`  Rebased: ${changes.length} change(s)`);
      if (trunkResult.success) {
        yield* Console.log(`  Trunk:   ${trunkResult.trunk.shortChangeId.slice(0, 12)}`);
      }
      yield* Console.log(`  Stack:   ${stackAfter.length} change(s)`);

      if (pushedBookmarks.length > 0) {
        const successCount = pushedBookmarks.filter((p) => p.success).length;
        yield* Console.log(`  Pushed:  ${successCount}/${pushedBookmarks.length} bookmark(s)`);

        if (!allPushed) {
          yield* Console.log("");
          yield* Console.log("Failed to push:");
          for (const p of pushedBookmarks.filter((p) => !p.success)) {
            yield* Console.log(`  - ${p.bookmark}: ${p.error}`);
          }
        }
      } else {
        yield* Console.log(`  Pushed:  no bookmarks to push`);
      }
    }
  }),
);
