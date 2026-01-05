/**
 * Test Layer for ConfigRepository
 *
 * Provides a mock ConfigRepository implementation for testing that:
 * - Uses in-memory state via Effect Ref
 * - Supports configurable initial state
 * - Exposes _getState() for test assertions
 * - Can simulate both success and failure modes
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";
import type { ConfigRepository as ConfigRepositoryInterface } from "../../src/ports/ConfigRepository.js";
import { ConfigRepository } from "../../src/ports/ConfigRepository.js";
import {
  ShipConfig,
  PartialShipConfig,
  AuthConfig,
  LinearConfig,
  GitConfig,
  PrConfig,
  CommitConfig,
  WorkspaceConfig,
} from "../../src/domain/Config.js";
import { TeamId } from "../../src/domain/Task.js";
import { ConfigError, WorkspaceNotInitializedError } from "../../src/domain/Errors.js";

// === Test State Types ===

export interface TestConfigState {
  /** Full config (null if not initialized) */
  config: ShipConfig | null;
  /** Partial config for initialization flow */
  partialConfig: PartialShipConfig;
  /** Config directory path */
  configDir: string;
  /** Whether config file exists */
  exists: boolean;
  /** Simulated load error */
  loadError: ConfigError | null;
  /** Simulated save error */
  saveError: ConfigError | null;
  /** Track method calls for assertions */
  methodCalls: Array<{ method: string; args: unknown[] }>;
}

const defaultConfig = new ShipConfig({
  linear: new LinearConfig({
    teamId: "test-team-id" as TeamId,
    teamKey: "TEST",
    projectId: Option.none(),
  }),
  auth: new AuthConfig({
    apiKey: "test-api-key",
  }),
  git: new GitConfig({
    defaultBranch: "main",
  }),
  pr: new PrConfig({
    openBrowser: true,
  }),
  commit: new CommitConfig({
    conventionalFormat: true,
  }),
  workspace: new WorkspaceConfig({
    basePath: ".ship/workspaces/{stack}",
    autoNavigate: true,
    autoCleanup: true,
  }),
  notion: Option.none(),
});

export const defaultTestConfigState: TestConfigState = {
  config: defaultConfig,
  partialConfig: new PartialShipConfig({
    linear: Option.some(defaultConfig.linear),
    auth: Option.some(defaultConfig.auth),
    git: defaultConfig.git,
    pr: defaultConfig.pr,
    commit: defaultConfig.commit,
    workspace: defaultConfig.workspace,
    notion: Option.none(),
  }),
  configDir: "/test/.ship",
  exists: true,
  loadError: null,
  saveError: null,
  methodCalls: [],
};

// === Test Layer Factory ===

/**
 * Creates a test ConfigRepository layer with configurable initial state.
 *
 * @example
 * ```typescript
 * it.effect("fails when workspace not initialized", () =>
 *   Effect.gen(function* () {
 *     const repo = yield* ConfigRepository;
 *     const exit = yield* Effect.exit(repo.load());
 *     expect(exit).toEqual(Exit.fail(WorkspaceNotInitializedError.default));
 *   }).pipe(Effect.provide(TestConfigRepositoryLayer({ config: null, exists: false })))
 * );
 * ```
 */
export const TestConfigRepositoryLayer = (
  config?: Partial<TestConfigState>,
): Layer.Layer<ConfigRepository> =>
  Layer.effect(
    ConfigRepository,
    Effect.gen(function* () {
      const initialState: TestConfigState = {
        ...defaultTestConfigState,
        ...config,
        methodCalls: [],
      };

      const stateRef = yield* Ref.make(initialState);

      const trackCall = (method: string, args: unknown[]) =>
        Ref.update(stateRef, (state) => ({
          ...state,
          methodCalls: [...state.methodCalls, { method, args }],
        }));

      const service: ConfigRepositoryInterface = {
        load: () =>
          Effect.gen(function* () {
            yield* trackCall("load", []);
            const state = yield* Ref.get(stateRef);

            if (state.loadError) {
              return yield* Effect.fail(state.loadError);
            }
            if (!state.exists || !state.config) {
              return yield* Effect.fail(WorkspaceNotInitializedError.default);
            }
            return state.config;
          }),

        loadPartial: () =>
          Effect.gen(function* () {
            yield* trackCall("loadPartial", []);
            const state = yield* Ref.get(stateRef);

            if (state.loadError) {
              return yield* Effect.fail(state.loadError);
            }
            return state.partialConfig;
          }),

        save: (newConfig: ShipConfig) =>
          Effect.gen(function* () {
            yield* trackCall("save", [newConfig]);
            const state = yield* Ref.get(stateRef);

            if (state.saveError) {
              return yield* Effect.fail(state.saveError);
            }

            yield* Ref.update(stateRef, (s) => ({
              ...s,
              config: newConfig,
              exists: true,
              partialConfig: new PartialShipConfig({
                linear: Option.some(newConfig.linear),
                auth: Option.some(newConfig.auth),
                git: newConfig.git,
                pr: newConfig.pr,
                commit: newConfig.commit,
                workspace: newConfig.workspace,
                notion: Option.none(),
              }),
            }));
          }),

        savePartial: (partial: PartialShipConfig) =>
          Effect.gen(function* () {
            yield* trackCall("savePartial", [partial]);
            const state = yield* Ref.get(stateRef);

            if (state.saveError) {
              return yield* Effect.fail(state.saveError);
            }

            yield* Ref.update(stateRef, (s) => ({
              ...s,
              partialConfig: partial,
            }));
          }),

        saveAuth: (auth: AuthConfig) =>
          Effect.gen(function* () {
            yield* trackCall("saveAuth", [auth]);
            const state = yield* Ref.get(stateRef);

            if (state.saveError) {
              return yield* Effect.fail(state.saveError);
            }

            yield* Ref.update(stateRef, (s) => ({
              ...s,
              config: s.config
                ? new ShipConfig({ ...s.config, auth })
                : null,
              partialConfig: new PartialShipConfig({
                ...s.partialConfig,
                auth: Option.some(auth),
                notion: s.partialConfig.notion,
              }),
            }));
          }),

        saveLinear: (linear: LinearConfig) =>
          Effect.gen(function* () {
            yield* trackCall("saveLinear", [linear]);
            const state = yield* Ref.get(stateRef);

            if (state.saveError) {
              return yield* Effect.fail(state.saveError);
            }

            yield* Ref.update(stateRef, (s) => ({
              ...s,
              config: s.config
                ? new ShipConfig({ ...s.config, linear })
                : null,
              partialConfig: new PartialShipConfig({
                ...s.partialConfig,
                linear: Option.some(linear),
                notion: s.partialConfig.notion,
              }),
            }));
          }),

        saveNotion: () =>
          Effect.gen(function* () {
            yield* trackCall("saveNotion", []);
            const state = yield* Ref.get(stateRef);

            if (state.saveError) {
              return yield* Effect.fail(state.saveError);
            }
          }),

        exists: () =>
          Effect.gen(function* () {
            yield* trackCall("exists", []);
            const state = yield* Ref.get(stateRef);

            if (state.loadError) {
              return yield* Effect.fail(state.loadError);
            }
            return state.exists;
          }),

        getConfigDir: () =>
          Effect.gen(function* () {
            yield* trackCall("getConfigDir", []);
            const state = yield* Ref.get(stateRef);
            return state.configDir;
          }),

        ensureConfigDir: () =>
          Effect.gen(function* () {
            yield* trackCall("ensureConfigDir", []);
            const state = yield* Ref.get(stateRef);

            if (state.saveError) {
              return yield* Effect.fail(state.saveError);
            }
          }),

        ensureGitignore: () =>
          Effect.gen(function* () {
            yield* trackCall("ensureGitignore", []);
            const state = yield* Ref.get(stateRef);

            if (state.saveError) {
              return yield* Effect.fail(state.saveError);
            }
          }),

        ensureOpencodeSkill: () =>
          Effect.gen(function* () {
            yield* trackCall("ensureOpencodeSkill", []);
            const state = yield* Ref.get(stateRef);

            if (state.saveError) {
              return yield* Effect.fail(state.saveError);
            }
          }),

        delete: () =>
          Effect.gen(function* () {
            yield* trackCall("delete", []);
            const state = yield* Ref.get(stateRef);

            if (state.saveError) {
              return yield* Effect.fail(state.saveError);
            }

            yield* Ref.update(stateRef, (s) => ({
              ...s,
              config: null,
              exists: false,
              partialConfig: new PartialShipConfig({
                linear: Option.none(),
                auth: Option.none(),
                git: new GitConfig({}),
                pr: new PrConfig({}),
                commit: new CommitConfig({}),
                workspace: new WorkspaceConfig({}),
                notion: Option.none(),
              }),
            }));
          }),
      };

      // Attach state accessor for test assertions
      return Object.assign(service, {
        _getState: () => Ref.get(stateRef),
        _setState: (update: Partial<TestConfigState>) =>
          Ref.update(stateRef, (s) => ({ ...s, ...update })),
      });
    }),
  );

// Type for the extended service with test helpers
export type TestConfigRepository = ConfigRepositoryInterface & {
  _getState: () => Effect.Effect<TestConfigState>;
  _setState: (update: Partial<TestConfigState>) => Effect.Effect<void>;
};
