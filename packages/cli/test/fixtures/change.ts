/**
 * VCS Change fixtures for testing.
 *
 * Provides factory functions that produce valid VCS domain objects
 * with sensible defaults, supporting partial overrides.
 */

import { Schema } from "effect"
import {
  Change,
  ChangeId,
  PushResult,
  TrunkInfo,
  SyncResult,
  WorkspaceInfo,
  UndoResult,
  UpdateStaleResult,
  AbandonedMergedChange,
} from "../../src/ports/VcsService.js"

// === Change Fixtures ===

export interface ChangeInput {
  id?: ChangeId
  changeId?: string
  description?: string
  author?: string
  timestamp?: Date
  bookmarks?: string[]
  isWorkingCopy?: boolean
  isEmpty?: boolean
}

export const makeChange = (overrides: ChangeInput = {}): Change => {
  const changeIdValue = overrides.changeId ?? "abc12345"
  return new Change({
    id: (overrides.id ?? Schema.decodeSync(ChangeId)(changeIdValue)) as ChangeId,
    changeId: changeIdValue,
    description: overrides.description ?? "Test change description",
    author: overrides.author ?? "test@example.com",
    timestamp: overrides.timestamp ?? new Date("2024-01-01"),
    bookmarks: overrides.bookmarks ?? [],
    isWorkingCopy: overrides.isWorkingCopy ?? true,
    isEmpty: overrides.isEmpty ?? false,
  })
}

// === PushResult Fixtures ===

export interface PushResultInput {
  bookmark?: string
  remote?: string
  changeId?: ChangeId
}

export const makePushResult = (overrides: PushResultInput = {}): PushResult =>
  new PushResult({
    bookmark: overrides.bookmark ?? "user/test-bookmark",
    remote: overrides.remote ?? "origin",
    changeId: (overrides.changeId ??
      Schema.decodeSync(ChangeId)("abc12345")) as ChangeId,
  })

// === TrunkInfo Fixtures ===

export interface TrunkInfoInput {
  id?: ChangeId
  shortChangeId?: string
  description?: string
}

export const makeTrunkInfo = (overrides: TrunkInfoInput = {}): TrunkInfo =>
  new TrunkInfo({
    id: (overrides.id ??
      Schema.decodeSync(ChangeId)("trunk12345")) as ChangeId,
    shortChangeId: overrides.shortChangeId ?? "trunk123",
    description: overrides.description ?? "Trunk commit",
  })

// === SyncResult Fixtures ===

export interface SyncResultInput {
  fetched?: boolean
  rebased?: boolean
  trunkChangeId?: string
  stackSize?: number
  conflicted?: boolean
  abandonedMergedChanges?: AbandonedMergedChange[]
  stackFullyMerged?: boolean
}

export const makeSyncResult = (overrides: SyncResultInput = {}): SyncResult =>
  new SyncResult({
    fetched: overrides.fetched ?? true,
    rebased: overrides.rebased ?? true,
    trunkChangeId: overrides.trunkChangeId ?? "trunk123",
    stackSize: overrides.stackSize ?? 1,
    conflicted: overrides.conflicted ?? false,
    abandonedMergedChanges: overrides.abandonedMergedChanges ?? [],
    stackFullyMerged: overrides.stackFullyMerged ?? false,
  })

// === AbandonedMergedChange Fixtures ===

export interface AbandonedMergedChangeInput {
  changeId?: string
  bookmark?: string
}

export const makeAbandonedMergedChange = (
  overrides: AbandonedMergedChangeInput = {},
): AbandonedMergedChange =>
  new AbandonedMergedChange({
    changeId: overrides.changeId ?? "merged123",
    bookmark: overrides.bookmark,
  })

// === WorkspaceInfo Fixtures ===

export interface WorkspaceInfoInput {
  name?: string
  path?: string
  changeId?: string
  shortChangeId?: string
  description?: string
  isDefault?: boolean
}

export const makeWorkspaceInfo = (
  overrides: WorkspaceInfoInput = {},
): WorkspaceInfo =>
  new WorkspaceInfo({
    name: overrides.name ?? "default",
    path: overrides.path ?? "/path/to/workspace",
    changeId: overrides.changeId ?? "abc12345",
    shortChangeId: overrides.shortChangeId ?? "abc123",
    description: overrides.description ?? "Workspace description",
    isDefault: overrides.isDefault ?? true,
  })

// === UndoResult Fixtures ===

export interface UndoResultInput {
  undone?: boolean
  operation?: string
}

export const makeUndoResult = (overrides: UndoResultInput = {}): UndoResult =>
  new UndoResult({
    undone: overrides.undone ?? true,
    operation: overrides.operation,
  })

// === UpdateStaleResult Fixtures ===

export interface UpdateStaleResultInput {
  updated?: boolean
  changeId?: string
}

export const makeUpdateStaleResult = (
  overrides: UpdateStaleResultInput = {},
): UpdateStaleResult =>
  new UpdateStaleResult({
    updated: overrides.updated ?? true,
    changeId: overrides.changeId,
  })
