/**
 * Temp directory management helpers for integration tests.
 *
 * Provides Effect-based utilities for creating and managing temporary directories
 * with proper cleanup using scoped resource management.
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "@effect/platform/FileSystem";
import * as Path from "@effect/platform/Path";
import * as os from "node:os";
import * as crypto from "node:crypto";

/**
 * Generate a unique temp directory name with the given prefix.
 */
const generateTempName = (prefix: string): string => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString("hex");
  return `${prefix}${timestamp}-${random}`;
};

/**
 * Create a temporary directory with the given prefix.
 *
 * @param prefix - Prefix for the temp directory name (e.g., "ship-test-")
 * @returns The absolute path to the created temp directory
 */
export const createTempDir = (prefix: string): Effect.Effect<string, Error, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const tempBase = os.tmpdir();
    const dirName = generateTempName(prefix);
    const tempPath = path.join(tempBase, dirName);

    yield* fs.makeDirectory(tempPath, { recursive: true });
    return tempPath;
  }).pipe(
    Effect.mapError((e) => new Error(`Failed to create temp directory: ${e}`)),
  );

/**
 * Remove a directory and all its contents recursively.
 *
 * @param dir - The directory path to remove
 */
export const removeDir = (dir: string): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(dir);
    if (exists) {
      yield* fs.remove(dir, { recursive: true });
    }
  }).pipe(
    Effect.mapError((e) => new Error(`Failed to remove directory ${dir}: ${e}`)),
  );

/**
 * Execute an effect with a temporary directory that is automatically cleaned up.
 *
 * Uses Effect's scoped resource management to ensure the temp directory
 * is removed even if the effect fails.
 *
 * @example
 * ```typescript
 * const result = yield* withTempDir("test-", (dir) =>
 *   Effect.gen(function* () {
 *     // Use dir for test operations
 *     yield* writeFile(path.join(dir, "test.txt"), "content")
 *     return "done"
 *   })
 * )
 * // dir is automatically cleaned up here
 * ```
 *
 * @param prefix - Prefix for the temp directory name
 * @param use - Effect that uses the temp directory
 * @returns The result of the use effect
 */
export const withTempDir = <A, E, R>(
  prefix: string,
  use: (dir: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error, R | FileSystem.FileSystem | Path.Path> =>
  Effect.scoped(
    Effect.acquireRelease(
      createTempDir(prefix),
      (dir) => removeDir(dir).pipe(Effect.ignore),
    ).pipe(Effect.flatMap(use)),
  );

/**
 * Write content to a file within a directory.
 *
 * @param filePath - The absolute path to the file
 * @param content - The content to write
 */
export const writeFile = (
  filePath: string,
  content: string,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(filePath, content);
  }).pipe(
    Effect.mapError((e) => new Error(`Failed to write file ${filePath}: ${e}`)),
  );

/**
 * Read content from a file.
 *
 * @param filePath - The absolute path to the file
 * @returns The file content as a string
 */
export const readFile = (
  filePath: string,
): Effect.Effect<string, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(filePath);
  }).pipe(
    Effect.mapError((e) => new Error(`Failed to read file ${filePath}: ${e}`)),
  );

/**
 * Check if a file or directory exists.
 *
 * @param path - The path to check
 * @returns True if the path exists
 */
export const exists = (
  path: string,
): Effect.Effect<boolean, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.exists(path);
  }).pipe(
    Effect.mapError((e) => new Error(`Failed to check existence of ${path}: ${e}`)),
  );

/**
 * Create a directory with all parent directories.
 *
 * @param dir - The directory path to create
 */
export const makeDir = (
  dir: string,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(dir, { recursive: true });
  }).pipe(
    Effect.mapError((e) => new Error(`Failed to create directory ${dir}: ${e}`)),
  );
