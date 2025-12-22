/**
 * ship stack sync - Fetch and rebase onto trunk
 *
 * Syncs the local stack with remote:
 * 1. Fetches latest changes from remote
 * 2. Rebases the stack onto updated trunk
 * 3. Reports any conflicts that need resolution
 *
 * This is the critical command for syncing after PRs are merged.
 */

import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { checkVcsAvailability, outputError } from "./shared.js";

// === Options ===

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

// === Output Types ===

interface SyncOutput {
  fetched: boolean;
  rebased: boolean;
  trunkChangeId?: string;
  stackSize?: number;
  conflicted?: boolean;
  error?: { tag: string; message: string };
}

// === Command ===

export const syncCommand = Command.make(
  "sync",
  { json: jsonOption },
  ({ json }) =>
    Effect.gen(function* () {
      // Check VCS availability (jj installed and in repo)
      const vcsCheck = yield* checkVcsAvailability();
      if (!vcsCheck.available) {
        yield* outputError(vcsCheck.error, json);
        return;
      }
      const { vcs } = vcsCheck;

      // Run sync operation - handle errors with preserved context
      const syncResult = yield* vcs.sync().pipe(
        Effect.map((result) => ({ success: true as const, result })),
        Effect.catchAll((e) => {
          const errorInfo =
            e && typeof e === "object" && "_tag" in e
              ? { tag: String(e._tag), message: "message" in e ? String(e.message) : String(e) }
              : { tag: "UnknownError", message: String(e) };
          return Effect.succeed({ success: false as const, error: errorInfo });
        }),
      );

      if (!syncResult.success) {
        const errMsg = `Sync failed: [${syncResult.error.tag}] ${syncResult.error.message}`;
        yield* outputError(errMsg, json);
        return;
      }

      const result = syncResult.result;

      const output: SyncOutput = {
        fetched: result.fetched,
        rebased: result.rebased,
        trunkChangeId: result.trunkChangeId,
        stackSize: result.stackSize,
        conflicted: result.conflicted,
      };

      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        if (result.conflicted) {
          yield* Console.log("Sync completed with conflicts!");
          yield* Console.log(`  Fetched: yes`);
          yield* Console.log(`  Rebased: yes (with conflicts)`);
          yield* Console.log(`  Trunk:   ${result.trunkChangeId.slice(0, 12)}`);
          yield* Console.log(`  Stack:   ${result.stackSize} change(s)`);
          yield* Console.log("");
          yield* Console.log("Resolve conflicts with 'jj status' and edit the conflicted files.");
        } else if (!result.rebased) {
          yield* Console.log("Already up to date.");
          yield* Console.log(`  Trunk: ${result.trunkChangeId.slice(0, 12)}`);
          yield* Console.log(`  Stack: ${result.stackSize} change(s)`);
        } else {
          yield* Console.log("Sync completed successfully.");
          yield* Console.log(`  Fetched: yes`);
          yield* Console.log(`  Rebased: yes`);
          yield* Console.log(`  Trunk:   ${result.trunkChangeId.slice(0, 12)}`);
          yield* Console.log(`  Stack:   ${result.stackSize} change(s)`);
        }
      }
    }),
);
