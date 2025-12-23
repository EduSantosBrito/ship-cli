import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Array from "effect/Array";
import * as FileSystem from "@effect/platform/FileSystem";
import * as Path from "@effect/platform/Path";
import * as YAML from "yaml";
import { TaskTemplate, YamlTaskTemplate } from "../../../domain/Template.js";
import { TemplateError, TemplateNotFoundError } from "../../../domain/Errors.js";
import { TemplateService } from "../../../ports/TemplateService.js";
import { ConfigRepository } from "../../../ports/ConfigRepository.js";

const TEMPLATES_DIR = "templates";

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configRepo = yield* ConfigRepository;

  const getTemplatesDir = () =>
    Effect.map(configRepo.getConfigDir(), (configDir) => path.join(configDir, TEMPLATES_DIR));

  const hasTemplates = (): Effect.Effect<boolean, never> =>
    Effect.gen(function* () {
      const templatesDir = yield* getTemplatesDir();
      return yield* fs.exists(templatesDir);
    }).pipe(Effect.catchAll(() => Effect.succeed(false)));

  const parseTemplateFile = (
    filePath: string,
    name: string,
  ): Effect.Effect<TaskTemplate, TemplateError> =>
    Effect.gen(function* () {
      const content = yield* fs.readFileString(filePath).pipe(
        Effect.mapError(
          (e) =>
            new TemplateError({
              message: `Failed to read template file: ${filePath}`,
              cause: e,
            }),
        ),
      );

      // Parse YAML using Effect.try
      const parsed = yield* Effect.try({
        try: () => YAML.parse(content),
        catch: (e) =>
          new TemplateError({
            message: `Invalid YAML in template '${name}': ${e instanceof Error ? e.message : String(e)}`,
            cause: e,
          }),
      });

      // Validate schema
      const yamlTemplate = yield* Schema.decodeUnknown(YamlTaskTemplate)(parsed).pipe(
        Effect.mapError(
          (e) =>
            new TemplateError({
              message: `Invalid template schema in '${name}': ${e.message}`,
              cause: e,
            }),
        ),
      );

      // Convert to TaskTemplate, using filename as name if not specified
      return new TaskTemplate({
        name: yamlTemplate.name ?? name,
        title: yamlTemplate.title,
        description: yamlTemplate.description,
        priority: yamlTemplate.priority,
        type: yamlTemplate.type,
      });
    });

  const getTemplate = (
    name: string,
  ): Effect.Effect<TaskTemplate, TemplateNotFoundError | TemplateError> =>
    Effect.gen(function* () {
      const templatesDir = yield* getTemplatesDir();
      const templatePath = path.join(templatesDir, `${name}.yaml`);

      const exists = yield* fs.exists(templatePath).pipe(Effect.catchAll(() => Effect.succeed(false)));
      if (!exists) {
        // Also try .yml extension
        const templatePathYml = path.join(templatesDir, `${name}.yml`);
        const existsYml = yield* fs.exists(templatePathYml).pipe(Effect.catchAll(() => Effect.succeed(false)));
        if (!existsYml) {
          return yield* TemplateNotFoundError.forName(name);
        }
        return yield* parseTemplateFile(templatePathYml, name);
      }

      return yield* parseTemplateFile(templatePath, name);
    });

  const listTemplates = (): Effect.Effect<ReadonlyArray<TaskTemplate>, TemplateError> =>
    Effect.gen(function* () {
      const templatesDir = yield* getTemplatesDir();

      const dirExists = yield* fs.exists(templatesDir).pipe(Effect.catchAll(() => Effect.succeed(false)));
      if (!dirExists) {
        return [];
      }

      const entries = yield* fs.readDirectory(templatesDir).pipe(
        Effect.mapError(
          (e) =>
            new TemplateError({
              message: `Failed to read templates directory`,
              cause: e,
            }),
        ),
      );

      // Filter for .yaml and .yml files
      const templateFiles = entries.filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"));

      // Parse each template file using Effect.forEach with Option for graceful error handling
      const results = yield* Effect.forEach(
        templateFiles,
        (file) => {
          const name = file.replace(/\.ya?ml$/, "");
          const filePath = path.join(templatesDir, file);
          return parseTemplateFile(filePath, name).pipe(
            Effect.map(Option.some),
            Effect.catchAll((e) =>
              Effect.logWarning(`Skipping invalid template '${name}': ${e.message}`).pipe(
                Effect.as(Option.none<TaskTemplate>()),
              ),
            ),
          );
        },
        { concurrency: "unbounded" },
      );

      return Array.getSomes(results);
    });

  return {
    getTemplate,
    listTemplates,
    hasTemplates,
  };
});

export const TemplateServiceLive = Layer.effect(TemplateService, make);
