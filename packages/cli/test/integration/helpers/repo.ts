/**
 * Jj repository setup helpers for integration tests.
 *
 * Provides Effect-based utilities for creating and managing jj repositories
 * with controlled configuration for reproducible testing.
 */

import * as Effect from "effect/Effect";
import * as Command from "@effect/platform/Command";
import * as CommandExecutor from "@effect/platform/CommandExecutor";
import * as FileSystem from "@effect/platform/FileSystem";
import * as Path from "@effect/platform/Path";
import { createTempDir, removeDir, writeFile } from "./fs.js";

/**
 * Specification for creating a commit in a test repository.
 */
export interface CommitSpec {
  /** Commit message/description */
  readonly message: string;
  /** Optional files to create/modify in this commit */
  readonly files?: ReadonlyArray<{
    readonly path: string;
    readonly content: string;
  }>;
  /** Optional bookmark to create at this commit */
  readonly bookmark?: string;
}

/**
 * Result of creating a test repository.
 */
export interface TestRepo {
  /** Absolute path to the repository */
  readonly path: string;
  /** Function to run jj commands in this repo */
  readonly runJj: (
    ...args: ReadonlyArray<string>
  ) => Effect.Effect<string, Error, CommandExecutor.CommandExecutor>;
}

/**
 * Result of creating a repository with a remote.
 */
export interface TestRepoWithRemote {
  /** The "origin" repository (bare repository) */
  readonly origin: string;
  /** The clone repository (working copy) */
  readonly clone: string;
  /** Function to run jj commands in the clone */
  readonly runJj: (
    ...args: ReadonlyArray<string>
  ) => Effect.Effect<string, Error, CommandExecutor.CommandExecutor>;
}

/**
 * Run a jj command in a specific directory.
 *
 * @param cwd - Working directory for the command
 * @param args - Arguments to pass to jj
 * @returns The command output
 */
export const runJj = (
  cwd: string,
  ...args: ReadonlyArray<string>
): Effect.Effect<string, Error, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor;
    // Use sh -c to run jj with proper stderr capture
    const escapedArgs = args.map((arg) => `'${arg.replace(/'/g, "'\"'\"'")}'`).join(" ");
    const cmd = Command.make("sh", "-c", `jj ${escapedArgs} 2>&1`).pipe(
      Command.workingDirectory(cwd),
    );
    return yield* Command.string(cmd).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
    );
  }).pipe(
    Effect.mapError((e) => new Error(`jj command failed: ${e}`)),
  );

/**
 * Run a git command in a specific directory.
 *
 * @param cwd - Working directory for the command
 * @param args - Arguments to pass to git
 * @returns The command output
 */
export const runGit = (
  cwd: string,
  ...args: ReadonlyArray<string>
): Effect.Effect<string, Error, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor;
    const cmd = Command.make("git", ...args).pipe(
      Command.workingDirectory(cwd),
    );
    return yield* Command.string(cmd).pipe(
      Effect.provideService(CommandExecutor.CommandExecutor, executor),
    );
  }).pipe(
    Effect.mapError((e) => new Error(`git command failed: ${e}`)),
  );

/**
 * Create a fresh jj repository with controlled configuration.
 *
 * The repository is configured with:
 * - Test user email and name
 * - No user-specific jj configuration
 *
 * @returns Information about the created repository
 */
export const createTempJjRepo = (): Effect.Effect<
  TestRepo,
  Error,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  Effect.gen(function* () {
    const tmpDir = yield* createTempDir("ship-test-");

    // Initialize jj repository with git backend
    yield* runJj(tmpDir, "git", "init");

    // Configure test user (repository-scoped)
    yield* runJj(tmpDir, "config", "set", "--repo", "user.email", "test@example.com");
    yield* runJj(tmpDir, "config", "set", "--repo", "user.name", "Test User");

    // Return repo info with bound runJj function
    const boundRunJj = (...args: ReadonlyArray<string>) => runJj(tmpDir, ...args);

    return {
      path: tmpDir,
      runJj: boundRunJj,
    };
  });

/**
 * Create a commit in a jj repository.
 *
 * @param repoPath - Path to the repository
 * @param spec - Commit specification
 */
export const createCommit = (
  repoPath: string,
  spec: CommitSpec,
): Effect.Effect<void, Error, FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    // Create/modify files if specified
    if (spec.files) {
      for (const file of spec.files) {
        const filePath = path.join(repoPath, file.path);
        const dir = path.dirname(filePath);

        // Ensure directory exists
        const dirExists = yield* fs.exists(dir).pipe(
          Effect.catchAll(() => Effect.succeed(false)),
        );
        if (!dirExists) {
          yield* fs.makeDirectory(dir, { recursive: true });
        }

        yield* writeFile(filePath, file.content);
      }
    }

    // Create the commit
    yield* runJj(repoPath, "commit", "-m", spec.message);

    // Create bookmark if specified
    if (spec.bookmark) {
      yield* runJj(repoPath, "bookmark", "create", spec.bookmark, "-r", "@-");
    }
  });

/**
 * Create a jj repository with a preset commit history.
 *
 * @param commits - Array of commit specifications to create
 * @returns Information about the created repository
 */
export const createRepoWithHistory = (
  commits: ReadonlyArray<CommitSpec>,
): Effect.Effect<
  TestRepo,
  Error,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  Effect.gen(function* () {
    const repo = yield* createTempJjRepo();

    for (const commit of commits) {
      yield* createCommit(repo.path, commit);
    }

    return repo;
  });

/**
 * Create a jj repository with a remote for testing sync/push operations.
 *
 * Creates two repositories:
 * 1. An "origin" repository (initialized as a git repo that jj can push to)
 * 2. A "clone" repository that has origin as its remote
 *
 * @returns Information about both repositories
 */
export const createRepoWithRemote = (): Effect.Effect<
  TestRepoWithRemote,
  Error,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  Effect.gen(function* () {
    // Create origin as a bare git repository
    const originDir = yield* createTempDir("ship-origin-");
    yield* runGit(originDir, "init", "--bare");

    // Create clone as a jj repo with git backend
    const cloneDir = yield* createTempDir("ship-clone-");
    yield* runJj(cloneDir, "git", "clone", originDir, ".");

    // Configure test user in clone
    yield* runJj(cloneDir, "config", "set", "--repo", "user.email", "test@example.com");
    yield* runJj(cloneDir, "config", "set", "--repo", "user.name", "Test User");

    // Return repo info with bound runJj function
    const boundRunJj = (...args: ReadonlyArray<string>) => runJj(cloneDir, ...args);

    return {
      origin: originDir,
      clone: cloneDir,
      runJj: boundRunJj,
    };
  });

/**
 * Execute an effect with a temporary jj repository that is automatically cleaned up.
 *
 * @param use - Effect that uses the repository
 * @returns The result of the use effect
 */
export const withTempJjRepo = <A, E, R>(
  use: (repo: TestRepo) => Effect.Effect<A, E, R>,
): Effect.Effect<
  A,
  E | Error,
  R | FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  Effect.scoped(
    Effect.acquireRelease(
      createTempJjRepo(),
      (repo) => removeDir(repo.path).pipe(Effect.ignore),
    ).pipe(Effect.flatMap(use)),
  );

/**
 * Execute an effect with a temporary jj repository with remote.
 * Both origin and clone are automatically cleaned up.
 *
 * @param use - Effect that uses the repositories
 * @returns The result of the use effect
 */
export const withTempJjRepoWithRemote = <A, E, R>(
  use: (repos: TestRepoWithRemote) => Effect.Effect<A, E, R>,
): Effect.Effect<
  A,
  E | Error,
  R | FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  Effect.scoped(
    Effect.acquireRelease(
      createRepoWithRemote(),
      (repos) =>
        Effect.all([
          removeDir(repos.origin),
          removeDir(repos.clone),
        ]).pipe(Effect.ignore),
    ).pipe(Effect.flatMap(use)),
  );

/**
 * Get the current change ID from a jj repository.
 *
 * @param repoPath - Path to the repository
 * @returns The current change ID
 */
export const getCurrentChangeId = (
  repoPath: string,
): Effect.Effect<string, Error, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const output = yield* runJj(repoPath, "log", "-r", "@", "-T", "change_id", "--no-graph");
    return output.trim();
  });

/**
 * Get the list of bookmarks from a jj repository.
 *
 * @param repoPath - Path to the repository
 * @returns Array of bookmark names
 */
export const getBookmarks = (
  repoPath: string,
): Effect.Effect<ReadonlyArray<string>, Error, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const output = yield* runJj(repoPath, "bookmark", "list", "-T", 'name ++ "\\n"');
    return output.trim().split("\n").filter(Boolean);
  });
