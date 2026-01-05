import { describe, it, expect } from "@effect/vitest";
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

// === Effect-Managed Test Resources ===

/**
 * TempDir resource that creates a temp directory and changes process.cwd to it.
 * Uses Effect.acquireRelease to guarantee cleanup even on test failure.
 */
const TempDirResource = Effect.acquireRelease(
  Effect.promise(async () => {
    const tmpPath = await fs.mkdtemp(path.join(os.tmpdir(), "ship-config-test-"));
    const originalCwd = process.cwd();
    process.chdir(tmpPath);
    return { path: tmpPath, originalCwd };
  }),
  ({ path: tmpPath, originalCwd }) =>
    Effect.promise(async () => {
      process.chdir(originalCwd);
      await fs.rm(tmpPath, { recursive: true, force: true });
    }),
);

/**
 * Write a config file in the temp directory
 */
const writeConfigFile = (tmpDir: string, content: string): Effect.Effect<void> =>
  Effect.promise(async () => {
    const configDir = path.join(tmpDir, ".ship");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, "config.yaml"), content);
  });

/**
 * Read config file from temp directory
 */
const readConfigFile = (tmpDir: string): Effect.Effect<string> =>
  Effect.promise(() => fs.readFile(path.join(tmpDir, ".ship", "config.yaml"), "utf-8"));

/**
 * Check if config file exists
 */
const configFileExists = (tmpDir: string): Effect.Effect<boolean> =>
  Effect.promise(async () => {
    try {
      await fs.access(path.join(tmpDir, ".ship", "config.yaml"));
      return true;
    } catch {
      return false;
    }
  });

// Layer that provides FileSystem and Path from Node, then ConfigRepository on top
const PlatformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const TestLayer = ConfigRepositoryLive.pipe(Layer.provide(PlatformLayer));

// Test fixtures
const makeValidYamlConfig = (
  overrides: Partial<{
    teamId: string;
    teamKey: string;
    projectId: string | null;
    apiKey: string;
    defaultBranch: string;
    openBrowser: boolean;
    conventionalFormat: boolean;
  }> = {},
): string => {
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
  describe("exists", () => {
    it.scoped("returns false when config file does not exist", () =>
      Effect.gen(function* () {
        yield* TempDirResource;

        const repo = yield* ConfigRepository;
        const result = yield* repo.exists();
        expect(result).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("returns true when config file exists", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(tmpPath, makeValidYamlConfig());

        const repo = yield* ConfigRepository;
        const result = yield* repo.exists();
        expect(result).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("load", () => {
    it.scoped("loads valid config with all required fields", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(
          tmpPath,
          makeValidYamlConfig({
            teamId: "team-abc",
            teamKey: "PROD",
            projectId: "proj-123",
            apiKey: "lin_api_secret",
          }),
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

    it.scoped("applies defaults for optional fields", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(tmpPath, makeValidYamlConfig());

        const repo = yield* ConfigRepository;
        const config = yield* repo.load();

        expect(config.git.defaultBranch).toBe("main");
        expect(config.pr.openBrowser).toBe(true);
        expect(config.commit.conventionalFormat).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("loads config with custom optional fields", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(
          tmpPath,
          makeValidYamlConfig({
            defaultBranch: "develop",
            openBrowser: false,
            conventionalFormat: false,
          }),
        );

        const repo = yield* ConfigRepository;
        const config = yield* repo.load();

        expect(config.git.defaultBranch).toBe("develop");
        expect(config.pr.openBrowser).toBe(false);
        expect(config.commit.conventionalFormat).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("fails with WorkspaceNotInitializedError when config file is missing", () =>
      Effect.gen(function* () {
        yield* TempDirResource;

        const repo = yield* ConfigRepository;
        const result = yield* repo.load().pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(WorkspaceNotInitializedError);
        }
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("fails with WorkspaceNotInitializedError when linear config is missing", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(tmpPath, YAML.stringify({ auth: { apiKey: "test" } }));

        const repo = yield* ConfigRepository;
        const result = yield* repo.load().pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(WorkspaceNotInitializedError);
        }
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("fails with WorkspaceNotInitializedError when auth config is missing", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(
          tmpPath,
          YAML.stringify({
            linear: { teamId: "t1", teamKey: "T", projectId: null },
          }),
        );

        const repo = yield* ConfigRepository;
        const result = yield* repo.load().pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(WorkspaceNotInitializedError);
        }
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("fails with ConfigError for invalid YAML syntax", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(tmpPath, "invalid: yaml: syntax: [");

        const repo = yield* ConfigRepository;
        const result = yield* repo.load().pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ConfigError);
          expect((result.left as ConfigError).message).toContain("Invalid YAML");
        }
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("fails with ConfigError for invalid schema", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(
          tmpPath,
          YAML.stringify({
            linear: { teamId: 123, teamKey: true }, // Wrong types
            auth: { apiKey: "test" },
          }),
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
    it.scoped("loads partial config when file exists", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(
          tmpPath,
          YAML.stringify({
            linear: { teamId: "t1", teamKey: "T", projectId: null },
          }),
        );

        const repo = yield* ConfigRepository;
        const config = yield* repo.loadPartial();

        expect(Option.isSome(config.linear)).toBe(true);
        expect(Option.isNone(config.auth)).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("returns empty partial config when file does not exist", () =>
      Effect.gen(function* () {
        yield* TempDirResource;

        const repo = yield* ConfigRepository;
        const config = yield* repo.loadPartial();

        expect(Option.isNone(config.linear)).toBe(true);
        expect(Option.isNone(config.auth)).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("save", () => {
    it.scoped("creates config directory and file when missing", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;

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
          notion: Option.none(),
        });

        yield* repo.save(config);

        const exists = yield* configFileExists(tmpPath);
        expect(exists).toBe(true);

        const content = yield* readConfigFile(tmpPath);
        const parsed = YAML.parse(content);
        expect(parsed.linear.teamId).toBe("team-new");
        expect(parsed.auth.apiKey).toBe("new_api_key");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("overwrites existing config file", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(tmpPath, makeValidYamlConfig());

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
          notion: Option.none(),
        });

        yield* repo.save(config);

        const content = yield* readConfigFile(tmpPath);
        const parsed = YAML.parse(content);
        expect(parsed.linear.teamId).toBe("updated-team");
        expect(parsed.linear.projectId).toBe("proj-upd");
        expect(parsed.git.defaultBranch).toBe("develop");
        expect(parsed.pr.openBrowser).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("saveAuth", () => {
    it.scoped("saves auth while preserving existing config", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(
          tmpPath,
          makeValidYamlConfig({
            teamId: "existing-team",
            teamKey: "EXS",
            apiKey: "old_key",
          }),
        );

        const repo = yield* ConfigRepository;
        yield* repo.saveAuth(new AuthConfig({ apiKey: "new_auth_key" }));

        const content = yield* readConfigFile(tmpPath);
        const parsed = YAML.parse(content);
        expect(parsed.auth.apiKey).toBe("new_auth_key");
        expect(parsed.linear.teamId).toBe("existing-team");
        expect(parsed.linear.teamKey).toBe("EXS");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("saves auth when no existing config", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;

        const repo = yield* ConfigRepository;
        yield* repo.saveAuth(new AuthConfig({ apiKey: "fresh_key" }));

        const content = yield* readConfigFile(tmpPath);
        const parsed = YAML.parse(content);
        expect(parsed.auth.apiKey).toBe("fresh_key");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("preserves git, pr, and commit config when updating auth", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(
          tmpPath,
          makeValidYamlConfig({
            defaultBranch: "develop",
            openBrowser: false,
            conventionalFormat: false,
          }),
        );

        const repo = yield* ConfigRepository;
        yield* repo.saveAuth(new AuthConfig({ apiKey: "updated_key" }));

        const content = yield* readConfigFile(tmpPath);
        const parsed = YAML.parse(content);
        expect(parsed.git.defaultBranch).toBe("develop");
        expect(parsed.pr.openBrowser).toBe(false);
        expect(parsed.commit.conventionalFormat).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("saveLinear", () => {
    it.scoped("saves linear config while preserving auth", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(tmpPath, makeValidYamlConfig({ apiKey: "existing_key" }));

        const repo = yield* ConfigRepository;
        yield* repo.saveLinear(
          new LinearConfig({
            teamId: "new-team" as any,
            teamKey: "NEW",
            projectId: Option.some("new-proj" as any),
          }),
        );

        const content = yield* readConfigFile(tmpPath);
        const parsed = YAML.parse(content);
        expect(parsed.linear.teamId).toBe("new-team");
        expect(parsed.linear.teamKey).toBe("NEW");
        expect(parsed.linear.projectId).toBe("new-proj");
        expect(parsed.auth.apiKey).toBe("existing_key");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("saves linear config with null projectId", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(tmpPath, makeValidYamlConfig());

        const repo = yield* ConfigRepository;
        yield* repo.saveLinear(
          new LinearConfig({
            teamId: "team-x" as any,
            teamKey: "X",
            projectId: Option.none(),
          }),
        );

        const content = yield* readConfigFile(tmpPath);
        const parsed = YAML.parse(content);
        expect(parsed.linear.projectId).toBeNull();
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("delete", () => {
    it.scoped("deletes existing config file", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(tmpPath, makeValidYamlConfig());

        const repo = yield* ConfigRepository;
        yield* repo.delete();

        const exists = yield* configFileExists(tmpPath);
        expect(exists).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("succeeds even when config file does not exist", () =>
      Effect.gen(function* () {
        yield* TempDirResource;

        const repo = yield* ConfigRepository;
        const result = yield* repo.delete().pipe(Effect.either);
        expect(result._tag).toBe("Right");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("ensureConfigDir", () => {
    it.scoped("creates .ship directory when it does not exist", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;

        const repo = yield* ConfigRepository;
        yield* repo.ensureConfigDir();

        const dirExists = yield* Effect.promise(async () => {
          try {
            await fs.access(path.join(tmpPath, ".ship"));
            return true;
          } catch {
            return false;
          }
        });
        expect(dirExists).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("succeeds when .ship directory already exists", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* Effect.promise(() => fs.mkdir(path.join(tmpPath, ".ship"), { recursive: true }));

        const repo = yield* ConfigRepository;
        const result = yield* repo.ensureConfigDir().pipe(Effect.either);
        expect(result._tag).toBe("Right");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("ensureGitignore", () => {
    it.scoped("creates .gitignore with .ship/ when it does not exist", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;

        const repo = yield* ConfigRepository;
        yield* repo.ensureGitignore();

        const content = yield* Effect.promise(() =>
          fs.readFile(path.join(tmpPath, ".gitignore"), "utf-8"),
        );
        expect(content).toContain(".ship/");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("appends .ship/ to existing .gitignore without it", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* Effect.promise(() =>
          fs.writeFile(path.join(tmpPath, ".gitignore"), "node_modules/\n"),
        );

        const repo = yield* ConfigRepository;
        yield* repo.ensureGitignore();

        const content = yield* Effect.promise(() =>
          fs.readFile(path.join(tmpPath, ".gitignore"), "utf-8"),
        );
        expect(content).toContain("node_modules/");
        expect(content).toContain(".ship/");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("does not duplicate .ship/ in .gitignore", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* Effect.promise(() =>
          fs.writeFile(path.join(tmpPath, ".gitignore"), "node_modules/\n.ship/\n"),
        );

        const repo = yield* ConfigRepository;
        yield* repo.ensureGitignore();

        const content = yield* Effect.promise(() =>
          fs.readFile(path.join(tmpPath, ".gitignore"), "utf-8"),
        );
        const matches = content.match(/\.ship\//g);
        expect(matches).toHaveLength(1);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("handles .gitignore without trailing newline", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* Effect.promise(() =>
          fs.writeFile(path.join(tmpPath, ".gitignore"), "node_modules/"),
        );

        const repo = yield* ConfigRepository;
        yield* repo.ensureGitignore();

        const content = yield* Effect.promise(() =>
          fs.readFile(path.join(tmpPath, ".gitignore"), "utf-8"),
        );
        expect(content).toContain("node_modules/");
        expect(content).toContain(".ship/");
        // Should have added newline before .ship/
        expect(content).toMatch(/node_modules\/\n\.ship\//);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("getConfigDir", () => {
    it.scoped("returns path to .ship directory", () =>
      Effect.gen(function* () {
        yield* TempDirResource;

        const repo = yield* ConfigRepository;
        const dir = yield* repo.getConfigDir();
        // Use endsWith to handle macOS /private symlink resolution
        expect(dir.endsWith(".ship")).toBe(true);
        expect(dir).toContain("ship-config-test-");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("savePartial", () => {
    it.scoped("saves partial config with only linear", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;

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
          notion: Option.none(),
        });

        yield* repo.savePartial(partial);

        const content = yield* readConfigFile(tmpPath);
        const parsed = YAML.parse(content);
        expect(parsed.linear.teamId).toBe("partial-team");
        expect(parsed.auth).toBeUndefined();
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("saves partial config with only auth", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;

        const repo = yield* ConfigRepository;

        const partial = new PartialShipConfig({
          linear: Option.none(),
          auth: Option.some(new AuthConfig({ apiKey: "partial_key" })),
          notion: Option.none(),
        });

        yield* repo.savePartial(partial);

        const content = yield* readConfigFile(tmpPath);
        const parsed = YAML.parse(content);
        expect(parsed.auth.apiKey).toBe("partial_key");
        expect(parsed.linear).toBeUndefined();
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("edge cases", () => {
    it.scoped("handles empty config file", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(tmpPath, "");

        const repo = yield* ConfigRepository;
        const result = yield* repo.load().pipe(Effect.either);

        // Empty file should be treated as missing required fields
        expect(result._tag).toBe("Left");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("handles config file with only comments", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(tmpPath, "# This is a comment\n");

        const repo = yield* ConfigRepository;
        const result = yield* repo.load().pipe(Effect.either);

        expect(result._tag).toBe("Left");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("handles config with extra unknown fields (should be ignored)", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeConfigFile(
          tmpPath,
          YAML.stringify({
            linear: { teamId: "t1", teamKey: "T", projectId: null },
            auth: { apiKey: "key" },
            unknownField: "should be ignored",
            anotherUnknown: { nested: true },
          }),
        );

        const repo = yield* ConfigRepository;
        const config = yield* repo.load();

        expect(config.linear.teamId).toBe("t1");
        expect(config.auth.apiKey).toBe("key");
      }).pipe(Effect.provide(TestLayer)),
    );
  });
});
