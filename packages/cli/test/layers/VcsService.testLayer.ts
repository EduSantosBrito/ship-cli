/**
 * Test Layer for VcsService
 *
 * Provides a mock VcsService implementation for testing that:
 * - Uses in-memory state via Effect Ref
 * - Supports configurable initial state
 * - Exposes _getState() for test assertions
 * - Can simulate both success and failure modes
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type { VcsService as VcsServiceInterface } from "../../src/ports/VcsService.js";
import {
  VcsService,
  Change,
  ChangeId,
  PushResult,
  TrunkInfo,
  SyncResult,
  WorkspaceInfo,
  UndoResult,
  UpdateStaleResult,
} from "../../src/ports/VcsService.js";
import {
  VcsError,
  JjNotInstalledError,
  NotARepoError,
  JjConflictError,
  JjPushError,
  JjFetchError,
  JjBookmarkError,
  JjRevisionError,
  JjSquashError,
  JjImmutableError,
  JjStaleWorkingCopyError,
  WorkspaceExistsError,
  WorkspaceNotFoundError,
} from "../../src/domain/Errors.js";

// === Test State Types ===

export interface TestVcsState {
  /** Map of change ID to Change objects */
  changes: Map<string, Change>;
  /** Current working copy change ID */
  currentChangeId: string;
  /** Whether current directory is a jj repo */
  isRepo: boolean;
  /** Whether jj CLI is available */
  isAvailable: boolean;
  /** Whether working copy has conflicts */
  hasConflicts: boolean;
  /** Whether working copy is stale */
  staleWorkingCopy: boolean;
  /** List of workspace infos */
  workspaces: WorkspaceInfo[];
  /** Current workspace name */
  currentWorkspaceName: string;
  /** Default branch name */
  defaultBranch: string;
  /** Simulated push errors (bookmark name -> error) */
  pushErrors: Map<string, JjPushError>;
  /** Simulated fetch error */
  fetchError: JjFetchError | null;
  /** Simulated immutable change IDs */
  immutableChangeIds: Set<string>;
  /** Simulated bookmark errors (name -> error) */
  bookmarkErrors: Map<string, JjBookmarkError>;
  /** Track method calls for assertions */
  methodCalls: Array<{ method: string; args: unknown[] }>;
}

export const defaultTestVcsState: TestVcsState = {
  changes: new Map([
    [
      "test-change-id",
      new Change({
        id: "test-change-id" as ChangeId,
        changeId: "testchng",
        description: "Test change",
        author: "test@example.com",
        timestamp: new Date("2024-01-15T10:00:00Z"),
        bookmarks: [],
        isWorkingCopy: true,
        isEmpty: false,
        hasConflict: false,
      }),
    ],
  ]),
  currentChangeId: "test-change-id",
  isRepo: true,
  isAvailable: true,
  hasConflicts: false,
  staleWorkingCopy: false,
  workspaces: [
    new WorkspaceInfo({
      name: "default",
      path: "/test/repo",
      changeId: "test-change-id",
      shortChangeId: "testchng",
      description: "Test change",
      isDefault: true,
    }),
  ],
  currentWorkspaceName: "default",
  defaultBranch: "main",
  pushErrors: new Map(),
  fetchError: null,
  immutableChangeIds: new Set(),
  bookmarkErrors: new Map(),
  methodCalls: [],
};

// === Test Layer Factory ===

/**
 * Creates a test VcsService layer with configurable initial state.
 *
 * @example
 * ```typescript
 * it.effect("fails when not in repo", () =>
 *   Effect.gen(function* () {
 *     const vcs = yield* VcsService;
 *     const exit = yield* Effect.exit(vcs.createChange("test"));
 *     expect(exit).toEqual(Exit.fail(NotARepoError.default));
 *   }).pipe(Effect.provide(TestVcsServiceLayer({ isRepo: false })))
 * );
 * ```
 */
export const TestVcsServiceLayer = (
  config?: Partial<TestVcsState>,
): Layer.Layer<VcsService> =>
  Layer.effect(
    VcsService,
    Effect.gen(function* () {
      const initialState: TestVcsState = {
        ...defaultTestVcsState,
        ...config,
        changes: config?.changes ?? new Map(defaultTestVcsState.changes),
        pushErrors: config?.pushErrors ?? new Map(),
        immutableChangeIds: config?.immutableChangeIds ?? new Set(),
        bookmarkErrors: config?.bookmarkErrors ?? new Map(),
        methodCalls: [],
      };

      const stateRef = yield* Ref.make(initialState);

      const trackCall = (method: string, args: unknown[]) =>
        Ref.update(stateRef, (state) => ({
          ...state,
          methodCalls: [...state.methodCalls, { method, args }],
        }));

      const checkAvailable = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (!state.isAvailable) {
          return yield* Effect.fail(JjNotInstalledError.default);
        }
      });

      const checkRepo = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (!state.isRepo) {
          return yield* Effect.fail(NotARepoError.default);
        }
      });

      const checkStale = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.staleWorkingCopy) {
          return yield* Effect.fail(JjStaleWorkingCopyError.default);
        }
      });

      const checkConflicts = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.hasConflicts) {
          return yield* Effect.fail(
            new JjConflictError({
              message: "Working copy has conflicts",
              conflictedPaths: ["test/conflicted-file.ts"],
            }),
          );
        }
      });

      const getCurrentChange = () =>
        Effect.gen(function* () {
          yield* checkRepo;
          const state = yield* Ref.get(stateRef);
          const change = state.changes.get(state.currentChangeId);
          if (!change) {
            return yield* Effect.fail(
              new VcsError({ message: "Current change not found in test state" }),
            );
          }
          return change;
        });

      const service: VcsServiceInterface = {
        isAvailable: () =>
          Effect.gen(function* () {
            yield* trackCall("isAvailable", []);
            const state = yield* Ref.get(stateRef);
            return state.isAvailable;
          }),

        isRepo: () =>
          Effect.gen(function* () {
            yield* trackCall("isRepo", []);
            const state = yield* Ref.get(stateRef);
            return state.isRepo;
          }),

        createChange: (message: string) =>
          Effect.gen(function* () {
            yield* trackCall("createChange", [message]);
            yield* checkAvailable;
            yield* checkRepo;
            yield* checkStale;
            yield* checkConflicts;

            const newId = `new-change-${Date.now()}` as ChangeId;
            const newChange = new Change({
              id: newId,
              changeId: newId.slice(0, 8),
              description: message,
              author: "test@example.com",
              timestamp: new Date(),
              bookmarks: [],
              isWorkingCopy: true,
              isEmpty: true,
              hasConflict: false,
            });

            yield* Ref.update(stateRef, (state) => {
              const changes = new Map(state.changes);
              // Mark old working copy as not working copy
              const oldChange = changes.get(state.currentChangeId);
              if (oldChange) {
                changes.set(
                  state.currentChangeId,
                  new Change({ ...oldChange, isWorkingCopy: false }),
                );
              }
              changes.set(newId, newChange);
              return { ...state, changes, currentChangeId: newId };
            });

            return newId;
          }),

        describe: (message: string) =>
          Effect.gen(function* () {
            yield* trackCall("describe", [message]);
            yield* checkRepo;
            yield* checkStale;

            yield* Ref.update(stateRef, (state) => {
              const changes = new Map(state.changes);
              const change = changes.get(state.currentChangeId);
              if (change) {
                changes.set(
                  state.currentChangeId,
                  new Change({ ...change, description: message }),
                );
              }
              return { ...state, changes };
            });
          }),

        commit: (message: string) =>
          Effect.gen(function* () {
            yield* trackCall("commit", [message]);
            yield* checkRepo;
            yield* checkStale;

            const state = yield* Ref.get(stateRef);
            const newId = `committed-${Date.now()}` as ChangeId;

            yield* Ref.update(stateRef, (s) => {
              const changes = new Map(s.changes);
              const oldChange = changes.get(s.currentChangeId);
              if (oldChange) {
                changes.set(
                  s.currentChangeId,
                  new Change({ ...oldChange, description: message, isWorkingCopy: false }),
                );
              }
              changes.set(
                newId,
                new Change({
                  id: newId,
                  changeId: newId.slice(0, 8),
                  description: "",
                  author: "test@example.com",
                  timestamp: new Date(),
                  bookmarks: [],
                  isWorkingCopy: true,
                  isEmpty: true,
                  hasConflict: false,
                }),
              );
              return { ...s, changes, currentChangeId: newId };
            });

            return state.currentChangeId as ChangeId;
          }),

        createBookmark: (name: string, ref?: ChangeId) =>
          Effect.gen(function* () {
            yield* trackCall("createBookmark", [name, ref]);
            yield* checkRepo;
            yield* checkStale;

            const state = yield* Ref.get(stateRef);
            const bookmarkError = state.bookmarkErrors.get(name);
            if (bookmarkError) {
              return yield* Effect.fail(bookmarkError);
            }

            const targetId = ref ?? state.currentChangeId;
            yield* Ref.update(stateRef, (s) => {
              const changes = new Map(s.changes);
              const change = changes.get(targetId);
              if (change) {
                changes.set(
                  targetId,
                  new Change({
                    ...change,
                    bookmarks: [...change.bookmarks, name],
                  }),
                );
              }
              return { ...s, changes };
            });
          }),

        moveBookmark: (name: string, ref?: ChangeId) =>
          Effect.gen(function* () {
            yield* trackCall("moveBookmark", [name, ref]);
            yield* checkRepo;
            yield* checkStale;

            const state = yield* Ref.get(stateRef);
            const targetId = ref ?? state.currentChangeId;

            yield* Ref.update(stateRef, (s) => {
              const changes = new Map(s.changes);
              // Remove bookmark from all changes
              for (const [id, change] of changes) {
                if (change.bookmarks.includes(name)) {
                  changes.set(
                    id,
                    new Change({
                      ...change,
                      bookmarks: change.bookmarks.filter((b) => b !== name),
                    }),
                  );
                }
              }
              // Add bookmark to target
              const targetChange = changes.get(targetId);
              if (targetChange) {
                changes.set(
                  targetId,
                  new Change({
                    ...targetChange,
                    bookmarks: [...targetChange.bookmarks, name],
                  }),
                );
              }
              return { ...s, changes };
            });
          }),

        deleteBookmark: (name: string) =>
          Effect.gen(function* () {
            yield* trackCall("deleteBookmark", [name]);
            yield* checkRepo;

            yield* Ref.update(stateRef, (s) => {
              const changes = new Map(s.changes);
              for (const [id, change] of changes) {
                if (change.bookmarks.includes(name)) {
                  changes.set(
                    id,
                    new Change({
                      ...change,
                      bookmarks: change.bookmarks.filter((b) => b !== name),
                    }),
                  );
                }
              }
              return { ...s, changes };
            });
          }),

        push: (bookmark: string) =>
          Effect.gen(function* () {
            yield* trackCall("push", [bookmark]);
            yield* checkRepo;
            yield* checkStale;

            const state = yield* Ref.get(stateRef);
            const pushError = state.pushErrors.get(bookmark);
            if (pushError) {
              return yield* Effect.fail(pushError);
            }

            return new PushResult({
              bookmark,
              remote: "origin",
              changeId: state.currentChangeId as ChangeId,
            });
          }),

        getCurrentChange,

        getStack: () =>
          Effect.gen(function* () {
            yield* trackCall("getStack", []);
            yield* checkRepo;

            const state = yield* Ref.get(stateRef);
            return Array.from(state.changes.values());
          }),

        getLog: (revset?: string) =>
          Effect.gen(function* () {
            yield* trackCall("getLog", [revset]);
            yield* checkRepo;

            const state = yield* Ref.get(stateRef);
            return Array.from(state.changes.values());
          }),

        fetch: () =>
          Effect.gen(function* () {
            yield* trackCall("fetch", []);
            yield* checkRepo;

            const state = yield* Ref.get(stateRef);
            if (state.fetchError) {
              return yield* Effect.fail(state.fetchError);
            }
          }),

        getTrunkInfo: () =>
          Effect.gen(function* () {
            yield* trackCall("getTrunkInfo", []);
            yield* checkRepo;

            const state = yield* Ref.get(stateRef);
            return new TrunkInfo({
              id: "trunk-change-id" as ChangeId,
              shortChangeId: "trunkchg",
              description: `trunk (${state.defaultBranch})`,
            });
          }),

        rebase: (source: ChangeId, destination: string) =>
          Effect.gen(function* () {
            yield* trackCall("rebase", [source, destination]);
            yield* checkRepo;
            yield* checkStale;

            const state = yield* Ref.get(stateRef);
            if (state.immutableChangeIds.has(source)) {
              return yield* Effect.fail(
                new JjImmutableError({
                  message: `Cannot rebase immutable commit ${source}`,
                  commitId: source,
                }),
              );
            }
          }),

        sync: (defaultBranch: string) =>
          Effect.gen(function* () {
            yield* trackCall("sync", [defaultBranch]);
            yield* checkRepo;

            const state = yield* Ref.get(stateRef);
            if (state.fetchError) {
              return yield* Effect.fail(state.fetchError);
            }

            return new SyncResult({
              fetched: true,
              rebased: true,
              trunkChangeId: "trunkchg",
              stackSize: state.changes.size,
              conflicted: state.hasConflicts,
              abandonedMergedChanges: [],
              stackFullyMerged: false,
            });
          }),

        getParentChange: () =>
          Effect.gen(function* () {
            yield* trackCall("getParentChange", []);
            yield* checkRepo;

            const state = yield* Ref.get(stateRef);
            const changes = Array.from(state.changes.values());
            const currentIdx = changes.findIndex((c) => c.id === state.currentChangeId);
            if (currentIdx > 0) {
              return changes[currentIdx - 1];
            }
            return null;
          }),

        squash: (message: string) =>
          Effect.gen(function* () {
            yield* trackCall("squash", [message]);
            yield* checkRepo;
            yield* checkStale;

            const state = yield* Ref.get(stateRef);
            const changes = Array.from(state.changes.values());
            const currentIdx = changes.findIndex((c) => c.id === state.currentChangeId);

            if (currentIdx <= 0) {
              return yield* Effect.fail(
                new JjSquashError({
                  message: "Cannot squash: no parent commit",
                }),
              );
            }

            const parent = changes[currentIdx - 1];
            yield* Ref.update(stateRef, (s) => {
              const newChanges = new Map(s.changes);
              newChanges.delete(s.currentChangeId);
              newChanges.set(
                parent.id,
                new Change({
                  ...parent,
                  description: message,
                  isWorkingCopy: true,
                }),
              );
              return { ...s, changes: newChanges, currentChangeId: parent.id };
            });

            return parent;
          }),

        abandon: (changeId?: string) =>
          Effect.gen(function* () {
            yield* trackCall("abandon", [changeId]);
            yield* checkRepo;
            yield* checkStale;

            const state = yield* Ref.get(stateRef);
            const targetId = changeId ?? state.currentChangeId;

            if (state.immutableChangeIds.has(targetId)) {
              return yield* Effect.fail(
                new JjImmutableError({
                  message: `Cannot abandon immutable commit ${targetId}`,
                  commitId: targetId,
                }),
              );
            }

            const changes = Array.from(state.changes.values());
            const targetIdx = changes.findIndex((c) => c.id === targetId);
            if (targetIdx < 0) {
              return yield* Effect.fail(
                new JjRevisionError({
                  message: `Revision not found: ${targetId}`,
                  revision: targetId,
                }),
              );
            }

            yield* Ref.update(stateRef, (s) => {
              const newChanges = new Map(s.changes);
              newChanges.delete(targetId);
              const remaining = Array.from(newChanges.values());
              const newCurrentId = remaining.length > 0 ? remaining[remaining.length - 1].id : "";
              return { ...s, changes: newChanges, currentChangeId: newCurrentId };
            });

            const newState = yield* Ref.get(stateRef);
            const newCurrent = newState.changes.get(newState.currentChangeId);
            if (!newCurrent) {
              return new Change({
                id: "empty-change" as ChangeId,
                changeId: "emptychg",
                description: "",
                author: "test@example.com",
                timestamp: new Date(),
                bookmarks: [],
                isWorkingCopy: true,
                isEmpty: true,
                hasConflict: false,
              });
            }
            return newCurrent;
          }),

        createWorkspace: (name: string, path: string, revision?: string) =>
          Effect.gen(function* () {
            yield* trackCall("createWorkspace", [name, path, revision]);
            yield* checkRepo;

            const state = yield* Ref.get(stateRef);
            if (state.workspaces.some((w) => w.name === name)) {
              return yield* Effect.fail(WorkspaceExistsError.forName(name, path));
            }

            const newWorkspace = new WorkspaceInfo({
              name,
              path,
              changeId: revision ?? state.currentChangeId,
              shortChangeId: (revision ?? state.currentChangeId).slice(0, 8),
              description: "New workspace",
              isDefault: false,
            });

            yield* Ref.update(stateRef, (s) => ({
              ...s,
              workspaces: [...s.workspaces, newWorkspace],
            }));

            return newWorkspace;
          }),

        listWorkspaces: () =>
          Effect.gen(function* () {
            yield* trackCall("listWorkspaces", []);
            yield* checkRepo;

            const state = yield* Ref.get(stateRef);
            return state.workspaces;
          }),

        forgetWorkspace: (name: string) =>
          Effect.gen(function* () {
            yield* trackCall("forgetWorkspace", [name]);
            yield* checkRepo;

            const state = yield* Ref.get(stateRef);
            if (!state.workspaces.some((w) => w.name === name)) {
              return yield* Effect.fail(WorkspaceNotFoundError.forName(name));
            }

            yield* Ref.update(stateRef, (s) => ({
              ...s,
              workspaces: s.workspaces.filter((w) => w.name !== name),
            }));
          }),

        getWorkspaceRoot: () =>
          Effect.gen(function* () {
            yield* trackCall("getWorkspaceRoot", []);
            yield* checkRepo;

            const state = yield* Ref.get(stateRef);
            const workspace = state.workspaces.find(
              (w) => w.name === state.currentWorkspaceName,
            );
            return workspace?.path ?? "/test/repo";
          }),

        getCurrentWorkspaceName: () =>
          Effect.gen(function* () {
            yield* trackCall("getCurrentWorkspaceName", []);
            yield* checkRepo;

            const state = yield* Ref.get(stateRef);
            return state.currentWorkspaceName;
          }),

        isNonDefaultWorkspace: () =>
          Effect.gen(function* () {
            yield* trackCall("isNonDefaultWorkspace", []);
            yield* checkRepo;

            const state = yield* Ref.get(stateRef);
            return state.currentWorkspaceName !== "default";
          }),

        getChildChange: () =>
          Effect.gen(function* () {
            yield* trackCall("getChildChange", []);
            yield* checkRepo;

            const state = yield* Ref.get(stateRef);
            const changes = Array.from(state.changes.values());
            const currentIdx = changes.findIndex((c) => c.id === state.currentChangeId);
            if (currentIdx >= 0 && currentIdx < changes.length - 1) {
              return changes[currentIdx + 1];
            }
            return null;
          }),

        editChange: (changeId: ChangeId) =>
          Effect.gen(function* () {
            yield* trackCall("editChange", [changeId]);
            yield* checkRepo;
            yield* checkStale;

            const state = yield* Ref.get(stateRef);
            if (state.immutableChangeIds.has(changeId)) {
              return yield* Effect.fail(
                new JjImmutableError({
                  message: `Cannot edit immutable commit ${changeId}`,
                  commitId: changeId,
                }),
              );
            }

            if (!state.changes.has(changeId)) {
              return yield* Effect.fail(
                new JjRevisionError({
                  message: `Revision not found: ${changeId}`,
                  revision: changeId,
                }),
              );
            }

            yield* Ref.update(stateRef, (s) => {
              const changes = new Map(s.changes);
              // Update isWorkingCopy flags
              for (const [id, change] of changes) {
                changes.set(
                  id,
                  new Change({ ...change, isWorkingCopy: id === changeId }),
                );
              }
              return { ...s, changes, currentChangeId: changeId };
            });
          }),

        undo: () =>
          Effect.gen(function* () {
            yield* trackCall("undo", []);
            yield* checkRepo;

            return new UndoResult({
              undone: true,
              operation: "test operation",
            });
          }),

        updateStaleWorkspace: () =>
          Effect.gen(function* () {
            yield* trackCall("updateStaleWorkspace", []);
            yield* checkRepo;

            const state = yield* Ref.get(stateRef);
            yield* Ref.update(stateRef, (s) => ({ ...s, staleWorkingCopy: false }));

            return new UpdateStaleResult({
              updated: state.staleWorkingCopy,
              changeId: state.currentChangeId,
            });
          }),
      };

      // Attach state accessor for test assertions
      return Object.assign(service, {
        _getState: () => Ref.get(stateRef),
        _setState: (update: Partial<TestVcsState>) =>
          Ref.update(stateRef, (s) => ({ ...s, ...update })),
      });
    }),
  );

// Type for the extended service with test helpers
export type TestVcsService = VcsServiceInterface & {
  _getState: () => Effect.Effect<TestVcsState>;
  _setState: (update: Partial<TestVcsState>) => Effect.Effect<void>;
};
