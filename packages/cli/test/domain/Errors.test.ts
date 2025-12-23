import { describe, it, expect } from "@effect/vitest"
import {
  // Task Errors
  TaskNotFoundError,
  MilestoneNotFoundError,
  TaskError,
  // Auth Errors
  AuthError,
  NotAuthenticatedError,
  // Config Errors
  ConfigError,
  ConfigNotFoundError,
  WorkspaceNotInitializedError,
  // VCS Errors
  VcsError,
  JjNotInstalledError,
  NotARepoError,
  JjConflictError,
  JjPushError,
  JjFetchError,
  JjBookmarkError,
  JjRevisionError,
  JjSquashError,
  JjImmutableError,
  JjStaleWorkingCopyError,
  // PR Errors
  PrError,
  GhNotInstalledError,
  GhNotAuthenticatedError,
  // Webhook Errors
  WebhookError,
  WebhookConnectionError,
  WebhookPermissionError,
  WebhookAlreadyExistsError,
  WebhookRateLimitError,
  // Prompt Errors
  PromptCancelledError,
  // Linear API Errors
  LinearApiError,
  RateLimitError,
  // OpenCode Errors
  OpenCodeError,
  OpenCodeNotRunningError,
  OpenCodeSessionNotFoundError,
  // Workspace Errors
  WorkspaceError,
  WorkspaceExistsError,
  WorkspaceNotFoundError,
  // Template Errors
  TemplateNotFoundError,
  TemplateError,
} from "../../src/domain/Errors.js"

describe("Domain Errors", () => {
  describe("Task Errors", () => {
    describe("TaskNotFoundError", () => {
      it("should have correct _tag", () => {
        const error = new TaskNotFoundError({ taskId: "task-123" })
        expect(error._tag).toBe("TaskNotFoundError")
      })

      it("should store taskId", () => {
        const error = new TaskNotFoundError({ taskId: "task-123" })
        expect(error.taskId).toBe("task-123")
      })

      it("should generate correct message", () => {
        const error = new TaskNotFoundError({ taskId: "task-123" })
        expect(error.message).toBe("Task not found: task-123")
      })
    })

    describe("MilestoneNotFoundError", () => {
      it("should have correct _tag", () => {
        const error = new MilestoneNotFoundError({ milestoneId: "mile-456" })
        expect(error._tag).toBe("MilestoneNotFoundError")
      })

      it("should store milestoneId", () => {
        const error = new MilestoneNotFoundError({ milestoneId: "mile-456" })
        expect(error.milestoneId).toBe("mile-456")
      })

      it("should generate correct message", () => {
        const error = new MilestoneNotFoundError({ milestoneId: "mile-456" })
        expect(error.message).toBe("Milestone not found: mile-456")
      })
    })

    describe("TaskError", () => {
      it("should have correct _tag", () => {
        const error = new TaskError({ message: "Something went wrong" })
        expect(error._tag).toBe("TaskError")
      })

      it("should store message", () => {
        const error = new TaskError({ message: "Something went wrong" })
        expect(error.message).toBe("Something went wrong")
      })

      it("should store optional cause", () => {
        const cause = new Error("Original error")
        const error = new TaskError({
          message: "Something went wrong",
          cause,
        })
        expect(error.cause).toBe(cause)
      })
    })
  })

  describe("Auth Errors", () => {
    describe("AuthError", () => {
      it("should have correct _tag", () => {
        const error = new AuthError({ message: "Auth failed" })
        expect(error._tag).toBe("AuthError")
      })

      it("should store message and optional cause", () => {
        const cause = new Error("Token expired")
        const error = new AuthError({ message: "Auth failed", cause })
        expect(error.message).toBe("Auth failed")
        expect(error.cause).toBe(cause)
      })
    })

    describe("NotAuthenticatedError", () => {
      it("should have correct _tag", () => {
        const error = new NotAuthenticatedError({ message: "Not logged in" })
        expect(error._tag).toBe("NotAuthenticatedError")
      })

      it("should store message", () => {
        const error = new NotAuthenticatedError({ message: "Not logged in" })
        expect(error.message).toBe("Not logged in")
      })
    })
  })

  describe("Config Errors", () => {
    describe("ConfigError", () => {
      it("should have correct _tag", () => {
        const error = new ConfigError({ message: "Invalid config" })
        expect(error._tag).toBe("ConfigError")
      })

      it("should store message and optional cause", () => {
        const cause = new Error("Parse error")
        const error = new ConfigError({ message: "Invalid config", cause })
        expect(error.message).toBe("Invalid config")
        expect(error.cause).toBe(cause)
      })
    })

    describe("ConfigNotFoundError", () => {
      it("should have correct _tag", () => {
        const error = new ConfigNotFoundError({ message: "Config not found" })
        expect(error._tag).toBe("ConfigNotFoundError")
      })

      it("should store message", () => {
        const error = new ConfigNotFoundError({ message: "Config not found" })
        expect(error.message).toBe("Config not found")
      })
    })

    describe("WorkspaceNotInitializedError", () => {
      it("should have correct _tag", () => {
        const error = new WorkspaceNotInitializedError({
          message: "Not initialized",
        })
        expect(error._tag).toBe("WorkspaceNotInitializedError")
      })

      it("should have a default instance", () => {
        expect(WorkspaceNotInitializedError.default._tag).toBe(
          "WorkspaceNotInitializedError",
        )
        expect(WorkspaceNotInitializedError.default.message).toBe(
          "Workspace not initialized. Run 'ship init' first.",
        )
      })
    })
  })

  describe("VCS Errors", () => {
    describe("VcsError", () => {
      it("should have correct _tag", () => {
        const error = new VcsError({ message: "VCS error" })
        expect(error._tag).toBe("VcsError")
      })

      it("should store message, cause, and exitCode", () => {
        const error = new VcsError({
          message: "Command failed",
          cause: new Error("Original"),
          exitCode: 1,
        })
        expect(error.message).toBe("Command failed")
        expect(error.exitCode).toBe(1)
      })
    })

    describe("JjNotInstalledError", () => {
      it("should have correct _tag", () => {
        const error = new JjNotInstalledError({ message: "jj not found" })
        expect(error._tag).toBe("JjNotInstalledError")
      })

      it("should have a default instance", () => {
        expect(JjNotInstalledError.default._tag).toBe("JjNotInstalledError")
        expect(JjNotInstalledError.default.message).toBe(
          "jj is not installed. Visit https://jj-vcs.github.io/jj/",
        )
      })
    })

    describe("NotARepoError", () => {
      it("should have correct _tag", () => {
        const error = new NotARepoError({ message: "Not a repo" })
        expect(error._tag).toBe("NotARepoError")
      })

      it("should have a default instance", () => {
        expect(NotARepoError.default._tag).toBe("NotARepoError")
        expect(NotARepoError.default.message).toBe(
          "Not a jj repository. Run 'jj git init' to initialize.",
        )
      })

      it("should store optional path", () => {
        const error = new NotARepoError({
          message: "Not a repo",
          path: "/some/path",
        })
        expect(error.path).toBe("/some/path")
      })
    })

    describe("JjConflictError", () => {
      it("should have correct _tag", () => {
        const error = new JjConflictError({ message: "Conflicts detected" })
        expect(error._tag).toBe("JjConflictError")
      })

      it("should store conflicted paths", () => {
        const error = new JjConflictError({
          message: "Conflicts detected",
          conflictedPaths: ["file1.ts", "file2.ts"],
        })
        expect(error.conflictedPaths).toEqual(["file1.ts", "file2.ts"])
      })
    })

    describe("JjPushError", () => {
      it("should have correct _tag", () => {
        const error = new JjPushError({ message: "Push failed" })
        expect(error._tag).toBe("JjPushError")
      })

      it("should store optional bookmark and cause", () => {
        const error = new JjPushError({
          message: "Push failed",
          bookmark: "main",
          cause: new Error("Auth failed"),
        })
        expect(error.bookmark).toBe("main")
      })
    })

    describe("JjFetchError", () => {
      it("should have correct _tag", () => {
        const error = new JjFetchError({ message: "Fetch failed" })
        expect(error._tag).toBe("JjFetchError")
      })
    })

    describe("JjBookmarkError", () => {
      it("should have correct _tag", () => {
        const error = new JjBookmarkError({ message: "Bookmark error" })
        expect(error._tag).toBe("JjBookmarkError")
      })

      it("should store optional bookmark", () => {
        const error = new JjBookmarkError({
          message: "Bookmark exists",
          bookmark: "feature-branch",
        })
        expect(error.bookmark).toBe("feature-branch")
      })
    })

    describe("JjRevisionError", () => {
      it("should have correct _tag", () => {
        const error = new JjRevisionError({ message: "Revision not found" })
        expect(error._tag).toBe("JjRevisionError")
      })

      it("should store optional revision", () => {
        const error = new JjRevisionError({
          message: "Revision not found",
          revision: "abc123",
        })
        expect(error.revision).toBe("abc123")
      })
    })

    describe("JjSquashError", () => {
      it("should have correct _tag", () => {
        const error = new JjSquashError({ message: "Squash failed" })
        expect(error._tag).toBe("JjSquashError")
      })
    })

    describe("JjImmutableError", () => {
      it("should have correct _tag", () => {
        const error = new JjImmutableError({ message: "Cannot modify" })
        expect(error._tag).toBe("JjImmutableError")
      })

      it("should store optional commitId", () => {
        const error = new JjImmutableError({
          message: "Cannot modify",
          commitId: "abc123",
        })
        expect(error.commitId).toBe("abc123")
      })
    })

    describe("JjStaleWorkingCopyError", () => {
      it("should have correct _tag", () => {
        const error = new JjStaleWorkingCopyError({ message: "Stale" })
        expect(error._tag).toBe("JjStaleWorkingCopyError")
      })

      it("should have a default instance", () => {
        expect(JjStaleWorkingCopyError.default._tag).toBe(
          "JjStaleWorkingCopyError",
        )
        expect(JjStaleWorkingCopyError.default.message).toBe(
          "The working copy is stale. Run 'ship stack update-stale' to recover.",
        )
      })
    })
  })

  describe("PR Errors", () => {
    describe("PrError", () => {
      it("should have correct _tag", () => {
        const error = new PrError({ message: "PR error" })
        expect(error._tag).toBe("PrError")
      })
    })

    describe("GhNotInstalledError", () => {
      it("should have correct _tag", () => {
        const error = new GhNotInstalledError({ message: "gh not found" })
        expect(error._tag).toBe("GhNotInstalledError")
      })

      it("should have a default instance", () => {
        expect(GhNotInstalledError.default._tag).toBe("GhNotInstalledError")
        expect(GhNotInstalledError.default.message).toBe(
          "gh CLI is not installed. Visit https://cli.github.com/",
        )
      })
    })

    describe("GhNotAuthenticatedError", () => {
      it("should have correct _tag", () => {
        const error = new GhNotAuthenticatedError({ message: "Not logged in" })
        expect(error._tag).toBe("GhNotAuthenticatedError")
      })

      it("should have a default instance", () => {
        expect(GhNotAuthenticatedError.default._tag).toBe(
          "GhNotAuthenticatedError",
        )
        expect(GhNotAuthenticatedError.default.message).toBe(
          "gh CLI is not authenticated. Run 'gh auth login' first.",
        )
      })
    })
  })

  describe("Webhook Errors", () => {
    describe("WebhookError", () => {
      it("should have correct _tag", () => {
        const error = new WebhookError({ message: "Webhook error" })
        expect(error._tag).toBe("WebhookError")
      })
    })

    describe("WebhookConnectionError", () => {
      it("should have correct _tag", () => {
        const error = new WebhookConnectionError({ message: "Connection failed" })
        expect(error._tag).toBe("WebhookConnectionError")
      })

      it("should store optional wsUrl and cause", () => {
        const error = new WebhookConnectionError({
          message: "Connection failed",
          wsUrl: "wss://example.com",
          cause: new Error("Timeout"),
        })
        expect(error.wsUrl).toBe("wss://example.com")
      })
    })

    describe("WebhookPermissionError", () => {
      it("should have correct _tag", () => {
        const error = new WebhookPermissionError({ message: "No permission" })
        expect(error._tag).toBe("WebhookPermissionError")
      })

      it("should create error for repo using static factory", () => {
        const error = WebhookPermissionError.forRepo("owner/repo")
        expect(error._tag).toBe("WebhookPermissionError")
        expect(error.repo).toBe("owner/repo")
        expect(error.message).toContain("owner/repo")
        expect(error.message).toContain("admin:repo_hook")
      })
    })

    describe("WebhookAlreadyExistsError", () => {
      it("should have correct _tag", () => {
        const error = new WebhookAlreadyExistsError({ message: "Already exists" })
        expect(error._tag).toBe("WebhookAlreadyExistsError")
      })

      it("should create error for repo using static factory", () => {
        const error = WebhookAlreadyExistsError.forRepo("owner/repo")
        expect(error._tag).toBe("WebhookAlreadyExistsError")
        expect(error.repo).toBe("owner/repo")
        expect(error.message).toContain("owner/repo")
      })
    })

    describe("WebhookRateLimitError", () => {
      it("should have correct _tag", () => {
        const error = new WebhookRateLimitError({ message: "Rate limited" })
        expect(error._tag).toBe("WebhookRateLimitError")
      })

      it("should create error from headers using static factory", () => {
        const error = WebhookRateLimitError.fromHeaders(60)
        expect(error._tag).toBe("WebhookRateLimitError")
        expect(error.retryAfter).toBe(60)
        expect(error.message).toContain("60 seconds")
      })

      it("should create error without retryAfter", () => {
        const error = WebhookRateLimitError.fromHeaders()
        expect(error._tag).toBe("WebhookRateLimitError")
        expect(error.retryAfter).toBeUndefined()
        expect(error.message).toContain("rate limit exceeded")
      })
    })
  })

  describe("Prompt Errors", () => {
    describe("PromptCancelledError", () => {
      it("should have correct _tag", () => {
        const error = new PromptCancelledError({ message: "Cancelled" })
        expect(error._tag).toBe("PromptCancelledError")
      })

      it("should have a default instance", () => {
        expect(PromptCancelledError.default._tag).toBe("PromptCancelledError")
        expect(PromptCancelledError.default.message).toBe(
          "Prompt cancelled by user",
        )
      })
    })
  })

  describe("Linear API Errors", () => {
    describe("LinearApiError", () => {
      it("should have correct _tag", () => {
        const error = new LinearApiError({ message: "API error" })
        expect(error._tag).toBe("LinearApiError")
      })

      it("should store optional statusCode", () => {
        const error = new LinearApiError({
          message: "Not found",
          statusCode: 404,
        })
        expect(error.statusCode).toBe(404)
      })
    })

    describe("RateLimitError", () => {
      it("should have correct _tag", () => {
        const error = new RateLimitError({ message: "Rate limited" })
        expect(error._tag).toBe("RateLimitError")
      })

      it("should store optional retryAfter", () => {
        const error = new RateLimitError({
          message: "Rate limited",
          retryAfter: 30,
        })
        expect(error.retryAfter).toBe(30)
      })
    })
  })

  describe("OpenCode Errors", () => {
    describe("OpenCodeError", () => {
      it("should have correct _tag", () => {
        const error = new OpenCodeError({ message: "OpenCode error" })
        expect(error._tag).toBe("OpenCodeError")
      })
    })

    describe("OpenCodeNotRunningError", () => {
      it("should have correct _tag", () => {
        const error = new OpenCodeNotRunningError({ message: "Not running" })
        expect(error._tag).toBe("OpenCodeNotRunningError")
      })

      it("should create error for URL using static factory", () => {
        const error = OpenCodeNotRunningError.forUrl("http://localhost:3000")
        expect(error._tag).toBe("OpenCodeNotRunningError")
        expect(error.serverUrl).toBe("http://localhost:3000")
        expect(error.message).toContain("http://localhost:3000")
      })
    })

    describe("OpenCodeSessionNotFoundError", () => {
      it("should have correct _tag", () => {
        const error = new OpenCodeSessionNotFoundError({
          message: "Session not found",
        })
        expect(error._tag).toBe("OpenCodeSessionNotFoundError")
      })

      it("should create error for session ID using static factory", () => {
        const error = OpenCodeSessionNotFoundError.forId("session-123")
        expect(error._tag).toBe("OpenCodeSessionNotFoundError")
        expect(error.sessionId).toBe("session-123")
        expect(error.message).toContain("session-123")
      })
    })
  })

  describe("Workspace Errors", () => {
    describe("WorkspaceError", () => {
      it("should have correct _tag", () => {
        const error = new WorkspaceError({ message: "Workspace error" })
        expect(error._tag).toBe("WorkspaceError")
      })

      it("should store optional name, path, and cause", () => {
        const error = new WorkspaceError({
          message: "Error",
          name: "my-workspace",
          path: "/path/to/workspace",
          cause: new Error("IO error"),
        })
        expect(error.name).toBe("my-workspace")
        expect(error.path).toBe("/path/to/workspace")
      })
    })

    describe("WorkspaceExistsError", () => {
      it("should have correct _tag", () => {
        const error = new WorkspaceExistsError({
          message: "Already exists",
          name: "ws",
        })
        expect(error._tag).toBe("WorkspaceExistsError")
      })

      it("should create error for name using static factory", () => {
        const error = WorkspaceExistsError.forName("my-workspace")
        expect(error._tag).toBe("WorkspaceExistsError")
        expect(error.name).toBe("my-workspace")
        expect(error.message).toContain("my-workspace")
      })

      it("should create error for name with path using static factory", () => {
        const error = WorkspaceExistsError.forName(
          "my-workspace",
          "/path/to/ws",
        )
        expect(error.name).toBe("my-workspace")
        expect(error.path).toBe("/path/to/ws")
        expect(error.message).toContain("/path/to/ws")
      })
    })

    describe("WorkspaceNotFoundError", () => {
      it("should have correct _tag", () => {
        const error = new WorkspaceNotFoundError({
          message: "Not found",
          name: "ws",
        })
        expect(error._tag).toBe("WorkspaceNotFoundError")
      })

      it("should create error for name using static factory", () => {
        const error = WorkspaceNotFoundError.forName("my-workspace")
        expect(error._tag).toBe("WorkspaceNotFoundError")
        expect(error.name).toBe("my-workspace")
        expect(error.message).toContain("my-workspace")
      })
    })
  })

  describe("Template Errors", () => {
    describe("TemplateNotFoundError", () => {
      it("should have correct _tag", () => {
        const error = new TemplateNotFoundError({
          message: "Not found",
          templateName: "my-template",
        })
        expect(error._tag).toBe("TemplateNotFoundError")
      })

      it("should create error for name using static factory", () => {
        const error = TemplateNotFoundError.forName("my-template")
        expect(error._tag).toBe("TemplateNotFoundError")
        expect(error.templateName).toBe("my-template")
        expect(error.message).toContain("my-template")
        expect(error.message).toContain("ship template list")
      })
    })

    describe("TemplateError", () => {
      it("should have correct _tag", () => {
        const error = new TemplateError({ message: "Template error" })
        expect(error._tag).toBe("TemplateError")
      })

      it("should store optional cause", () => {
        const cause = new Error("IO error")
        const error = new TemplateError({
          message: "Template error",
          cause,
        })
        expect(error.cause).toBe(cause)
      })
    })
  })
})
