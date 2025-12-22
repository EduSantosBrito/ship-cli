/**
 * ship stack submit - Push and create/update PR
 *
 * Submits the current change to remote:
 * 1. Gets current change and its bookmark
 * 2. Pushes bookmark to remote
 * 3. Creates or updates a PR on GitHub
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
}

// === Command ===

export const submitCommand = Command.make(
  "submit",
  { json: jsonOption, draft: draftOption, title: titleOption, body: bodyOption },
  ({ json, draft, title, body }) =>
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
        yield* outputError("GitHub CLI (gh) is not installed or not authenticated. Run 'gh auth login' first.", json);
        return;
      }

      // Get current change
      const changeResult = yield* vcs.getCurrentChange().pipe(
        Effect.map((change) => ({ success: true as const, change })),
        Effect.catchAll((e) =>
          Effect.succeed({ success: false as const, error: String(e) }),
        ),
      );

      if (!changeResult.success) {
        yield* outputError(`Failed to get current change: ${changeResult.error}`, json);
        return;
      }

      const change = changeResult.change;

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

      // Push the bookmark to remote
      const pushResult = yield* vcs.push(bookmark).pipe(
        Effect.map((result) => ({ success: true as const, result })),
        Effect.catchAll((e) =>
          Effect.succeed({ success: false as const, error: String(e) }),
        ),
      );

      if (!pushResult.success) {
        yield* outputError(`Failed to push: ${pushResult.error}`, json);
        return;
      }

      // Determine base branch for PR
      // If parent change has a bookmark, use that (stacked PR workflow)
      // Otherwise, fall back to main/trunk
      const parentChange = yield* vcs.getParentChange().pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );

      const baseBranch = pipe(
        Option.fromNullable(parentChange),
        Option.flatMap((p) => Array.head(p.bookmarks)),
        Option.getOrElse(() => "main"),
      );

      // Resolve PR title and body using Option.getOrElse
      const prTitle = Option.getOrElse(title, () => change.description.split("\n")[0] || bookmark);
      const prBody = Option.getOrElse(body, () => change.description);

      // Check if PR already exists for this branch
      const existingPr = yield* prService.getPrByBranch(bookmark).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );

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
            Effect.catchAll((e) =>
              Effect.succeed({ success: false as const, error: String(e) }),
            ),
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
          Effect.catchAll((e) =>
            Effect.succeed({ success: false as const, error: String(e) }),
          ),
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

      // Output result
      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        if (output.error) {
          yield* Console.log(`Pushed bookmark: ${output.bookmark}`);
          yield* Console.log(`Base branch: ${output.baseBranch}`);
          yield* Console.log(`Warning: ${output.error}`);
        } else if (output.pr) {
          yield* Console.log(`Pushed bookmark: ${output.bookmark}`);
          yield* Console.log(`Base branch: ${output.baseBranch}`);
          const statusMsg = output.pr.status === "created" 
            ? "Created PR" 
            : output.pr.status === "exists" 
              ? "PR already exists" 
              : "Updated PR";
          yield* Console.log(`${statusMsg}: #${output.pr.number}`);
          yield* Console.log(`URL: ${output.pr.url}`);
        }
      }
    }),
);
