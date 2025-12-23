/**
 * CLI command execution helpers for integration tests.
 *
 * Provides utilities for running the ship CLI in test environments
 * with captured output.
 */

import * as Effect from "effect/Effect";
import * as Command from "@effect/platform/Command";
import * as CommandExecutor from "@effect/platform/CommandExecutor";

/**
 * Result of running a CLI command.
 */
export interface CommandResult {
  /** Standard output from the command */
  readonly stdout: string;
  /** Standard error from the command */
  readonly stderr: string;
  /** Exit code of the command */
  readonly exitCode: number;
}

/**
 * Run the ship CLI with the given arguments.
 *
 * @param args - Arguments to pass to the ship CLI
 * @param cwd - Working directory for the command
 * @returns The command result with stdout, stderr, and exit code
 */
export const runShipCli = (
  args: ReadonlyArray<string>,
  cwd: string,
): Effect.Effect<CommandResult, never, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor;

    // Build the command - use pnpm ship in the workspace context
    const cmd = Command.make("pnpm", "ship", ...args).pipe(Command.workingDirectory(cwd));

    // Run the command and capture exit code
    const exitCode = yield* Command.exitCode(cmd).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
      Effect.catchAll(() => Effect.succeed(1)),
    );

    // Run command again to get output (we need separate runs for exit code vs output)
    // Using sh wrapper to capture both stdout and stderr
    const escapedArgs = args.map((arg) => `'${arg.replace(/'/g, "'\"'\"'")}'`).join(" ");
    const outputCmd = Command.make("sh", "-c", `pnpm ship ${escapedArgs} 2>&1`).pipe(
      Command.workingDirectory(cwd),
    );

    const output = yield* Command.string(outputCmd).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
      Effect.catchAll(() => Effect.succeed("")),
    );

    return {
      stdout: output,
      stderr: "", // Combined into stdout via 2>&1
      exitCode,
    };
  });

/**
 * Run a shell command and return combined output.
 *
 * @param command - The shell command to run
 * @param cwd - Working directory for the command
 * @returns Combined stdout and stderr
 */
export const runShell = (
  command: string,
  cwd: string,
): Effect.Effect<string, Error, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor;
    const cmd = Command.make("sh", "-c", `${command} 2>&1`).pipe(Command.workingDirectory(cwd));
    return yield* Command.string(cmd).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
    );
  }).pipe(
    Effect.mapError((e) => new Error(`Shell command failed: ${e}`)),
  );

/**
 * Assert that a command result indicates success.
 *
 * @param result - The command result to check
 * @param message - Optional message for assertion failure
 */
export const assertSuccess = (result: CommandResult, message?: string): void => {
  if (result.exitCode !== 0) {
    const errorMessage = message
      ? `${message}: Command failed with exit code ${result.exitCode}`
      : `Command failed with exit code ${result.exitCode}`;
    throw new Error(`${errorMessage}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
};

/**
 * Assert that a command result indicates failure.
 *
 * @param result - The command result to check
 * @param message - Optional message for assertion failure
 */
export const assertFailure = (result: CommandResult, message?: string): void => {
  if (result.exitCode === 0) {
    const errorMessage = message ? `${message}: Command unexpectedly succeeded` : "Command unexpectedly succeeded";
    throw new Error(`${errorMessage}\nstdout: ${result.stdout}`);
  }
};

/**
 * Assert that command output contains a specific string.
 *
 * @param result - The command result to check
 * @param substring - The substring to search for
 * @param inStderr - Whether to search in stderr instead of stdout
 */
export const assertOutputContains = (
  result: CommandResult,
  substring: string,
  inStderr = false,
): void => {
  const output = inStderr ? result.stderr : result.stdout;
  if (!output.includes(substring)) {
    throw new Error(
      `Expected ${inStderr ? "stderr" : "stdout"} to contain "${substring}"\nActual output: ${output}`,
    );
  }
};
