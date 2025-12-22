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
} from "../domain/Errors.js";

/** Union of all VCS error types */
export type VcsErrors =
  | VcsError
  | NotARepoError
  | JjConflictError
  | JjPushError
  | JjFetchError
  | JjBookmarkError
  | JjRevisionError;

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

export class SyncResult extends Schema.Class<SyncResult>("SyncResult")({
  fetched: Schema.Boolean,
  rebased: Schema.Boolean,
  /** Short change ID of trunk for display */
  trunkChangeId: Schema.String,
  stackSize: Schema.Number,
  conflicted: Schema.Boolean,
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
   * @param destination - The destination to rebase onto (default: "main")
   */
  readonly rebase: (source: ChangeId, destination?: string) => Effect.Effect<void, VcsErrors>;

  /**
   * Sync with remote: fetch and rebase stack onto trunk
   * This is the high-level operation that agents should use after PRs merge
   */
  readonly sync: () => Effect.Effect<SyncResult, VcsErrors>;

  /**
   * Get parent change of current working copy
   * Returns null if current change is on trunk (no parent in stack)
   */
  readonly getParentChange: () => Effect.Effect<Change | null, VcsErrors>;
}

export const VcsService = Context.GenericTag<VcsService>("VcsService");
