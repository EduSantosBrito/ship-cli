/**
 * Shared utilities for stack commands
 */

import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { VcsService } from "../../../../../ports/VcsService.js";
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";

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
export const checkVcsAvailability = (): Effect.Effect<VcsCheckResult, never, VcsService> =>
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
      return { available: false, error: "Not a jj repository" } as const;
    }

    return { available: true, vcs } as const;
  });

/**
 * Output an error message in text or JSON format
 */
export const outputError = (message: string, json: boolean): Effect.Effect<void, never> =>
  json ? Console.log(JSON.stringify({ error: message })) : Console.log(`Error: ${message}`);

/**
 * Extract error information from an Effect error.
 *
 * Returns a structured object with tag and message for tagged errors,
 * or a generic error for unknown errors.
 *
 * @example
 * ```ts
 * Effect.catchAll((e) => {
 *   const { tag, message } = extractErrorInfo(e);
 *   return Effect.succeed({ success: false, error: { tag, message } });
 * })
 * ```
 */
export const extractErrorInfo = (e: unknown): { tag: string; message: string } => {
  if (e && typeof e === "object" && "_tag" in e) {
    return {
      tag: String(e._tag),
      message: "message" in e ? String(e.message) : String(e),
    };
  }
  return { tag: "UnknownError", message: String(e) };
};

/**
 * Format an Effect error into a human-readable string.
 *
 * Handles tagged errors (with _tag property) by including the tag in the output,
 * making it easier to identify the error type in logs and user-facing messages.
 *
 * @example
 * ```ts
 * Effect.catchAll((e) => {
 *   const errMsg = formatEffectError(e);
 *   return Effect.succeed({ success: false, error: errMsg });
 * })
 * ```
 */
export const formatEffectError = (e: unknown): string => {
  const { tag, message } = extractErrorInfo(e);
  return `[${tag}] ${message}`;
};

/**
 * Get the configured default branch (trunk) from config.
 *
 * Loads the config and extracts git.defaultBranch, falling back to "main"
 * if config loading fails or the field is not set.
 *
 * This helper provides type-safe access to just the defaultBranch value,
 * avoiding the need to create partial config objects with incorrect shapes.
 *
 * @example
 * ```ts
 * const defaultBranch = yield* getDefaultBranch();
 * yield* vcs.sync(defaultBranch);
 * ```
 */
export const getDefaultBranch = (): Effect.Effect<string, never, ConfigRepository> =>
  Effect.gen(function* () {
    const configRepo = yield* ConfigRepository;
    return yield* configRepo.load().pipe(
      Effect.map((c) => c.git.defaultBranch),
      Effect.catchAll(() => Effect.succeed("main")),
    );
  });
