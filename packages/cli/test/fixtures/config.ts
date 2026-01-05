/**
 * Config domain fixtures for testing.
 *
 * Provides factory functions that produce valid Config domain objects
 * with sensible defaults, supporting partial overrides.
 */

import { Option } from "effect"
import { ProjectId, TeamId } from "../../src/domain/Task.js"
import {
  AuthConfig,
  LinearConfig,
  GitConfig,
  PrConfig,
  CommitConfig,
  WorkspaceConfig,
  ShipConfig,
  PartialShipConfig,
  WorkspaceMetadata,
  WorkspacesFile,
} from "../../src/domain/Config.js"

// === AuthConfig Fixtures ===

export interface AuthConfigInput {
  apiKey?: string
}

export const makeAuthConfig = (overrides: AuthConfigInput = {}): AuthConfig =>
  new AuthConfig({
    apiKey: overrides.apiKey ?? "test-api-key",
  })

// === LinearConfig Fixtures ===

export interface LinearConfigInput {
  teamId?: TeamId
  teamKey?: string
  projectId?: ProjectId | null
}

export const makeLinearConfig = (
  overrides: LinearConfigInput = {},
): LinearConfig =>
  new LinearConfig({
    teamId: (overrides.teamId ?? "team-1") as TeamId,
    teamKey: overrides.teamKey ?? "ENG",
    projectId:
      overrides.projectId === null
        ? Option.none()
        : Option.fromNullable(overrides.projectId as ProjectId | undefined),
  })

// === GitConfig Fixtures ===

export interface GitConfigInput {
  defaultBranch?: string
}

export const makeGitConfig = (overrides: GitConfigInput = {}): GitConfig =>
  new GitConfig({
    defaultBranch: overrides.defaultBranch ?? "main",
  })

// === PrConfig Fixtures ===

export interface PrConfigInput {
  openBrowser?: boolean
}

export const makePrConfig = (overrides: PrConfigInput = {}): PrConfig =>
  new PrConfig({
    openBrowser: overrides.openBrowser ?? true,
  })

// === CommitConfig Fixtures ===

export interface CommitConfigInput {
  conventionalFormat?: boolean
}

export const makeCommitConfig = (
  overrides: CommitConfigInput = {},
): CommitConfig =>
  new CommitConfig({
    conventionalFormat: overrides.conventionalFormat ?? true,
  })

// === WorkspaceConfig Fixtures ===

export interface WorkspaceConfigInput {
  basePath?: string
  autoNavigate?: boolean
  autoCleanup?: boolean
}

export const makeWorkspaceConfig = (
  overrides: WorkspaceConfigInput = {},
): WorkspaceConfig =>
  new WorkspaceConfig({
    basePath: overrides.basePath ?? ".ship/workspaces/{stack}",
    autoNavigate: overrides.autoNavigate ?? true,
    autoCleanup: overrides.autoCleanup ?? true,
  })

// === ShipConfig Fixtures ===

export interface ShipConfigInput {
  linear?: LinearConfig
  auth?: AuthConfig
  git?: GitConfig
  pr?: PrConfig
  commit?: CommitConfig
  workspace?: WorkspaceConfig
}

export const makeShipConfig = (overrides: ShipConfigInput = {}): ShipConfig =>
  new ShipConfig({
    linear: overrides.linear ?? makeLinearConfig(),
    notion: Option.none(),
    auth: overrides.auth ?? makeAuthConfig(),
    git: overrides.git ?? makeGitConfig(),
    pr: overrides.pr ?? makePrConfig(),
    commit: overrides.commit ?? makeCommitConfig(),
    workspace: overrides.workspace ?? makeWorkspaceConfig(),
  })

// === PartialShipConfig Fixtures ===

export interface PartialShipConfigInput {
  linear?: LinearConfig | null
  auth?: AuthConfig | null
  git?: GitConfig
  pr?: PrConfig
  commit?: CommitConfig
  workspace?: WorkspaceConfig
}

export const makePartialShipConfig = (
  overrides: PartialShipConfigInput = {},
): PartialShipConfig =>
  new PartialShipConfig({
    linear:
      overrides.linear === null
        ? Option.none()
        : Option.fromNullable(overrides.linear),
    notion: Option.none(),
    auth:
      overrides.auth === null
        ? Option.none()
        : Option.fromNullable(overrides.auth),
    git: overrides.git ?? makeGitConfig(),
    pr: overrides.pr ?? makePrConfig(),
    commit: overrides.commit ?? makeCommitConfig(),
    workspace: overrides.workspace ?? makeWorkspaceConfig(),
  })

// === WorkspaceMetadata Fixtures ===

export interface WorkspaceMetadataInput {
  name?: string
  path?: string
  stackName?: string
  bookmark?: string | null
  createdAt?: Date
  taskId?: string | null
}

export const makeWorkspaceMetadata = (
  overrides: WorkspaceMetadataInput = {},
): WorkspaceMetadata =>
  new WorkspaceMetadata({
    name: overrides.name ?? "test-workspace",
    path: overrides.path ?? "/path/to/workspace",
    stackName: overrides.stackName ?? "test-stack",
    bookmark:
      overrides.bookmark === null
        ? Option.none()
        : Option.fromNullable(overrides.bookmark ?? "user/test-bookmark"),
    createdAt: overrides.createdAt ?? new Date("2024-01-01"),
    taskId:
      overrides.taskId === null
        ? Option.none()
        : Option.fromNullable(overrides.taskId),
  })

// === WorkspacesFile Fixtures ===

export interface WorkspacesFileInput {
  workspaces?: WorkspaceMetadata[]
}

export const makeWorkspacesFile = (
  overrides: WorkspacesFileInput = {},
): WorkspacesFile =>
  new WorkspacesFile({
    workspaces: overrides.workspaces ?? [],
  })
