import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as FileSystem from "@effect/platform/FileSystem";
import * as Path from "@effect/platform/Path";
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";

const forceOption = Options.boolean("force").pipe(
  Options.withAlias("f"),
  Options.withDescription("Overwrite existing templates"),
  Options.withDefault(false),
);

// Default templates to create
const DEFAULT_TEMPLATES = {
  bug: `# Bug report template
name: bug
title: "fix: {title}"
description: |
  ## Bug Report

  **What happened:**
  {title}

  **Expected behavior:**
  

  **Steps to reproduce:**
  1. 

  **Environment:**
  - 
priority: high
type: bug
`,
  feature: `# Feature request template
name: feature
title: "feat: {title}"
description: |
  ## Feature Request

  **Description:**
  {title}

  **Use case:**
  

  **Acceptance criteria:**
  - [ ] 
priority: medium
type: feature
`,
  refactor: `# Refactor template
name: refactor
title: "refactor: {title}"
description: |
  ## Refactor

  **What to refactor:**
  {title}

  **Why:**
  

  **Scope:**
  - 
priority: low
type: chore
`,
  docs: `# Documentation template
name: docs
title: "docs: {title}"
description: |
  ## Documentation

  **What to document:**
  {title}

  **Location:**
  

  **Notes:**
  - 
priority: low
type: chore
`,
};

export const initTemplateCommand = Command.make("init", { force: forceOption }, ({ force }) =>
  Effect.gen(function* () {
    const configRepo = yield* ConfigRepository;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const configDir = yield* configRepo.getConfigDir();
    const templatesDir = path.join(configDir, "templates");

    // Ensure templates directory exists
    const dirExists = yield* fs
      .exists(templatesDir)
      .pipe(Effect.catchAll(() => Effect.succeed(false)));
    if (!dirExists) {
      yield* fs.makeDirectory(templatesDir, { recursive: true });
    }

    let created = 0;
    let skipped = 0;

    for (const [name, content] of Object.entries(DEFAULT_TEMPLATES)) {
      const templatePath = path.join(templatesDir, `${name}.yaml`);
      const exists = yield* fs
        .exists(templatePath)
        .pipe(Effect.catchAll(() => Effect.succeed(false)));

      if (exists && !force) {
        yield* Console.log(`Skipping ${name}.yaml (already exists, use --force to overwrite)`);
        skipped++;
      } else {
        yield* fs.writeFileString(templatePath, content);
        yield* Console.log(`Created ${name}.yaml`);
        created++;
      }
    }

    yield* Console.log("");
    if (created > 0) {
      yield* Console.log(`Created ${created} template(s) in .ship/templates/`);
    }
    if (skipped > 0) {
      yield* Console.log(`Skipped ${skipped} existing template(s)`);
    }
    yield* Console.log("");
    yield* Console.log('Use templates with: ship task create --template <name> "Task title"');
    yield* Console.log("View templates with: ship template list");
  }),
);
