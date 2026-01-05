/**
 * Shared utilities for PR commands
 *
 * This module provides common validation and helper functions used by
 * both `ship pr create` and `ship pr stack` commands.
 */

import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { VcsService, type Change } from "../../../../../ports/VcsService.js";
import { PrService } from "../../../../../ports/PrService.js";
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";

// === Types ===

/**
 * Result of checking PR prerequisites (VCS and GitHub CLI availability)
 */
export type PrPrerequisitesResult =
  | { available: true; vcs: VcsService; prService: PrService }
  | { available: false; error: string };

// === Shared Functions ===

/**
 * Check if VCS (jj) is available and we're in a repository.
 *
 * This helper properly handles errors instead of swallowing them with orElseSucceed.
 * Returns a discriminated union for explicit error handling in commands.
 */
export const checkVcsAvailability = (): Effect.Effect<
  { available: true; vcs: VcsService } | { available: false; error: string },
  never,
  VcsService
> =>
  Effect.gen(function* () {
    const vcs = yield* VcsService;

    // Check if jj is installed
    const isInstalled = yield* vcs.isAvailable();
    if (!isInstalled) {
      return { available: false, error: "jj is not installed" } as const;
    }

    // Check if we're in a jj repo - handle specific errors
    const isRepoResult = yield* vcs.isRepo().pipe(
      Effect.map((isRepo) => ({ isRepo, error: null as string | null })),
      Effect.catchTag("NotARepoError", (e) => Effect.succeed({ isRepo: false, error: e.message })),
      Effect.catchTag("VcsError", (e) => Effect.succeed({ isRepo: false, error: e.message })),
      Effect.catchAll(() => Effect.succeed({ isRepo: false, error: "Unknown VCS error" })),
    );

    if (isRepoResult.error) {
      return { available: false, error: isRepoResult.error } as const;
    }

    if (!isRepoResult.isRepo) {
      return {
        available: false,
        error: "Not a jj repository. Run 'jj git init --colocate' to set up jj for stacked changes.",
      } as const;
    }

    return { available: true, vcs } as const;
  });

/**
 * Check all prerequisites for PR commands:
 * - VCS (jj) is available and in a repository
 * - GitHub CLI (gh) is available and authenticated
 *
 * @example
 * ```ts
 * const prereqs = yield* checkPrPrerequisites();
 * if (!prereqs.available) {
 *   yield* outputError(prereqs.error, json);
 *   return;
 * }
 * const { vcs, prService } = prereqs;
 * ```
 */
export const checkPrPrerequisites = (): Effect.Effect<
  PrPrerequisitesResult,
  never,
  VcsService | PrService
> =>
  Effect.gen(function* () {
    // Check VCS availability (jj installed and in repo)
    const vcsCheck = yield* checkVcsAvailability();
    if (!vcsCheck.available) {
      return { available: false, error: vcsCheck.error } as const;
    }
    const { vcs } = vcsCheck;

    // Get PR service and check if gh is available
    const prService = yield* PrService;
    const ghAvailable = yield* prService.isAvailable();
    if (!ghAvailable) {
      return {
        available: false,
        error: "GitHub CLI (gh) is not installed or not authenticated. Run 'gh auth login' first.",
      } as const;
    }

    return { available: true, vcs, prService } as const;
  });

/**
 * Output an error message in text or JSON format
 */
export const outputError = (message: string, json: boolean): Effect.Effect<void, never> =>
  json ? Console.log(JSON.stringify({ error: message })) : Console.log(`Error: ${message}`);

/**
 * Get the configured default branch (trunk) from config.
 *
 * Loads the config and extracts git.defaultBranch, falling back to "main"
 * if config loading fails or the field is not set.
 */
export const getDefaultBranch = (): Effect.Effect<string, never, ConfigRepository> =>
  Effect.gen(function* () {
    const configRepo = yield* ConfigRepository;
    return yield* configRepo.load().pipe(
      Effect.map((c) => c.git.defaultBranch),
      Effect.catchAll(() => Effect.succeed("main")),
    );
  });

/**
 * Check if any changes in the stack have conflicts.
 * Returns list of conflicted changes for error reporting.
 *
 * @param changes - Array of changes to check
 * @returns Array of changes that have conflicts
 */
export const getConflictedChanges = (changes: ReadonlyArray<Change>): ReadonlyArray<Change> =>
  changes.filter((c) => c.hasConflict);

/**
 * Format conflict error message for display.
 *
 * @param conflictedChanges - Array of changes with conflicts
 * @returns Formatted error message
 */
export const formatConflictError = (conflictedChanges: ReadonlyArray<Change>): string => {
  const conflictList = conflictedChanges
    .map(
      (c) => `  - ${c.changeId.slice(0, 8)}: ${c.description.split("\n")[0] || "(no description)"}`,
    )
    .join("\n");

  return `Cannot create PRs: ${conflictedChanges.length} change(s) have conflicts. Resolve conflicts first:\n${conflictList}`;
};
