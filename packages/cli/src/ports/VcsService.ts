import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { JjNotInstalledError, VcsError } from "../domain/Errors.js";

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

export interface VcsService {
  /**
   * Check if jj is available
   */
  readonly isAvailable: () => Effect.Effect<boolean, never>;

  /**
   * Check if current directory is a jj repo
   */
  readonly isRepo: () => Effect.Effect<boolean, VcsError>;

  /**
   * Create a new change (jj new)
   */
  readonly createChange: (
    message: string,
  ) => Effect.Effect<ChangeId, JjNotInstalledError | VcsError>;

  /**
   * Describe/update current change message
   */
  readonly describe: (message: string) => Effect.Effect<void, VcsError>;

  /**
   * Commit (jj commit) - creates new empty change on top
   */
  readonly commit: (message: string) => Effect.Effect<ChangeId, VcsError>;

  /**
   * Create a bookmark at current change
   */
  readonly createBookmark: (name: string, ref?: ChangeId) => Effect.Effect<void, VcsError>;

  /**
   * Push bookmark to remote
   */
  readonly push: (bookmark: string) => Effect.Effect<PushResult, VcsError>;

  /**
   * Get current change
   */
  readonly getCurrentChange: () => Effect.Effect<Change, VcsError>;

  /**
   * Get the stack of changes (from main to current)
   */
  readonly getStack: () => Effect.Effect<ReadonlyArray<Change>, VcsError>;

  /**
   * Get log of changes
   */
  readonly getLog: (revset?: string) => Effect.Effect<ReadonlyArray<Change>, VcsError>;

  /**
   * Fetch from remote
   */
  readonly fetch: () => Effect.Effect<void, VcsError>;
}

export const VcsService = Context.GenericTag<VcsService>("VcsService");
