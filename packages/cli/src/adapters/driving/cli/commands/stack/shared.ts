/**
 * Shared utilities for stack commands
 */

import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { VcsService } from "../../../../../ports/VcsService.js";
import { JjNotInstalledError, VcsError } from "../../../../../domain/Errors.js";

/**
 * Result of checking VCS availability
 */
export type VcsCheckResult =
  | { available: true; vcs: VcsService }
  | { available: false; error: string };

/**
 * Check if VCS (jj) is available and we're in a repository.
 *
 * This helper properly handles errors instead of swallowing them with orElseSucceed.
 * Returns a discriminated union for explicit error handling in commands.
 *
 * Usage:
 * ```ts
 * const result = yield* checkVcsAvailability();
 * if (!result.available) {
 *   yield* outputError(result.error, json);
 *   return;
 * }
 * const { vcs } = result;
 * // ... use vcs
 * ```
 */
export const checkVcsAvailability = (): Effect.Effect<
  VcsCheckResult,
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
      Effect.catchAll((e) => {
        if (e instanceof JjNotInstalledError) {
          return Effect.succeed({ isRepo: false, error: "jj is not installed" });
        }
        if (e instanceof VcsError) {
          return Effect.succeed({ isRepo: false, error: e.message });
        }
        return Effect.succeed({ isRepo: false, error: "Unknown VCS error" });
      }),
    );

    if (isRepoResult.error) {
      return { available: false, error: isRepoResult.error } as const;
    }

    if (!isRepoResult.isRepo) {
      return { available: false, error: "Not a jj repository" } as const;
    }

    return { available: true, vcs } as const;
  });

/**
 * Output an error message in text or JSON format
 */
export const outputError = (
  message: string,
  json: boolean,
): Effect.Effect<void, never> =>
  json
    ? Console.log(JSON.stringify({ error: message }))
    : Console.log(`Error: ${message}`);
