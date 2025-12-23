/**
 * Shared Test Fixtures
 *
 * Centralized factory functions for creating test data across all test files.
 * Import from this module instead of defining local fixtures.
 *
 * @example
 * ```typescript
 * import { makeTask, makeChange, makeShipConfig } from "../fixtures/index.js"
 *
 * const task = makeTask({ title: "My Task" })
 * const change = makeChange({ description: "feat: add feature" })
 * ```
 */

// === Task Domain Fixtures ===
export {
  makeTask,
  makeSubtask,
  makeWorkflowState,
  makeDependency,
  makeTeam,
  makeProject,
  makeMilestone,
  type TaskInput,
  type SubtaskInput,
  type WorkflowStateInput,
  type DependencyInput,
  type TeamInput,
  type ProjectInput,
  type MilestoneInput,
} from "./task.js"

// === Config Fixtures ===
export {
  makeAuthConfig,
  makeLinearConfig,
  makeGitConfig,
  makePrConfig,
  makeCommitConfig,
  makeWorkspaceConfig,
  makeShipConfig,
  makePartialShipConfig,
  makeWorkspaceMetadata,
  makeWorkspacesFile,
  type AuthConfigInput,
  type LinearConfigInput,
  type GitConfigInput,
  type PrConfigInput,
  type CommitConfigInput,
  type WorkspaceConfigInput,
  type ShipConfigInput,
  type PartialShipConfigInput,
  type WorkspaceMetadataInput,
  type WorkspacesFileInput,
} from "./config.js"

// === VCS Change Fixtures ===
export {
  makeChange,
  makePushResult,
  makeTrunkInfo,
  makeSyncResult,
  makeAbandonedMergedChange,
  makeWorkspaceInfo,
  makeUndoResult,
  makeUpdateStaleResult,
  type ChangeInput,
  type PushResultInput,
  type TrunkInfoInput,
  type SyncResultInput,
  type AbandonedMergedChangeInput,
  type WorkspaceInfoInput,
  type UndoResultInput,
  type UpdateStaleResultInput,
} from "./change.js"

// === Linear SDK Mock Fixtures ===
export {
  createMockWorkflowState,
  createMockLabel,
  createMockLabelsConnection,
  createMockTeam,
  createMockChildIssue,
  createMockIssue,
  createMockProject,
  createMockMilestone,
  type LinearWorkflowStateInput,
  type IssueLabelInput,
  type LinearTeamInput,
  type ChildIssueInput,
  type LinearIssueInput,
  type LinearProjectInput,
  type LinearMilestoneInput,
} from "./linear.js"
