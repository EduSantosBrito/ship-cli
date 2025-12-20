#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Effect from "effect/Effect";
import { run } from "./adapters/driving/cli/main.js";
import { AppLayer } from "./infrastructure/Layers.js";

// Run the CLI
run(process.argv).pipe(
  Effect.provide(AppLayer),
  NodeRuntime.runMain({ disableErrorReporting: false }),
);
