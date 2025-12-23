/**
 * JjErrorMapper - Map jj CLI errors to typed VcsError subtypes
 *
 * This module parses jj stderr output and maps known error patterns
 * to specific error types for proper handling upstream.
 */

import {
  VcsError,
  NotARepoError,
  JjConflictError,
  JjPushError,
  JjFetchError,
  JjBookmarkError,
  JjRevisionError,
  JjSquashError,
  JjImmutableError,
  JjStaleWorkingCopyError,
  WorkspaceError,
  WorkspaceExistsError,
  WorkspaceNotFoundError,
} from "../../../domain/Errors.js";

/** Union of all VCS error types that can be mapped */
export type JjError =
  | VcsError
  | NotARepoError
  | JjConflictError
  | JjPushError
  | JjFetchError
  | JjBookmarkError
  | JjRevisionError
  | JjSquashError
  | JjImmutableError
  | JjStaleWorkingCopyError
  | WorkspaceError
  | WorkspaceExistsError
  | WorkspaceNotFoundError;

/**
 * Error patterns for jj CLI output
 * Each pattern maps to a specific error type constructor
 */
interface ErrorPattern {
  /** Regex to match against stderr output */
  pattern: RegExp;
  /** Function to create the appropriate error from the match */
  createError: (output: string, match: RegExpMatchArray) => JjError;
}

const ERROR_PATTERNS: ReadonlyArray<ErrorPattern> = [
  // Not a repository
  {
    pattern: /There is no jj repo in/i,
    createError: () =>
      new NotARepoError({
        message: "Not a jj repository. Run 'jj git init' to initialize.",
      }),
  },
  {
    pattern: /Error: The current directory is not part of a repository/i,
    createError: () =>
      new NotARepoError({
        message: "Not a jj repository. Run 'jj git init' to initialize.",
      }),
  },

  // Conflicts
  {
    pattern: /Conflicting changes in/i,
    createError: (output) => {
      // Try to extract conflicted paths
      const pathMatches = output.match(/Conflicting changes in "([^"]+)"/g);
      const paths = pathMatches
        ? pathMatches.map((m) => m.replace(/Conflicting changes in "([^"]+)"/, "$1"))
        : [];
      if (paths.length > 0) {
        return new JjConflictError({
          message: "Working copy has conflicts that need to be resolved.",
          conflictedPaths: paths,
        });
      }
      return new JjConflictError({
        message: "Working copy has conflicts that need to be resolved.",
      });
    },
  },
  {
    pattern: /conflict/i,
    createError: (output) =>
      new JjConflictError({
        message: output.trim() || "Working copy has conflicts.",
      }),
  },

  // Push errors
  {
    pattern: /Won't push commit .* since it has no description/i,
    createError: () =>
      new JjPushError({
        message: "Cannot push: commit has no description. Use 'jj describe' to add one.",
      }),
  },
  {
    pattern: /Refusing to create new remote bookmark/i,
    createError: (output) => {
      const bookmarkMatch = output.match(/bookmark (\S+)/);
      const bookmark = bookmarkMatch?.[1];
      return new JjPushError({
        message: "Push failed: new bookmark requires --allow-new flag or manual tracking.",
        ...(bookmark && { bookmark }),
      });
    },
  },
  {
    pattern: /failed to push/i,
    createError: (output) =>
      new JjPushError({
        message: output.trim() || "Push failed.",
      }),
  },
  {
    pattern: /error: failed to push some refs/i,
    createError: () =>
      new JjPushError({
        message: "Push rejected. Try fetching and rebasing first.",
      }),
  },

  // Fetch errors
  {
    pattern: /failed to fetch/i,
    createError: (output) =>
      new JjFetchError({
        message: output.trim() || "Fetch failed.",
      }),
  },
  {
    pattern: /Could not find remote/i,
    createError: () =>
      new JjFetchError({
        message: "Remote not found. Check your git remote configuration.",
      }),
  },

  // Bookmark errors
  {
    pattern: /Bookmark already exists: (\S+)/i,
    createError: (_output, match) =>
      new JjBookmarkError({
        message: `Bookmark '${match[1]}' already exists. Use 'jj bookmark move' to update it.`,
        bookmark: match[1],
      }),
  },
  {
    pattern: /Bookmark "([^"]+)" doesn't exist/i,
    createError: (_output, match) =>
      new JjBookmarkError({
        message: `Bookmark '${match[1]}' not found.`,
        bookmark: match[1],
      }),
  },
  {
    pattern: /No such bookmark/i,
    createError: (output) =>
      new JjBookmarkError({
        message: output.trim() || "Bookmark not found.",
      }),
  },

  // Immutable commit errors
  {
    pattern: /Commit (\S+) is immutable/i,
    createError: (_output, match) =>
      new JjImmutableError({
        message:
          "Cannot modify immutable commit. This is typically a protected commit like main/master.",
        commitId: match[1],
      }),
  },

  // Squash errors
  {
    pattern: /Cannot squash into the root commit/i,
    createError: () =>
      new JjSquashError({
        message: "Cannot squash: target is the root commit.",
      }),
  },
  {
    pattern: /Cannot squash commits that have children/i,
    createError: () =>
      new JjSquashError({
        message: "Cannot squash: commit has children. Squash the children first.",
      }),
  },
  {
    pattern: /Cannot squash .* into itself/i,
    createError: () =>
      new JjSquashError({
        message: "Cannot squash a commit into itself.",
      }),
  },

  // Revision errors
  {
    pattern: /Revset "([^"]+)" didn't resolve to any revisions/i,
    createError: (_output, match) =>
      new JjRevisionError({
        message: `Revision '${match[1]}' not found.`,
        revision: match[1],
      }),
  },
  {
    pattern: /Revision "([^"]+)" doesn't exist/i,
    createError: (_output, match) =>
      new JjRevisionError({
        message: `Revision '${match[1]}' not found.`,
        revision: match[1],
      }),
  },
  {
    pattern: /No such revision/i,
    createError: (output) =>
      new JjRevisionError({
        message: output.trim() || "Revision not found.",
      }),
  },

  // Stale working copy errors
  {
    pattern: /The working copy is stale/i,
    createError: () => JjStaleWorkingCopyError.default,
  },
  {
    pattern: /working copy is stale/i,
    createError: () => JjStaleWorkingCopyError.default,
  },

  // Workspace errors (jj workspace)
  {
    pattern: /Workspace '([^']+)' already exists/i,
    createError: (_output, match) => WorkspaceExistsError.forName(match[1]),
  },
  {
    pattern: /already exists at: (.+)/i,
    createError: (_output, match) => WorkspaceExistsError.forName("unknown", match[1]),
  },
  {
    pattern: /No workspace named '([^']+)'/i,
    createError: (_output, match) => WorkspaceNotFoundError.forName(match[1]),
  },
  {
    pattern: /Workspace '([^']+)' doesn't exist/i,
    createError: (_output, match) => WorkspaceNotFoundError.forName(match[1]),
  },

  // Catch-all for generic workspace errors
  {
    pattern: /workspace/i,
    createError: (output) =>
      new WorkspaceError({
        message: output.trim() || "Workspace operation failed",
      }),
  },
];

/**
 * Map jj CLI output to a typed error
 *
 * @param output - Combined stdout/stderr from jj command
 * @param command - The jj command that was run (for context in generic errors)
 * @param exitCode - Optional exit code from the command
 * @returns A typed VcsError subtype
 */
export const mapJjError = (output: string, command: string, exitCode?: number): JjError => {
  // Try each pattern in order
  for (const { pattern, createError } of ERROR_PATTERNS) {
    const match = output.match(pattern);
    if (match) {
      return createError(output, match);
    }
  }

  // Fallback to generic VcsError with the original output
  return new VcsError({
    message: output.trim() || `jj ${command} failed`,
    ...(exitCode !== undefined && { exitCode }),
  });
};

/**
 * Check if output indicates an error (heuristic)
 *
 * jj uses exit codes but when running through shell we may not have them.
 * This checks common error indicators in the output.
 *
 * IMPORTANT: These patterns must be specific enough to avoid false positives.
 * The output may contain user-written commit messages, descriptions, etc.
 * Don't match generic words like "conflict" - instead match jj's actual error patterns.
 */
export const looksLikeError = (output: string): boolean => {
  const errorIndicators = [
    /^Error:/im,
    /^error:/im,
    /^fatal:/im,
    /failed to/i, // More specific than just "failed"
    /cannot /i, // With space to avoid matching "cannotation" etc
    /won't /i, // With space for specificity
    /refusing to/i, // jj's actual pattern
    /Conflicting changes in/i, // jj's actual conflict message
    /has conflicts?$/im, // "Working copy has conflicts" or "has conflict"
  ];

  return errorIndicators.some((pattern) => pattern.test(output));
};
