import { describe, it, expect } from "@effect/vitest"
import { Effect, Schema, Option } from "effect"
import {
  // Constants
  SHIP_WORKSPACES_DIR,
  DEFAULT_WORKSPACE_NAME,
  DEFAULT_WORKSPACE_PATH_PATTERN,
  // Config classes
  AuthConfig,
  LinearConfig,
  GitConfig,
  PrConfig,
  CommitConfig,
  WorkspaceConfig,
  ShipConfig,
  PartialShipConfig,
  // Workspace metadata
  WorkspaceMetadata,
  WorkspacesFile,
  // Utility functions
  resolveWorkspacePath,
} from "../../src/domain/Config.js"
import { ProjectId } from "../../src/domain/Task.js"

describe("Config Domain", () => {
  describe("Constants", () => {
    it("should have correct SHIP_WORKSPACES_DIR", () => {
      expect(SHIP_WORKSPACES_DIR).toBe("workspaces")
    })

    it("should have correct DEFAULT_WORKSPACE_NAME", () => {
      expect(DEFAULT_WORKSPACE_NAME).toBe("default")
    })

    it("should have correct DEFAULT_WORKSPACE_PATH_PATTERN", () => {
      expect(DEFAULT_WORKSPACE_PATH_PATTERN).toBe(".ship/workspaces/{stack}")
    })
  })

  describe("resolveWorkspacePath", () => {
    it("should replace {repo} variable", () => {
      const result = resolveWorkspacePath("../{repo}-workspace", {
        repo: "ship-cli",
        stack: "feature",
      })
      expect(result).toBe("../ship-cli-workspace")
    })

    it("should replace {stack} variable", () => {
      const result = resolveWorkspacePath(".ship/workspaces/{stack}", {
        repo: "ship-cli",
        stack: "bri-123-auth",
      })
      expect(result).toBe(".ship/workspaces/bri-123-auth")
    })

    it("should replace {user} variable when provided", () => {
      const result = resolveWorkspacePath("{user}/{repo}/{stack}", {
        repo: "ship-cli",
        stack: "feature",
        user: "alice",
      })
      expect(result).toBe("alice/ship-cli/feature")
    })

    it("should replace {user} with empty string when not provided", () => {
      const result = resolveWorkspacePath("{user}-{stack}", {
        repo: "ship-cli",
        stack: "feature",
      })
      expect(result).toBe("-feature")
    })

    it("should replace multiple occurrences of same variable", () => {
      const result = resolveWorkspacePath("{stack}/{stack}", {
        repo: "ship-cli",
        stack: "feature",
      })
      expect(result).toBe("feature/feature")
    })

    it("should handle all variables together", () => {
      const result = resolveWorkspacePath("{repo}/{user}/{stack}", {
        repo: "my-project",
        stack: "auth-feature",
        user: "bob",
      })
      expect(result).toBe("my-project/bob/auth-feature")
    })

    it("should preserve literal text", () => {
      const result = resolveWorkspacePath("prefix-{stack}-suffix", {
        repo: "ship-cli",
        stack: "feature",
      })
      expect(result).toBe("prefix-feature-suffix")
    })

    it("should handle default pattern correctly", () => {
      const result = resolveWorkspacePath(DEFAULT_WORKSPACE_PATH_PATTERN, {
        repo: "ship-cli",
        stack: "bri-27-tests",
      })
      expect(result).toBe(".ship/workspaces/bri-27-tests")
    })
  })

  describe("AuthConfig", () => {
    it.effect("should decode valid auth config", () =>
      Effect.gen(function* () {
        const data = { apiKey: "lin_api_xxx" }
        const result = yield* Schema.decode(AuthConfig)(data)
        expect(result.apiKey).toBe("lin_api_xxx")
      }),
    )
  })

  describe("LinearConfig", () => {
    it.effect("should decode valid linear config", () =>
      Effect.gen(function* () {
        const data = {
          teamId: "team-123",
          teamKey: "ENG",
          projectId: null,
        }
        const result = yield* Schema.decode(LinearConfig)(data)
        expect(result.teamId).toBe("team-123")
        expect(result.teamKey).toBe("ENG")
        expect(Option.isNone(result.projectId)).toBe(true)
      }),
    )

    it.effect("should handle optional projectId as Some", () =>
      Effect.gen(function* () {
        const data = {
          teamId: "team-123",
          teamKey: "ENG",
          projectId: "proj-456",
        }
        const result = yield* Schema.decode(LinearConfig)(data)
        expect(Option.isSome(result.projectId)).toBe(true)
        expect(Option.getOrElse(result.projectId, () => "" as ProjectId)).toBe(
          "proj-456",
        )
      }),
    )
  })

  describe("GitConfig", () => {
    it.effect("should decode with default branch 'main'", () =>
      Effect.gen(function* () {
        const data = {}
        const result = yield* Schema.decode(GitConfig)(data)
        expect(result.defaultBranch).toBe("main")
      }),
    )

    it.effect("should decode with custom default branch", () =>
      Effect.gen(function* () {
        const data = { defaultBranch: "master" }
        const result = yield* Schema.decode(GitConfig)(data)
        expect(result.defaultBranch).toBe("master")
      }),
    )
  })

  describe("PrConfig", () => {
    it.effect("should decode with default openBrowser true", () =>
      Effect.gen(function* () {
        const data = {}
        const result = yield* Schema.decode(PrConfig)(data)
        expect(result.openBrowser).toBe(true)
      }),
    )

    it.effect("should decode with explicit openBrowser false", () =>
      Effect.gen(function* () {
        const data = { openBrowser: false }
        const result = yield* Schema.decode(PrConfig)(data)
        expect(result.openBrowser).toBe(false)
      }),
    )
  })

  describe("CommitConfig", () => {
    it.effect("should decode with default conventionalFormat true", () =>
      Effect.gen(function* () {
        const data = {}
        const result = yield* Schema.decode(CommitConfig)(data)
        expect(result.conventionalFormat).toBe(true)
      }),
    )

    it.effect("should decode with explicit conventionalFormat false", () =>
      Effect.gen(function* () {
        const data = { conventionalFormat: false }
        const result = yield* Schema.decode(CommitConfig)(data)
        expect(result.conventionalFormat).toBe(false)
      }),
    )
  })

  describe("WorkspaceConfig", () => {
    it.effect("should decode with default basePath", () =>
      Effect.gen(function* () {
        const data = {}
        const result = yield* Schema.decode(WorkspaceConfig)(data)
        expect(result.basePath).toBe(DEFAULT_WORKSPACE_PATH_PATTERN)
      }),
    )

    it.effect("should decode with default autoNavigate true", () =>
      Effect.gen(function* () {
        const data = {}
        const result = yield* Schema.decode(WorkspaceConfig)(data)
        expect(result.autoNavigate).toBe(true)
      }),
    )

    it.effect("should decode with default autoCleanup true", () =>
      Effect.gen(function* () {
        const data = {}
        const result = yield* Schema.decode(WorkspaceConfig)(data)
        expect(result.autoCleanup).toBe(true)
      }),
    )

    it.effect("should decode with custom values", () =>
      Effect.gen(function* () {
        const data = {
          basePath: "../{stack}",
          autoNavigate: false,
          autoCleanup: false,
        }
        const result = yield* Schema.decode(WorkspaceConfig)(data)
        expect(result.basePath).toBe("../{stack}")
        expect(result.autoNavigate).toBe(false)
        expect(result.autoCleanup).toBe(false)
      }),
    )
  })

  describe("ShipConfig", () => {
    it.effect("should decode full config with required fields", () =>
      Effect.gen(function* () {
        const data = {
          linear: {
            teamId: "team-123",
            teamKey: "ENG",
            projectId: null,
          },
          auth: {
            apiKey: "lin_api_xxx",
          },
        }
        const result = yield* Schema.decode(ShipConfig)(data)
        expect(result.linear.teamId).toBe("team-123")
        expect(result.auth.apiKey).toBe("lin_api_xxx")
      }),
    )

    it.effect("should apply defaults for optional configs", () =>
      Effect.gen(function* () {
        const data = {
          linear: {
            teamId: "team-123",
            teamKey: "ENG",
            projectId: null,
          },
          auth: {
            apiKey: "lin_api_xxx",
          },
        }
        const result = yield* Schema.decode(ShipConfig)(data)
        // Check defaults are applied
        expect(result.git.defaultBranch).toBe("main")
        expect(result.pr.openBrowser).toBe(true)
        expect(result.commit.conventionalFormat).toBe(true)
        expect(result.workspace.basePath).toBe(DEFAULT_WORKSPACE_PATH_PATTERN)
      }),
    )

    it.effect("should decode with all fields specified", () =>
      Effect.gen(function* () {
        const data = {
          linear: {
            teamId: "team-123",
            teamKey: "PROD",
            projectId: "proj-1",
          },
          auth: {
            apiKey: "lin_api_yyy",
          },
          git: {
            defaultBranch: "develop",
          },
          pr: {
            openBrowser: false,
          },
          commit: {
            conventionalFormat: false,
          },
          workspace: {
            basePath: "../workspaces/{stack}",
            autoNavigate: false,
            autoCleanup: false,
          },
        }
        const result = yield* Schema.decode(ShipConfig)(data)
        expect(result.linear.teamKey).toBe("PROD")
        expect(result.git.defaultBranch).toBe("develop")
        expect(result.pr.openBrowser).toBe(false)
        expect(result.commit.conventionalFormat).toBe(false)
        expect(result.workspace.basePath).toBe("../workspaces/{stack}")
      }),
    )
  })

  describe("PartialShipConfig", () => {
    it.effect("should decode with all None for required fields", () =>
      Effect.gen(function* () {
        const data = {
          linear: null,
          auth: null,
        }
        const result = yield* Schema.decode(PartialShipConfig)(data)
        expect(Option.isNone(result.linear)).toBe(true)
        expect(Option.isNone(result.auth)).toBe(true)
      }),
    )

    it.effect("should decode with Some for required fields", () =>
      Effect.gen(function* () {
        const data = {
          linear: {
            teamId: "team-123",
            teamKey: "ENG",
            projectId: null,
          },
          auth: {
            apiKey: "lin_api_xxx",
          },
        }
        const result = yield* Schema.decode(PartialShipConfig)(data)
        expect(Option.isSome(result.linear)).toBe(true)
        expect(Option.isSome(result.auth)).toBe(true)
      }),
    )

    it.effect("should apply defaults for optional configs", () =>
      Effect.gen(function* () {
        const data = {
          linear: null,
          auth: null,
        }
        const result = yield* Schema.decode(PartialShipConfig)(data)
        expect(result.git.defaultBranch).toBe("main")
        expect(result.pr.openBrowser).toBe(true)
        expect(result.commit.conventionalFormat).toBe(true)
        expect(result.workspace.basePath).toBe(DEFAULT_WORKSPACE_PATH_PATTERN)
      }),
    )
  })

  describe("WorkspaceMetadata", () => {
    it.effect("should decode valid workspace metadata", () =>
      Effect.gen(function* () {
        const data = {
          name: "bri-123-feature",
          path: "/Users/dev/project/.ship/workspaces/bri-123-feature",
          stackName: "bri-123-feature",
          bookmark: "user/bri-123-feature",
          createdAt: "2024-01-01T00:00:00.000Z",
          taskId: "BRI-123",
        }
        const result = yield* Schema.decode(WorkspaceMetadata)(data)
        expect(result.name).toBe("bri-123-feature")
        expect(result.path).toBe(
          "/Users/dev/project/.ship/workspaces/bri-123-feature",
        )
        expect(result.stackName).toBe("bri-123-feature")
        expect(Option.isSome(result.bookmark)).toBe(true)
        expect(Option.isSome(result.taskId)).toBe(true)
      }),
    )

    it.effect("should handle optional bookmark as None", () =>
      Effect.gen(function* () {
        const data = {
          name: "workspace-1",
          path: "/path/to/workspace",
          stackName: "stack-1",
          bookmark: null,
          createdAt: "2024-01-01T00:00:00.000Z",
          taskId: null,
        }
        const result = yield* Schema.decode(WorkspaceMetadata)(data)
        expect(Option.isNone(result.bookmark)).toBe(true)
        expect(Option.isNone(result.taskId)).toBe(true)
      }),
    )
  })

  describe("WorkspacesFile", () => {
    it.effect("should decode empty workspaces file", () =>
      Effect.gen(function* () {
        const data = { workspaces: [] }
        const result = yield* Schema.decode(WorkspacesFile)(data)
        expect(result.workspaces).toHaveLength(0)
      }),
    )

    it.effect("should decode workspaces file with entries", () =>
      Effect.gen(function* () {
        const data = {
          workspaces: [
            {
              name: "ws-1",
              path: "/path/1",
              stackName: "stack-1",
              bookmark: "bookmark-1",
              createdAt: "2024-01-01T00:00:00.000Z",
              taskId: "TASK-1",
            },
            {
              name: "ws-2",
              path: "/path/2",
              stackName: "stack-2",
              bookmark: null,
              createdAt: "2024-01-02T00:00:00.000Z",
              taskId: null,
            },
          ],
        }
        const result = yield* Schema.decode(WorkspacesFile)(data)
        expect(result.workspaces).toHaveLength(2)
        expect(result.workspaces[0].name).toBe("ws-1")
        expect(result.workspaces[1].name).toBe("ws-2")
      }),
    )
  })
})
