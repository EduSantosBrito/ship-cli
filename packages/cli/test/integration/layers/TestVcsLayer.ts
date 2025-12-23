/**
 * Test layer for VcsService backed by a real jj repository.
 *
 * Provides a VcsService that operates on a test jj repository,
 * allowing integration tests to test actual VCS operations.
 */

import * as Layer from "effect/Layer";
import * as NodeContext from "@effect/platform-node/NodeContext";
import { VcsServiceLive } from "../../../src/adapters/driven/vcs/VcsServiceLive.js";

/**
 * Create a test VcsService layer backed by NodeContext.
 *
 * The VcsService uses the CommandExecutor from NodeContext to run jj commands.
 * Tests should set the working directory appropriately before running VCS operations.
 *
 * @example
 * ```typescript
 * const test = Effect.gen(function* () {
 *   const repo = yield* createTempJjRepo();
 *   // Change to repo directory and run VCS operations
 *   yield* Effect.provide(
 *     someVcsOperation(),
 *     TestVcsLayer,
 *   );
 * });
 * ```
 */
export const TestVcsLayer = VcsServiceLive.pipe(Layer.provide(NodeContext.layer));

/**
 * Create a test VcsService layer with custom working directory.
 *
 * This is useful for tests that need to run VCS operations in a specific
 * test repository without changing the process working directory.
 *
 * Note: VcsServiceLive uses process.cwd() internally, so for full control
 * tests may need to use the repo helpers that execute jj in specific directories.
 */
export const makeTestVcsLayer = () => TestVcsLayer;
