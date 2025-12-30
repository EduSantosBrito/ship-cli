/**
 * Webhook diagnostics - Provides user-friendly error messages for repo issues
 *
 * Inspired by jj's helpful error messages with actionable hints.
 */

import * as PlatformCommand from "@effect/platform/Command";
import * as CommandExecutor from "@effect/platform/CommandExecutor";
import * as FileSystem from "@effect/platform/FileSystem";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Match from "effect/Match";

// === Error Types ===

export type RepoIssue = Data.TaggedEnum<{
  NotGitRepo: {};
  NoRemote: { readonly hasJj: boolean };
  JjNotInitialized: {};
}>;

export const RepoIssue = Data.taggedEnum<RepoIssue>();

// === Diagnostics ===

/**
 * Diagnose why getCurrentRepo() returned null.
 * Returns specific issue for helpful error messages.
 *
 * @param cwd - Current working directory to check (defaults to process.cwd())
 */
export const diagnoseRepoIssue = (
  cwd?: string,
): Effect.Effect<RepoIssue, never, CommandExecutor.CommandExecutor | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor;
    const fs = yield* FileSystem.FileSystem;

    const workdir = cwd ?? (yield* Effect.sync(() => process.cwd()));
    const hasGitDir = yield* fs.exists(`${workdir}/.git`).pipe(Effect.orElseSucceed(() => false));
    const hasJjDir = yield* fs.exists(`${workdir}/.jj`).pipe(Effect.orElseSucceed(() => false));

    // Not a repo at all
    if (!hasGitDir && !hasJjDir) {
      return RepoIssue.NotGitRepo();
    }

    // Has .git but no .jj - check for remotes
    if (hasGitDir && !hasJjDir) {
      const remoteResult = yield* PlatformCommand.string(
        PlatformCommand.make("git", "remote", "-v"),
      ).pipe(
        Effect.provideService(CommandExecutor.CommandExecutor, executor),
        Effect.map((output) => output.trim()),
        Effect.orElseSucceed(() => ""),
      );

      if (!remoteResult) {
        return RepoIssue.NoRemote({ hasJj: false });
      }

      // Has git with remote, but no jj
      return RepoIssue.JjNotInitialized();
    }

    // Has .jj - check if remotes are configured
    const jjRemoteResult = yield* PlatformCommand.string(
      PlatformCommand.make("jj", "git", "remote", "list"),
    ).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
      Effect.map((output) => output.trim()),
      Effect.orElseSucceed(() => ""),
    );

    if (!jjRemoteResult) {
      return RepoIssue.NoRemote({ hasJj: true });
    }

    // Has jj with remotes but gh repo view still failed
    // This shouldn't happen, but fallback to no remote error
    return RepoIssue.NoRemote({ hasJj: hasJjDir });
  });

// === Error Formatting ===

/**
 * Format repo issue as structured error lines (for testing/composition).
 */
export const formatRepoError: (issue: RepoIssue) => ReadonlyArray<string> = Match.type<RepoIssue>().pipe(
  Match.tag("NotGitRepo", () => [
    "Error: Not in a git repository.",
    "",
    "Hint: Initialize a repository first:",
    "  git init && gh repo create",
  ]),
  Match.tag("NoRemote", ({ hasJj }) =>
    hasJj
      ? [
          "Error: No GitHub remote configured.",
          "",
          "Hint: Add a GitHub remote to your jj repository:",
          "  jj git remote add origin git@github.com:OWNER/REPO.git",
          "",
          "Or create a new GitHub repo:",
          "  gh repo create REPO --source=. --remote=origin",
        ]
      : [
          "Error: No GitHub remote configured.",
          "",
          "Hint: Create a GitHub repository:",
          "  gh repo create REPO --source=. --remote=origin",
          "",
          "Or add an existing remote:",
          "  git remote add origin git@github.com:OWNER/REPO.git",
        ],
  ),
  Match.tag("JjNotInitialized", () => [
    "Error: This is a git repository but jj is not initialized.",
    "",
    "Hint: Ship CLI works best with jj. Initialize jj for this repo:",
    "  jj git init --colocate",
  ]),
  Match.exhaustive,
);

/**
 * Print user-friendly error messages with hints (jj style).
 */
export const printRepoError = (issue: RepoIssue): Effect.Effect<void, never> =>
  Effect.forEach(formatRepoError(issue), (line) => Console.error(line), { discard: true });
