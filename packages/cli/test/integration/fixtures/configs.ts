/**
 * Preset configurations for integration tests.
 *
 * Provides common configuration patterns that can be used to create
 * test environments with known settings.
 */

import type { TestConfigOptions } from "../layers/TestConfigLayer.js";
import type { TestIssueOptions, TestTaskData } from "../layers/TestIssueLayer.js";

// ============================================================================
// Config Presets
// ============================================================================

/**
 * Default test configuration with typical values.
 */
export const DEFAULT_CONFIG: TestConfigOptions = {
  teamId: "test-team-id",
  teamKey: "TEST",
  projectId: null,
  apiKey: "lin_api_test_key_12345",
  defaultBranch: "main",
  openBrowser: false,
  conventionalFormat: true,
  configExists: true,
};

/**
 * Configuration for a project with a specific project ID.
 */
export const CONFIG_WITH_PROJECT: TestConfigOptions = {
  ...DEFAULT_CONFIG,
  projectId: "test-project-id",
};

/**
 * Configuration with master as the default branch.
 */
export const CONFIG_MASTER_BRANCH: TestConfigOptions = {
  ...DEFAULT_CONFIG,
  defaultBranch: "master",
};

/**
 * Configuration with browser opening enabled.
 */
export const CONFIG_OPEN_BROWSER: TestConfigOptions = {
  ...DEFAULT_CONFIG,
  openBrowser: true,
};

/**
 * Configuration with conventional commits disabled.
 */
export const CONFIG_NO_CONVENTIONAL: TestConfigOptions = {
  ...DEFAULT_CONFIG,
  conventionalFormat: false,
};

/**
 * Configuration simulating uninitialized workspace.
 */
export const CONFIG_UNINITIALIZED: TestConfigOptions = {
  configExists: false,
};

// ============================================================================
// Task Presets
// ============================================================================

/**
 * A single task in backlog state.
 */
export const SINGLE_BACKLOG_TASK: TestTaskData = {
  id: "task-single",
  identifier: "TEST-100",
  title: "Single Backlog Task",
  description: "A simple task in the backlog",
  stateType: "backlog",
  priority: "medium",
};

/**
 * A task in progress.
 */
export const TASK_IN_PROGRESS: TestTaskData = {
  id: "task-progress",
  identifier: "TEST-101",
  title: "In Progress Task",
  description: "A task currently being worked on",
  stateType: "started",
  priority: "high",
};

/**
 * A completed task.
 */
export const COMPLETED_TASK: TestTaskData = {
  id: "task-done",
  identifier: "TEST-102",
  title: "Completed Task",
  stateType: "completed",
  priority: "medium",
};

// Default team ID for test configurations
const TEST_TEAM_ID = "test-team-id";

/**
 * Issue repository with empty tasks (clean slate).
 */
export const EMPTY_ISSUES: TestIssueOptions = {
  initialTasks: [],
  teamId: TEST_TEAM_ID,
};

/**
 * Issue repository with a mix of task states.
 */
export const MIXED_TASKS: TestIssueOptions = {
  initialTasks: [
    {
      id: "task-1",
      identifier: "TEST-1",
      title: "Ready Task",
      stateType: "backlog",
      priority: "high",
    },
    {
      id: "task-2",
      identifier: "TEST-2",
      title: "In Progress Task",
      stateType: "started",
      priority: "medium",
    },
    {
      id: "task-3",
      identifier: "TEST-3",
      title: "Blocked Task",
      stateType: "backlog",
      priority: "low",
      blockedBy: ["task-1"],
    },
    {
      id: "task-4",
      identifier: "TEST-4",
      title: "Done Task",
      stateType: "completed",
      priority: "medium",
    },
  ],
  teamId: TEST_TEAM_ID,
};

/**
 * Issue repository with blocking relationships.
 */
export const BLOCKED_TASKS: TestIssueOptions = {
  initialTasks: [
    {
      id: "blocker-1",
      identifier: "TEST-BLOCK-1",
      title: "Blocking Task 1",
      stateType: "backlog",
    },
    {
      id: "blocker-2",
      identifier: "TEST-BLOCK-2",
      title: "Blocking Task 2",
      stateType: "started",
    },
    {
      id: "blocked-1",
      identifier: "TEST-WAIT-1",
      title: "Waiting on one task",
      stateType: "backlog",
      blockedBy: ["blocker-1"],
    },
    {
      id: "blocked-2",
      identifier: "TEST-WAIT-2",
      title: "Waiting on two tasks",
      stateType: "backlog",
      blockedBy: ["blocker-1", "blocker-2"],
    },
  ],
  teamId: TEST_TEAM_ID,
};

/**
 * Issue repository for priority testing.
 */
export const PRIORITY_TASKS: TestIssueOptions = {
  initialTasks: [
    {
      id: "urgent",
      identifier: "TEST-URGENT",
      title: "Urgent Priority Task",
      stateType: "backlog",
      priority: "urgent",
    },
    {
      id: "high",
      identifier: "TEST-HIGH",
      title: "High Priority Task",
      stateType: "backlog",
      priority: "high",
    },
    {
      id: "medium",
      identifier: "TEST-MED",
      title: "Medium Priority Task",
      stateType: "backlog",
      priority: "medium",
    },
    {
      id: "low",
      identifier: "TEST-LOW",
      title: "Low Priority Task",
      stateType: "backlog",
      priority: "low",
    },
    {
      id: "none",
      identifier: "TEST-NONE",
      title: "No Priority Task",
      stateType: "backlog",
      priority: "none",
    },
  ],
  teamId: TEST_TEAM_ID,
};

// ============================================================================
// Combined Test Environments
// ============================================================================

/**
 * A complete test environment configuration.
 */
export interface TestEnvironment {
  readonly config: TestConfigOptions;
  readonly issues: TestIssueOptions;
}

/**
 * Default test environment with typical setup.
 */
export const DEFAULT_ENVIRONMENT: TestEnvironment = {
  config: DEFAULT_CONFIG,
  issues: MIXED_TASKS,
};

/**
 * Empty test environment (no tasks, initialized config).
 */
export const EMPTY_ENVIRONMENT: TestEnvironment = {
  config: DEFAULT_CONFIG,
  issues: EMPTY_ISSUES,
};

/**
 * Uninitialized test environment (for testing init flow).
 */
export const UNINITIALIZED_ENVIRONMENT: TestEnvironment = {
  config: CONFIG_UNINITIALIZED,
  issues: EMPTY_ISSUES,
};
