import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  JjNotInstalledError,
  VcsError,
  NotARepoError,
  JjConflictError,
  JjPushError,
  JjFetchError,
  JjBookmarkError,
  JjRevisionError,
  JjSquashError,
  JjImmutableError,
  JjStaleWorkingCopyError,
  WorkspaceError,
  WorkspaceExistsError,
  WorkspaceNotFoundError,
} from "../domain/Errors.js";

/** Union of all VCS error types */
export type VcsErrors =
  | VcsError
  | NotARepoError
  | JjConflictError
  | JjPushError
  | JjFetchError
  | JjBookmarkError
  | JjRevisionError
  | JjSquashError
  | JjImmutableError
  | JjStaleWorkingCopyError
  | WorkspaceError
  | WorkspaceExistsError
  | WorkspaceNotFoundError;

// === VCS Domain Types ===

export const ChangeId = Schema.String.pipe(Schema.brand("ChangeId"));
export type ChangeId = typeof ChangeId.Type;

export class Change extends Schema.Class<Change>("Change")({
  id: ChangeId,
  changeId: Schema.String, // Short change id
  description: Schema.String,
  author: Schema.String,
  timestamp: Schema.Date,
  bookmarks: Schema.Array(Schema.String),
  isWorkingCopy: Schema.Boolean,
  isEmpty: Schema.Boolean,
  /** Whether this change has unresolved merge conflicts */
  hasConflict: Schema.Boolean,
}) {}

export class PushResult extends Schema.Class<PushResult>("PushResult")({
  bookmark: Schema.String,
  remote: Schema.String,
  changeId: ChangeId,
}) {}

export class TrunkInfo extends Schema.Class<TrunkInfo>("TrunkInfo")({
  /** Full change ID (branded) */
  id: ChangeId,
  /** Short change ID for display (e.g., "abc12345") */
  shortChangeId: Schema.String,
  description: Schema.String,
}) {}

/** Information about a change that was auto-abandoned during sync */
export class AbandonedMergedChange extends Schema.Class<AbandonedMergedChange>(
  "AbandonedMergedChange",
)({
  /** Short change ID that was abandoned */
  changeId: Schema.String,
  /** Bookmark associated with the abandoned change */
  bookmark: Schema.optional(Schema.String),
}) {}

export class SyncResult extends Schema.Class<SyncResult>("SyncResult")({
  fetched: Schema.Boolean,
  rebased: Schema.Boolean,
  /** Short change ID of trunk for display */
  trunkChangeId: Schema.String,
  stackSize: Schema.Number,
  conflicted: Schema.Boolean,
  /**
   * Changes that were auto-abandoned because they became empty after rebase
   * (their content is now in trunk, indicating they were merged)
   */
  abandonedMergedChanges: Schema.optionalWith(Schema.Array(AbandonedMergedChange), {
    default: () => [],
  }),
  /**
   * Whether the entire stack was merged and workspace cleanup was triggered.
   * Only true when all changes were abandoned and the stack is now empty.
   */
  stackFullyMerged: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}

/** Information about a jj workspace */
export class WorkspaceInfo extends Schema.Class<WorkspaceInfo>("WorkspaceInfo")({
  /** Workspace name (e.g., "default", "feature-x") */
  name: Schema.String,
  /** Absolute path to the workspace directory */
  path: Schema.String,
  /** Current change ID in this workspace */
  changeId: Schema.String,
  /** Short change ID for display */
  shortChangeId: Schema.String,
  /** Description of the current change */
  description: Schema.String,
  /** True if this is the default workspace */
  isDefault: Schema.Boolean,
}) {}

export interface VcsService {
  /**
   * Check if jj is available
   */
  readonly isAvailable: () => Effect.Effect<boolean, never>;

  /**
   * Check if current directory is a jj repo
   */
  readonly isRepo: () => Effect.Effect<boolean, VcsErrors>;

  /**
   * Create a new change (jj new)
   */
  readonly createChange: (
    message: string,
  ) => Effect.Effect<ChangeId, JjNotInstalledError | VcsErrors>;

  /**
   * Describe/update current change message
   */
  readonly describe: (message: string) => Effect.Effect<void, VcsErrors>;

  /**
   * Commit (jj commit) - creates new empty change on top
   */
  readonly commit: (message: string) => Effect.Effect<ChangeId, VcsErrors>;

  /**
   * Create a bookmark at current change
   */
  readonly createBookmark: (name: string, ref?: ChangeId) => Effect.Effect<void, VcsErrors>;

  /**
   * Move an existing bookmark to the current change (or specified revision)
   * @param name - Bookmark name to move
   * @param ref - Optional revision to move to (defaults to current @)
   */
  readonly moveBookmark: (name: string, ref?: ChangeId) => Effect.Effect<void, VcsErrors>;

  /**
   * Delete a local bookmark
   * @param name - Bookmark name to delete
   */
  readonly deleteBookmark: (name: string) => Effect.Effect<void, VcsErrors>;

  /**
   * Push bookmark to remote
   */
  readonly push: (bookmark: string) => Effect.Effect<PushResult, VcsErrors>;

  /**
   * Get current change
   */
  readonly getCurrentChange: () => Effect.Effect<Change, VcsErrors>;

  /**
   * Get the stack of changes (from main to current)
   */
  readonly getStack: () => Effect.Effect<ReadonlyArray<Change>, VcsErrors>;

  /**
   * Get log of changes
   */
  readonly getLog: (revset?: string) => Effect.Effect<ReadonlyArray<Change>, VcsErrors>;

  /**
   * Fetch from remote
   */
  readonly fetch: () => Effect.Effect<void, VcsErrors>;

  /**
   * Get trunk (main branch) info
   */
  readonly getTrunkInfo: () => Effect.Effect<TrunkInfo, VcsErrors>;

  /**
   * Rebase changes onto a destination
   * @param source - The first change to rebase (and its descendants)
   * @param destination - The destination to rebase onto (required - use config.git.defaultBranch for default)
   */
  readonly rebase: (source: ChangeId, destination: string) => Effect.Effect<void, VcsErrors>;

  /**
   * Sync with remote: fetch and rebase stack onto trunk
   * This is the high-level operation that agents should use after PRs merge
   * @param defaultBranch - The trunk branch to rebase onto (use config.git.defaultBranch)
   */
  readonly sync: (defaultBranch: string) => Effect.Effect<SyncResult, VcsErrors>;

  /**
   * Get parent change of current working copy
   * Returns null if current change is on trunk (no parent in stack)
   */
  readonly getParentChange: () => Effect.Effect<Change | null, VcsErrors>;

  /**
   * Squash current change into its parent
   * @param message - Message for the combined change (required to avoid editor)
   * @returns The parent change (now containing squashed content)
   */
  readonly squash: (message: string) => Effect.Effect<Change, VcsErrors>;

  /**
   * Abandon a change (removes it from history)
   * @param changeId - Optional change ID to abandon (defaults to current @).
   *                   jj validates the change ID and returns an error if invalid.
   * @returns The new working copy change after abandonment
   */
  readonly abandon: (changeId?: string) => Effect.Effect<Change, VcsErrors>;

  // === Workspace Operations (jj workspace) ===

  /**
   * Create a new jj workspace
   * @param name - Workspace name (used for identification)
   * @param path - Path where workspace will be created
   * @param revision - Optional revision to checkout (defaults to parent of current @)
   * @returns Information about the created workspace
   */
  readonly createWorkspace: (
    name: string,
    path: string,
    revision?: string,
  ) => Effect.Effect<WorkspaceInfo, VcsErrors>;

  /**
   * List all workspaces in the repository
   * @returns Array of workspace information
   */
  readonly listWorkspaces: () => Effect.Effect<ReadonlyArray<WorkspaceInfo>, VcsErrors>;

  /**
   * Forget a workspace (stop tracking it, files remain on disk)
   * @param name - Workspace name to forget
   */
  readonly forgetWorkspace: (name: string) => Effect.Effect<void, VcsErrors>;

  /**
   * Get the root path of current workspace
   * @returns Absolute path to the workspace root
   */
  readonly getWorkspaceRoot: () => Effect.Effect<string, VcsErrors>;

  /**
   * Get the current workspace name
   * @returns Name of the current workspace (e.g., "default", "feature-x")
   */
  readonly getCurrentWorkspaceName: () => Effect.Effect<string, VcsErrors>;

  /**
   * Check if current directory is in a non-default workspace
   * @returns True if in a non-default workspace
   */
  readonly isNonDefaultWorkspace: () => Effect.Effect<boolean, VcsErrors>;

  // === Stack Navigation ===

  /**
   * Get child change of current working copy (toward the tip of the stack)
   * Returns null if current change has no children in the stack
   */
  readonly getChildChange: () => Effect.Effect<Change | null, VcsErrors>;

  /**
   * Edit a specific change (make it the working copy)
   * This is equivalent to `jj edit <changeId>`
   * @param changeId - The change ID to edit
   */
  readonly editChange: (changeId: ChangeId) => Effect.Effect<void, VcsErrors>;

  // === Recovery Operations ===

  /**
   * Undo the last jj operation
   * This is equivalent to `jj undo`
   * @returns Information about the undone operation
   */
  readonly undo: () => Effect.Effect<UndoResult, VcsErrors>;

  /**
   * Update a stale working copy
   * This is equivalent to `jj workspace update-stale`
   * Use this when the working copy becomes stale after operations in another workspace
   * or after remote changes (e.g., PR merge via CI)
   * @returns Information about the update
   */
  readonly updateStaleWorkspace: () => Effect.Effect<UpdateStaleResult, VcsErrors>;
}

/** Result of an undo operation */
export class UndoResult extends Schema.Class<UndoResult>("UndoResult")({
  /** Whether the undo was successful */
  undone: Schema.Boolean,
  /** Description of the operation that was undone (if available) */
  operation: Schema.optional(Schema.String),
}) {}

/** Result of updating a stale workspace */
export class UpdateStaleResult extends Schema.Class<UpdateStaleResult>("UpdateStaleResult")({
  /** Whether the update was performed */
  updated: Schema.Boolean,
  /** The new working copy change ID after update */
  changeId: Schema.optional(Schema.String),
}) {}

export const VcsService = Context.GenericTag<VcsService>("VcsService");
