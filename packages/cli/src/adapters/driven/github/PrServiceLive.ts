/**
 * PrServiceLive - GitHub CLI (gh) wrapper for PR operations
 *
 * This adapter implements the PrService port using the gh CLI.
 * All commands are executed via the shell with proper error handling.
 *
 * Key gh commands used:
 * - `gh auth status` - Check authentication
 * - `gh pr create` - Create a new PR
 * - `gh pr view` - View PR details or open in browser
 * - `gh pr list` - List PRs (for finding PR by branch)
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as Duration from "effect/Duration";
import * as Command from "@effect/platform/Command";
import * as CommandExecutor from "@effect/platform/CommandExecutor";
import {
  GhNotInstalledError,
  GhNotAuthenticatedError,
  PrError,
} from "../../../domain/Errors.js";
import {
  PrService,
  PullRequest,
  PrId,
  type CreatePrInput,
  type UpdatePrInput,
  type PrErrors,
} from "../../../ports/PrService.js";

// Retry policy for network operations: exponential backoff with max 3 retries
const networkRetryPolicy = Schedule.intersect(
  Schedule.exponential(Duration.millis(500)),
  Schedule.recurs(3),
);

// Timeout for network operations
const NETWORK_TIMEOUT = Duration.seconds(60);

// === gh JSON Response Schemas ===

/**
 * Schema for gh pr view --json output
 */
const GhPrJsonSchema = Schema.Struct({
  id: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  state: Schema.String, // "OPEN", "CLOSED", "MERGED"
  headRefName: Schema.String,
  baseRefName: Schema.String,
});

type GhPrJson = typeof GhPrJsonSchema.Type;



// === Service Implementation ===

const make = Effect.gen(function* () {
  const executor = yield* CommandExecutor.CommandExecutor;

  /**
   * Run a gh command and return stdout as string.
   * gh outputs to stdout for successful commands.
   */
  const runGh = (
    ...args: ReadonlyArray<string>
  ): Effect.Effect<string, PrErrors> => {
    const cmd = Command.make("gh", ...args);

    return Command.string(cmd).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
      Effect.mapError((e) => {
        const errorStr = String(e);

        // Check for gh CLI not installed - be specific to avoid matching "not found" in other contexts
        if (
          errorStr.includes("command not found") ||
          errorStr.includes("ENOENT") ||
          errorStr.includes("gh: not found")
        ) {
          return GhNotInstalledError.default;
        }

        if (
          errorStr.includes("not logged in") ||
          errorStr.includes("authentication") ||
          errorStr.includes("401")
        ) {
          return GhNotAuthenticatedError.default;
        }

        return new PrError({
          message: `gh ${args[0]} failed: ${errorStr}`,
          cause: e,
        });
      }),
    );
  };

  /**
   * Run a gh command and return exit code (for checking success/failure).
   */
  const runGhExitCode = (
    ...args: ReadonlyArray<string>
  ): Effect.Effect<number, never> => {
    const cmd = Command.make("gh", ...args);
    return Command.exitCode(cmd).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
      Effect.catchAll(() => Effect.succeed(1)),
    );
  };

  /**
   * Wrap an effect with network retry and timeout for resilience
   */
  const withNetworkRetry = <A, E>(
    effect: Effect.Effect<A, E>,
    operation: string,
  ): Effect.Effect<A, E | PrError> =>
    effect.pipe(
      Effect.timeoutFail({
        duration: NETWORK_TIMEOUT,
        onTimeout: () => new PrError({ message: `${operation} timed out after 60 seconds` }),
      }),
      Effect.retry(networkRetryPolicy),
    );

  /**
   * Parse JSON output from gh command
   */
  const parseGhJson = <T>(
    output: string,
    schema: Schema.Schema<T>,
  ): Effect.Effect<T, PrError> =>
    Effect.try({
      try: () => JSON.parse(output),
      catch: (e) =>
        new PrError({ message: `Failed to parse gh output: ${e}`, cause: e }),
    }).pipe(
      Effect.flatMap((json) =>
        Schema.decodeUnknown(schema)(json).pipe(
          Effect.mapError(
            (e) =>
              new PrError({
                message: `Invalid gh response format: ${e.message}`,
                cause: e,
              }),
          ),
        ),
      ),
    );

  /**
   * Convert gh PR state to our domain state
   */
  const normalizeState = (ghState: string): "open" | "closed" | "merged" => {
    switch (ghState.toUpperCase()) {
      case "OPEN":
        return "open";
      case "MERGED":
        return "merged";
      case "CLOSED":
      default:
        return "closed";
    }
  };

  /**
   * Convert gh PR JSON to our PullRequest domain type
   */
  const toPullRequest = (ghPr: GhPrJson): Effect.Effect<PullRequest, PrError> =>
    Schema.decode(PrId)(ghPr.id).pipe(
      Effect.map(
        (validatedId) =>
          new PullRequest({
            id: validatedId,
            number: ghPr.number,
            title: ghPr.title,
            url: ghPr.url,
            state: normalizeState(ghPr.state),
            head: ghPr.headRefName,
            base: ghPr.baseRefName,
          }),
      ),
      Effect.mapError(
        (e) => new PrError({ message: `Invalid PR ID format: ${e.message}`, cause: e }),
      ),
    );

  // === Public API ===

  const isAvailable = (): Effect.Effect<boolean, never> =>
    Effect.gen(function* () {
      // First check if gh is installed
      const versionCode = yield* runGhExitCode("version");
      if (versionCode !== 0) {
        return false;
      }

      // Then check if authenticated
      const authCode = yield* runGhExitCode("auth", "status");
      return authCode === 0;
    });

  const createPr = (
    input: CreatePrInput,
  ): Effect.Effect<PullRequest, PrErrors> =>
    withNetworkRetry(
      Effect.gen(function* () {
        // Build the command arguments for creating the PR
        // Note: gh pr create doesn't support --json, it just outputs the PR URL
        const createArgs = [
          "pr",
          "create",
          "--title",
          input.title,
          "--body",
          input.body,
          "--head",
          input.head,
          "--base",
          input.base,
          ...(input.draft ? ["--draft"] : []),
        ];

        // Create the PR (output is the PR URL)
        yield* runGh(...createArgs);

        // Now fetch the PR details using gh pr view with --json
        const viewArgs = [
          "pr",
          "view",
          input.head,
          "--json",
          "id,number,title,url,state,headRefName,baseRefName",
        ];

        const output = yield* runGh(...viewArgs);
        const ghPr = yield* parseGhJson(output, GhPrJsonSchema);
        return yield* toPullRequest(ghPr);
      }),
      "createPr",
    );

  const updatePr = (
    prNumber: number,
    input: UpdatePrInput,
  ): Effect.Effect<PullRequest, PrErrors> =>
    withNetworkRetry(
      Effect.gen(function* () {
        // Build the command arguments for updating the PR
        const updateArgs = ["pr", "edit", String(prNumber)];
        if (input.title) {
          updateArgs.push("--title", input.title);
        }
        if (input.body) {
          updateArgs.push("--body", input.body);
        }

        // Update the PR
        yield* runGh(...updateArgs);

        // Fetch the updated PR details
        const viewArgs = [
          "pr",
          "view",
          String(prNumber),
          "--json",
          "id,number,title,url,state,headRefName,baseRefName",
        ];

        const output = yield* runGh(...viewArgs);
        const ghPr = yield* parseGhJson(output, GhPrJsonSchema);
        return yield* toPullRequest(ghPr);
      }),
      "updatePr",
    );

  const openInBrowser = (url: string): Effect.Effect<void, PrError> =>
    Effect.gen(function* () {
      // Use gh browse which is cross-platform (works on macOS, Linux, Windows)
      // gh browse can open any URL in the user's default browser
      const cmd = Command.make("gh", "browse", "--repo", url);
      const exitCode = yield* Command.exitCode(cmd).pipe(
        Effect.provideService(CommandExecutor.CommandExecutor, executor),
        Effect.catchAll(() => Effect.succeed(1)),
      );

      if (exitCode !== 0) {
        // Fallback: try gh pr view --web if the URL is a PR URL
        yield* runGh("pr", "view", "--web", url).pipe(
          Effect.asVoid,
          Effect.catchAll(() =>
            Effect.fail(
              new PrError({ message: `Failed to open browser for ${url}` }),
            ),
          ),
        );
      }
    });

  const getPrByBranch = (
    branch: string,
  ): Effect.Effect<PullRequest | null, PrErrors> =>
    withNetworkRetry(
      Effect.gen(function* () {
        // gh pr view with branch name, get JSON output
        const result = yield* runGh(
          "pr",
          "view",
          branch,
          "--json",
          "id,number,title,url,state,headRefName,baseRefName",
        ).pipe(
          Effect.map((output) => ({ found: true as const, output })),
          Effect.catchAll((e) => {
            // If no PR exists for this branch, gh returns an error
            // We should return null, not fail
            // Be specific about which errors indicate "no PR" vs actual failures
            if (
              e instanceof PrError &&
              (e.message.includes("no pull requests found") ||
                e.message.includes("Could not resolve"))
            ) {
              return Effect.succeed({ found: false as const });
            }
            return Effect.fail(e);
          }),
        );

        if (!result.found) {
          return null;
        }

        const ghPr = yield* parseGhJson(result.output, GhPrJsonSchema);
        return yield* toPullRequest(ghPr);
      }),
      "getPrByBranch",
    );

  return {
    isAvailable,
    createPr,
    updatePr,
    openInBrowser,
    getPrByBranch,
  };
});

export const PrServiceLive = Layer.effect(PrService, make);
