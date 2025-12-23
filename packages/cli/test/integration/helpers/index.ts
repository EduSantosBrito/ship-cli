/**
 * Integration test helpers re-exports.
 *
 * Provides a unified entry point for all integration test utilities.
 */

// File system helpers
export {
  createTempDir,
  removeDir,
  withTempDir,
  writeFile,
  readFile,
  exists,
  makeDir,
} from "./fs.js";

// Repository helpers
export {
  type CommitSpec,
  type TestRepo,
  type TestRepoWithRemote,
  runJj,
  runGit,
  createTempJjRepo,
  createCommit,
  createRepoWithHistory,
  createRepoWithRemote,
  withTempJjRepo,
  withTempJjRepoWithRemote,
  getCurrentChangeId,
  getBookmarks,
} from "./repo.js";

// CLI helpers
export {
  type CommandResult,
  runShipCli,
  runShell,
  assertSuccess,
  assertFailure,
  assertOutputContains,
} from "./cli.js";
