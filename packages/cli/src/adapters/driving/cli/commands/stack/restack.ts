/**
 * ship stack restack - Rebase entire stack onto trunk
 *
 * Rebases the entire stack onto trunk (main branch).
 * Unlike sync which also fetches from remote, restack only performs the rebase.
 *
 * Use cases:
 * - After manually resolving conflicts
 * - After making changes that need to be rebased without fetching
 * - When you want to ensure your stack is based on the latest local trunk
 */

import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { checkVcsAvailability, outputError, formatEffectError } from "./shared.js";

// === Options ===

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

// === Output Types ===

interface RestackOutput {
  restacked: boolean;
  stackSize?: number;
  trunkChangeId?: string;
  conflicted?: boolean;
  error?: string;
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
            restacked: false,
            stackSize: 0,
            trunkChangeId: trunkResult.trunk.shortChangeId,
          }
        : {
            restacked: false,
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

    // Get the first change in stack (oldest, closest to trunk)
    // Stack is returned with newest first, so last element is the base
    const firstInStack = changes[changes.length - 1];

    // Rebase stack onto trunk
    const rebaseResult = yield* vcs.rebase(firstInStack.id, "main").pipe(
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
        restacked: false,
        error: rebaseResult.error,
      };
      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* outputError(`Restack failed: ${rebaseResult.error}`, json);
      }
      return;
    }

    // Get updated stack and trunk info
    const stackAfter = yield* vcs.getStack().pipe(
      Effect.map((s) => s.length),
      Effect.catchAll(() => Effect.succeed(changes.length)),
    );

    const trunkResult = yield* vcs.getTrunkInfo().pipe(
      Effect.map((trunk) => ({ success: true as const, trunk })),
      Effect.catchAll(() => Effect.succeed({ success: false as const })),
    );

    const output: RestackOutput = trunkResult.success
      ? {
          restacked: true,
          stackSize: stackAfter,
          trunkChangeId: trunkResult.trunk.shortChangeId,
          conflicted: rebaseResult.conflicted,
        }
      : {
          restacked: true,
          stackSize: stackAfter,
          conflicted: rebaseResult.conflicted,
        };

    if (json) {
      yield* Console.log(JSON.stringify(output, null, 2));
    } else {
      if (rebaseResult.conflicted) {
        yield* Console.log("Restack completed with conflicts!");
        yield* Console.log(`  Rebased: yes (with conflicts)`);
        if (trunkResult.success) {
          yield* Console.log(`  Trunk:   ${trunkResult.trunk.shortChangeId.slice(0, 12)}`);
        }
        yield* Console.log(`  Stack:   ${stackAfter} change(s)`);
        yield* Console.log("");
        yield* Console.log("Resolve conflicts with 'jj status' and edit the conflicted files.");
      } else {
        yield* Console.log("Restack completed successfully.");
        yield* Console.log(`  Rebased: ${changes.length} change(s)`);
        if (trunkResult.success) {
          yield* Console.log(`  Trunk:   ${trunkResult.trunk.shortChangeId.slice(0, 12)}`);
        }
        yield* Console.log(`  Stack:   ${stackAfter} change(s)`);
      }
    }
  }),
);
