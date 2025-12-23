import * as Schema from "effect/Schema";
import { ProjectId, TeamId } from "./Task.js";

// Personal API key from https://linear.app/settings/api
export class AuthConfig extends Schema.Class<AuthConfig>("AuthConfig")({
  apiKey: Schema.String,
}) {}

export class LinearConfig extends Schema.Class<LinearConfig>("LinearConfig")({
  teamId: TeamId,
  teamKey: Schema.String,
  projectId: Schema.OptionFromNullOr(ProjectId),
}) {}

export class GitConfig extends Schema.Class<GitConfig>("GitConfig")({
  defaultBranch: Schema.optionalWith(Schema.String, { default: () => "main" }),
}) {}

export class PrConfig extends Schema.Class<PrConfig>("PrConfig")({
  openBrowser: Schema.optionalWith(Schema.Boolean, { default: () => true }),
}) {}

export class CommitConfig extends Schema.Class<CommitConfig>("CommitConfig")({
  conventionalFormat: Schema.optionalWith(Schema.Boolean, { default: () => true }),
}) {}

export class WorkspaceConfig extends Schema.Class<WorkspaceConfig>("WorkspaceConfig")({
  /**
   * Base path pattern for workspaces.
   * Supports variables: {repo}, {stack}, {user}
   * @default ".ship/workspaces/{stack}"
   * @example ".ship/workspaces/bri-123-auth-feature"
   */
  basePath: Schema.optionalWith(Schema.String, { default: () => ".ship/workspaces/{stack}" }),

  /**
   * Whether to automatically cd into workspace after creation.
   * Note: CLI cannot actually change the user's shell directory,
   * but will output the cd command to run.
   * @default true
   */
  autoNavigate: Schema.optionalWith(Schema.Boolean, { default: () => true }),

  /**
   * Automatically clean up workspaces when stack is completed or abandoned.
   * @default true
   */
  autoCleanup: Schema.optionalWith(Schema.Boolean, { default: () => true }),
}) {}

export class ShipConfig extends Schema.Class<ShipConfig>("ShipConfig")({
  linear: LinearConfig,
  auth: AuthConfig,
  git: Schema.optionalWith(GitConfig, { default: () => new GitConfig({}) }),
  pr: Schema.optionalWith(PrConfig, { default: () => new PrConfig({}) }),
  commit: Schema.optionalWith(CommitConfig, { default: () => new CommitConfig({}) }),
  workspace: Schema.optionalWith(WorkspaceConfig, { default: () => new WorkspaceConfig({}) }),
}) {}

// Partial config for when we're initializing
export class PartialShipConfig extends Schema.Class<PartialShipConfig>("PartialShipConfig")({
  linear: Schema.OptionFromNullOr(LinearConfig),
  auth: Schema.OptionFromNullOr(AuthConfig),
  git: Schema.optionalWith(GitConfig, { default: () => new GitConfig({}) }),
  pr: Schema.optionalWith(PrConfig, { default: () => new PrConfig({}) }),
  commit: Schema.optionalWith(CommitConfig, { default: () => new CommitConfig({}) }),
  workspace: Schema.optionalWith(WorkspaceConfig, { default: () => new WorkspaceConfig({}) }),
}) {}

// === Workspace Metadata (stored in .ship/workspaces.json) ===

/**
 * Metadata for a single workspace created by ship.
 * Note: jj tracks workspaces itself, but we store additional metadata
 * like task associations here.
 */
export class WorkspaceMetadata extends Schema.Class<WorkspaceMetadata>("WorkspaceMetadata")({
  /** Workspace name (matches jj workspace name) */
  name: Schema.String,
  /** Absolute path to the workspace */
  path: Schema.String,
  /** Stack name/identifier (derived from bookmark or message) */
  stackName: Schema.String,
  /** Bookmark associated with this stack */
  bookmark: Schema.OptionFromNullOr(Schema.String),
  /** When the workspace was created */
  createdAt: Schema.Date,
  /** Linear task ID if associated */
  taskId: Schema.OptionFromNullOr(Schema.String),
}) {}

/**
 * Schema for .ship/workspaces.json file
 */
export class WorkspacesFile extends Schema.Class<WorkspacesFile>("WorkspacesFile")({
  workspaces: Schema.Array(WorkspaceMetadata),
}) {}

// === Workspace Path Resolution ===

/**
 * Variables available for workspace path pattern substitution
 */
export interface WorkspacePathVariables {
  /** Repository name (e.g., "ship-cli") */
  repo: string;
  /** Stack name (e.g., "bri-123-feature") */
  stack: string;
  /** Username (optional) */
  user?: string;
}

/**
 * Resolve a workspace path pattern to an actual path.
 *
 * @param pattern - Path pattern with variables like "{repo}", "{stack}", "{user}"
 * @param variables - Values to substitute into the pattern
 * @returns Resolved path string
 *
 * @example
 * resolveWorkspacePath("../{repo}-{stack}", { repo: "ship-cli", stack: "auth" })
 * // Returns: "../ship-cli-auth"
 */
export const resolveWorkspacePath = (
  pattern: string,
  variables: WorkspacePathVariables,
): string => {
  return pattern
    .replace(/{repo}/g, variables.repo)
    .replace(/{stack}/g, variables.stack)
    .replace(/{user}/g, variables.user ?? "");
};

// === Workspace Metadata I/O Utilities ===

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FileSystem from "@effect/platform/FileSystem";
import * as Path from "@effect/platform/Path";
import * as Duration from "effect/Duration";
import * as Schedule from "effect/Schedule";
import type { ConfigRepository } from "../ports/ConfigRepository.js";

// Lock file constants
const LOCK_FILE_NAME = "workspaces.lock";
const LOCK_STALE_TIMEOUT = Duration.seconds(30); // Consider lock stale after 30s
const LOCK_ACQUIRE_RETRY = Schedule.intersect(
  Schedule.exponential(Duration.millis(50)),
  Schedule.recurs(10), // Max ~5 seconds of retrying
);

/**
 * Acquire a file lock for workspace metadata operations.
 * Uses a simple lock file mechanism for cross-process synchronization.
 *
 * @returns A release function to call when done with the lock
 */
const acquireWorkspaceLock = (
  configRepo: ConfigRepository,
): Effect.Effect<
  () => Effect.Effect<void, never, FileSystem.FileSystem | Path.Path>,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const configDir = yield* configRepo.getConfigDir();
    const lockPath = pathService.join(configDir, LOCK_FILE_NAME);

    // Try to acquire the lock with retries
    yield* Effect.gen(function* () {
      // Check if lock file exists and is stale
      const lockExists = yield* fs.exists(lockPath);
      if (lockExists) {
        const stat = yield* fs.stat(lockPath).pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (stat) {
          // mtime is Option<Date>, extract with Option.getOrElse
          const mtime = Option.getOrElse(stat.mtime, () => new Date(0));
          const lockAge = Date.now() - mtime.getTime();
          if (lockAge > Duration.toMillis(LOCK_STALE_TIMEOUT)) {
            // Lock is stale, remove it
            yield* Effect.logDebug(`Removing stale lock file (age: ${lockAge}ms)`);
            yield* fs.remove(lockPath).pipe(Effect.catchAll(() => Effect.void));
          } else {
            // Lock is active, fail to trigger retry
            return yield* Effect.fail("Lock held by another process");
          }
        }
      }

      // Try to create the lock file exclusively
      // Write PID and timestamp for debugging
      const lockContent = JSON.stringify({ pid: process.pid, timestamp: Date.now() });
      yield* fs.writeFileString(lockPath, lockContent);
    }).pipe(
      Effect.retry(LOCK_ACQUIRE_RETRY),
      Effect.catchAll(() => Effect.void), // If we can't acquire, proceed anyway (best effort)
    );

    // Return release function
    const release = (): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
      fs.remove(lockPath).pipe(Effect.catchAll(() => Effect.void));

    return release;
  });

/**
 * Execute an operation with file locking to prevent concurrent access.
 *
 * @param operation - The operation to execute while holding the lock
 * @returns The result of the operation
 */
export const withWorkspaceLock = <A, E>(
  configRepo: ConfigRepository,
  operation: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
): Effect.Effect<A, E, FileSystem.FileSystem | Path.Path> =>
  Effect.acquireUseRelease(
    acquireWorkspaceLock(configRepo),
    () => operation,
    (release) => release(),
  );

/**
 * Load workspace metadata from .ship/workspaces.json with proper Schema validation.
 *
 * @returns The parsed WorkspacesFile or an empty WorkspacesFile if file doesn't exist or is invalid
 */
export const loadWorkspacesFile = (
  configRepo: ConfigRepository,
): Effect.Effect<WorkspacesFile, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const configDir = yield* configRepo.getConfigDir();
    const workspacesPath = path.join(configDir, "workspaces.json");

    const content = yield* fs
      .readFileString(workspacesPath)
      .pipe(Effect.catchAll(() => Effect.succeed("{}")));

    return yield* Effect.try(() => JSON.parse(content)).pipe(
      Effect.flatMap((parsed) => Schema.decodeUnknown(WorkspacesFile)(parsed)),
      Effect.catchAll(() => Effect.succeed(new WorkspacesFile({ workspaces: [] }))),
    );
  });

/**
 * Save workspace metadata to .ship/workspaces.json with proper Schema encoding.
 */
export const saveWorkspacesFile = (
  configRepo: ConfigRepository,
  workspacesFile: WorkspacesFile,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const configDir = yield* configRepo.getConfigDir();
    const workspacesPath = path.join(configDir, "workspaces.json");

    const encoded = Schema.encodeSync(WorkspacesFile)(workspacesFile);
    yield* fs.writeFileString(workspacesPath, JSON.stringify(encoded, null, 2));
  }).pipe(Effect.catchAll(() => Effect.void));

/**
 * Load workspace metadata with file locking (use for read-modify-write operations).
 */
export const loadWorkspacesFileWithLock = (
  configRepo: ConfigRepository,
): Effect.Effect<WorkspacesFile, never, FileSystem.FileSystem | Path.Path> =>
  withWorkspaceLock(configRepo, loadWorkspacesFile(configRepo));

/**
 * Save workspace metadata with file locking.
 */
export const saveWorkspacesFileWithLock = (
  configRepo: ConfigRepository,
  workspacesFile: WorkspacesFile,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  withWorkspaceLock(configRepo, saveWorkspacesFile(configRepo, workspacesFile));

/**
 * Atomically modify workspace metadata with file locking.
 * This is the safest way to update workspace metadata in concurrent scenarios.
 *
 * @param modify - Function to modify the workspaces file
 * @returns The result of the modification function
 */
export const modifyWorkspacesFile = <A>(
  configRepo: ConfigRepository,
  modify: (file: WorkspacesFile) => readonly [A, WorkspacesFile],
): Effect.Effect<A, never, FileSystem.FileSystem | Path.Path> =>
  withWorkspaceLock(
    configRepo,
    Effect.gen(function* () {
      const current = yield* loadWorkspacesFile(configRepo);
      const [result, updated] = modify(current);
      yield* saveWorkspacesFile(configRepo, updated);
      return result;
    }),
  );
