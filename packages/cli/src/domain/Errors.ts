import * as Data from "effect/Data";

// === Task Errors ===

export class TaskNotFoundError extends Data.TaggedError("TaskNotFoundError")<{
  readonly taskId: string;
}> {
  get message() {
    return `Task not found: ${this.taskId}`;
  }
}

export class TaskError extends Data.TaggedError("TaskError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// === Auth Errors ===

export class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class NotAuthenticatedError extends Data.TaggedError("NotAuthenticatedError")<{
  readonly message: string;
}> {}

// === Config Errors ===

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ConfigNotFoundError extends Data.TaggedError("ConfigNotFoundError")<{
  readonly message: string;
}> {}

export class WorkspaceNotInitializedError extends Data.TaggedError("WorkspaceNotInitializedError")<{
  readonly message: string;
}> {
  static readonly default = new WorkspaceNotInitializedError({
    message: "Workspace not initialized. Run 'ship init' first.",
  });
}

// === VCS Errors ===

/** Generic VCS error - used when error doesn't match a specific type */
export class VcsError extends Data.TaggedError("VcsError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly exitCode?: number;
}> {}

/** jj CLI is not installed or not in PATH */
export class JjNotInstalledError extends Data.TaggedError("JjNotInstalledError")<{
  readonly message: string;
}> {
  static readonly default = new JjNotInstalledError({
    message: "jj is not installed. Visit https://jj-vcs.github.io/jj/",
  });
}

/** Current directory is not a jj repository */
export class NotARepoError extends Data.TaggedError("NotARepoError")<{
  readonly message: string;
  readonly path?: string;
}> {
  static readonly default = new NotARepoError({
    message: "Not a jj repository. Run 'jj git init' to initialize.",
  });
}

/** Working copy has conflicts that need to be resolved */
export class JjConflictError extends Data.TaggedError("JjConflictError")<{
  readonly message: string;
  readonly conflictedPaths?: ReadonlyArray<string>;
}> {}

/** Push operation failed (auth, network, rejected, etc.) */
export class JjPushError extends Data.TaggedError("JjPushError")<{
  readonly message: string;
  readonly bookmark?: string;
  readonly cause?: unknown;
}> {}

/** Fetch operation failed (network, auth, etc.) */
export class JjFetchError extends Data.TaggedError("JjFetchError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Bookmark operation failed (already exists, not found, etc.) */
export class JjBookmarkError extends Data.TaggedError("JjBookmarkError")<{
  readonly message: string;
  readonly bookmark?: string;
}> {}

/** Revision/revset not found or invalid */
export class JjRevisionError extends Data.TaggedError("JjRevisionError")<{
  readonly message: string;
  readonly revision?: string;
}> {}

// === PR Errors ===

export class PrError extends Data.TaggedError("PrError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class GhNotInstalledError extends Data.TaggedError("GhNotInstalledError")<{
  readonly message: string;
}> {
  static readonly default = new GhNotInstalledError({
    message: "gh CLI is not installed. Visit https://cli.github.com/",
  });
}

// === Linear API Errors ===

export class LinearApiError extends Data.TaggedError("LinearApiError")<{
  readonly message: string;
  readonly statusCode?: number;
  readonly cause?: unknown;
}> {}

export class RateLimitError extends Data.TaggedError("RateLimitError")<{
  readonly message: string;
  readonly retryAfter?: number;
}> {}
