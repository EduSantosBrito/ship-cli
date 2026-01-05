#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Effect from "effect/Effect";
import * as fs from "node:fs";
import * as path from "node:path";
import * as YAML from "yaml";
import { run } from "./adapters/driving/cli/main.js";
import { AppLayer, NotionAppLayer } from "./infrastructure/Layers.js";
import type { TaskProvider } from "./domain/Config.js";

/**
 * Detect the task provider from config file synchronously.
 * This runs before Effect runtime starts to determine which layer to use.
 * Falls back to "linear" if config doesn't exist or provider isn't specified.
 */
const detectProvider = (): TaskProvider => {
  try {
    const configPath = path.join(process.cwd(), ".ship", "config.yaml");
    if (!fs.existsSync(configPath)) {
      return "linear";
    }
    const content = fs.readFileSync(configPath, "utf-8");
    const parsed = YAML.parse(content);
    return parsed?.provider === "notion" ? "notion" : "linear";
  } catch {
    return "linear";
  }
};

// Detect provider before starting Effect runtime
const provider = detectProvider();

// Run CLI with the appropriate layer based on provider
if (provider === "notion") {
  run(process.argv).pipe(
    Effect.provide(NotionAppLayer),
    NodeRuntime.runMain({ disableErrorReporting: false }),
  );
} else {
  run(process.argv).pipe(
    Effect.provide(AppLayer),
    NodeRuntime.runMain({ disableErrorReporting: false }),
  );
}
