/**
 * WebhookEventFormatter - Format GitHub webhook events for agent consumption
 *
 * Formats events in a concise, action-oriented way:
 * - Collapsed content (no full review bodies, comment text, etc.)
 * - Clear action prompts telling the agent what to do
 * - Minimal metadata (just enough to identify the event)
 */

import type { WebhookEvent } from "../../../ports/WebhookService.js";

/**
 * Format a webhook event into an agent-friendly message.
 * Messages are concise with clear action prompts.
 */
export const formatWebhookEvent = (event: WebhookEvent): string => {
  const { event: eventType, action, payload, deliveryId } = event;

  // Type guard for payload
  const p = payload as Record<string, unknown> | null;
  if (!p) {
    return `[GitHub] Received ${eventType} event (delivery: ${deliveryId})

→ Action: Check this event`;
  }

  switch (eventType) {
    case "pull_request":
      return formatPullRequestEvent(action, p);
    case "pull_request_review":
      return formatPullRequestReviewEvent(action, p);
    case "pull_request_review_comment":
      return formatPullRequestReviewCommentEvent(action, p);
    case "issue_comment":
      return formatIssueCommentEvent(action, p);
    case "check_run":
      return formatCheckRunEvent(action, p);
    case "check_suite":
      return formatCheckSuiteEvent(action, p);
    case "push":
      return formatPushEvent(action, p);
    case "issues":
      return formatIssuesEvent(action, p);
    default:
      return formatGenericEvent(eventType, action, p);
  }
};

// === Event Formatters ===

function formatPullRequestEvent(
  action: string | undefined,
  payload: Record<string, unknown>,
): string {
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;
  const sender = payload.sender as Record<string, unknown> | undefined;

  const prNumber = pr?.number ?? "?";
  const prTitle = pr?.title ?? "Unknown PR";
  const repoName = repo?.full_name ?? "unknown/repo";
  const senderLogin = sender?.login ?? "someone";
  const prUrl = pr?.html_url ?? "";

  switch (action) {
    case "opened":
      return `[GitHub] PR #${prNumber} opened by @${senderLogin}

Repository: ${repoName}
Title: ${prTitle}
URL: ${prUrl}

→ Action: Review this new pull request`;

    case "closed":
      const merged = pr?.merged === true;
      if (merged) {
        const mergedBy = (pr?.merged_by as Record<string, unknown>)?.login ?? senderLogin;
        return `[GitHub] PR #${prNumber} merged by @${mergedBy}

Repository: ${repoName}
Title: ${prTitle}
URL: ${prUrl}

→ Action: Run stack-sync --auto-submit to rebase and push dependent PRs`;
      }
      return `[GitHub] PR #${prNumber} closed (not merged) by @${senderLogin}

Repository: ${repoName}
Title: ${prTitle}
URL: ${prUrl}

→ Action: Check if this closure was intentional`;

    case "synchronize":
      return `[GitHub] PR #${prNumber} updated with new commits

Repository: ${repoName}
Title: ${prTitle}
URL: ${prUrl}

→ Action: Review the new commits if needed`;

    case "reopened":
      return `[GitHub] PR #${prNumber} reopened by @${senderLogin}

Repository: ${repoName}
Title: ${prTitle}
URL: ${prUrl}

→ Action: Check the reopened PR`;

    case "review_requested":
      const reviewer = payload.requested_reviewer as Record<string, unknown> | undefined;
      const reviewerLogin = reviewer?.login ?? "someone";
      return `[GitHub] Review requested from @${reviewerLogin} on PR #${prNumber}

Repository: ${repoName}
Title: ${prTitle}
URL: ${prUrl}

→ Action: Review request noted`;

    default:
      return `[GitHub] PR #${prNumber} - ${action ?? "updated"}

Repository: ${repoName}
Title: ${prTitle}
URL: ${prUrl}

→ Action: Check this PR event`;
  }
}

function formatPullRequestReviewEvent(
  _action: string | undefined,
  payload: Record<string, unknown>,
): string {
  const review = payload.review as Record<string, unknown> | undefined;
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;
  const sender = payload.sender as Record<string, unknown> | undefined;

  const prNumber = pr?.number ?? "?";
  const prTitle = pr?.title ?? "Unknown PR";
  const repoName = repo?.full_name ?? "unknown/repo";
  const senderLogin = sender?.login ?? "someone";
  const reviewState = (review?.state as string) ?? "unknown";
  const prUrl = pr?.html_url ?? "";

  // Determine review type and action
  let reviewType: string;
  let actionPrompt: string;

  switch (reviewState.toLowerCase()) {
    case "approved":
      reviewType = "approved";
      actionPrompt = "Consider merging the PR";
      break;
    case "changes_requested":
      reviewType = "requested changes on";
      actionPrompt = "Address the requested changes";
      break;
    case "commented":
      reviewType = "commented on";
      actionPrompt = "Review the comments and respond if needed";
      break;
    default:
      reviewType = "reviewed";
      actionPrompt = "Check the review feedback";
  }

  return `[GitHub] @${senderLogin} ${reviewType} PR #${prNumber}

Repository: ${repoName}
Title: ${prTitle}
URL: ${prUrl}

→ Action: ${actionPrompt}`;
}

function formatPullRequestReviewCommentEvent(
  _action: string | undefined,
  payload: Record<string, unknown>,
): string {
  const comment = payload.comment as Record<string, unknown> | undefined;
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;

  const prNumber = pr?.number ?? "?";
  const prTitle = pr?.title ?? "Unknown PR";
  const repoName = repo?.full_name ?? "unknown/repo";
  const commenter = (comment?.user as Record<string, unknown>)?.login ?? "someone";
  const commentPath = comment?.path ?? "";
  const commentUrl = comment?.html_url ?? "";

  return `[GitHub] @${commenter} commented on PR #${prNumber}

Repository: ${repoName}
Title: ${prTitle}
File: ${commentPath}
URL: ${commentUrl}

→ Action: Review the comment and respond if needed`;
}

function formatIssueCommentEvent(
  _action: string | undefined,
  payload: Record<string, unknown>,
): string {
  const comment = payload.comment as Record<string, unknown> | undefined;
  const issue = payload.issue as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;

  const issueNumber = issue?.number ?? "?";
  const issueTitle = issue?.title ?? "Unknown";
  const repoName = repo?.full_name ?? "unknown/repo";
  const commenter = (comment?.user as Record<string, unknown>)?.login ?? "someone";
  const commentUrl = comment?.html_url ?? "";
  const isPr = "pull_request" in (issue ?? {});

  const itemType = isPr ? "PR" : "Issue";

  return `[GitHub] @${commenter} commented on ${itemType} #${issueNumber}

Repository: ${repoName}
Title: ${issueTitle}
URL: ${commentUrl}

→ Action: Review the comment and respond if needed`;
}

function formatCheckRunEvent(action: string | undefined, payload: Record<string, unknown>): string {
  const checkRun = payload.check_run as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;

  const name = checkRun?.name ?? "Unknown check";
  const conclusion = checkRun?.conclusion ?? "";
  const status = checkRun?.status ?? "unknown";
  const repoName = repo?.full_name ?? "unknown/repo";
  const htmlUrl = checkRun?.html_url ?? "";

  if (action === "completed") {
    const passed = conclusion === "success";

    if (passed) {
      return `[GitHub] Check "${name}" passed

Repository: ${repoName}
URL: ${htmlUrl}

→ Action: CI check passed, no action needed`;
    }

    return `[GitHub] Check "${name}" failed

Repository: ${repoName}
Conclusion: ${conclusion}
URL: ${htmlUrl}

→ Action: Investigate and fix the failing check`;
  }

  return `[GitHub] Check "${name}" ${action ?? status}

Repository: ${repoName}
Status: ${status}
URL: ${htmlUrl}

→ Action: Monitor check progress`;
}

function formatCheckSuiteEvent(
  action: string | undefined,
  payload: Record<string, unknown>,
): string {
  const checkSuite = payload.check_suite as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;

  const conclusion = checkSuite?.conclusion ?? "";
  const status = checkSuite?.status ?? "unknown";
  const repoName = repo?.full_name ?? "unknown/repo";
  const headBranch = checkSuite?.head_branch ?? "unknown";

  if (action === "completed") {
    const passed = conclusion === "success";

    if (passed) {
      return `[GitHub] All checks passed on ${headBranch}

Repository: ${repoName}
Branch: ${headBranch}

→ Action: CI passed, PR may be ready to merge`;
    }

    return `[GitHub] Some checks failed on ${headBranch}

Repository: ${repoName}
Branch: ${headBranch}
Conclusion: ${conclusion}

→ Action: Investigate and fix the failing checks`;
  }

  return `[GitHub] Check suite ${action ?? status} on ${headBranch}

Repository: ${repoName}
Branch: ${headBranch}

→ Action: Monitor check progress`;
}

function formatPushEvent(_action: string | undefined, payload: Record<string, unknown>): string {
  const repo = payload.repository as Record<string, unknown> | undefined;
  const pusher = payload.pusher as Record<string, unknown> | undefined;
  const commits = payload.commits as Array<Record<string, unknown>> | undefined;
  const ref = payload.ref as string | undefined;

  const repoName = repo?.full_name ?? "unknown/repo";
  const pusherName = pusher?.name ?? "someone";
  const branch = ref?.replace("refs/heads/", "") ?? "unknown";
  const commitCount = commits?.length ?? 0;

  return `[GitHub] @${pusherName} pushed ${commitCount} commit(s) to ${branch}

Repository: ${repoName}
Branch: ${branch}

→ Action: Check if this affects your work`;
}

function formatIssuesEvent(action: string | undefined, payload: Record<string, unknown>): string {
  const issue = payload.issue as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;
  const sender = payload.sender as Record<string, unknown> | undefined;

  const issueNumber = issue?.number ?? "?";
  const issueTitle = issue?.title ?? "Unknown";
  const repoName = repo?.full_name ?? "unknown/repo";
  const senderLogin = sender?.login ?? "someone";
  const issueUrl = issue?.html_url ?? "";

  return `[GitHub] Issue #${issueNumber} ${action ?? "updated"} by @${senderLogin}

Repository: ${repoName}
Title: ${issueTitle}
URL: ${issueUrl}

→ Action: Check this issue event`;
}

function formatGenericEvent(
  eventType: string,
  action: string | undefined,
  payload: Record<string, unknown>,
): string {
  const repo = payload.repository as Record<string, unknown> | undefined;
  const sender = payload.sender as Record<string, unknown> | undefined;

  const repoName = repo?.full_name ?? "unknown/repo";
  const senderLogin = sender?.login ?? "unknown";

  return `[GitHub] ${eventType}${action ? ` (${action})` : ""} by @${senderLogin}

Repository: ${repoName}

→ Action: Check this event`;
}
