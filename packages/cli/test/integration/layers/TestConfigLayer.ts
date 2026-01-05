/**
 * Test layer for ConfigRepository with configurable test data.
 *
 * Provides a ConfigRepository that can be configured with test data,
 * allowing integration tests to test configuration loading/saving.
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../src/ports/ConfigRepository.js";
import {
  AuthConfig,
  GitConfig,
  LinearConfig,
  PartialShipConfig,
  PrConfig,
  CommitConfig,
  ShipConfig,
} from "../../../src/domain/Config.js";
import { WorkspaceNotInitializedError } from "../../../src/domain/Errors.js";
import type { TeamId, ProjectId } from "../../../src/domain/Task.js";

/**
 * Test configuration options.
 */
export interface TestConfigOptions {
  /** Linear team ID */
  readonly teamId?: string;
  /** Linear team key */
  readonly teamKey?: string;
  /** Linear project ID (optional) */
  readonly projectId?: string | null;
  /** Linear API key */
  readonly apiKey?: string;
  /** Git default branch */
  readonly defaultBranch?: string;
  /** Whether to open browser for PRs */
  readonly openBrowser?: boolean;
  /** Whether to use conventional commit format */
  readonly conventionalFormat?: boolean;
  /** Whether config exists (for testing uninitialized state) */
  readonly configExists?: boolean;
}

const DEFAULT_OPTIONS: Required<TestConfigOptions> = {
  teamId: "test-team-id",
  teamKey: "TEST",
  projectId: null,
  apiKey: "test-api-key",
  defaultBranch: "main",
  openBrowser: false,
  conventionalFormat: true,
  configExists: true,
};

/**
 * Create an in-memory ConfigRepository for testing.
 *
 * @param options - Configuration options for the test
 */
const makeTestConfigRepository = (
  options: TestConfigOptions = {},
): Effect.Effect<ConfigRepository, never> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let storedConfig: ShipConfig | null = opts.configExists
    ? new ShipConfig({
        linear: new LinearConfig({
          teamId: opts.teamId as unknown as typeof TeamId.Type,
          teamKey: opts.teamKey,
          projectId: opts.projectId
            ? Option.some(opts.projectId as unknown as typeof ProjectId.Type)
            : Option.none(),
        }),
        auth: new AuthConfig({ apiKey: opts.apiKey }),
        git: new GitConfig({ defaultBranch: opts.defaultBranch }),
        pr: new PrConfig({ openBrowser: opts.openBrowser }),
        commit: new CommitConfig({ conventionalFormat: opts.conventionalFormat }),
        notion: Option.none(),
      })
    : null;

  return Effect.succeed({
    load: () =>
      storedConfig
        ? Effect.succeed(storedConfig)
        : Effect.fail(WorkspaceNotInitializedError.default),

    loadPartial: () =>
      Effect.succeed(
        storedConfig
          ? new PartialShipConfig({
              linear: Option.some(storedConfig.linear),
              auth: Option.some(storedConfig.auth),
              notion: Option.none(),
            })
          : new PartialShipConfig({
              linear: Option.none(),
              auth: Option.none(),
              notion: Option.none(),
            }),
      ),

    save: (config: ShipConfig) => {
      storedConfig = config;
      return Effect.void;
    },

    savePartial: (partial: PartialShipConfig) => {
      // Merge partial into existing or create new
      if (storedConfig && Option.isSome(partial.linear) && Option.isSome(partial.auth)) {
        storedConfig = new ShipConfig({
          linear: partial.linear.value,
          auth: partial.auth.value,
          git: partial.git ?? storedConfig.git,
          pr: partial.pr ?? storedConfig.pr,
          commit: partial.commit ?? storedConfig.commit,
          notion: Option.none(),
        });
      }
      return Effect.void;
    },

    saveAuth: (auth: AuthConfig) => {
      if (storedConfig) {
        storedConfig = new ShipConfig({
          ...storedConfig,
          auth,
        });
      }
      return Effect.void;
    },

    saveLinear: (linear: LinearConfig) => {
      if (storedConfig) {
        storedConfig = new ShipConfig({
          ...storedConfig,
          linear,
        });
      }
      return Effect.void;
    },

    exists: () => Effect.succeed(storedConfig !== null),

    getConfigDir: () => Effect.succeed("/tmp/test-config"),

    ensureConfigDir: () => Effect.void,

    ensureGitignore: () => Effect.void,

    ensureOpencodeSkill: () => Effect.void,

    delete: () => {
      storedConfig = null;
      return Effect.void;
    },
  } satisfies ConfigRepository);
};

/**
 * Create a test ConfigRepository layer with custom options.
 *
 * @param options - Configuration options for the test
 */
export const makeTestConfigLayer = (options: TestConfigOptions = {}) =>
  Layer.effect(ConfigRepository, makeTestConfigRepository(options));

/**
 * Default test ConfigRepository layer with typical test values.
 */
export const TestConfigLayer = makeTestConfigLayer();

/**
 * Test ConfigRepository layer that simulates uninitialized workspace.
 */
export const UninitializedConfigLayer = makeTestConfigLayer({ configExists: false });
