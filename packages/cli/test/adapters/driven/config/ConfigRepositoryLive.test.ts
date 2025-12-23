import { describe, it, expect, beforeEach, afterEach } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import * as YAML from "yaml";
import { ConfigRepositoryLive } from "../../../../src/adapters/driven/config/ConfigRepositoryLive.js";
import { ConfigRepository } from "../../../../src/ports/ConfigRepository.js";
import {
  AuthConfig,
  LinearConfig,
  ShipConfig,
  PartialShipConfig,
  GitConfig,
  PrConfig,
  CommitConfig,
} from "../../../../src/domain/Config.js";
import { WorkspaceNotInitializedError, ConfigError } from "../../../../src/domain/Errors.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

// === Test Utilities ===

/**
 * Create a temporary directory for testing.
 * Returns cleanup function and temp path.
 */
const createTempDir = async (): Promise<{ path: string; cleanup: () => Promise<void> }> => {
  const tmpPath = await fs.mkdtemp(path.join(os.tmpdir(), "ship-config-test-"));
  return {
    path: tmpPath,
    cleanup: async () => {
      await fs.rm(tmpPath, { recursive: true, force: true });
    },
  };
};

/**
 * Write a config file in the temp directory
 */
const writeConfigFile = async (tmpDir: string, content: string): Promise<void> => {
  const configDir = path.join(tmpDir, ".ship");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "config.yaml"), content);
};

/**
 * Read config file from temp directory
 */
const readConfigFile = async (tmpDir: string): Promise<string> => {
  return fs.readFile(path.join(tmpDir, ".ship", "config.yaml"), "utf-8");
};

/**
 * Check if config file exists
 */
const configFileExists = async (tmpDir: string): Promise<boolean> => {
  try {
    await fs.access(path.join(tmpDir, ".ship", "config.yaml"));
    return true;
  } catch {
    return false;
  }
};

// Layer that provides FileSystem and Path from Node, then ConfigRepository on top
const PlatformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const TestLayer = ConfigRepositoryLive.pipe(Layer.provide(PlatformLayer));

// Test fixtures
const makeValidYamlConfig = (overrides: Partial<{
  teamId: string;
  teamKey: string;
  projectId: string | null;
  apiKey: string;
  defaultBranch: string;
  openBrowser: boolean;
  conventionalFormat: boolean;
}> = {}): string => {
  const config = {
    linear: {
      teamId: overrides.teamId ?? "team-123",
      teamKey: overrides.teamKey ?? "ENG",
      projectId: overrides.projectId ?? null,
    },
    auth: {
      apiKey: overrides.apiKey ?? "lin_api_test_key",
    },
    ...(overrides.defaultBranch !== undefined && {
      git: { defaultBranch: overrides.defaultBranch },
    }),
    ...(overrides.openBrowser !== undefined && {
      pr: { openBrowser: overrides.openBrowser },
    }),
    ...(overrides.conventionalFormat !== undefined && {
      commit: { conventionalFormat: overrides.conventionalFormat },
    }),
  };
  return YAML.stringify(config);
};

describe("ConfigRepositoryLive Integration", () => {
  let tmpDir: { path: string; cleanup: () => Promise<void> };
  let originalCwd: string;

  beforeEach(async () => {
    tmpDir = await createTempDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir.path);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await tmpDir.cleanup();
  });

  describe("exists", () => {
    it.effect("returns false when config file does not exist", () =>
      Effect.gen(function* () {
        const repo = yield* ConfigRepository;
        const result = yield* repo.exists();
        expect(result).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("returns true when config file exists", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeConfigFile(tmpDir.path, makeValidYamlConfig()));
        const repo = yield* ConfigRepository;
        const result = yield* repo.exists();
        expect(result).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("load", () => {
    it.effect("loads valid config with all required fields", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeConfigFile(
            tmpDir.path,
            makeValidYamlConfig({
              teamId: "team-abc",
              teamKey: "PROD",
              projectId: "proj-123",
              apiKey: "lin_api_secret",
            }),
          ),
        );

        const repo = yield* ConfigRepository;
        const config = yield* repo.load();

        expect(config.linear.teamId).toBe("team-abc");
        expect(config.linear.teamKey).toBe("PROD");
        expect(Option.isSome(config.linear.projectId)).toBe(true);
        expect(Option.getOrNull(config.linear.projectId)).toBe("proj-123");
        expect(config.auth.apiKey).toBe("lin_api_secret");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("applies defaults for optional fields", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeConfigFile(tmpDir.path, makeValidYamlConfig()));

        const repo = yield* ConfigRepository;
        const config = yield* repo.load();

        expect(config.git.defaultBranch).toBe("main");
        expect(config.pr.openBrowser).toBe(true);
        expect(config.commit.conventionalFormat).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("loads config with custom optional fields", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeConfigFile(
            tmpDir.path,
            makeValidYamlConfig({
              defaultBranch: "develop",
              openBrowser: false,
              conventionalFormat: false,
            }),
          ),
        );

        const repo = yield* ConfigRepository;
        const config = yield* repo.load();

        expect(config.git.defaultBranch).toBe("develop");
        expect(config.pr.openBrowser).toBe(false);
        expect(config.commit.conventionalFormat).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("fails with WorkspaceNotInitializedError when config file is missing", () =>
      Effect.gen(function* () {
        const repo = yield* ConfigRepository;
        const result = yield* repo.load().pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(WorkspaceNotInitializedError);
        }
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("fails with WorkspaceNotInitializedError when linear config is missing", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeConfigFile(tmpDir.path, YAML.stringify({ auth: { apiKey: "test" } })),
        );

        const repo = yield* ConfigRepository;
        const result = yield* repo.load().pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(WorkspaceNotInitializedError);
        }
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("fails with WorkspaceNotInitializedError when auth config is missing", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeConfigFile(
            tmpDir.path,
            YAML.stringify({
              linear: { teamId: "t1", teamKey: "T", projectId: null },
            }),
          ),
        );

        const repo = yield* ConfigRepository;
        const result = yield* repo.load().pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(WorkspaceNotInitializedError);
        }
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("fails with ConfigError for invalid YAML syntax", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeConfigFile(tmpDir.path, "invalid: yaml: syntax: ["));

        const repo = yield* ConfigRepository;
        const result = yield* repo.load().pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ConfigError);
          expect((result.left as ConfigError).message).toContain("Invalid YAML");
        }
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("fails with ConfigError for invalid schema", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeConfigFile(
            tmpDir.path,
            YAML.stringify({
              linear: { teamId: 123, teamKey: true }, // Wrong types
              auth: { apiKey: "test" },
            }),
          ),
        );

        const repo = yield* ConfigRepository;
        const result = yield* repo.load().pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ConfigError);
          expect((result.left as ConfigError).message).toContain("Invalid config");
        }
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("loadPartial", () => {
    it.effect("loads partial config when file exists", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeConfigFile(
            tmpDir.path,
            YAML.stringify({
              linear: { teamId: "t1", teamKey: "T", projectId: null },
            }),
          ),
        );

        const repo = yield* ConfigRepository;
        const config = yield* repo.loadPartial();

        expect(Option.isSome(config.linear)).toBe(true);
        expect(Option.isNone(config.auth)).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("returns empty partial config when file does not exist", () =>
      Effect.gen(function* () {
        const repo = yield* ConfigRepository;
        const config = yield* repo.loadPartial();

        expect(Option.isNone(config.linear)).toBe(true);
        expect(Option.isNone(config.auth)).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("save", () => {
    it.effect("creates config directory and file when missing", () =>
      Effect.gen(function* () {
        const repo = yield* ConfigRepository;

        const config = new ShipConfig({
          linear: new LinearConfig({
            teamId: "team-new" as any,
            teamKey: "NEW",
            projectId: Option.none(),
          }),
          auth: new AuthConfig({ apiKey: "new_api_key" }),
          git: new GitConfig({ defaultBranch: "main" }),
          pr: new PrConfig({ openBrowser: true }),
          commit: new CommitConfig({ conventionalFormat: true }),
        });

        yield* repo.save(config);

        const exists = yield* Effect.promise(() => configFileExists(tmpDir.path));
        expect(exists).toBe(true);

        const content = yield* Effect.promise(() => readConfigFile(tmpDir.path));
        const parsed = YAML.parse(content);
        expect(parsed.linear.teamId).toBe("team-new");
        expect(parsed.auth.apiKey).toBe("new_api_key");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("overwrites existing config file", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeConfigFile(tmpDir.path, makeValidYamlConfig()));

        const repo = yield* ConfigRepository;

        const config = new ShipConfig({
          linear: new LinearConfig({
            teamId: "updated-team" as any,
            teamKey: "UPD",
            projectId: Option.some("proj-upd" as any),
          }),
          auth: new AuthConfig({ apiKey: "updated_key" }),
          git: new GitConfig({ defaultBranch: "develop" }),
          pr: new PrConfig({ openBrowser: false }),
          commit: new CommitConfig({ conventionalFormat: false }),
        });

        yield* repo.save(config);

        const content = yield* Effect.promise(() => readConfigFile(tmpDir.path));
        const parsed = YAML.parse(content);
        expect(parsed.linear.teamId).toBe("updated-team");
        expect(parsed.linear.projectId).toBe("proj-upd");
        expect(parsed.git.defaultBranch).toBe("develop");
        expect(parsed.pr.openBrowser).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("saveAuth", () => {
    it.effect("saves auth while preserving existing config", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeConfigFile(
            tmpDir.path,
            makeValidYamlConfig({
              teamId: "existing-team",
              teamKey: "EXS",
              apiKey: "old_key",
            }),
          ),
        );

        const repo = yield* ConfigRepository;
        yield* repo.saveAuth(new AuthConfig({ apiKey: "new_auth_key" }));

        const content = yield* Effect.promise(() => readConfigFile(tmpDir.path));
        const parsed = YAML.parse(content);
        expect(parsed.auth.apiKey).toBe("new_auth_key");
        expect(parsed.linear.teamId).toBe("existing-team");
        expect(parsed.linear.teamKey).toBe("EXS");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("saves auth when no existing config", () =>
      Effect.gen(function* () {
        const repo = yield* ConfigRepository;
        yield* repo.saveAuth(new AuthConfig({ apiKey: "fresh_key" }));

        const content = yield* Effect.promise(() => readConfigFile(tmpDir.path));
        const parsed = YAML.parse(content);
        expect(parsed.auth.apiKey).toBe("fresh_key");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("preserves git, pr, and commit config when updating auth", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeConfigFile(
            tmpDir.path,
            makeValidYamlConfig({
              defaultBranch: "develop",
              openBrowser: false,
              conventionalFormat: false,
            }),
          ),
        );

        const repo = yield* ConfigRepository;
        yield* repo.saveAuth(new AuthConfig({ apiKey: "updated_key" }));

        const content = yield* Effect.promise(() => readConfigFile(tmpDir.path));
        const parsed = YAML.parse(content);
        expect(parsed.git.defaultBranch).toBe("develop");
        expect(parsed.pr.openBrowser).toBe(false);
        expect(parsed.commit.conventionalFormat).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("saveLinear", () => {
    it.effect("saves linear config while preserving auth", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeConfigFile(tmpDir.path, makeValidYamlConfig({ apiKey: "existing_key" })),
        );

        const repo = yield* ConfigRepository;
        yield* repo.saveLinear(
          new LinearConfig({
            teamId: "new-team" as any,
            teamKey: "NEW",
            projectId: Option.some("new-proj" as any),
          }),
        );

        const content = yield* Effect.promise(() => readConfigFile(tmpDir.path));
        const parsed = YAML.parse(content);
        expect(parsed.linear.teamId).toBe("new-team");
        expect(parsed.linear.teamKey).toBe("NEW");
        expect(parsed.linear.projectId).toBe("new-proj");
        expect(parsed.auth.apiKey).toBe("existing_key");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("saves linear config with null projectId", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeConfigFile(tmpDir.path, makeValidYamlConfig()));

        const repo = yield* ConfigRepository;
        yield* repo.saveLinear(
          new LinearConfig({
            teamId: "team-x" as any,
            teamKey: "X",
            projectId: Option.none(),
          }),
        );

        const content = yield* Effect.promise(() => readConfigFile(tmpDir.path));
        const parsed = YAML.parse(content);
        expect(parsed.linear.projectId).toBeNull();
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("delete", () => {
    it.effect("deletes existing config file", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeConfigFile(tmpDir.path, makeValidYamlConfig()));

        const repo = yield* ConfigRepository;
        yield* repo.delete();

        const exists = yield* Effect.promise(() => configFileExists(tmpDir.path));
        expect(exists).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("succeeds even when config file does not exist", () =>
      Effect.gen(function* () {
        const repo = yield* ConfigRepository;
        const result = yield* repo.delete().pipe(Effect.either);
        expect(result._tag).toBe("Right");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("ensureConfigDir", () => {
    it.effect("creates .ship directory when it does not exist", () =>
      Effect.gen(function* () {
        const repo = yield* ConfigRepository;
        yield* repo.ensureConfigDir();

        const dirExists = yield* Effect.promise(async () => {
          try {
            await fs.access(path.join(tmpDir.path, ".ship"));
            return true;
          } catch {
            return false;
          }
        });
        expect(dirExists).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("succeeds when .ship directory already exists", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(tmpDir.path, ".ship"), { recursive: true }));

        const repo = yield* ConfigRepository;
        const result = yield* repo.ensureConfigDir().pipe(Effect.either);
        expect(result._tag).toBe("Right");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("ensureGitignore", () => {
    it.effect("creates .gitignore with .ship/ when it does not exist", () =>
      Effect.gen(function* () {
        const repo = yield* ConfigRepository;
        yield* repo.ensureGitignore();

        const content = yield* Effect.promise(() =>
          fs.readFile(path.join(tmpDir.path, ".gitignore"), "utf-8"),
        );
        expect(content).toContain(".ship/");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("appends .ship/ to existing .gitignore without it", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          fs.writeFile(path.join(tmpDir.path, ".gitignore"), "node_modules/\n"),
        );

        const repo = yield* ConfigRepository;
        yield* repo.ensureGitignore();

        const content = yield* Effect.promise(() =>
          fs.readFile(path.join(tmpDir.path, ".gitignore"), "utf-8"),
        );
        expect(content).toContain("node_modules/");
        expect(content).toContain(".ship/");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("does not duplicate .ship/ in .gitignore", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          fs.writeFile(path.join(tmpDir.path, ".gitignore"), "node_modules/\n.ship/\n"),
        );

        const repo = yield* ConfigRepository;
        yield* repo.ensureGitignore();

        const content = yield* Effect.promise(() =>
          fs.readFile(path.join(tmpDir.path, ".gitignore"), "utf-8"),
        );
        const matches = content.match(/\.ship\//g);
        expect(matches).toHaveLength(1);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("handles .gitignore without trailing newline", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          fs.writeFile(path.join(tmpDir.path, ".gitignore"), "node_modules/"),
        );

        const repo = yield* ConfigRepository;
        yield* repo.ensureGitignore();

        const content = yield* Effect.promise(() =>
          fs.readFile(path.join(tmpDir.path, ".gitignore"), "utf-8"),
        );
        expect(content).toContain("node_modules/");
        expect(content).toContain(".ship/");
        // Should have added newline before .ship/
        expect(content).toMatch(/node_modules\/\n\.ship\//);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("getConfigDir", () => {
    it.effect("returns path to .ship directory", () =>
      Effect.gen(function* () {
        const repo = yield* ConfigRepository;
        const dir = yield* repo.getConfigDir();
        // Use endsWith to handle macOS /private symlink resolution
        expect(dir.endsWith(".ship")).toBe(true);
        expect(dir).toContain("ship-config-test-");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("savePartial", () => {
    it.effect("saves partial config with only linear", () =>
      Effect.gen(function* () {
        const repo = yield* ConfigRepository;

        const partial = new PartialShipConfig({
          linear: Option.some(
            new LinearConfig({
              teamId: "partial-team" as any,
              teamKey: "PRT",
              projectId: Option.none(),
            }),
          ),
          auth: Option.none(),
        });

        yield* repo.savePartial(partial);

        const content = yield* Effect.promise(() => readConfigFile(tmpDir.path));
        const parsed = YAML.parse(content);
        expect(parsed.linear.teamId).toBe("partial-team");
        expect(parsed.auth).toBeUndefined();
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("saves partial config with only auth", () =>
      Effect.gen(function* () {
        const repo = yield* ConfigRepository;

        const partial = new PartialShipConfig({
          linear: Option.none(),
          auth: Option.some(new AuthConfig({ apiKey: "partial_key" })),
        });

        yield* repo.savePartial(partial);

        const content = yield* Effect.promise(() => readConfigFile(tmpDir.path));
        const parsed = YAML.parse(content);
        expect(parsed.auth.apiKey).toBe("partial_key");
        expect(parsed.linear).toBeUndefined();
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("edge cases", () => {
    it.effect("handles empty config file", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeConfigFile(tmpDir.path, ""));

        const repo = yield* ConfigRepository;
        const result = yield* repo.load().pipe(Effect.either);

        // Empty file should be treated as missing required fields
        expect(result._tag).toBe("Left");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("handles config file with only comments", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeConfigFile(tmpDir.path, "# This is a comment\n"));

        const repo = yield* ConfigRepository;
        const result = yield* repo.load().pipe(Effect.either);

        expect(result._tag).toBe("Left");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.effect("handles config with extra unknown fields (should be ignored)", () =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeConfigFile(
            tmpDir.path,
            YAML.stringify({
              linear: { teamId: "t1", teamKey: "T", projectId: null },
              auth: { apiKey: "key" },
              unknownField: "should be ignored",
              anotherUnknown: { nested: true },
            }),
          ),
        );

        const repo = yield* ConfigRepository;
        const config = yield* repo.load();

        expect(config.linear.teamId).toBe("t1");
        expect(config.auth.apiKey).toBe("key");
      }).pipe(Effect.provide(TestLayer)),
    );
  });
});
