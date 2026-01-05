import { describe, it, expect } from "@effect/vitest";
import { formatWebhookEvent } from "../../../../src/adapters/driven/opencode/WebhookEventFormatter.js";
import { WebhookEvent } from "../../../../src/ports/WebhookService.js";

// === Test Fixtures ===

const makeWebhookEvent = (
  overrides: Partial<{
    event: string;
    action: string;
    payload: Record<string, unknown>;
    deliveryId: string;
  }>,
): WebhookEvent =>
  new WebhookEvent({
    event: overrides.event ?? "pull_request",
    action: overrides.action,
    deliveryId: overrides.deliveryId ?? "delivery-123",
    payload: overrides.payload ?? {},
    headers: {},
  });

const makePrPayload = (
  overrides: Partial<{
    number: number;
    title: string;
    merged: boolean;
    mergedBy: string;
    htmlUrl: string;
  }> = {},
): Record<string, unknown> => ({
  pull_request: {
    number: overrides.number ?? 42,
    title: overrides.title ?? "Add feature",
    merged: overrides.merged ?? false,
    merged_by: overrides.mergedBy ? { login: overrides.mergedBy } : undefined,
    html_url: overrides.htmlUrl ?? "https://github.com/owner/repo/pull/42",
  },
  repository: { full_name: "owner/repo" },
  sender: { login: "author" },
});

const makeReviewPayload = (
  overrides: Partial<{
    prNumber: number;
    prTitle: string;
    reviewState: string;
    reviewer: string;
  }> = {},
): Record<string, unknown> => ({
  review: {
    state: overrides.reviewState ?? "approved",
  },
  pull_request: {
    number: overrides.prNumber ?? 42,
    title: overrides.prTitle ?? "Add feature",
    html_url: "https://github.com/owner/repo/pull/42",
  },
  repository: { full_name: "owner/repo" },
  sender: { login: overrides.reviewer ?? "reviewer" },
});

const makeCheckRunPayload = (
  overrides: Partial<{
    name: string;
    conclusion: string;
    status: string;
    htmlUrl: string;
  }> = {},
): Record<string, unknown> => ({
  check_run: {
    name: overrides.name ?? "CI",
    conclusion: overrides.conclusion ?? "success",
    status: overrides.status ?? "completed",
    html_url: overrides.htmlUrl ?? "https://github.com/owner/repo/runs/123",
  },
  repository: { full_name: "owner/repo" },
});

const makeCheckSuitePayload = (
  overrides: Partial<{
    conclusion: string;
    status: string;
    headBranch: string;
  }> = {},
): Record<string, unknown> => ({
  check_suite: {
    conclusion: overrides.conclusion ?? "success",
    status: overrides.status ?? "completed",
    head_branch: overrides.headBranch ?? "feature-branch",
  },
  repository: { full_name: "owner/repo" },
});

const makeIssueCommentPayload = (
  overrides: Partial<{
    issueNumber: number;
    issueTitle: string;
    commenter: string;
    isPullRequest: boolean;
  }> = {},
): Record<string, unknown> => ({
  comment: {
    user: { login: overrides.commenter ?? "commenter" },
    html_url: "https://github.com/owner/repo/issues/42#comment-1",
  },
  issue: {
    number: overrides.issueNumber ?? 42,
    title: overrides.issueTitle ?? "Issue title",
    ...(overrides.isPullRequest ? { pull_request: {} } : {}),
  },
  repository: { full_name: "owner/repo" },
});

const makeReviewCommentPayload = (
  overrides: Partial<{
    prNumber: number;
    prTitle: string;
    commenter: string;
    path: string;
  }> = {},
): Record<string, unknown> => ({
  comment: {
    user: { login: overrides.commenter ?? "commenter" },
    path: overrides.path ?? "src/index.ts",
    html_url: "https://github.com/owner/repo/pull/42#discussion_r1",
  },
  pull_request: {
    number: overrides.prNumber ?? 42,
    title: overrides.prTitle ?? "Add feature",
  },
  repository: { full_name: "owner/repo" },
});

const makePushPayload = (
  overrides: Partial<{
    pusher: string;
    branch: string;
    commitCount: number;
  }> = {},
): Record<string, unknown> => ({
  pusher: { name: overrides.pusher ?? "developer" },
  ref: `refs/heads/${overrides.branch ?? "main"}`,
  commits: Array(overrides.commitCount ?? 3).fill({ message: "commit" }),
  repository: { full_name: "owner/repo" },
});

const makeIssuePayload = (
  overrides: Partial<{
    issueNumber: number;
    issueTitle: string;
    sender: string;
  }> = {},
): Record<string, unknown> => ({
  issue: {
    number: overrides.issueNumber ?? 10,
    title: overrides.issueTitle ?? "Bug report",
    html_url: "https://github.com/owner/repo/issues/10",
  },
  repository: { full_name: "owner/repo" },
  sender: { login: overrides.sender ?? "reporter" },
});

describe("WebhookEventFormatter", () => {
  describe("pull_request events", () => {
    it("formats PR opened event with author", () => {
      const event = makeWebhookEvent({
        event: "pull_request",
        action: "opened",
        payload: makePrPayload({ number: 42, title: "Add feature" }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("[GitHub] PR #42 opened by @author");
      expect(message).toContain("Title: Add feature");
      expect(message).toContain("Repository: owner/repo");
      expect(message).toContain("URL: https://github.com/owner/repo/pull/42");
      expect(message).toContain("Action: Review this new pull request");
    });

    it("formats PR merged event with merge author", () => {
      const event = makeWebhookEvent({
        event: "pull_request",
        action: "closed",
        payload: makePrPayload({ number: 42, merged: true, mergedBy: "merger" }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("[GitHub] PR #42 merged by @merger");
      expect(message).toContain("Action: Run stack-restack");
    });

    it("formats PR closed (not merged) event", () => {
      const event = makeWebhookEvent({
        event: "pull_request",
        action: "closed",
        payload: makePrPayload({ number: 42, merged: false }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("[GitHub] PR #42 closed (not merged)");
      expect(message).toContain("Action: Check if this closure was intentional");
    });

    it("formats PR synchronize event (new commits)", () => {
      const event = makeWebhookEvent({
        event: "pull_request",
        action: "synchronize",
        payload: makePrPayload({ number: 42 }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("[GitHub] PR #42 updated with new commits");
      expect(message).toContain("Action: Review the new commits");
    });

    it("formats PR reopened event", () => {
      const event = makeWebhookEvent({
        event: "pull_request",
        action: "reopened",
        payload: makePrPayload({ number: 42 }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("[GitHub] PR #42 reopened by @author");
      expect(message).toContain("Action: Check the reopened PR");
    });

    it("formats PR review requested event with reviewer name", () => {
      const event = makeWebhookEvent({
        event: "pull_request",
        action: "review_requested",
        payload: {
          ...makePrPayload({ number: 42 }),
          requested_reviewer: { login: "reviewer" },
        },
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("Review requested from @reviewer on PR #42");
      expect(message).toContain("Action: Review request noted");
    });

    it("formats unknown PR action with fallback", () => {
      const event = makeWebhookEvent({
        event: "pull_request",
        action: "labeled",
        payload: makePrPayload({ number: 42 }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("[GitHub] PR #42 - labeled");
      expect(message).toContain("Action: Check this PR event");
    });
  });

  describe("pull_request_review events", () => {
    it("formats approved review", () => {
      const event = makeWebhookEvent({
        event: "pull_request_review",
        action: "submitted",
        payload: makeReviewPayload({ reviewState: "approved", reviewer: "reviewer" }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("@reviewer approved PR #42");
      expect(message).toContain("Action: Consider merging the PR");
    });

    it("formats changes requested review", () => {
      const event = makeWebhookEvent({
        event: "pull_request_review",
        action: "submitted",
        payload: makeReviewPayload({ reviewState: "changes_requested", reviewer: "reviewer" }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("@reviewer requested changes on PR #42");
      expect(message).toContain("Action: Address the requested changes");
    });

    it("formats comment-only review", () => {
      const event = makeWebhookEvent({
        event: "pull_request_review",
        action: "submitted",
        payload: makeReviewPayload({ reviewState: "commented", reviewer: "reviewer" }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("@reviewer commented on PR #42");
      expect(message).toContain("Action: Review the comments and respond if needed");
    });

    it("formats unknown review state with fallback", () => {
      const event = makeWebhookEvent({
        event: "pull_request_review",
        action: "submitted",
        payload: makeReviewPayload({ reviewState: "dismissed", reviewer: "reviewer" }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("@reviewer reviewed PR #42");
      expect(message).toContain("Action: Check the review feedback");
    });
  });

  describe("check_run events", () => {
    it("formats CI passed event", () => {
      const event = makeWebhookEvent({
        event: "check_run",
        action: "completed",
        payload: makeCheckRunPayload({ name: "Build", conclusion: "success" }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain('[GitHub] Check "Build" passed');
      expect(message).toContain("Action: CI check passed, no action needed");
    });

    it("formats CI failed event with check name and conclusion", () => {
      const event = makeWebhookEvent({
        event: "check_run",
        action: "completed",
        payload: makeCheckRunPayload({ name: "Tests", conclusion: "failure" }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain('[GitHub] Check "Tests" failed');
      expect(message).toContain("Conclusion: failure");
      expect(message).toContain("Action: Investigate and fix the failing check");
    });

    it("formats CI pending/in-progress event", () => {
      const event = makeWebhookEvent({
        event: "check_run",
        action: "created",
        payload: makeCheckRunPayload({ name: "Lint", status: "in_progress" }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain('[GitHub] Check "Lint" created');
      expect(message).toContain("Status: in_progress");
      expect(message).toContain("Action: Monitor check progress");
    });
  });

  describe("check_suite events", () => {
    it("formats all checks passed on branch", () => {
      const event = makeWebhookEvent({
        event: "check_suite",
        action: "completed",
        payload: makeCheckSuitePayload({ conclusion: "success", headBranch: "feature-x" }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("[GitHub] All checks passed on feature-x");
      expect(message).toContain("Action: CI passed, PR may be ready to merge");
    });

    it("formats some checks failed on branch", () => {
      const event = makeWebhookEvent({
        event: "check_suite",
        action: "completed",
        payload: makeCheckSuitePayload({ conclusion: "failure", headBranch: "feature-x" }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("[GitHub] Some checks failed on feature-x");
      expect(message).toContain("Conclusion: failure");
      expect(message).toContain("Action: Investigate and fix the failing checks");
    });

    it("formats check suite in progress", () => {
      const event = makeWebhookEvent({
        event: "check_suite",
        action: "requested",
        payload: makeCheckSuitePayload({ status: "queued", headBranch: "feature-x" }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("[GitHub] Check suite requested on feature-x");
      expect(message).toContain("Action: Monitor check progress");
    });
  });

  describe("issue_comment events", () => {
    it("formats comment on PR", () => {
      const event = makeWebhookEvent({
        event: "issue_comment",
        action: "created",
        payload: makeIssueCommentPayload({ isPullRequest: true, commenter: "reviewer" }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("@reviewer commented on PR #42");
      expect(message).toContain("Action: Review the comment and respond if needed");
    });

    it("formats comment on issue (not PR)", () => {
      const event = makeWebhookEvent({
        event: "issue_comment",
        action: "created",
        payload: makeIssueCommentPayload({ isPullRequest: false, commenter: "user" }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("@user commented on Issue #42");
    });
  });

  describe("pull_request_review_comment events", () => {
    it("formats review comment with file path", () => {
      const event = makeWebhookEvent({
        event: "pull_request_review_comment",
        action: "created",
        payload: makeReviewCommentPayload({
          prNumber: 42,
          commenter: "reviewer",
          path: "src/utils/helper.ts",
        }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("@reviewer commented on PR #42");
      expect(message).toContain("File: src/utils/helper.ts");
      expect(message).toContain("Action: Review the comment and respond if needed");
    });
  });

  describe("push events", () => {
    it("formats push event with commit count and branch", () => {
      const event = makeWebhookEvent({
        event: "push",
        payload: makePushPayload({ pusher: "developer", branch: "main", commitCount: 5 }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("@developer pushed 5 commit(s) to main");
      expect(message).toContain("Repository: owner/repo");
      expect(message).toContain("Action: Check if this affects your work");
    });
  });

  describe("issues events", () => {
    it("formats issue opened event", () => {
      const event = makeWebhookEvent({
        event: "issues",
        action: "opened",
        payload: makeIssuePayload({ issueNumber: 10, issueTitle: "Bug report", sender: "reporter" }),
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("Issue #10 opened by @reporter");
      expect(message).toContain("Title: Bug report");
      expect(message).toContain("Action: Check this issue event");
    });
  });

  describe("edge cases", () => {
    it("handles unknown event types with graceful fallback", () => {
      const event = makeWebhookEvent({
        event: "deployment",
        action: "created",
        payload: {
          repository: { full_name: "owner/repo" },
          sender: { login: "deployer" },
        },
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("[GitHub] deployment (created) by @deployer");
      expect(message).toContain("Repository: owner/repo");
      expect(message).toContain("Action: Check this event");
    });

    it("handles null payload without crashing", () => {
      const event = new WebhookEvent({
        event: "ping",
        action: undefined,
        deliveryId: "delivery-123",
        payload: null,
        headers: {},
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("[GitHub] Received ping event");
      expect(message).toContain("delivery: delivery-123");
      expect(message).toContain("Action: Check this event");
    });

    it("handles missing PR fields gracefully", () => {
      const event = makeWebhookEvent({
        event: "pull_request",
        action: "opened",
        payload: {
          pull_request: {}, // Missing number, title, etc.
          repository: {}, // Missing full_name
          sender: {}, // Missing login
        },
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("[GitHub] PR #?");
      expect(message).toContain("by @someone");
      expect(message).toContain("Title: Unknown PR");
      expect(message).toContain("Repository: unknown/repo");
    });

    it("handles missing check_run fields gracefully", () => {
      const event = makeWebhookEvent({
        event: "check_run",
        action: "completed",
        payload: {
          check_run: {}, // Missing name, conclusion
          repository: {},
        },
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain('[GitHub] Check "Unknown check"');
    });

    it("handles missing review fields gracefully", () => {
      const event = makeWebhookEvent({
        event: "pull_request_review",
        action: "submitted",
        payload: {
          review: {}, // Missing state
          pull_request: {},
          repository: {},
          sender: {},
        },
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("@someone reviewed PR #?");
    });

    it("handles missing comment fields gracefully", () => {
      const event = makeWebhookEvent({
        event: "pull_request_review_comment",
        action: "created",
        payload: {
          comment: {}, // Missing user, path
          pull_request: {},
          repository: {},
        },
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("@someone commented on PR #?");
      expect(message).toContain("File:");
    });

    it("handles missing push fields gracefully", () => {
      const event = makeWebhookEvent({
        event: "push",
        payload: {
          pusher: {},
          repository: {},
        },
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("@someone pushed 0 commit(s)");
      expect(message).toContain("to unknown");
    });

    it("handles empty payload object", () => {
      const event = makeWebhookEvent({
        event: "unknown_event",
        action: "triggered",
        payload: {},
      });

      const message = formatWebhookEvent(event);

      expect(message).toContain("[GitHub] unknown_event (triggered) by @unknown");
      expect(message).toContain("Repository: unknown/repo");
    });
  });
});
