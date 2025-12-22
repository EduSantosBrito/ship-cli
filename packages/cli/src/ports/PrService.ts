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

/** Union of all PR error types */
export type PrErrors = GhNotInstalledError | GhNotAuthenticatedError | PrError;

export interface PrService {
  /**
   * Check if gh CLI is available and authenticated
   */
  readonly isAvailable: () => Effect.Effect<boolean, never>;

  /**
   * Create a new pull request
   */
  readonly createPr: (input: CreatePrInput) => Effect.Effect<PullRequest, PrErrors>;

  /**
   * Update an existing pull request
   */
  readonly updatePr: (prNumber: number, input: UpdatePrInput) => Effect.Effect<PullRequest, PrErrors>;

  /**
   * Open PR URL in browser
   */
  readonly openInBrowser: (url: string) => Effect.Effect<void, PrError>;

  /**
   * Get PR by branch name. Returns null if no PR exists for the branch.
   */
  readonly getPrByBranch: (branch: string) => Effect.Effect<PullRequest | null, PrErrors>;
}

export const PrService = Context.GenericTag<PrService>("PrService");
