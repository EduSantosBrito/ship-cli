/**
 * ship pr --stack - Create stacked PRs for entire stack
 *
 * Creates GitHub PRs for all changes in the stack with proper base branch targeting:
 * - First PR targets main (or configured default branch)
 * - Subsequent PRs target the previous PR's branch
 *
 * Features:
 * - Existing PRs detected and skipped (URL shown)
 * - Existing PRs with wrong base are retargeted
 * - All PR URLs listed at end of output
 * - Handles partial stacks (some PRs exist, some don't)
 *
 * Usage:
 *   ship pr --stack           # Create PRs for all changes in stack
 *   ship pr --stack --draft   # Create all PRs as drafts
 *   ship pr --stack --dry-run # Show what would be created
 *   ship pr --stack --json    # Output as JSON
 */

import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import {
  checkPrPrerequisites,
  outputError,
  getDefaultBranch,
  getConflictedChanges,
  formatConflictError,
} from "./shared.js";
import { CreatePrInput } from "../../../../../ports/PrService.js";
import { IssueRepository } from "../../../../../ports/IssueRepository.js";
import type { Change } from "../../../../../ports/VcsService.js";
import type { Task } from "../../../../../domain/Task.js";
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
  Options.withDescription("Create PRs as draft"),
  Options.withDefault(false),
);

const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDescription("Show what would be created without executing"),
  Options.withDefault(false),
);

// === Output Types ===

interface StackPrResult {
  bookmark: string;
  baseBranch: string;
  taskId?: string | undefined;
  pr?: {
    url: string;
    number: number;
    status: "created" | "exists" | "retargeted" | "would-create" | "would-retarget";
    previousBase?: string | undefined;
  };
  error?: string | undefined;
  skipped?: boolean;
  skipReason?: string | undefined;
}

interface StackOutput {
  results: StackPrResult[];
  summary: {
    total: number;
    created: number;
    exists: number;
    retargeted: number;
    skipped: number;
    errors: number;
  };
}

// === Command ===

export const stackCommand = Command.make(
  "stack",
  {
    json: jsonOption,
    draft: draftOption,
    dryRun: dryRunOption,
  },
  ({ json, draft, dryRun }) =>
    Effect.gen(function* () {
      // Check all prerequisites (VCS and GitHub CLI)
      const prereqs = yield* checkPrPrerequisites();
      if (!prereqs.available) {
        yield* outputError(prereqs.error, json);
        return;
      }
      const { vcs, prService } = prereqs;

      // Get Issue Repository for task fetching
      const issueRepo = yield* IssueRepository;

      // Get configured default branch (trunk)
      const defaultBranch = yield* getDefaultBranch();

      // Get the stack - all changes from trunk to current
      const stackChanges = yield* vcs.getStack().pipe(
        Effect.catchAll(() => {
          return Effect.succeed([] as ReadonlyArray<Change>);
        }),
      );

      if (stackChanges.length === 0) {
        yield* outputError("No changes in stack to create PRs for.", json);
        return;
      }

      // Check for conflicts in the stack
      const conflictedChanges = getConflictedChanges(stackChanges);
      if (conflictedChanges.length > 0) {
        yield* outputError(formatConflictError(conflictedChanges), json);
        return;
      }

      // Filter to only changes with bookmarks (can create PRs)
      const changesWithBookmarks = stackChanges.filter((c) => c.bookmarks.length > 0 && !c.isEmpty);

      if (changesWithBookmarks.length === 0) {
        yield* outputError(
          "No changes with bookmarks found in stack. Create bookmarks first with 'jj bookmark create <name>'.",
          json,
        );
        return;
      }

      if (!json) {
        yield* Console.log("Creating stacked PRs...\n");
      }

      // Extract all task IDs from bookmarks for parallel fetching
      const taskIdMap = new Map<string, string>();
      for (const change of changesWithBookmarks) {
        const bookmark = change.bookmarks[0];
        const taskId = parseTaskIdentifierFromBookmark(bookmark);
        if (taskId) {
          taskIdMap.set(bookmark, taskId);
        }
      }

      // Fetch all tasks in parallel (with concurrency limit)
      const uniqueTaskIds = [...new Set(taskIdMap.values())];
      const tasksMap = yield* Effect.forEach(
        uniqueTaskIds,
        (taskId) =>
          issueRepo.getTaskByIdentifier(taskId).pipe(
            Effect.map((task) => [taskId, task] as const),
            Effect.catchAll(() => Effect.succeed(null)),
          ),
        { concurrency: 5 },
      ).pipe(
        Effect.map(
          (results) =>
            new Map<string, Task>(results.filter((r): r is [string, Task] => r !== null)),
        ),
      );

      const results: StackPrResult[] = [];
      let previousBookmark: string | null = null;

      // Process changes from bottom to top (oldest to newest)
      for (const change of changesWithBookmarks) {
        const bookmark = change.bookmarks[0];
        const baseBranch = previousBookmark ?? defaultBranch;

        // Get task ID from pre-computed map
        const taskId = taskIdMap.get(bookmark);

        // Check if PR already exists for this branch
        const existingPr = yield* prService
          .getPrByBranch(bookmark)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));

        if (existingPr) {
          // PR exists - check if base needs retargeting
          if (existingPr.base !== baseBranch) {
            if (dryRun) {
              results.push({
                bookmark,
                baseBranch,
                taskId,
                pr: {
                  url: existingPr.url,
                  number: existingPr.number,
                  status: "would-retarget",
                  previousBase: existingPr.base,
                },
              });
              if (!json) {
                yield* Console.log(
                  `  ○ ${bookmark} → PR #${existingPr.number} (would retarget: ${existingPr.base} → ${baseBranch})`,
                );
              }
            } else {
              // Retarget the PR
              const retargetResult = yield* prService
                .updatePrBase(existingPr.number, baseBranch)
                .pipe(
                  Effect.map(() => ({ success: true as const })),
                  Effect.catchAll((e) =>
                    Effect.succeed({ success: false as const, error: String(e) }),
                  ),
                );

              if (retargetResult.success) {
                results.push({
                  bookmark,
                  baseBranch,
                  taskId,
                  pr: {
                    url: existingPr.url,
                    number: existingPr.number,
                    status: "retargeted",
                    previousBase: existingPr.base,
                  },
                });
                if (!json) {
                  yield* Console.log(
                    `  ○ ${bookmark} → PR #${existingPr.number} (retargeted: ${existingPr.base} → ${baseBranch})`,
                  );
                }
              } else {
                results.push({
                  bookmark,
                  baseBranch,
                  taskId,
                  pr: {
                    url: existingPr.url,
                    number: existingPr.number,
                    status: "exists",
                  },
                  error: `Failed to retarget: ${retargetResult.error}`,
                });
                if (!json) {
                  yield* Console.log(
                    `  ○ ${bookmark} → PR #${existingPr.number} (exists, retarget failed)`,
                  );
                }
              }
            }
          } else {
            // PR exists with correct base
            results.push({
              bookmark,
              baseBranch,
              taskId,
              pr: {
                url: existingPr.url,
                number: existingPr.number,
                status: "exists",
              },
            });
            if (!json) {
              yield* Console.log(
                `  ○ ${bookmark} → PR #${existingPr.number} (exists, base: ${baseBranch})`,
              );
            }
          }
        } else {
          // Create new PR
          if (dryRun) {
            results.push({
              bookmark,
              baseBranch,
              taskId,
              pr: {
                url: "",
                number: 0,
                status: "would-create",
              },
            });
            if (!json) {
              yield* Console.log(`  ○ ${bookmark} → (would create, base: ${baseBranch})`);
            }
          } else {
            // Generate PR title and body using pre-fetched task data
            let prTitle: string;
            let prBody: string;

            // Look up task from pre-fetched map (parallel fetching done earlier)
            const task = taskId ? tasksMap.get(taskId) : undefined;

            if (task) {
              // Use task info for PR
              prTitle = `${taskId}: ${task.title}`;
              const { body } = generatePrBody({
                task,
                stackChanges: [change],
              });
              prBody = body;
            } else {
              // No task found - fall back to change description
              prTitle = change.description.split("\n")[0] || bookmark;
              prBody = generateMinimalPrBody(change);
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

            if (createResult.success) {
              results.push({
                bookmark,
                baseBranch,
                taskId,
                pr: {
                  url: createResult.pr.url,
                  number: createResult.pr.number,
                  status: "created",
                },
              });
              if (!json) {
                yield* Console.log(
                  `  @ ${bookmark} → PR #${createResult.pr.number} (created, base: ${baseBranch})`,
                );
              }
            } else {
              results.push({
                bookmark,
                baseBranch,
                taskId,
                error: `Failed to create PR: ${createResult.error}`,
              });
              if (!json) {
                yield* Console.log(`  ✗ ${bookmark} → Error: ${createResult.error}`);
              }
            }
          }
        }

        // Update previous bookmark for next iteration
        previousBookmark = bookmark;
      }

      // Calculate summary
      const summary = {
        total: results.length,
        created: results.filter(
          (r) => r.pr?.status === "created" || r.pr?.status === "would-create",
        ).length,
        exists: results.filter((r) => r.pr?.status === "exists").length,
        retargeted: results.filter(
          (r) => r.pr?.status === "retargeted" || r.pr?.status === "would-retarget",
        ).length,
        skipped: results.filter((r) => r.skipped).length,
        errors: results.filter((r) => r.error && !r.pr).length,
      };

      const output: StackOutput = { results, summary };

      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        // Print summary with PR URLs
        yield* Console.log("");
        yield* Console.log("Stack PRs:");
        for (const result of results) {
          if (result.pr?.url) {
            yield* Console.log(`  ${result.pr.url}`);
          }
        }

        if (dryRun) {
          yield* Console.log("");
          yield* Console.log("(dry-run mode - no PRs were created or modified)");
        }
      }
    }),
);
