/**
 * ship pr review - Fetch PR reviews and comments
 *
 * Displays PR reviews, inline code comments, and conversation comments
 * in a format optimized for AI consumption.
 *
 * Key features:
 * - Shows review verdicts (APPROVED, CHANGES_REQUESTED, etc.) with author
 * - Shows inline code comments with file:line context
 * - Groups comments by file for easier navigation
 * - Supports --unresolved flag to filter to unresolved threads only
 * - Supports --json flag for machine-readable output
 */

import * as Command from "@effect/cli/Command";
import * as Args from "@effect/cli/Args";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { VcsService } from "../../../../../ports/VcsService.js";
import {
  PrService,
  type PrReview,
  type PrReviewComment,
  type PrComment,
} from "../../../../../ports/PrService.js";

// === Options ===

const prNumberArg = Args.integer({ name: "pr-number" }).pipe(
  Args.withDescription("PR number (defaults to current bookmark's PR)"),
  Args.optional,
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

const unresolvedOption = Options.boolean("unresolved").pipe(
  Options.withDescription("Show only unresolved/actionable comments"),
  Options.withDefault(false),
);

// === Output Types ===

interface ReviewOutput {
  prNumber: number;
  prTitle?: string;
  prUrl?: string;
  reviews: Array<{
    id: number;
    author: string;
    state: string;
    body: string;
    submittedAt: string;
  }>;
  codeComments: Array<{
    id: number;
    path: string;
    line: number | null;
    body: string;
    author: string;
    createdAt: string;
    inReplyToId: number | null;
    diffHunk?: string;
  }>;
  conversationComments: Array<{
    id: number;
    body: string;
    author: string;
    createdAt: string;
  }>;
  /** Comments grouped by file for easier navigation */
  commentsByFile: Record<
    string,
    Array<{
      line: number | null;
      author: string;
      body: string;
      id: number;
      diffHunk?: string;
    }>
  >;
  error?: string;
}

// === Helpers ===

const outputError = (message: string, json: boolean) =>
  json
    ? Console.log(JSON.stringify({ error: message }))
    : Console.error(`Error: ${message}`);

/**
 * Group comments by file path for easier navigation
 */
const groupCommentsByFile = (
  comments: ReadonlyArray<PrReviewComment>,
): Record<
  string,
  Array<{ line: number | null; author: string; body: string; id: number; diffHunk?: string }>
> => {
  const grouped: Record<
    string,
    Array<{ line: number | null; author: string; body: string; id: number; diffHunk?: string }>
  > = {};

  for (const comment of comments) {
    if (!grouped[comment.path]) {
      grouped[comment.path] = [];
    }
    const entry: {
      line: number | null;
      author: string;
      body: string;
      id: number;
      diffHunk?: string;
    } = {
      line: comment.line,
      author: comment.author,
      body: comment.body,
      id: comment.id,
    };
    if (comment.diffHunk !== undefined) {
      entry.diffHunk = comment.diffHunk;
    }
    grouped[comment.path].push(entry);
  }

  // Sort comments within each file by line number
  for (const path of Object.keys(grouped)) {
    grouped[path].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  }

  return grouped;
};

/**
 * Filter to only "actionable" comments:
 * - Reviews that are CHANGES_REQUESTED
 * - Comments that are not replies (top-level comments only)
 */
const filterUnresolved = (
  reviews: ReadonlyArray<PrReview>,
  codeComments: ReadonlyArray<PrReviewComment>,
  conversationComments: ReadonlyArray<PrComment>,
): {
  reviews: ReadonlyArray<PrReview>;
  codeComments: ReadonlyArray<PrReviewComment>;
  conversationComments: ReadonlyArray<PrComment>;
} => {
  // Only show reviews that request changes
  const filteredReviews = reviews.filter((r) => r.state === "CHANGES_REQUESTED");

  // Only show top-level code comments (not replies)
  const filteredCodeComments = codeComments.filter((c) => c.inReplyToId === null);

  // Keep all conversation comments (they're usually important)
  return {
    reviews: filteredReviews,
    codeComments: filteredCodeComments,
    conversationComments,
  };
};

/**
 * Format human-readable output for reviews and comments
 */
const formatHumanOutput = (output: ReviewOutput): string => {
  const lines: string[] = [];

  lines.push(`## PR #${output.prNumber}${output.prTitle ? `: ${output.prTitle}` : ""}`);
  if (output.prUrl) {
    lines.push(`URL: ${output.prUrl}`);
  }
  lines.push("");

  // Reviews section (sorted by date, newest first)
  if (output.reviews.length > 0) {
    lines.push("### Reviews");
    const sortedReviews = [...output.reviews].sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
    );
    for (const review of sortedReviews) {
      const stateEmoji =
        review.state === "APPROVED"
          ? "[APPROVED]"
          : review.state === "CHANGES_REQUESTED"
            ? "[CHANGES_REQUESTED]"
            : `[${review.state}]`;
      lines.push(`- @${review.author}: ${stateEmoji}`);
      if (review.body) {
        // Indent the review body
        const bodyLines = review.body.split("\n").map((l) => `  ${l}`);
        lines.push(...bodyLines);
      }
    }
    lines.push("");
  }

  // Code comments section (grouped by file)
  const fileKeys = Object.keys(output.commentsByFile);
  if (fileKeys.length > 0) {
    lines.push(`### Code Comments (${output.codeComments.length} total)`);
    lines.push("");

    for (const filePath of fileKeys.sort()) {
      const fileComments = output.commentsByFile[filePath];
      lines.push(`#### ${filePath}`);

      for (const comment of fileComments) {
        const lineInfo = comment.line !== null ? `:${comment.line}` : "";
        lines.push(`**${filePath}${lineInfo}** - @${comment.author}:`);
        // Show code context if available
        if (comment.diffHunk) {
          lines.push("```diff");
          lines.push(comment.diffHunk);
          lines.push("```");
        }
        // Indent comment body
        const bodyLines = comment.body.split("\n").map((l) => `> ${l}`);
        lines.push(...bodyLines);
        lines.push("");
      }
    }
  }

  // Conversation comments section
  if (output.conversationComments.length > 0) {
    lines.push("### Conversation");
    for (const comment of output.conversationComments) {
      lines.push(`- @${comment.author}:`);
      const bodyLines = comment.body.split("\n").map((l) => `  ${l}`);
      lines.push(...bodyLines);
      lines.push("");
    }
  }

  // Summary if no feedback
  if (
    output.reviews.length === 0 &&
    output.codeComments.length === 0 &&
    output.conversationComments.length === 0
  ) {
    lines.push("No reviews or comments found.");
  }

  return lines.join("\n").trim();
};

// === Command ===

export const reviewCommand = Command.make(
  "review",
  {
    prNumber: prNumberArg,
    json: jsonOption,
    unresolved: unresolvedOption,
  },
  ({ prNumber, json, unresolved }) =>
    Effect.gen(function* () {
      const prService = yield* PrService;

      // Check if gh is available
      const ghAvailable = yield* prService.isAvailable();
      if (!ghAvailable) {
        yield* outputError(
          "GitHub CLI (gh) is not installed or not authenticated. Run 'gh auth login' first.",
          json,
        );
        return;
      }

      // Resolve PR number and get PR info if available
      let resolvedPrNumber: number;
      let prInfo: { title: string; url: string } | null = null;

      if (Option.isSome(prNumber)) {
        resolvedPrNumber = prNumber.value;
        // When user provides PR number explicitly, we don't have PR info
        // We could add getPrByNumber in the future, for now we just skip the title/url
      } else {
        // Try to detect from current bookmark
        const vcs = yield* VcsService;
        const changeResult = yield* vcs.getCurrentChange().pipe(
          Effect.map((change) => ({ success: true as const, change })),
          Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
        );

        if (!changeResult.success) {
          yield* outputError(
            "Failed to get current change. Provide a PR number explicitly.",
            json,
          );
          return;
        }

        const change = changeResult.change;
        if (change.bookmarks.length === 0) {
          yield* outputError(
            "Current change has no bookmark. Provide a PR number explicitly.",
            json,
          );
          return;
        }

        const bookmark = change.bookmarks[0];
        const pr = yield* prService.getPrByBranch(bookmark).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
        );

        if (!pr) {
          yield* outputError(
            `No PR found for bookmark '${bookmark}'. Provide a PR number explicitly.`,
            json,
          );
          return;
        }

        resolvedPrNumber = pr.number;
        // Cache PR info from the lookup
        prInfo = { title: pr.title, url: pr.url };
      }

      // Fetch reviews and comments in parallel
      const [reviewsResult, codeCommentsResult, conversationResult] = yield* Effect.all([
        prService.getReviews(resolvedPrNumber).pipe(
          Effect.map((r) => ({ success: true as const, data: r })),
          Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
        ),
        prService.getReviewComments(resolvedPrNumber).pipe(
          Effect.map((r) => ({ success: true as const, data: r })),
          Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
        ),
        prService.getPrComments(resolvedPrNumber).pipe(
          Effect.map((r) => ({ success: true as const, data: r })),
          Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
        ),
      ]);

      // Check for errors
      if (!reviewsResult.success) {
        yield* outputError(`Failed to fetch reviews: ${reviewsResult.error}`, json);
        return;
      }
      if (!codeCommentsResult.success) {
        yield* outputError(`Failed to fetch code comments: ${codeCommentsResult.error}`, json);
        return;
      }
      if (!conversationResult.success) {
        yield* outputError(
          `Failed to fetch conversation comments: ${conversationResult.error}`,
          json,
        );
        return;
      }

      let reviews = reviewsResult.data;
      let codeComments = codeCommentsResult.data;
      let conversationComments = conversationResult.data;

      // Apply unresolved filter if requested
      if (unresolved) {
        const filtered = filterUnresolved(reviews, codeComments, conversationComments);
        reviews = filtered.reviews;
        codeComments = filtered.codeComments;
        conversationComments = filtered.conversationComments;
      }

      // Build output
      const output: ReviewOutput = {
        prNumber: resolvedPrNumber,
        ...(prInfo?.title !== undefined ? { prTitle: prInfo.title } : {}),
        ...(prInfo?.url !== undefined ? { prUrl: prInfo.url } : {}),
        reviews: reviews.map((r) => ({
          id: r.id,
          author: r.author,
          state: r.state,
          body: r.body,
          submittedAt: r.submittedAt,
        })),
        codeComments: codeComments.map((c) => {
          const base = {
            id: c.id,
            path: c.path,
            line: c.line,
            body: c.body,
            author: c.author,
            createdAt: c.createdAt,
            inReplyToId: c.inReplyToId,
          };
          return c.diffHunk !== undefined ? { ...base, diffHunk: c.diffHunk } : base;
        }),
        conversationComments: conversationComments.map((c) => ({
          id: c.id,
          body: c.body,
          author: c.author,
          createdAt: c.createdAt,
        })),
        commentsByFile: groupCommentsByFile(codeComments),
      };

      // Output result
      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* Console.log(formatHumanOutput(output));
      }
    }),
);
