import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type { AuthConfig, LinearConfig, PartialShipConfig, ShipConfig } from "../domain/Config.js";
import type { ConfigError, WorkspaceNotInitializedError } from "../domain/Errors.js";

export interface ConfigRepository {
  readonly load: () => Effect.Effect<ShipConfig, WorkspaceNotInitializedError | ConfigError>;
  readonly loadPartial: () => Effect.Effect<PartialShipConfig, ConfigError>;
  readonly save: (config: ShipConfig) => Effect.Effect<void, ConfigError>;
  readonly savePartial: (config: PartialShipConfig) => Effect.Effect<void, ConfigError>;
  readonly saveAuth: (auth: AuthConfig) => Effect.Effect<void, ConfigError>;
  readonly saveLinear: (linear: LinearConfig) => Effect.Effect<void, ConfigError>;
  readonly exists: () => Effect.Effect<boolean, ConfigError>;
  readonly getConfigDir: () => Effect.Effect<string, never>;
  readonly ensureConfigDir: () => Effect.Effect<void, ConfigError>;
  readonly ensureGitignore: () => Effect.Effect<void, ConfigError>;
  readonly delete: () => Effect.Effect<void, ConfigError>;
}

export const ConfigRepository = Context.GenericTag<ConfigRepository>("ConfigRepository");
