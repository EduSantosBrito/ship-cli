/**
 * WebhookEventFormatter - Format GitHub webhook events for agent consumption
 *
 * Transforms raw GitHub webhook payloads into human-readable messages that
 * the agent can understand and act upon.
 */

import type { WebhookEvent } from "../../../ports/WebhookService.js";

/**
 * Format a webhook event into an agent-friendly message.
 */
export const formatWebhookEvent = (event: WebhookEvent): string => {
  const { event: eventType, action, payload, deliveryId } = event;

  // Type guard for payload
  const p = payload as Record<string, unknown> | null;
  if (!p) {
    return `[GitHub] Received ${eventType} event (delivery: ${deliveryId})`;
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

function formatPullRequestEvent(action: string | undefined, payload: Record<string, unknown>): string {
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;
  const sender = payload.sender as Record<string, unknown> | undefined;

  const prNumber = pr?.number ?? "?";
  const prTitle = pr?.title ?? "Unknown PR";
  const repoName = repo?.full_name ?? "unknown/repo";
  const senderLogin = sender?.login ?? "someone";
  const prUrl = pr?.html_url ?? "";
  const baseBranch = (pr?.base as Record<string, unknown>)?.ref ?? "main";
  const headBranch = (pr?.head as Record<string, unknown>)?.ref ?? "unknown";

  switch (action) {
    case "opened":
      return `[GitHub] PR #${prNumber} opened by @${senderLogin}

Repository: ${repoName}
Title: ${prTitle}
Branch: ${headBranch} → ${baseBranch}
URL: ${prUrl}

A new pull request has been created. You may want to review it.`;

    case "closed":
      const merged = pr?.merged === true;
      if (merged) {
        const mergedBy = (pr?.merged_by as Record<string, unknown>)?.login ?? senderLogin;
        return `[GitHub] PR #${prNumber} merged by @${mergedBy}

Repository: ${repoName}
Title: ${prTitle}
Branch: ${headBranch} → ${baseBranch}
URL: ${prUrl}

Suggested action: Run \`ship stack-sync\` to update your local stack.`;
      }
      return `[GitHub] PR #${prNumber} closed by @${senderLogin}

Repository: ${repoName}
Title: ${prTitle}
URL: ${prUrl}

The pull request was closed without merging.`;

    case "synchronize":
      return `[GitHub] PR #${prNumber} updated with new commits

Repository: ${repoName}
Title: ${prTitle}
URL: ${prUrl}

New commits have been pushed to this PR.`;

    case "reopened":
      return `[GitHub] PR #${prNumber} reopened by @${senderLogin}

Repository: ${repoName}
Title: ${prTitle}
URL: ${prUrl}`;

    case "review_requested":
      const reviewer = payload.requested_reviewer as Record<string, unknown> | undefined;
      const reviewerLogin = reviewer?.login ?? "someone";
      return `[GitHub] Review requested on PR #${prNumber}

Repository: ${repoName}
Title: ${prTitle}
Reviewer: @${reviewerLogin}
URL: ${prUrl}`;

    default:
      return `[GitHub] PR #${prNumber} - ${action ?? "unknown action"}

Repository: ${repoName}
Title: ${prTitle}
URL: ${prUrl}`;
  }
}

function formatPullRequestReviewEvent(action: string | undefined, payload: Record<string, unknown>): string {
  const review = payload.review as Record<string, unknown> | undefined;
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;
  const sender = payload.sender as Record<string, unknown> | undefined;

  const prNumber = pr?.number ?? "?";
  const prTitle = pr?.title ?? "Unknown PR";
  const repoName = repo?.full_name ?? "unknown/repo";
  const senderLogin = sender?.login ?? "someone";
  const reviewState = review?.state ?? "unknown";
  const reviewBody = review?.body ?? "";
  const prUrl = pr?.html_url ?? "";

  const stateEmoji = reviewState === "approved" ? "approved" : reviewState === "changes_requested" ? "requested changes on" : "reviewed";

  let message = `[GitHub] @${senderLogin} ${stateEmoji} PR #${prNumber}

Repository: ${repoName}
Title: ${prTitle}
URL: ${prUrl}`;

  if (reviewBody) {
    message += `\n\nReview comment:\n${truncate(String(reviewBody), 500)}`;
  }

  if (reviewState === "changes_requested") {
    message += `\n\nAction required: The reviewer has requested changes.`;
  } else if (reviewState === "approved") {
    message += `\n\nThe PR has been approved and may be ready to merge.`;
  }

  return message;
}

function formatPullRequestReviewCommentEvent(_action: string | undefined, payload: Record<string, unknown>): string {
  const comment = payload.comment as Record<string, unknown> | undefined;
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;

  const prNumber = pr?.number ?? "?";
  const prTitle = pr?.title ?? "Unknown PR";
  const repoName = repo?.full_name ?? "unknown/repo";
  const commenter = (comment?.user as Record<string, unknown>)?.login ?? "someone";
  const commentBody = comment?.body ?? "";
  const commentPath = comment?.path ?? "";
  const commentUrl = comment?.html_url ?? "";

  return `[GitHub] @${commenter} commented on PR #${prNumber}

Repository: ${repoName}
Title: ${prTitle}
File: ${commentPath}
URL: ${commentUrl}

Comment:
${truncate(String(commentBody), 500)}`;
}

function formatIssueCommentEvent(_action: string | undefined, payload: Record<string, unknown>): string {
  const comment = payload.comment as Record<string, unknown> | undefined;
  const issue = payload.issue as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;

  const issueNumber = issue?.number ?? "?";
  const issueTitle = issue?.title ?? "Unknown";
  const repoName = repo?.full_name ?? "unknown/repo";
  const commenter = (comment?.user as Record<string, unknown>)?.login ?? "someone";
  const commentBody = comment?.body ?? "";
  const commentUrl = comment?.html_url ?? "";
  const isPr = "pull_request" in (issue ?? {});

  const itemType = isPr ? "PR" : "Issue";

  return `[GitHub] @${commenter} commented on ${itemType} #${issueNumber}

Repository: ${repoName}
Title: ${issueTitle}
URL: ${commentUrl}

Comment:
${truncate(String(commentBody), 500)}`;
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
    const statusIcon = passed ? "passed" : "failed";
    
    let message = `[GitHub] Check "${name}" ${statusIcon}

Repository: ${repoName}
Conclusion: ${conclusion}
URL: ${htmlUrl}`;

    if (!passed) {
      message += `\n\nA CI check has failed. You may need to investigate.`;
    }

    return message;
  }

  return `[GitHub] Check "${name}" ${action ?? status}

Repository: ${repoName}
Status: ${status}
URL: ${htmlUrl}`;
}

function formatCheckSuiteEvent(action: string | undefined, payload: Record<string, unknown>): string {
  const checkSuite = payload.check_suite as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;

  const conclusion = checkSuite?.conclusion ?? "";
  const status = checkSuite?.status ?? "unknown";
  const repoName = repo?.full_name ?? "unknown/repo";
  const headBranch = checkSuite?.head_branch ?? "unknown";

  if (action === "completed") {
    const passed = conclusion === "success";
    const statusIcon = passed ? "All checks passed" : "Some checks failed";
    
    return `[GitHub] ${statusIcon} on ${headBranch}

Repository: ${repoName}
Branch: ${headBranch}
Conclusion: ${conclusion}`;
  }

  return `[GitHub] Check suite ${action ?? status} on ${headBranch}

Repository: ${repoName}
Branch: ${headBranch}
Status: ${status}`;
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

  let message = `[GitHub] @${pusherName} pushed ${commitCount} commit(s) to ${branch}

Repository: ${repoName}
Branch: ${branch}`;

  if (commits && commits.length > 0) {
    message += `\n\nCommits:`;
    for (const commit of commits.slice(0, 5)) {
      const sha = String(commit.id ?? "").substring(0, 7);
      const msg = truncate(String(commit.message ?? ""), 60);
      message += `\n- ${sha}: ${msg}`;
    }
    if (commits.length > 5) {
      message += `\n... and ${commits.length - 5} more`;
    }
  }

  return message;
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
URL: ${issueUrl}`;
}

function formatGenericEvent(eventType: string, action: string | undefined, payload: Record<string, unknown>): string {
  const repo = payload.repository as Record<string, unknown> | undefined;
  const sender = payload.sender as Record<string, unknown> | undefined;

  const repoName = repo?.full_name ?? "unknown/repo";
  const senderLogin = sender?.login ?? "unknown";

  return `[GitHub] ${eventType}${action ? ` (${action})` : ""} by @${senderLogin}

Repository: ${repoName}

This is a ${eventType} event that may require your attention.`;
}

// === Helpers ===

function truncate(text: string, maxLength: number): string {
  // Remove newlines for single-line truncation
  const singleLine = text.replace(/\n/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return singleLine.substring(0, maxLength - 3) + "...";
}
