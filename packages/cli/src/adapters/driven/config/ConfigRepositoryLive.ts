import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as FileSystem from "@effect/platform/FileSystem";
import * as Path from "@effect/platform/Path";
import * as YAML from "yaml";
import {
  AuthConfig,
  GitConfig,
  LinearConfig,
  PartialShipConfig,
  PrConfig,
  CommitConfig,
  ShipConfig,
} from "../../../domain/Config.js";
import { ConfigError, WorkspaceNotInitializedError } from "../../../domain/Errors.js";
import { ConfigRepository } from "../../../ports/ConfigRepository.js";
import { TeamId, ProjectId } from "../../../domain/Task.js";

// Helper to convert config strings to branded types
// These are stored values that we trust as valid IDs
const asTeamId = (s: string): typeof TeamId.Type => s as typeof TeamId.Type;
const asProjectId = (s: string): typeof ProjectId.Type => s as typeof ProjectId.Type;

const CONFIG_DIR = ".ship";
const CONFIG_FILE = "config.yaml";

// YAML representation (with optional fields for partial configs)
const YamlConfig = Schema.Struct({
  linear: Schema.optional(
    Schema.Struct({
      teamId: Schema.String,
      teamKey: Schema.String,
      projectId: Schema.NullOr(Schema.String),
    }),
  ),
  auth: Schema.optional(
    Schema.Struct({
      apiKey: Schema.String,
    }),
  ),
  git: Schema.optional(
    Schema.Struct({
      defaultBranch: Schema.optional(Schema.String),
    }),
  ),
  pr: Schema.optional(
    Schema.Struct({
      openBrowser: Schema.optional(Schema.Boolean),
    }),
  ),
  commit: Schema.optional(
    Schema.Struct({
      conventionalFormat: Schema.optional(Schema.Boolean),
    }),
  ),
});

type YamlConfig = typeof YamlConfig.Type;

interface MutableYamlConfig {
  linear?: {
    teamId: string;
    teamKey: string;
    projectId: string | null;
  };
  auth?: {
    apiKey: string;
  };
  git?: {
    defaultBranch?: string;
  };
  pr?: {
    openBrowser?: boolean;
  };
  commit?: {
    conventionalFormat?: boolean;
  };
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const getConfigDir = () => Effect.succeed(path.join(process.cwd(), CONFIG_DIR));

  const getConfigPath = () => Effect.map(getConfigDir(), (dir) => path.join(dir, CONFIG_FILE));

  const ensureConfigDir = () =>
    Effect.gen(function* () {
      const dir = yield* getConfigDir();
      const dirExists = yield* fs.exists(dir);
      if (!dirExists) {
        yield* fs.makeDirectory(dir, { recursive: true });
      }
    }).pipe(
      Effect.catchAll((e) =>
        Effect.fail(new ConfigError({ message: `Failed to create config directory: ${e}` })),
      ),
    );

  const ensureGitignore = () =>
    Effect.gen(function* () {
      const gitignorePath = path.join(process.cwd(), ".gitignore");
      const gitignoreExists = yield* fs.exists(gitignorePath);

      if (gitignoreExists) {
        const content = yield* fs.readFileString(gitignorePath);
        // Check if .ship is already in gitignore
        const lines = content.split("\n");
        const hasShip = lines.some((line) => line.trim() === ".ship" || line.trim() === ".ship/");
        if (!hasShip) {
          // Append .ship to gitignore
          const newContent = content.endsWith("\n") ? `${content}.ship/\n` : `${content}\n.ship/\n`;
          yield* fs.writeFileString(gitignorePath, newContent);
        }
      } else {
        // Create new .gitignore with .ship
        yield* fs.writeFileString(gitignorePath, ".ship/\n");
      }
    }).pipe(
      Effect.catchAll((e) =>
        Effect.fail(new ConfigError({ message: `Failed to update .gitignore: ${e}` })),
      ),
    );

  const exists = () =>
    Effect.gen(function* () {
      const configPath = yield* getConfigPath();
      return yield* fs.exists(configPath);
    }).pipe(Effect.catchAll(() => Effect.succeed(false)));

  const readYaml = (): Effect.Effect<YamlConfig | null, ConfigError> =>
    Effect.gen(function* () {
      const configPath = yield* getConfigPath();
      const fileExists = yield* fs.exists(configPath);
      if (!fileExists) {
        return null;
      }
      const content = yield* fs.readFileString(configPath);

      // Parse YAML
      let parsed: unknown;
      try {
        parsed = YAML.parse(content);
      } catch (e) {
        return yield* Effect.fail(
          new ConfigError({
            message: `Invalid YAML in .ship/config.yaml: ${e instanceof Error ? e.message : e}`,
            cause: e,
          }),
        );
      }

      // Validate schema
      return yield* Schema.decodeUnknown(YamlConfig)(parsed).pipe(
        Effect.mapError(
          (e) =>
            new ConfigError({
              message: `Invalid config in .ship/config.yaml. Run 'ship init' to reconfigure.\nDetails: ${e.message}`,
              cause: e,
            }),
        ),
      );
    }).pipe(
      Effect.catchAll((e) => {
        if (e instanceof ConfigError) {
          return Effect.fail(e);
        }
        return Effect.fail(new ConfigError({ message: `Failed to read config: ${e}`, cause: e }));
      }),
    );

  const writeYaml = (yamlConfig: MutableYamlConfig): Effect.Effect<void, ConfigError> =>
    Effect.gen(function* () {
      yield* ensureConfigDir();
      const configPath = yield* getConfigPath();
      const content = YAML.stringify(yamlConfig);
      yield* fs.writeFileString(configPath, content);
    }).pipe(
      Effect.catchAll((e) =>
        Effect.fail(new ConfigError({ message: `Failed to write config: ${e}`, cause: e })),
      ),
    );

  const yamlToPartial = (yaml: YamlConfig | null): PartialShipConfig => {
    if (!yaml) {
      return new PartialShipConfig({
        linear: Option.none(),
        auth: Option.none(),
      });
    }

    return new PartialShipConfig({
      linear: yaml.linear
        ? Option.some(
            new LinearConfig({
              teamId: asTeamId(yaml.linear.teamId),
              teamKey: yaml.linear.teamKey,
              projectId: yaml.linear.projectId
                ? Option.some(asProjectId(yaml.linear.projectId))
                : Option.none(),
            }),
          )
        : Option.none(),
      auth: yaml.auth ? Option.some(new AuthConfig({ apiKey: yaml.auth.apiKey })) : Option.none(),
    });
  };

  const partialToYaml = (partialConfig: PartialShipConfig): MutableYamlConfig => {
    const yaml: MutableYamlConfig = {};

    if (Option.isSome(partialConfig.linear)) {
      const linear = partialConfig.linear.value;
      yaml.linear = {
        teamId: linear.teamId,
        teamKey: linear.teamKey,
        projectId: Option.isSome(linear.projectId) ? linear.projectId.value : null,
      };
    }

    if (Option.isSome(partialConfig.auth)) {
      yaml.auth = { apiKey: partialConfig.auth.value.apiKey };
    }

    if (partialConfig.git) {
      yaml.git = { defaultBranch: partialConfig.git.defaultBranch };
    }

    if (partialConfig.pr) {
      yaml.pr = { openBrowser: partialConfig.pr.openBrowser };
    }

    if (partialConfig.commit) {
      yaml.commit = { conventionalFormat: partialConfig.commit.conventionalFormat };
    }

    return yaml;
  };

  const fullToYaml = (fullConfig: ShipConfig): MutableYamlConfig => ({
    linear: {
      teamId: fullConfig.linear.teamId,
      teamKey: fullConfig.linear.teamKey,
      projectId: Option.isSome(fullConfig.linear.projectId)
        ? fullConfig.linear.projectId.value
        : null,
    },
    auth: { apiKey: fullConfig.auth.apiKey },
    git: { defaultBranch: fullConfig.git.defaultBranch },
    pr: { openBrowser: fullConfig.pr.openBrowser },
    commit: { conventionalFormat: fullConfig.commit.conventionalFormat },
  });

  const load = (): Effect.Effect<ShipConfig, WorkspaceNotInitializedError | ConfigError> =>
    Effect.gen(function* () {
      const yaml = yield* readYaml();
      if (!yaml || !yaml.linear || !yaml.auth) {
        return yield* Effect.fail(WorkspaceNotInitializedError.default);
      }

      return new ShipConfig({
        linear: new LinearConfig({
          teamId: asTeamId(yaml.linear.teamId),
          teamKey: yaml.linear.teamKey,
          projectId: yaml.linear.projectId
            ? Option.some(asProjectId(yaml.linear.projectId))
            : Option.none(),
        }),
        auth: new AuthConfig({ apiKey: yaml.auth.apiKey }),
        git: new GitConfig({ defaultBranch: yaml.git?.defaultBranch ?? "main" }),
        pr: new PrConfig({ openBrowser: yaml.pr?.openBrowser ?? true }),
        commit: new CommitConfig({ conventionalFormat: yaml.commit?.conventionalFormat ?? true }),
      });
    });

  const loadPartial = () =>
    Effect.gen(function* () {
      const yaml = yield* readYaml();
      return yamlToPartial(yaml);
    });

  const save = (fullConfig: ShipConfig) =>
    Effect.gen(function* () {
      const yaml = fullToYaml(fullConfig);
      yield* writeYaml(yaml);
    });

  const savePartial = (partialConfig: PartialShipConfig) =>
    Effect.gen(function* () {
      const yaml = partialToYaml(partialConfig);
      yield* writeYaml(yaml);
    });

  const saveAuth = (auth: AuthConfig) =>
    Effect.gen(function* () {
      const existingYaml = yield* readYaml();
      const yaml: MutableYamlConfig = {};
      if (existingYaml?.linear) {
        yaml.linear = {
          teamId: existingYaml.linear.teamId,
          teamKey: existingYaml.linear.teamKey,
          projectId: existingYaml.linear.projectId,
        };
      }
      if (existingYaml?.git?.defaultBranch)
        yaml.git = { defaultBranch: existingYaml.git.defaultBranch };
      if (existingYaml?.pr?.openBrowser !== undefined)
        yaml.pr = { openBrowser: existingYaml.pr.openBrowser };
      if (existingYaml?.commit?.conventionalFormat !== undefined)
        yaml.commit = { conventionalFormat: existingYaml.commit.conventionalFormat };
      yaml.auth = { apiKey: auth.apiKey };
      yield* writeYaml(yaml);
    });

  const saveLinear = (linear: LinearConfig) =>
    Effect.gen(function* () {
      const existingYaml = yield* readYaml();
      const yaml: MutableYamlConfig = {};
      if (existingYaml?.auth) {
        yaml.auth = { apiKey: existingYaml.auth.apiKey };
      }
      if (existingYaml?.git?.defaultBranch)
        yaml.git = { defaultBranch: existingYaml.git.defaultBranch };
      if (existingYaml?.pr?.openBrowser !== undefined)
        yaml.pr = { openBrowser: existingYaml.pr.openBrowser };
      if (existingYaml?.commit?.conventionalFormat !== undefined)
        yaml.commit = { conventionalFormat: existingYaml.commit.conventionalFormat };
      yaml.linear = {
        teamId: linear.teamId,
        teamKey: linear.teamKey,
        projectId: Option.isSome(linear.projectId) ? linear.projectId.value : null,
      };
      yield* writeYaml(yaml);
    });

  const deleteConfig = () =>
    Effect.gen(function* () {
      const configPath = yield* getConfigPath();
      const fileExists = yield* fs.exists(configPath);
      if (fileExists) {
        yield* fs.remove(configPath);
      }
    }).pipe(
      Effect.catchAll((e) =>
        Effect.fail(new ConfigError({ message: `Failed to delete config: ${e}`, cause: e })),
      ),
    );

  return {
    load,
    loadPartial,
    save,
    savePartial,
    saveAuth,
    saveLinear,
    exists,
    getConfigDir,
    ensureConfigDir,
    ensureGitignore,
    delete: deleteConfig,
  };
});

export const ConfigRepositoryLive = Layer.effect(ConfigRepository, make);
