import { describe, it, expect } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import * as YAML from "yaml";
import { TemplateServiceLive } from "../../../../src/adapters/driven/template/TemplateServiceLive.js";
import { ConfigRepositoryLive } from "../../../../src/adapters/driven/config/ConfigRepositoryLive.js";
import { TemplateService } from "../../../../src/ports/TemplateService.js";
import { TemplateNotFoundError, TemplateError } from "../../../../src/domain/Errors.js";
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
    const tmpPath = await fs.mkdtemp(path.join(os.tmpdir(), "ship-template-test-"));
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
 * Write a template file in the temp directory
 */
const writeTemplateFile = (
  tmpDir: string,
  name: string,
  content: string,
  extension: string = "yaml",
): Effect.Effect<void> =>
  Effect.promise(async () => {
    const templatesDir = path.join(tmpDir, ".ship", "templates");
    await fs.mkdir(templatesDir, { recursive: true });
    await fs.writeFile(path.join(templatesDir, `${name}.${extension}`), content);
  });

/**
 * Ensure templates directory exists
 */
const ensureTemplatesDir = (tmpDir: string): Effect.Effect<void> =>
  Effect.promise(async () => {
    const templatesDir = path.join(tmpDir, ".ship", "templates");
    await fs.mkdir(templatesDir, { recursive: true });
  });

/**
 * Write an arbitrary file in the templates directory (for testing non-yaml files)
 */
const writeArbitraryFile = (
  tmpDir: string,
  filename: string,
  content: string,
): Effect.Effect<void> =>
  Effect.promise(async () => {
    const templatesDir = path.join(tmpDir, ".ship", "templates");
    await fs.mkdir(templatesDir, { recursive: true });
    await fs.writeFile(path.join(templatesDir, filename), content);
  });

// Layer that provides all dependencies for TemplateService
const PlatformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const ConfigLayer = ConfigRepositoryLive.pipe(Layer.provide(PlatformLayer));
const TestLayer = TemplateServiceLive.pipe(
  Layer.provide(ConfigLayer),
  Layer.provide(PlatformLayer),
);

// Test fixtures
const makeValidTemplate = (
  overrides: Partial<{
    name: string;
    title: string;
    description: string;
    priority: string;
    type: string;
  }> = {},
): string => {
  const template: Record<string, unknown> = {};
  if (overrides.name !== undefined) template.name = overrides.name;
  if (overrides.title !== undefined) template.title = overrides.title;
  if (overrides.description !== undefined) template.description = overrides.description;
  if (overrides.priority !== undefined) template.priority = overrides.priority;
  if (overrides.type !== undefined) template.type = overrides.type;
  return YAML.stringify(template);
};

describe("TemplateServiceLive Integration", () => {
  describe("hasTemplates", () => {
    it.scoped("returns false when templates directory does not exist", () =>
      Effect.gen(function* () {
        yield* TempDirResource;

        const service = yield* TemplateService;
        const result = yield* service.hasTemplates();
        expect(result).toBe(false);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("returns true when templates directory exists", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* ensureTemplatesDir(tmpPath);

        const service = yield* TemplateService;
        const result = yield* service.hasTemplates();
        expect(result).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("returns true when templates directory exists with files", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(tmpPath, "bug", makeValidTemplate({ name: "bug" }));

        const service = yield* TemplateService;
        const result = yield* service.hasTemplates();
        expect(result).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("listTemplates", () => {
    it.scoped("returns empty array when templates directory does not exist", () =>
      Effect.gen(function* () {
        yield* TempDirResource;

        const service = yield* TemplateService;
        const templates = yield* service.listTemplates();
        expect(templates).toHaveLength(0);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("returns empty array when templates directory is empty", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* ensureTemplatesDir(tmpPath);

        const service = yield* TemplateService;
        const templates = yield* service.listTemplates();
        expect(templates).toHaveLength(0);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("lists all .yaml templates in directory", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(tmpPath, "bug", makeValidTemplate({ name: "bug" }));
        yield* writeTemplateFile(tmpPath, "feature", makeValidTemplate({ name: "feature" }));
        yield* writeTemplateFile(tmpPath, "chore", makeValidTemplate({ name: "chore" }));

        const service = yield* TemplateService;
        const templates = yield* service.listTemplates();

        expect(templates).toHaveLength(3);
        const names = templates.map((t) => t.name);
        expect(names).toContain("bug");
        expect(names).toContain("feature");
        expect(names).toContain("chore");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("lists .yml templates alongside .yaml templates", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(tmpPath, "bug", makeValidTemplate({ name: "bug" }), "yaml");
        yield* writeTemplateFile(tmpPath, "feature", makeValidTemplate({ name: "feature" }), "yml");

        const service = yield* TemplateService;
        const templates = yield* service.listTemplates();

        expect(templates).toHaveLength(2);
        const names = templates.map((t) => t.name);
        expect(names).toContain("bug");
        expect(names).toContain("feature");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("ignores non-yaml files in templates directory", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(tmpPath, "bug", makeValidTemplate({ name: "bug" }));
        // Write non-yaml files using the helper for consistency
        yield* writeArbitraryFile(tmpPath, "readme.md", "# Templates");
        yield* writeArbitraryFile(tmpPath, "config.json", "{}");

        const service = yield* TemplateService;
        const templates = yield* service.listTemplates();

        expect(templates).toHaveLength(1);
        expect(templates[0].name).toBe("bug");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("skips invalid templates and returns valid ones", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(tmpPath, "valid", makeValidTemplate({ name: "valid" }));
        yield* writeTemplateFile(tmpPath, "invalid", "invalid: yaml: [");

        const service = yield* TemplateService;
        const templates = yield* service.listTemplates();

        expect(templates).toHaveLength(1);
        expect(templates[0].name).toBe("valid");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("uses filename as template name when name field is missing", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(
          tmpPath,
          "my-template",
          makeValidTemplate({ title: "fix: {title}" }),
        );

        const service = yield* TemplateService;
        const templates = yield* service.listTemplates();

        expect(templates).toHaveLength(1);
        expect(templates[0].name).toBe("my-template");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("getTemplate", () => {
    it.scoped("retrieves template by name with .yaml extension", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(
          tmpPath,
          "bug",
          makeValidTemplate({
            name: "bug",
            title: "fix: {title}",
            priority: "high",
            type: "bug",
          }),
        );

        const service = yield* TemplateService;
        const template = yield* service.getTemplate("bug");

        expect(template.name).toBe("bug");
        expect(template.title).toBe("fix: {title}");
        expect(template.priority).toBe("high");
        expect(template.type).toBe("bug");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("retrieves template by name with .yml extension", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(
          tmpPath,
          "feature",
          makeValidTemplate({ name: "feature", title: "feat: {title}" }),
          "yml",
        );

        const service = yield* TemplateService;
        const template = yield* service.getTemplate("feature");

        expect(template.name).toBe("feature");
        expect(template.title).toBe("feat: {title}");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("prefers .yaml over .yml when both exist", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(
          tmpPath,
          "test",
          makeValidTemplate({ name: "test-yaml", title: "from yaml" }),
          "yaml",
        );
        yield* writeTemplateFile(
          tmpPath,
          "test",
          makeValidTemplate({ name: "test-yml", title: "from yml" }),
          "yml",
        );

        const service = yield* TemplateService;
        const template = yield* service.getTemplate("test");

        expect(template.name).toBe("test-yaml");
        expect(template.title).toBe("from yaml");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("fails with TemplateNotFoundError when template does not exist", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* ensureTemplatesDir(tmpPath);

        const service = yield* TemplateService;
        const result = yield* service.getTemplate("nonexistent").pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(TemplateNotFoundError);
          expect((result.left as TemplateNotFoundError).message).toContain("nonexistent");
        }
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("fails with TemplateNotFoundError when templates directory does not exist", () =>
      Effect.gen(function* () {
        yield* TempDirResource;

        const service = yield* TemplateService;
        const result = yield* service.getTemplate("any").pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(TemplateNotFoundError);
        }
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("fails with TemplateError for invalid YAML syntax", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(tmpPath, "bad", "invalid: yaml: [");

        const service = yield* TemplateService;
        const result = yield* service.getTemplate("bad").pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(TemplateError);
          expect((result.left as TemplateError).message).toContain("Invalid YAML");
        }
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("fails with TemplateError for invalid schema", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(
          tmpPath,
          "bad-schema",
          YAML.stringify({ priority: "invalid-priority" }),
        );

        const service = yield* TemplateService;
        const result = yield* service.getTemplate("bad-schema").pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(TemplateError);
          expect((result.left as TemplateError).message).toContain("Invalid template schema");
        }
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("template parsing", () => {
    it.scoped("parses minimal template with only name", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(tmpPath, "minimal", makeValidTemplate({}));

        const service = yield* TemplateService;
        const template = yield* service.getTemplate("minimal");

        expect(template.name).toBe("minimal");
        expect(template.title).toBeUndefined();
        expect(template.description).toBeUndefined();
        expect(template.priority).toBeUndefined();
        expect(template.type).toBeUndefined();
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("parses full template with all fields", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(
          tmpPath,
          "full",
          makeValidTemplate({
            name: "full-template",
            title: "feat: {title}",
            description: "## Feature\n\n{title}",
            priority: "medium",
            type: "feature",
          }),
        );

        const service = yield* TemplateService;
        const template = yield* service.getTemplate("full");

        expect(template.name).toBe("full-template");
        expect(template.title).toBe("feat: {title}");
        expect(template.description).toBe("## Feature\n\n{title}");
        expect(template.priority).toBe("medium");
        expect(template.type).toBe("feature");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("parses template with all valid priority values", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        const priorities = ["urgent", "high", "medium", "low", "none"];

        for (const priority of priorities) {
          yield* writeTemplateFile(tmpPath, `p-${priority}`, makeValidTemplate({ priority }));
        }

        const service = yield* TemplateService;

        for (const priority of priorities) {
          const template = yield* service.getTemplate(`p-${priority}`);
          expect(template.priority).toBe(priority);
        }
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("parses template with all valid type values", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        const types = ["bug", "feature", "task", "epic", "chore"];

        for (const type of types) {
          yield* writeTemplateFile(tmpPath, `t-${type}`, makeValidTemplate({ type }));
        }

        const service = yield* TemplateService;

        for (const type of types) {
          const template = yield* service.getTemplate(`t-${type}`);
          expect(template.type).toBe(type);
        }
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("edge cases", () => {
    it.scoped("handles empty YAML file with TemplateError", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(tmpPath, "empty", "");

        const service = yield* TemplateService;
        const result = yield* service.getTemplate("empty").pipe(Effect.either);

        // Empty YAML parses as null, which fails schema validation
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(TemplateError);
        }
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("handles YAML file with only comments with TemplateError", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(tmpPath, "comments", "# This is a comment\n# Another comment");

        const service = yield* TemplateService;
        const result = yield* service.getTemplate("comments").pipe(Effect.either);

        // Comments-only YAML parses as null, which fails schema validation
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(TemplateError);
        }
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("handles template with extra unknown fields (should be ignored)", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(
          tmpPath,
          "extra",
          YAML.stringify({
            name: "extra",
            title: "test",
            unknownField: "should be ignored",
            anotherUnknown: { nested: true },
          }),
        );

        const service = yield* TemplateService;
        const template = yield* service.getTemplate("extra");

        expect(template.name).toBe("extra");
        expect(template.title).toBe("test");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("handles template with multiline description", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        const multilineDesc = `## Bug Report

**What happened:**
{title}

**Expected behavior:**

**Steps to reproduce:**
1. 
2. 
3. 

**Environment:**
- OS: 
- Version: `;

        yield* writeTemplateFile(
          tmpPath,
          "multiline",
          YAML.stringify({
            name: "multiline",
            description: multilineDesc,
          }),
        );

        const service = yield* TemplateService;
        const template = yield* service.getTemplate("multiline");

        expect(template.description).toBe(multilineDesc);
        expect(template.description).toContain("## Bug Report");
        expect(template.description).toContain("{title}");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scoped("handles template names with special characters in filename", () =>
      Effect.gen(function* () {
        const { path: tmpPath } = yield* TempDirResource;
        yield* writeTemplateFile(
          tmpPath,
          "my-special_template.v2",
          makeValidTemplate({ name: "my-special_template.v2" }),
        );

        const service = yield* TemplateService;
        const template = yield* service.getTemplate("my-special_template.v2");

        expect(template.name).toBe("my-special_template.v2");
      }).pipe(Effect.provide(TestLayer)),
    );
  });
});
