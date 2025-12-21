import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Duration from "effect/Duration";
import * as Command from "@effect/platform/Command";
import * as CommandExecutor from "@effect/platform/CommandExecutor";
import { JjNotInstalledError, VcsError } from "../../../domain/Errors.js";
import { VcsService, ChangeId, Change, PushResult } from "../../../ports/VcsService.js";

// JSON template for jj log output
// This template outputs JSON that can be parsed into Change objects
// Note: current_working_copy is the correct boolean for checking if this is the working copy
// Each JSON object is on its own line for easy parsing
const JJ_LOG_TEMPLATE = `
"{" ++
"\\\"id\\\": \\\"" ++ commit_id ++ "\\\"," ++
"\\\"changeId\\\": \\\"" ++ change_id.short() ++ "\\\"," ++
"\\\"description\\\": \\\"" ++ description.first_line() ++ "\\\"," ++
"\\\"author\\\": \\\"" ++ author.email() ++ "\\\"," ++
"\\\"timestamp\\\": \\\"" ++ committer.timestamp() ++ "\\\"," ++
"\\\"bookmarks\\\": [" ++ bookmarks.map(|b| "\\\"" ++ b ++ "\\\"").join(", ") ++ "]," ++
"\\\"isWorkingCopy\\\": " ++ if(current_working_copy, "true", "false") ++ "," ++
"\\\"isEmpty\\\": " ++ if(empty, "true", "false") ++
"}" ++ "\\n"
`;

// Retry policy for network operations: exponential backoff with max 3 retries
const networkRetryPolicy = Schedule.intersect(
  Schedule.exponential(Duration.millis(500)),
  Schedule.recurs(3),
);

// Timeout for network operations
const NETWORK_TIMEOUT = Duration.seconds(60);

/**
 * Parse a single Change from jj JSON output
 */
const parseChange = (json: string): Effect.Effect<Change, VcsError> =>
  Effect.try({
    try: () => {
      const parsed = JSON.parse(json);
      return new Change({
        id: parsed.id as ChangeId,
        changeId: parsed.changeId,
        description: parsed.description,
        author: parsed.author,
        timestamp: new Date(parsed.timestamp),
        bookmarks: parsed.bookmarks.filter((b: string) => b !== ""),
        isWorkingCopy: parsed.isWorkingCopy,
        isEmpty: parsed.isEmpty,
      });
    },
    catch: (e) => new VcsError({ message: `Failed to parse jj output: ${e}`, cause: e }),
  });

/**
 * Parse multiple Changes from jj JSON output (newline-separated)
 */
const parseChanges = (output: string): Effect.Effect<ReadonlyArray<Change>, VcsError> => {
  const lines = output
    .trim()
    .split("\n")
    .filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return Effect.succeed([]);
  }
  return Effect.all(lines.map(parseChange));
};

/**
 * Extract change ID from jj new/commit output
 * Output format: "Working copy  (@) now at: <change_id> <commit_id> (empty) <description>"
 */
const extractChangeId = (output: string): Effect.Effect<ChangeId, VcsError> =>
  Effect.try({
    try: () => {
      // jj new output: "Working copy  (@) now at: rnrztzzn 98410bd9 (empty) message"
      // jj commit output: "Working copy  (@) now at: newchange 5e6f7g8h (empty) (no description set)"
      // Match accounts for optional (@) and variable whitespace
      const match = output.match(/Working copy\s+(?:\(@\)\s+)?now at:\s+(\w+)/);
      if (!match) {
        throw new Error(`Could not extract change ID from: ${output}`);
      }
      return match[1] as ChangeId;
    },
    catch: (e) => new VcsError({ message: `Failed to extract change ID: ${e}`, cause: e }),
  });

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
   * This approach will be improved in BRI-8 (jj output parsing) by using
   * jj's native JSON/template output instead of parsing human-readable text.
   */
  const runJj = (...args: ReadonlyArray<string>): Effect.Effect<string, VcsError> => {
    const escapedArgs = args.map(escapeShellArg).join(" ");
    const cmd = Command.make("sh", "-c", `jj ${escapedArgs} 2>&1`);
    return Command.string(cmd).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
      Effect.mapError((e) => new VcsError({ message: `jj ${args[0]} failed: ${e}`, cause: e })),
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

  const isRepo = (): Effect.Effect<boolean, VcsError> =>
    runJjExitCode("root").pipe(Effect.map((code) => code === 0));

  const createChange = (message: string): Effect.Effect<ChangeId, JjNotInstalledError | VcsError> =>
    Effect.gen(function* () {
      const available = yield* isAvailable();
      if (!available) {
        return yield* JjNotInstalledError.default;
      }
      const output = yield* runJj("new", "-m", message);
      return yield* extractChangeId(output);
    });

  const describe = (message: string): Effect.Effect<void, VcsError> =>
    runJj("describe", "-m", message).pipe(Effect.asVoid);

  const commit = (message: string): Effect.Effect<ChangeId, VcsError> =>
    Effect.gen(function* () {
      const output = yield* runJj("commit", "-m", message);
      return yield* extractChangeId(output);
    });

  const createBookmark = (name: string, ref?: ChangeId): Effect.Effect<void, VcsError> => {
    if (ref) {
      return runJj("bookmark", "create", name, "-r", ref).pipe(Effect.asVoid);
    }
    return runJj("bookmark", "create", name).pipe(Effect.asVoid);
  };

  const getCurrentChange = (): Effect.Effect<Change, VcsError> =>
    Effect.gen(function* () {
      const output = yield* runJj("log", "-r", "@", "-T", JJ_LOG_TEMPLATE, "--no-graph");
      const changes = yield* parseChanges(output);
      if (changes.length === 0) {
        return yield* new VcsError({ message: "No current change found" });
      }
      return changes[0];
    });

  const push = (bookmark: string): Effect.Effect<PushResult, VcsError> =>
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

  const getStack = (): Effect.Effect<ReadonlyArray<Change>, VcsError> =>
    Effect.gen(function* () {
      // Get changes from trunk (main/master) to current working copy
      const output = yield* runJj("log", "-r", "trunk()..@", "-T", JJ_LOG_TEMPLATE, "--no-graph");
      return yield* parseChanges(output);
    });

  const getLog = (revset?: string): Effect.Effect<ReadonlyArray<Change>, VcsError> =>
    Effect.gen(function* () {
      const rev = revset ?? "@";
      const output = yield* runJj("log", "-r", rev, "-T", JJ_LOG_TEMPLATE, "--no-graph");
      return yield* parseChanges(output);
    });

  const fetch = (): Effect.Effect<void, VcsError> =>
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
