/**
 * ship pr - Create PR for current change/bookmark
 *
 * Creates a GitHub PR for the current jj change/bookmark with task information
 * auto-populated from Linear. This is the primary PR creation command that
 * complements `ship stack submit` (which handles push + PR in one step).
 *
 * Features:
 * - Extracts task ID from bookmark (e.g., "user/bri-123-slug" -> "BRI-123")
 * - Fetches task details from Linear for rich PR body
 * - Falls back to minimal PR body if no task linked
 * - Idempotent: shows existing PR URL instead of creating duplicate
 *
 * Usage:
 *   ship pr              # Create PR for current bookmark
 *   ship pr --draft      # Create as draft PR
 *   ship pr --open       # Open PR in browser after creation
 *   ship pr --json       # Output as JSON
 */

import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Array from "effect/Array";
import * as Console from "effect/Console";
import { pipe } from "effect/Function";
import { checkPrPrerequisites, outputError, getDefaultBranch } from "./shared.js";
import { CreatePrInput } from "../../../../../ports/PrService.js";
import { IssueRepository } from "../../../../../ports/IssueRepository.js";
import {
  generatePrBody,
  generateMinimalPrBody,
  parseTaskIdentifierFromBookmark,
} from "../../../../driven/github/PrBodyGenerator.js";

// === Options ===

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

const draftOption = Options.boolean("draft").pipe(
  Options.withDescription("Create PR as draft"),
  Options.withDefault(false),
);

const openOption = Options.boolean("open").pipe(
  Options.withDescription("Open PR in browser after creation"),
  Options.withDefault(false),
);

// === Output Types ===

interface CreateOutput {
  bookmark: string;
  baseBranch: string;
  taskId?: string | undefined;
  pr?: {
    url: string;
    number: number;
    status: "created" | "exists";
  };
  error?: string | undefined;
}

// === Command ===

export const createPrCommand = Command.make(
  "create",
  {
    json: jsonOption,
    draft: draftOption,
    open: openOption,
  },
  ({ json, draft, open }) =>
    Effect.gen(function* () {
      // Check all prerequisites (VCS and GitHub CLI)
      const prereqs = yield* checkPrPrerequisites();
      if (!prereqs.available) {
        yield* outputError(prereqs.error, json);
        return;
      }
      const { vcs, prService } = prereqs;

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
          "Current change is empty (no modifications). Make some changes before creating a PR.",
          json,
        );
        return;
      }

      // Check if PR already exists for this branch
      const existingPr = yield* prService
        .getPrByBranch(bookmark)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));

      if (existingPr) {
        // PR already exists - show URL and return (idempotent)
        const output: CreateOutput = {
          bookmark,
          baseBranch: "", // Not relevant for existing PR
          pr: {
            url: existingPr.url,
            number: existingPr.number,
            status: "exists",
          },
        };

        if (json) {
          yield* Console.log(JSON.stringify(output, null, 2));
        } else {
          yield* Console.log(`PR already exists: #${existingPr.number}`);
          yield* Console.log(`URL: ${existingPr.url}`);
        }

        // Open in browser if requested
        if (open) {
          yield* prService.openInBrowser(existingPr.url).pipe(Effect.catchAll(() => Effect.void));
        }

        return;
      }

      // Get configured default branch (trunk)
      const defaultBranch = yield* getDefaultBranch();

      // Determine base branch for PR
      // Use the parent's bookmark for stacked PR workflow
      // Fall back to configured default branch if no parent bookmark
      const baseBranch = pipe(
        Option.fromNullable(parentChange),
        Option.flatMap((p) => Array.head(p.bookmarks)),
        Option.getOrElse(() => defaultBranch),
      );

      // Try to extract task ID from bookmark
      const taskId = parseTaskIdentifierFromBookmark(bookmark);

      // Get stack changes for PR body
      const stackChanges = yield* vcs.getStack().pipe(Effect.catchAll(() => Effect.succeed([])));

      // Generate PR title and body
      let prTitle: string;
      let prBody: string;

      if (taskId) {
        // Try to fetch task from Linear
        const issueRepo = yield* IssueRepository;
        const taskResult = yield* issueRepo.getTaskByIdentifier(taskId).pipe(
          Effect.map((task) => ({ success: true as const, task })),
          Effect.catchAll(() => Effect.succeed({ success: false as const })),
        );

        if (taskResult.success) {
          // Use task info for PR
          prTitle = `${taskId}: ${taskResult.task.title}`;
          const { body } = generatePrBody({
            task: taskResult.task,
            stackChanges,
          });
          prBody = body;
        } else {
          // Task not found - fall back to change description
          prTitle = change.description.split("\n")[0] || bookmark;
          prBody = generateMinimalPrBody(change, stackChanges);
        }
      } else {
        // No task ID found - use change description
        prTitle = change.description.split("\n")[0] || bookmark;
        prBody = generateMinimalPrBody(change, stackChanges);
      }

      // Create the PR
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
        const output: CreateOutput = {
          bookmark,
          baseBranch,
          taskId: taskId ?? undefined,
          error: `Failed to create PR: ${createResult.error}`,
        };

        if (json) {
          yield* Console.log(JSON.stringify(output, null, 2));
        } else {
          yield* Console.log(`Bookmark: ${bookmark}`);
          yield* Console.log(`Base branch: ${baseBranch}`);
          yield* Console.log(`Error: ${output.error}`);
        }
        return;
      }

      // Success
      const output: CreateOutput = {
        bookmark,
        baseBranch,
        taskId: taskId ?? undefined,
        pr: {
          url: createResult.pr.url,
          number: createResult.pr.number,
          status: "created",
        },
      };

      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* Console.log(`Created PR: #${createResult.pr.number}`);
        yield* Console.log(`Bookmark: ${bookmark}`);
        yield* Console.log(`Base branch: ${baseBranch}`);
        if (taskId) {
          yield* Console.log(`Task: ${taskId}`);
        }
        yield* Console.log(`URL: ${createResult.pr.url}`);
      }

      // Open in browser if requested
      if (open) {
        yield* prService
          .openInBrowser(createResult.pr.url)
          .pipe(Effect.catchAll(() => Effect.void));
      }
    }),
);
