/**
 * ship stack submit - Push and create/update PR
 *
 * Submits the current change to remote:
 * 1. Gets current change and its bookmark
 * 2. Pushes bookmark to remote
 * 3. Creates or updates a PR on GitHub
 * 4. If --subscribe is provided, subscribes to all PRs in the stack for webhook events
 *
 * When used via the OpenCode plugin, the session ID is automatically provided from the
 * tool context, enabling automatic subscription to stack PRs without explicit --subscribe.
 *
 * This is the key command for submitting work, following Graphite's `gt submit` pattern.
 */

import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Array from "effect/Array";
import * as Console from "effect/Console";
import { pipe } from "effect/Function";
import { checkVcsAvailability, outputError } from "./shared.js";
import { PrService, CreatePrInput, UpdatePrInput } from "../../../../../ports/PrService.js";
import { DaemonService } from "../../../../../ports/DaemonService.js";

// === Options ===

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

const draftOption = Options.boolean("draft").pipe(
  Options.withDescription("Create PR as draft"),
  Options.withDefault(false),
);

const titleOption = Options.text("title").pipe(
  Options.withAlias("t"),
  Options.withDescription("PR title (defaults to change description)"),
  Options.optional,
);

const bodyOption = Options.text("body").pipe(
  Options.withAlias("b"),
  Options.withDescription("PR body"),
  Options.optional,
);

const subscribeOption = Options.text("subscribe").pipe(
  Options.withAlias("s"),
  Options.withDescription("OpenCode session ID to subscribe to all stack PRs"),
  Options.optional,
);

// === Output Types ===

interface SubmitOutput {
  pushed: boolean;
  bookmark?: string;
  baseBranch?: string;
  pr?: {
    url: string;
    number: number;
    status: "created" | "updated" | "exists";
  };
  error?: string;
  subscribed?: {
    sessionId: string;
    prNumbers: number[];
  };
  /** Changes that were auto-abandoned because they were empty with no description */
  abandonedEmptyChanges?: string[];
}

// === Command ===

export const submitCommand = Command.make(
  "submit",
  {
    json: jsonOption,
    draft: draftOption,
    title: titleOption,
    body: bodyOption,
    subscribe: subscribeOption,
  },
  ({ json, draft, title, body, subscribe }) =>
    Effect.gen(function* () {
      // Check VCS availability (jj installed and in repo)
      const vcsCheck = yield* checkVcsAvailability();
      if (!vcsCheck.available) {
        yield* outputError(vcsCheck.error, json);
        return;
      }
      const { vcs } = vcsCheck;

      // Get PR service
      const prService = yield* PrService;

      // Check if gh is available
      const ghAvailable = yield* prService.isAvailable();
      if (!ghAvailable) {
        yield* outputError(
          "GitHub CLI (gh) is not installed or not authenticated. Run 'gh auth login' first.",
          json,
        );
        return;
      }

      // Get current change
      const changeResult = yield* vcs.getCurrentChange().pipe(
        Effect.map((change) => ({ success: true as const, change })),
        Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
      );

      if (!changeResult.success) {
        yield* outputError(`Failed to get current change: ${changeResult.error}`, json);
        return;
      }

      let change = changeResult.change;

      // If current change is empty AND has no bookmark, check if parent has a bookmark
      // This handles the case where working copy is an empty change on top of actual work
      const parentChange = yield* vcs
        .getParentChange()
        .pipe(Effect.catchAll(() => Effect.succeed(null)));

      if (change.isEmpty && change.bookmarks.length === 0) {
        if (parentChange && parentChange.bookmarks.length > 0 && !parentChange.isEmpty) {
          // Parent has a bookmark with changes - use that instead
          change = parentChange;
        }
      }

      // Check if change has a bookmark
      if (change.bookmarks.length === 0) {
        yield* outputError(
          "Current change has no bookmark. Create one with 'jj bookmark create <name>' or use 'ship start <task-id>'.",
          json,
        );
        return;
      }

      // Use the first bookmark (typically there's only one)
      const bookmark = change.bookmarks[0];

      // Check if change is empty
      if (change.isEmpty) {
        yield* outputError(
          "Current change is empty (no modifications). Make some changes before submitting.",
          json,
        );
        return;
      }

      // Auto-abandon empty changes without descriptions in the stack
      // This prevents "commit has no description" errors when pushing
      const stackChanges = yield* vcs.getStack().pipe(Effect.catchAll(() => Effect.succeed([])));

      // Helper to check if a change should be abandoned
      const isEmptyWithoutDescription = (c: typeof stackChanges[number]) =>
        c.isEmpty &&
        (!c.description || c.description.trim() === "" || c.description === "(no description)") &&
        c.bookmarks.length === 0 &&
        c.id !== change.id; // Don't abandon the change we're submitting

      const emptyChangesToAbandon = stackChanges.filter(isEmptyWithoutDescription);

      // Abandon empty changes and collect successfully abandoned change IDs
      const abandonedChangeIds = yield* Effect.forEach(
        emptyChangesToAbandon,
        (emptyChange) =>
          vcs.abandon(emptyChange.id).pipe(
            Effect.map(() => emptyChange.changeId),
            Effect.catchAll(() => Effect.succeed(null)), // Continue on failure
          ),
      ).pipe(Effect.map((ids) => ids.filter((id): id is string => id !== null)));

      // Push the bookmark to remote
      const pushResult = yield* vcs.push(bookmark).pipe(
        Effect.map((result) => ({ success: true as const, result })),
        Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
      );

      if (!pushResult.success) {
        yield* outputError(`Failed to push: ${pushResult.error}`, json);
        return;
      }

      // Determine base branch for PR
      // If we're submitting the parent (because current was empty), look at grandparent
      // Otherwise, use the parent's bookmark for stacked PR workflow
      // Fall back to main/trunk if no parent bookmark
      const submitParentChange =
        change === parentChange
          ? yield* vcs.getLog("@--").pipe(
              Effect.map((changes) => (changes.length > 0 ? changes[0] : null)),
              Effect.catchAll(() => Effect.succeed(null)),
            )
          : parentChange;

      const baseBranch = pipe(
        Option.fromNullable(submitParentChange),
        Option.flatMap((p) => Array.head(p.bookmarks)),
        Option.getOrElse(() => "main"),
      );

      // Resolve PR title and body using Option.getOrElse
      const prTitle = Option.getOrElse(title, () => change.description.split("\n")[0] || bookmark);
      const prBody = Option.getOrElse(body, () => change.description);

      // Check if PR already exists for this branch
      const existingPr = yield* prService
        .getPrByBranch(bookmark)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));

      let output: SubmitOutput;

      if (existingPr) {
        // PR already exists - check if we need to update it
        const hasUpdates = Option.isSome(title) || Option.isSome(body);

        if (hasUpdates) {
          // Update the PR with new title/body
          const updateInput = new UpdatePrInput({
            title: Option.isSome(title) ? prTitle : undefined,
            body: Option.isSome(body) ? prBody : undefined,
          });

          const updateResult = yield* prService.updatePr(existingPr.number, updateInput).pipe(
            Effect.map((pr) => ({ success: true as const, pr })),
            Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
          );

          if (!updateResult.success) {
            output = {
              pushed: true,
              bookmark,
              baseBranch,
              pr: {
                url: existingPr.url,
                number: existingPr.number,
                status: "exists",
              },
              error: `Pushed but failed to update PR: ${updateResult.error}`,
            };
          } else {
            output = {
              pushed: true,
              bookmark,
              baseBranch,
              pr: {
                url: updateResult.pr.url,
                number: updateResult.pr.number,
                status: "updated",
              },
            };
          }
        } else {
          // No updates needed, just report exists
          output = {
            pushed: true,
            bookmark,
            baseBranch,
            pr: {
              url: existingPr.url,
              number: existingPr.number,
              status: "exists",
            },
          };
        }
      } else {
        // Create new PR
        const createInput = new CreatePrInput({
          title: prTitle,
          body: prBody,
          head: bookmark,
          base: baseBranch,
          draft,
        });

        const createResult = yield* prService.createPr(createInput).pipe(
          Effect.map((pr) => ({ success: true as const, pr })),
          Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
        );

        if (!createResult.success) {
          // Push succeeded but PR creation failed - partial success
          output = {
            pushed: true,
            bookmark,
            baseBranch,
            error: `Pushed but failed to create PR: ${createResult.error}`,
          };
        } else {
          output = {
            pushed: true,
            bookmark,
            baseBranch,
            pr: {
              url: createResult.pr.url,
              number: createResult.pr.number,
              status: "created",
            },
          };
        }
      }

      // If subscribe option provided and we have a PR, subscribe to all stack PRs
      if (Option.isSome(subscribe) && output.pr) {
        const sessionId = subscribe.value;
        const daemonService = yield* DaemonService;

        // Check if daemon is running
        const daemonRunning = yield* daemonService.isRunning();
        if (daemonRunning) {
          // Get all PRs in the stack by getting all bookmarks from trunk to current
          const stackLog = yield* vcs.getLog().pipe(Effect.catchAll(() => Effect.succeed([])));

          // Get bookmarks from stack (excluding current bookmark)
          const stackBookmarks = stackLog
            .filter((c) => c.bookmarks.length > 0 && c.bookmarks[0] !== bookmark)
            .map((c) => c.bookmarks[0]!)
            .filter(Boolean);

          // Fetch PR numbers concurrently for all bookmarks in the stack
          const stackPrNumbers = yield* Effect.forEach(
            stackBookmarks,
            (stackBookmark) =>
              prService.getPrByBranch(stackBookmark).pipe(
                Effect.map((pr) => (pr ? pr.number : null)),
                Effect.catchAll(() => Effect.succeed(null as number | null)),
              ),
            { concurrency: 5 },
          ).pipe(Effect.map((nums) => nums.filter((n): n is number => n !== null)));

          // Combine current PR with stack PRs
          const prNumbers = [output.pr.number, ...stackPrNumbers];

          // Subscribe to all PRs
          if (prNumbers.length > 0) {
            const subscribeResult = yield* daemonService.subscribe(sessionId, prNumbers).pipe(
              Effect.map(() => true),
              Effect.tapError((e) =>
                Effect.logWarning("Failed to subscribe to stack PRs").pipe(
                  Effect.annotateLogs({ error: String(e), prNumbers: prNumbers.join(",") }),
                ),
              ),
              Effect.catchAll(() => Effect.succeed(false)),
            );
            // Only report subscription if it actually succeeded
            if (subscribeResult) {
              output.subscribed = { sessionId, prNumbers };
            }
          }
        }
      }

      // Add info about auto-abandoned empty changes
      if (abandonedChangeIds.length > 0) {
        output.abandonedEmptyChanges = abandonedChangeIds;
      }

      // Output result
      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        // Report auto-abandoned changes first
        if (output.abandonedEmptyChanges && output.abandonedEmptyChanges.length > 0) {
          yield* Console.log(
            `Auto-abandoned empty changes: ${output.abandonedEmptyChanges.join(", ")}`,
          );
        }
        if (output.error) {
          yield* Console.log(`Pushed bookmark: ${output.bookmark}`);
          yield* Console.log(`Base branch: ${output.baseBranch}`);
          yield* Console.log(`Warning: ${output.error}`);
        } else if (output.pr) {
          yield* Console.log(`Pushed bookmark: ${output.bookmark}`);
          yield* Console.log(`Base branch: ${output.baseBranch}`);
          const statusMsg =
            output.pr.status === "created"
              ? "Created PR"
              : output.pr.status === "exists"
                ? "PR already exists"
                : "Updated PR";
          yield* Console.log(`${statusMsg}: #${output.pr.number}`);
          yield* Console.log(`URL: ${output.pr.url}`);
        }
        if (output.subscribed) {
          yield* Console.log(`Subscribed to PRs: ${output.subscribed.prNumbers.join(", ")}`);
        }
      }
    }),
);
