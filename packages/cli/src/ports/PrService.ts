import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { GhNotInstalledError, GhNotAuthenticatedError, PrError } from "../domain/Errors.js";

// === PR Domain Types ===

export const PrId = Schema.String.pipe(Schema.brand("PrId"));
export type PrId = typeof PrId.Type;

export class PullRequest extends Schema.Class<PullRequest>("PullRequest")({
  id: PrId,
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literal("open", "closed", "merged"),
  head: Schema.String,
  base: Schema.String,
}) {}

export class CreatePrInput extends Schema.Class<CreatePrInput>("CreatePrInput")({
  title: Schema.String,
  body: Schema.String,
  head: Schema.String, // branch name
  base: Schema.optionalWith(Schema.String, { default: () => "main" }),
  draft: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}

export class UpdatePrInput extends Schema.Class<UpdatePrInput>("UpdatePrInput")({
  title: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
}) {}

// === PR Review Types ===

/** Review verdict from a reviewer */
export class PrReview extends Schema.Class<PrReview>("PrReview")({
  id: Schema.Number,
  author: Schema.String,
  state: Schema.Literal("APPROVED", "CHANGES_REQUESTED", "COMMENTED", "PENDING", "DISMISSED"),
  body: Schema.String,
  submittedAt: Schema.String,
}) {}

/** Inline code comment on a PR */
export class PrReviewComment extends Schema.Class<PrReviewComment>("PrReviewComment")({
  id: Schema.Number,
  path: Schema.String,
  line: Schema.NullOr(Schema.Number), // null for file-level comments
  body: Schema.String,
  author: Schema.String,
  createdAt: Schema.String,
  inReplyToId: Schema.NullOr(Schema.Number), // for threading
  diffHunk: Schema.optional(Schema.String), // the code context
}) {}

/** General conversation comment on a PR (issue comments) */
export class PrComment extends Schema.Class<PrComment>("PrComment")({
  id: Schema.Number,
  body: Schema.String,
  author: Schema.String,
  createdAt: Schema.String,
}) {}

/** Union of all PR error types */
export type PrErrors = GhNotInstalledError | GhNotAuthenticatedError | PrError;

export interface PrService {
  /**
   * Check if gh CLI is available and authenticated
   */
  readonly isAvailable: () => Effect.Effect<boolean, never>;

  /**
   * Get current repository in "owner/repo" format.
   * Returns null if not in a git repo or no remote configured.
   */
  readonly getCurrentRepo: () => Effect.Effect<string | null, PrErrors>;

  /**
   * Create a new pull request
   */
  readonly createPr: (input: CreatePrInput) => Effect.Effect<PullRequest, PrErrors>;

  /**
   * Update an existing pull request
   */
  readonly updatePr: (
    prNumber: number,
    input: UpdatePrInput,
  ) => Effect.Effect<PullRequest, PrErrors>;

  /**
   * Open PR URL in browser
   */
  readonly openInBrowser: (url: string) => Effect.Effect<void, PrError>;

  /**
   * Get PR by branch name. Returns null if no PR exists for the branch.
   */
  readonly getPrByBranch: (branch: string) => Effect.Effect<PullRequest | null, PrErrors>;

  /**
   * Update the base branch of an existing pull request.
   * Used to retarget a PR after its parent PR is merged.
   * @param prNumber - The PR number to update
   * @param base - The new base branch name
   */
  readonly updatePrBase: (prNumber: number, base: string) => Effect.Effect<PullRequest, PrErrors>;

  /**
   * Get reviews for a pull request.
   * Returns review verdicts (APPROVED, CHANGES_REQUESTED, etc.) with author and body.
   * @param prNumber - The PR number
   */
  readonly getReviews: (prNumber: number) => Effect.Effect<ReadonlyArray<PrReview>, PrErrors>;

  /**
   * Get inline code comments for a pull request.
   * Returns comments on specific lines with file path and code context.
   * @param prNumber - The PR number
   */
  readonly getReviewComments: (
    prNumber: number,
  ) => Effect.Effect<ReadonlyArray<PrReviewComment>, PrErrors>;

  /**
   * Get general conversation comments for a pull request (issue comments).
   * These are top-level discussion comments, not inline code comments.
   * @param prNumber - The PR number
   */
  readonly getPrComments: (prNumber: number) => Effect.Effect<ReadonlyArray<PrComment>, PrErrors>;
}

export const PrService = Context.GenericTag<PrService>("PrService");
