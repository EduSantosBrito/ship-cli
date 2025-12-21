import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Duration from "effect/Duration";
import * as Command from "@effect/platform/Command";
import * as CommandExecutor from "@effect/platform/CommandExecutor";
import { JjNotInstalledError, VcsError } from "../../../domain/Errors.js";
import { VcsService, ChangeId, PushResult, type VcsErrors } from "../../../ports/VcsService.js";
import {
  JJ_LOG_JSON_TEMPLATE,
  parseChanges,
  parseChangeIdFromOutput,
  getCurrentChangeId,
} from "./JjParser.js";
import { mapJjError, looksLikeError, type JjError } from "./JjErrorMapper.js";

// Retry policy for network operations: exponential backoff with max 3 retries
const networkRetryPolicy = Schedule.intersect(
  Schedule.exponential(Duration.millis(500)),
  Schedule.recurs(3),
);

// Timeout for network operations
const NETWORK_TIMEOUT = Duration.seconds(60);

const make = Effect.gen(function* () {
  // Get CommandExecutor from context - it will be provided by the layer
  const executor = yield* CommandExecutor.CommandExecutor;

  /**
   * Escape a string for safe use in a single-quoted shell argument.
   * Uses the POSIX-compliant pattern: replace ' with '\'' (end quote, escaped quote, start quote).
   *
   * Note: Consider using a library like `shell-quote` for more complex escaping needs.
   * For our use case (simple jj command arguments), this pattern is sufficient and well-tested.
   */
  const escapeShellArg = (arg: string): string => `'${arg.replace(/'/g, "'\"'\"'")}'`;

  /**
   * Run a jj command and return combined stdout+stderr as string.
   *
   * Why shell wrapper? jj outputs most information to stderr, not stdout.
   * @effect/platform's Command.string only captures stdout, so we use
   * `sh -c "jj ... 2>&1"` to redirect stderr to stdout for capture.
   *
   * Error handling: If the output looks like an error (based on heuristics),
   * we map it to a typed JjError using the error mapper.
   */
  const runJj = (...args: ReadonlyArray<string>): Effect.Effect<string, JjError> => {
    const escapedArgs = args.map(escapeShellArg).join(" ");
    const cmd = Command.make("sh", "-c", `jj ${escapedArgs} 2>&1`);
    const command = args[0] ?? "unknown";

    return Command.string(cmd).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
      Effect.flatMap((output) => {
        // Check if output looks like an error
        if (looksLikeError(output)) {
          return Effect.fail(mapJjError(output, command));
        }
        return Effect.succeed(output);
      }),
      Effect.mapError((e) => {
        // If already a JjError, pass through
        if (e && typeof e === "object" && "_tag" in e) {
          return e as JjError;
        }
        // Otherwise map the platform error
        return new VcsError({ message: `jj ${command} failed: ${e}`, cause: e });
      }),
    );
  };

  /**
   * Run a jj command and return exit code (for checking success/failure).
   *
   * Note: Uses direct execution (not shell-wrapped) since we only need the exit code,
   * not the output. Exit codes work correctly without stderr capture.
   */
  const runJjExitCode = (...args: ReadonlyArray<string>): Effect.Effect<number, never> => {
    const cmd = Command.make("jj", ...args);
    return Command.exitCode(cmd).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
      Effect.catchAll(() => Effect.succeed(1)),
    );
  };

  /**
   * Wrap an effect with network retry and timeout
   */
  const withNetworkRetry = <A, E>(
    effect: Effect.Effect<A, E>,
    operation: string,
  ): Effect.Effect<A, E | VcsError> =>
    effect.pipe(
      Effect.timeoutFail({
        duration: NETWORK_TIMEOUT,
        onTimeout: () => new VcsError({ message: `${operation} timed out after 60 seconds` }),
      }),
      Effect.retry(networkRetryPolicy),
    );

  const isAvailable = (): Effect.Effect<boolean, never> => {
    const cmd = Command.make("jj", "version");
    return Command.exitCode(cmd).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
      Effect.map((code) => code === 0),
      Effect.catchAll(() => Effect.succeed(false)),
    );
  };

  const isRepo = (): Effect.Effect<boolean, VcsErrors> =>
    runJjExitCode("root").pipe(Effect.map((code) => code === 0));

  const createChange = (
    message: string,
  ): Effect.Effect<ChangeId, JjNotInstalledError | VcsErrors> =>
    Effect.gen(function* () {
      const available = yield* isAvailable();
      if (!available) {
        return yield* JjNotInstalledError.default;
      }
      // Run jj new, then get the change ID from the new working copy
      // This is more reliable than parsing the stderr output
      yield* runJj("new", "-m", message);
      return yield* getCurrentChangeId(runJj);
    });

  const describe = (message: string): Effect.Effect<void, VcsErrors> =>
    runJj("describe", "-m", message).pipe(Effect.asVoid);

  const commit = (message: string): Effect.Effect<ChangeId, VcsErrors> =>
    Effect.gen(function* () {
      yield* runJj("commit", "-m", message);
      return yield* getCurrentChangeId(runJj);
    });

  const createBookmark = (name: string, ref?: ChangeId): Effect.Effect<void, VcsErrors> => {
    if (ref) {
      return runJj("bookmark", "create", name, "-r", ref).pipe(Effect.asVoid);
    }
    return runJj("bookmark", "create", name).pipe(Effect.asVoid);
  };

  const getCurrentChange = (): Effect.Effect<
    import("../../../ports/VcsService.js").Change,
    VcsErrors
  > =>
    Effect.gen(function* () {
      const output = yield* runJj("log", "-r", "@", "-T", JJ_LOG_JSON_TEMPLATE, "--no-graph");
      const changes = yield* parseChanges(output);
      if (changes.length === 0) {
        return yield* new VcsError({ message: "No current change found" });
      }
      return changes[0];
    });

  const push = (bookmark: string): Effect.Effect<PushResult, VcsErrors> =>
    withNetworkRetry(
      Effect.gen(function* () {
        yield* runJj("git", "push", "-b", bookmark);
        // Get the current change to return the change ID
        const current = yield* getCurrentChange();
        return new PushResult({
          bookmark,
          remote: "origin",
          changeId: current.id,
        });
      }),
      "git push",
    );

  const getStack = (): Effect.Effect<
    ReadonlyArray<import("../../../ports/VcsService.js").Change>,
    VcsErrors
  > =>
    Effect.gen(function* () {
      // Get changes from trunk (main/master) to current working copy
      const output = yield* runJj(
        "log",
        "-r",
        "trunk()..@",
        "-T",
        JJ_LOG_JSON_TEMPLATE,
        "--no-graph",
      );
      return yield* parseChanges(output);
    });

  const getLog = (
    revset?: string,
  ): Effect.Effect<ReadonlyArray<import("../../../ports/VcsService.js").Change>, VcsErrors> =>
    Effect.gen(function* () {
      const rev = revset ?? "@";
      const output = yield* runJj("log", "-r", rev, "-T", JJ_LOG_JSON_TEMPLATE, "--no-graph");
      return yield* parseChanges(output);
    });

  const fetch = (): Effect.Effect<void, VcsErrors> =>
    withNetworkRetry(runJj("git", "fetch").pipe(Effect.asVoid), "git fetch");

  return {
    isAvailable,
    isRepo,
    createChange,
    describe,
    commit,
    createBookmark,
    push,
    getCurrentChange,
    getStack,
    getLog,
    fetch,
  };
});

export const VcsServiceLive = Layer.effect(VcsService, make);

// Re-export parseChangeIdFromOutput for use in other modules that need to parse jj output
export { parseChangeIdFromOutput };
