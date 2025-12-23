import * as Data from "effect/Data";

// === Task Errors ===

export class TaskNotFoundError extends Data.TaggedError("TaskNotFoundError")<{
  readonly taskId: string;
}> {
  get message() {
    return `Task not found: ${this.taskId}`;
  }
}

export class MilestoneNotFoundError extends Data.TaggedError("MilestoneNotFoundError")<{
  readonly milestoneId: string;
}> {
  get message() {
    return `Milestone not found: ${this.milestoneId}`;
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

/** Squash operation failed */
export class JjSquashError extends Data.TaggedError("JjSquashError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Attempt to modify an immutable commit */
export class JjImmutableError extends Data.TaggedError("JjImmutableError")<{
  readonly message: string;
  readonly commitId?: string;
}> {}

/** Working copy is stale and needs to be updated */
export class JjStaleWorkingCopyError extends Data.TaggedError("JjStaleWorkingCopyError")<{
  readonly message: string;
}> {
  static readonly default = new JjStaleWorkingCopyError({
    message: "The working copy is stale. Run 'ship stack update-stale' to recover.",
  });
}

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

/** gh CLI is installed but not authenticated with GitHub */
export class GhNotAuthenticatedError extends Data.TaggedError("GhNotAuthenticatedError")<{
  readonly message: string;
}> {
  static readonly default = new GhNotAuthenticatedError({
    message: "gh CLI is not authenticated. Run 'gh auth login' first.",
  });
}

// === Webhook Errors ===

/** Generic webhook error */
export class WebhookError extends Data.TaggedError("WebhookError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** WebSocket connection error */
export class WebhookConnectionError extends Data.TaggedError("WebhookConnectionError")<{
  readonly message: string;
  readonly wsUrl?: string;
  readonly cause?: unknown;
}> {}

/** Webhook permission denied (insufficient GitHub permissions) */
export class WebhookPermissionError extends Data.TaggedError("WebhookPermissionError")<{
  readonly message: string;
  readonly repo?: string;
}> {
  static forRepo(repo: string) {
    return new WebhookPermissionError({
      message: `Insufficient permissions to create webhooks on ${repo}. You need admin access or the 'admin:repo_hook' scope.`,
      repo,
    });
  }
}

/** Webhook already exists error (only one cli webhook allowed per repo) */
export class WebhookAlreadyExistsError extends Data.TaggedError("WebhookAlreadyExistsError")<{
  readonly message: string;
  readonly repo?: string;
}> {
  static forRepo(repo: string) {
    return new WebhookAlreadyExistsError({
      message: `A webhook forwarder is already active for ${repo}. Only one user can forward webhooks at a time per repository.`,
      repo,
    });
  }
}

/** GitHub API rate limit exceeded */
export class WebhookRateLimitError extends Data.TaggedError("WebhookRateLimitError")<{
  readonly message: string;
  readonly retryAfter?: number;
}> {
  static fromHeaders(retryAfter?: number) {
    const retryMsg = retryAfter ? ` Retry after ${retryAfter} seconds.` : "";
    return new WebhookRateLimitError({
      message: `GitHub API rate limit exceeded.${retryMsg}`,
      ...(retryAfter !== undefined ? { retryAfter } : {}),
    });
  }
}

// === Prompt Errors ===

/** User cancelled an interactive prompt (e.g., Ctrl+C) */
export class PromptCancelledError extends Data.TaggedError("PromptCancelledError")<{
  readonly message: string;
}> {
  static readonly default = new PromptCancelledError({
    message: "Prompt cancelled by user",
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

// === OpenCode Errors ===

/** Generic OpenCode service error */
export class OpenCodeError extends Data.TaggedError("OpenCodeError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** OpenCode server is not running or unreachable */
export class OpenCodeNotRunningError extends Data.TaggedError("OpenCodeNotRunningError")<{
  readonly message: string;
  readonly serverUrl?: string;
}> {
  static forUrl(serverUrl: string) {
    return new OpenCodeNotRunningError({
      message: `OpenCode server is not running at ${serverUrl}. Start it with 'opencode' or 'opencode serve'.`,
      serverUrl,
    });
  }
}

/** OpenCode session not found */
export class OpenCodeSessionNotFoundError extends Data.TaggedError("OpenCodeSessionNotFoundError")<{
  readonly message: string;
  readonly sessionId?: string;
}> {
  static forId(sessionId: string) {
    return new OpenCodeSessionNotFoundError({
      message: `Session not found: ${sessionId}`,
      sessionId,
    });
  }
}

// === Workspace Errors (jj workspace) ===

/** Generic workspace operation error */
export class WorkspaceError extends Data.TaggedError("WorkspaceError")<{
  readonly message: string;
  readonly name?: string;
  readonly path?: string;
  readonly cause?: unknown;
}> {}

/** Workspace already exists with the specified name */
export class WorkspaceExistsError extends Data.TaggedError("WorkspaceExistsError")<{
  readonly message: string;
  readonly name: string;
  readonly path?: string;
}> {
  static forName(name: string, path?: string) {
    const pathMsg = path ? ` at ${path}` : "";
    return new WorkspaceExistsError({
      message: `Workspace '${name}' already exists${pathMsg}`,
      name,
      ...(path !== undefined ? { path } : {}),
    });
  }
}

/** Workspace not found with the specified name */
export class WorkspaceNotFoundError extends Data.TaggedError("WorkspaceNotFoundError")<{
  readonly message: string;
  readonly name: string;
}> {
  static forName(name: string) {
    return new WorkspaceNotFoundError({
      message: `Workspace '${name}' not found`,
      name,
    });
  }
}

// === Template Errors ===

/** Template not found by name */
export class TemplateNotFoundError extends Data.TaggedError("TemplateNotFoundError")<{
  readonly message: string;
  readonly templateName: string;
}> {
  static forName(name: string) {
    return new TemplateNotFoundError({
      message: `Template '${name}' not found. Run 'ship template list' to see available templates.`,
      templateName: name,
    });
  }
}

/** Generic template error */
export class TemplateError extends Data.TaggedError("TemplateError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
