import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { GhNotInstalledError, PrError } from "../domain/Errors.js";

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
}) {}

export interface PrService {
  /**
   * Check if gh CLI is available
   */
  readonly isAvailable: () => Effect.Effect<boolean, never>;

  /**
   * Create a new pull request
   */
  readonly createPr: (
    input: CreatePrInput,
  ) => Effect.Effect<PullRequest, GhNotInstalledError | PrError>;

  /**
   * Open PR URL in browser
   */
  readonly openInBrowser: (url: string) => Effect.Effect<void, PrError>;

  /**
   * Get PR by branch name
   */
  readonly getPrByBranch: (branch: string) => Effect.Effect<PullRequest | null, PrError>;
}

export class PrService extends Context.Tag("PrService")<PrService, PrService>() {}
