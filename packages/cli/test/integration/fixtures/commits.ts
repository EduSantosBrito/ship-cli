/**
 * Preset commit histories for integration tests.
 *
 * Provides common commit patterns that can be used to create
 * test repositories with known history.
 */

import type { CommitSpec } from "../helpers/repo.js";

/**
 * A simple single commit with one file.
 */
export const SINGLE_COMMIT: ReadonlyArray<CommitSpec> = [
  {
    message: "Initial commit",
    files: [{ path: "README.md", content: "# Test Project\n" }],
  },
];

/**
 * A linear history of three commits.
 */
export const LINEAR_HISTORY: ReadonlyArray<CommitSpec> = [
  {
    message: "Initial commit",
    files: [{ path: "README.md", content: "# Test Project\n" }],
  },
  {
    message: "Add main module",
    files: [{ path: "src/main.ts", content: 'console.log("Hello");\n' }],
  },
  {
    message: "Add tests",
    files: [{ path: "test/main.test.ts", content: 'it("works", () => {});\n' }],
  },
];

/**
 * History with bookmarks for testing bookmark operations.
 */
export const HISTORY_WITH_BOOKMARKS: ReadonlyArray<CommitSpec> = [
  {
    message: "Initial commit",
    files: [{ path: "README.md", content: "# Test Project\n" }],
    bookmark: "main",
  },
  {
    message: "Feature branch commit",
    files: [{ path: "feature.ts", content: "// feature\n" }],
    bookmark: "feature/test",
  },
];

/**
 * History simulating a feature branch workflow.
 */
export const FEATURE_BRANCH_HISTORY: ReadonlyArray<CommitSpec> = [
  {
    message: "Initial project setup",
    files: [
      { path: "README.md", content: "# Test Project\n\nA test project.\n" },
      { path: "package.json", content: '{"name": "test", "version": "1.0.0"}\n' },
    ],
    bookmark: "main",
  },
  {
    message: "BRI-123: Add user authentication",
    files: [
      { path: "src/auth.ts", content: "export const auth = () => {};\n" },
      { path: "test/auth.test.ts", content: 'it("authenticates", () => {});\n' },
    ],
    bookmark: "user/bri-123-auth",
  },
];

/**
 * History with multiple files in one commit.
 */
export const MULTI_FILE_COMMIT: ReadonlyArray<CommitSpec> = [
  {
    message: "Initial project with multiple files",
    files: [
      { path: "README.md", content: "# Project\n" },
      { path: "package.json", content: '{"name": "project"}\n' },
      { path: "src/index.ts", content: 'export const main = () => "hello";\n' },
      { path: "src/utils.ts", content: "export const add = (a: number, b: number) => a + b;\n" },
      { path: "test/index.test.ts", content: 'describe("main", () => {});\n' },
    ],
  },
];

/**
 * Empty commit history (just initialize the repo).
 */
export const EMPTY_HISTORY: ReadonlyArray<CommitSpec> = [];

/**
 * History for testing stacked changes workflow.
 */
export const STACKED_CHANGES: ReadonlyArray<CommitSpec> = [
  {
    message: "Base setup",
    files: [{ path: "README.md", content: "# Stack Demo\n" }],
    bookmark: "main",
  },
  {
    message: "First change in stack",
    files: [{ path: "change1.ts", content: "// first\n" }],
    bookmark: "user/stack-1",
  },
  {
    message: "Second change in stack",
    files: [{ path: "change2.ts", content: "// second\n" }],
    bookmark: "user/stack-2",
  },
  {
    message: "Third change in stack",
    files: [{ path: "change3.ts", content: "// third\n" }],
    bookmark: "user/stack-3",
  },
];

/**
 * History simulating a conflict scenario.
 * The same file is modified in multiple commits.
 */
export const CONFLICT_PRONE_HISTORY: ReadonlyArray<CommitSpec> = [
  {
    message: "Initial version of config",
    files: [{ path: "config.json", content: '{"version": 1}\n' }],
  },
  {
    message: "Update config version",
    files: [{ path: "config.json", content: '{"version": 2}\n' }],
  },
];
