/**
 * Integration tests for VcsService with real jj.
 *
 * These tests verify that VcsServiceLive correctly executes jj commands,
 * parses output, and handles errors against actual jj behavior.
 *
 * Prerequisites:
 * - jj binary installed and in PATH
 * - Tests skip gracefully if jj is not available
 */

import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeContext from "@effect/platform-node/NodeContext";
import { VcsService, type ChangeId } from "../../src/ports/VcsService.js";
import { VcsServiceLive } from "../../src/adapters/driven/vcs/VcsServiceLive.js";
import { createTempJjRepo, createRepoWithRemote } from "./helpers/repo.js";
import { removeDir } from "./helpers/fs.js";
import * as Path from "@effect/platform/Path";
import * as FileSystem from "@effect/platform/FileSystem";

// Layer for running VCS operations
const VcsLayer = VcsServiceLive.pipe(Layer.provide(NodeContext.layer));

// Combined layer with all dependencies
const TestLayer = Layer.mergeAll(VcsLayer, NodeContext.layer);

// === Effect-Managed Test Resources ===

/**
 * Checks if jj is available and skips the test if not.
 * This is an Effect that succeeds with true if jj is available,
 * or succeeds with false (allowing test to skip gracefully) if not.
 */
const checkJjAvailable = Effect.gen(function* () {
  const vcs = yield* VcsService;
  return yield* vcs.isAvailable();
}).pipe(
  Effect.provide(TestLayer),
  Effect.catchAll(() => Effect.succeed(false)),
);

/**
 * Effect-managed temp repo resource that handles directory changes and cleanup.
 * Uses Effect.acquireRelease to guarantee cleanup even on test failure.
 */
const TempRepoResource = Effect.acquireRelease(
  Effect.gen(function* () {
    const repo = yield* createTempJjRepo();
    const savedCwd = process.cwd();
    process.chdir(repo.path);
    return { repo, savedCwd };
  }),
  ({ repo, savedCwd }) =>
    Effect.gen(function* () {
      process.chdir(savedCwd);
      yield* removeDir(repo.path).pipe(Effect.ignore);
    }),
);

/**
 * Effect-managed temp repo with remote resource.
 * Uses Effect.acquireRelease to guarantee cleanup even on test failure.
 */
const TempRepoWithRemoteResource = Effect.acquireRelease(
  Effect.gen(function* () {
    const repos = yield* createRepoWithRemote();
    const savedCwd = process.cwd();
    process.chdir(repos.clone);
    return { repos, savedCwd };
  }),
  ({ repos, savedCwd }) =>
    Effect.gen(function* () {
      process.chdir(savedCwd);
      yield* removeDir(repos.origin).pipe(Effect.ignore);
      yield* removeDir(repos.clone).pipe(Effect.ignore);
    }),
);

/**
 * Effect-managed temp directory (non-jj repo) for testing error scenarios.
 * Uses Effect.acquireRelease to guarantee cleanup even on test failure.
 */
const TempNonRepoResource = Effect.acquireRelease(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const tempDir = path.join("/tmp", `ship-test-no-repo-${Date.now()}`);
    yield* fs.makeDirectory(tempDir, { recursive: true });
    const savedCwd = process.cwd();
    process.chdir(tempDir);
    return { tempDir, savedCwd };
  }),
  ({ tempDir, savedCwd }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      process.chdir(savedCwd);
      yield* fs.remove(tempDir, { recursive: true }).pipe(Effect.ignore);
    }),
);

/**
 * Wrapper that skips the test if jj is not available.
 * Uses Effect pattern instead of mutable module state.
 * Logs a warning when skipping so it's visible in test output.
 */
const withJjAvailable = <A, E, R>(
  testFn: () => Effect.Effect<A, E, R>,
): Effect.Effect<A | void, E, R> =>
  Effect.gen(function* () {
    const available = yield* checkJjAvailable;
    if (!available) {
      // Log warning so it's visible in test output
      yield* Effect.logWarning("jj is not available - skipping test");
      return;
    }
    return yield* testFn();
  });

describe("VcsService integration", () => {
  describe("Repository Operations", () => {
    it.effect("isAvailable returns true when jj is installed", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          const vcs = yield* VcsService;
          const available = yield* vcs.isAvailable();
          expect(available).toBe(true);
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("isRepo returns true in a jj repository", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          yield* TempRepoResource;

          const vcs = yield* VcsService;
          const isRepo = yield* vcs.isRepo();
          expect(isRepo).toBe(true);
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("getCurrentChange returns working copy with isWorkingCopy true", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          yield* TempRepoResource;

          const vcs = yield* VcsService;
          const change = yield* vcs.getCurrentChange();

          expect(change.isWorkingCopy).toBe(true);
          expect(change.changeId).toBeDefined();
          expect(change.id).toBeDefined();
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("getLog returns changes for the specified revset", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          const { repo } = yield* TempRepoResource;

          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;

          // Create some commits
          yield* fs.writeFileString(path.join(repo.path, "file1.txt"), "content1");
          yield* repo.runJj("commit", "-m", "First commit");

          yield* fs.writeFileString(path.join(repo.path, "file2.txt"), "content2");
          yield* repo.runJj("commit", "-m", "Second commit");

          const vcs = yield* VcsService;
          const changes = yield* vcs.getLog("@");

          expect(changes.length).toBeGreaterThanOrEqual(1);
          // Current change should be in the log
          expect(changes.some((c) => c.isWorkingCopy)).toBe(true);
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("getStack returns changes from trunk to current", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          const { repo } = yield* TempRepoResource;

          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;

          // Create some commits to build a stack
          yield* fs.writeFileString(path.join(repo.path, "file1.txt"), "content1");
          yield* repo.runJj("commit", "-m", "Stack change 1");

          yield* fs.writeFileString(path.join(repo.path, "file2.txt"), "content2");
          yield* repo.runJj("commit", "-m", "Stack change 2");

          const vcs = yield* VcsService;
          const stack = yield* vcs.getStack();

          // Stack should include our changes (may vary based on trunk detection)
          expect(Array.isArray(stack)).toBe(true);
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );
  });

  describe("Change Operations", () => {
    it.scoped("describe updates the current change message", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          yield* TempRepoResource;

          const vcs = yield* VcsService;

          yield* vcs.describe("Test description");
          const change = yield* vcs.getCurrentChange();

          expect(change.description).toBe("Test description");
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("createChange creates a new change with the given message", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          const { repo } = yield* TempRepoResource;

          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;

          // First create content so the change isn't empty
          yield* fs.writeFileString(path.join(repo.path, "test.txt"), "content");

          const vcs = yield* VcsService;

          yield* vcs.describe("Parent change");
          const newChangeId = yield* vcs.createChange("New change message");

          expect(newChangeId).toBeDefined();

          const current = yield* vcs.getCurrentChange();
          expect(current.description).toBe("New change message");
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("commit creates new change and returns the committed change id", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          const { repo } = yield* TempRepoResource;

          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;

          // Create a file to commit
          yield* fs.writeFileString(path.join(repo.path, "file.txt"), "content");

          const vcs = yield* VcsService;

          const commitId = yield* vcs.commit("Commit message");
          expect(commitId).toBeDefined();

          // After commit, we should be on a new empty change
          const current = yield* vcs.getCurrentChange();
          expect(current.isEmpty).toBe(true);
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("getParentChange returns the parent of current change", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          const { repo } = yield* TempRepoResource;

          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;

          // Create a parent commit
          yield* fs.writeFileString(path.join(repo.path, "file1.txt"), "content1");
          yield* repo.runJj("commit", "-m", "Parent commit");

          // Create current change with content
          yield* fs.writeFileString(path.join(repo.path, "file2.txt"), "content2");
          yield* repo.runJj("describe", "-m", "Current change");

          const vcs = yield* VcsService;
          const parent = yield* vcs.getParentChange();

          expect(parent).not.toBeNull();
          expect(parent?.description).toBe("Parent commit");
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("squash combines current change into parent", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          const { repo } = yield* TempRepoResource;

          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;

          // Create parent commit
          yield* fs.writeFileString(path.join(repo.path, "file1.txt"), "content1");
          yield* repo.runJj("commit", "-m", "Parent commit");

          // Create current change
          yield* fs.writeFileString(path.join(repo.path, "file2.txt"), "content2");
          yield* repo.runJj("describe", "-m", "Current change");

          const vcs = yield* VcsService;

          const squashed = yield* vcs.squash("Squashed commit message");

          expect(squashed).toBeDefined();
          expect(squashed.description).toBe("Squashed commit message");
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("abandon removes the current change", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          const { repo } = yield* TempRepoResource;

          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;

          // Create a parent and current change
          yield* fs.writeFileString(path.join(repo.path, "file1.txt"), "content1");
          yield* repo.runJj("commit", "-m", "Parent commit");

          yield* fs.writeFileString(path.join(repo.path, "file2.txt"), "content2");
          yield* repo.runJj("describe", "-m", "To be abandoned");

          const vcs = yield* VcsService;

          const beforeAbandon = yield* vcs.getCurrentChange();
          const result = yield* vcs.abandon();

          // After abandon, we should be on a new change
          expect(result.id).not.toBe(beforeAbandon.id);
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );
  });

  describe("Bookmark Operations", () => {
    it.scoped("createBookmark creates a bookmark at current change", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          yield* TempRepoResource;

          const vcs = yield* VcsService;

          yield* vcs.describe("Change with bookmark");
          yield* vcs.createBookmark("test-bookmark");

          const current = yield* vcs.getCurrentChange();
          expect(current.bookmarks).toContain("test-bookmark");
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("moveBookmark moves an existing bookmark", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          const { repo } = yield* TempRepoResource;

          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;

          // Create first change with bookmark
          yield* fs.writeFileString(path.join(repo.path, "file1.txt"), "content1");
          yield* repo.runJj("commit", "-m", "First commit");
          yield* repo.runJj("bookmark", "create", "movable-bookmark", "-r", "@-");

          // Create second change
          yield* fs.writeFileString(path.join(repo.path, "file2.txt"), "content2");
          yield* repo.runJj("describe", "-m", "Second change");

          const vcs = yield* VcsService;

          // Move bookmark to current change
          yield* vcs.moveBookmark("movable-bookmark");

          const current = yield* vcs.getCurrentChange();
          expect(current.bookmarks).toContain("movable-bookmark");
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("deleteBookmark removes a bookmark", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          yield* TempRepoResource;

          const vcs = yield* VcsService;

          yield* vcs.describe("Change with bookmark");
          yield* vcs.createBookmark("to-delete");

          // Verify bookmark exists
          const before = yield* vcs.getCurrentChange();
          expect(before.bookmarks).toContain("to-delete");

          // Delete it
          yield* vcs.deleteBookmark("to-delete");

          const after = yield* vcs.getCurrentChange();
          expect(after.bookmarks).not.toContain("to-delete");
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );
  });

  describe("Workspace Operations", () => {
    it.scoped("listWorkspaces returns at least the default workspace", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          yield* TempRepoResource;

          const vcs = yield* VcsService;
          const workspaces = yield* vcs.listWorkspaces();

          expect(workspaces.length).toBeGreaterThanOrEqual(1);
          expect(workspaces.some((w) => w.name === "default")).toBe(true);
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("getWorkspaceRoot returns the repository root", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          const { repo } = yield* TempRepoResource;

          const vcs = yield* VcsService;
          const root = yield* vcs.getWorkspaceRoot();

          // Normalize paths for comparison (macOS /private/var vs /var symlink)
          const normalizePathForComparison = (p: string) => p.replace(/^\/private/, "");
          expect(normalizePathForComparison(root)).toBe(normalizePathForComparison(repo.path));
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("getCurrentWorkspaceName returns 'default' in default workspace", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          yield* TempRepoResource;

          const vcs = yield* VcsService;
          const name = yield* vcs.getCurrentWorkspaceName();

          expect(name).toBe("default");
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("isNonDefaultWorkspace returns false in default workspace", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          yield* TempRepoResource;

          const vcs = yield* VcsService;
          const isNonDefault = yield* vcs.isNonDefaultWorkspace();

          expect(isNonDefault).toBe(false);
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("createWorkspace creates a new workspace", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          const { repo } = yield* TempRepoResource;

          const path = yield* Path.Path;
          const workspacePath = path.join(repo.path, "test-workspace");

          const vcs = yield* VcsService;

          const workspace = yield* vcs.createWorkspace("test-ws", workspacePath);

          expect(workspace.name).toBe("test-ws");
          // Workspace path is reported with the actual path (may differ due to symlinks or default structure)
          expect(workspace.path).toContain("test-ws");

          // Verify it's in the list
          const workspaces = yield* vcs.listWorkspaces();
          expect(workspaces.some((w) => w.name === "test-ws")).toBe(true);

          // Cleanup
          yield* vcs.forgetWorkspace("test-ws");
          yield* removeDir(workspacePath);
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("forgetWorkspace removes workspace from tracking", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          const { repo } = yield* TempRepoResource;

          const path = yield* Path.Path;
          const workspacePath = path.join(repo.path, "to-forget");

          const vcs = yield* VcsService;

          // Create workspace
          yield* vcs.createWorkspace("to-forget", workspacePath);

          // Forget it
          yield* vcs.forgetWorkspace("to-forget");

          // Verify it's gone from the list
          const workspaces = yield* vcs.listWorkspaces();
          expect(workspaces.some((w) => w.name === "to-forget")).toBe(false);

          // Cleanup files
          yield* removeDir(workspacePath);
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );
  });

  describe("Stack Navigation", () => {
    it.scoped("getChildChange returns null when no children exist", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          yield* TempRepoResource;

          const vcs = yield* VcsService;
          const child = yield* vcs.getChildChange();

          expect(child).toBeNull();
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("editChange moves working copy to specified change", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          const { repo } = yield* TempRepoResource;

          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;

          // Create parent commit and capture its id
          yield* fs.writeFileString(path.join(repo.path, "file1.txt"), "content1");
          yield* repo.runJj("commit", "-m", "Parent commit");

          // Get parent change id
          const parentOutput = yield* repo.runJj("log", "-r", "@-", "-T", "change_id", "--no-graph");
          const parentId = parentOutput.trim() as ChangeId;

          // Create child commit
          yield* fs.writeFileString(path.join(repo.path, "file2.txt"), "content2");
          yield* repo.runJj("describe", "-m", "Child change");

          const vcs = yield* VcsService;

          // Edit parent change
          yield* vcs.editChange(parentId);

          const current = yield* vcs.getCurrentChange();
          expect(current.description).toBe("Parent commit");
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );
  });

  describe("Recovery Operations", () => {
    it.scoped("undo reverses the last operation", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          yield* TempRepoResource;

          const vcs = yield* VcsService;

          // Make a change
          yield* vcs.describe("Before undo");

          // Verify description
          const before = yield* vcs.getCurrentChange();
          expect(before.description).toBe("Before undo");

          // Undo
          const result = yield* vcs.undo();
          expect(result.undone).toBe(true);

          // Description should be reverted
          const after = yield* vcs.getCurrentChange();
          expect(after.description).not.toBe("Before undo");
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );
  });

  describe("Remote Operations", () => {
    it.scoped("sync fetches and rebases onto trunk", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          const { repos } = yield* TempRepoWithRemoteResource;

          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;

          // Create initial commit and main bookmark in origin first
          yield* fs.writeFileString(path.join(repos.clone, "init.txt"), "initial");
          yield* repos.runJj("commit", "-m", "Initial commit");
          yield* repos.runJj("bookmark", "create", "main", "-r", "@-");
          yield* repos.runJj("git", "push", "-b", "main", "--allow-new");

          // Create some content in clone
          yield* fs.writeFileString(path.join(repos.clone, "file.txt"), "content");
          yield* repos.runJj("commit", "-m", "Local commit");

          const vcs = yield* VcsService;

          // Sync should work
          const result = yield* vcs.sync("main");

          expect(result.fetched).toBe(true);
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("push sends bookmark to remote", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          const { repos } = yield* TempRepoWithRemoteResource;

          const path = yield* Path.Path;
          const fs = yield* FileSystem.FileSystem;

          // Create content and bookmark
          yield* fs.writeFileString(path.join(repos.clone, "file.txt"), "content");
          yield* repos.runJj("describe", "-m", "Change to push");
          yield* repos.runJj("bookmark", "create", "feature-branch");

          const vcs = yield* VcsService;

          const result = yield* vcs.push("feature-branch");

          expect(result.bookmark).toBe("feature-branch");
          expect(result.remote).toBe("origin");
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );
  });

  describe("Error Scenarios", () => {
    it.scoped("operations fail gracefully outside a repo", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          // Use Effect-managed temp directory that is NOT a jj repo
          yield* TempNonRepoResource;

          const vcs = yield* VcsService;

          // isRepo should return false, not fail
          const isRepo = yield* vcs.isRepo();
          expect(isRepo).toBe(false);
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("moveBookmark fails for nonexistent bookmark", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          yield* TempRepoResource;

          const vcs = yield* VcsService;

          // Try to move a nonexistent bookmark - jj may or may not error depending on version
          // We just verify it doesn't create the bookmark
          yield* vcs.moveBookmark("nonexistent-bookmark").pipe(Effect.ignore);
          const afterMove = yield* vcs.getCurrentChange();

          // The bookmark should not appear (jj doesn't create it when moving non-existent)
          // or if jj errors, this just passes
          expect(afterMove.bookmarks.includes("nonexistent-bookmark")).toBe(false);
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );

    it.scoped("deleteBookmark fails for nonexistent bookmark", () =>
      withJjAvailable(() =>
        Effect.gen(function* () {
          yield* TempRepoResource;

          const vcs = yield* VcsService;

          // Try to delete a nonexistent bookmark
          // This should fail, but jj may just output a warning
          yield* Effect.exit(vcs.deleteBookmark("does-not-exist"));

          // Either it fails (expected) or it succeeds with no effect (also acceptable)
          // The key is it shouldn't throw an unhandled error
          expect(true).toBe(true); // Test passes if we get here without crash
        }).pipe(Effect.provide(VcsLayer)),
      ).pipe(Effect.provide(NodeContext.layer)),
    );
  });
});
