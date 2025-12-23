/**
 * JjParser - Parse jj CLI output into typed domain objects
 *
 * This module provides type-safe parsing of jj output using Effect Schema.
 * It handles both JSON template output and human-readable output where needed.
 *
 * jj supports native JSON output via the `json()` template function, which
 * provides structured data that we parse into our domain types.
 */

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { VcsError } from "../../../domain/Errors.js";
import { Change, ChangeId, type VcsErrors } from "../../../ports/VcsService.js";

// === jj JSON Template ===

/**
 * Template for jj log that produces JSON output with all fields we need.
 * Each commit is output as a JSON object on its own line.
 */
export const JJ_LOG_JSON_TEMPLATE = `
"{" ++
"\\"commit_id\\":" ++ json(commit_id) ++ "," ++
"\\"change_id\\":" ++ json(change_id) ++ "," ++
"\\"description\\":" ++ json(description) ++ "," ++
"\\"author\\":" ++ json(author) ++ "," ++
"\\"bookmarks\\":" ++ json(local_bookmarks) ++ "," ++
"\\"is_working_copy\\":" ++ json(current_working_copy) ++ "," ++
"\\"is_empty\\":" ++ json(empty) ++ "," ++
"\\"has_conflict\\":" ++ json(conflict) ++
"}" ++ "\\n"
`.trim();

// === Raw JSON Schemas (matching jj output) ===

/** jj author/committer signature */
const JjSignatureSchema = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  timestamp: Schema.String,
});

/** jj bookmark reference - target can have null values for divergent bookmarks */
const JjBookmarkSchema = Schema.Struct({
  name: Schema.String,
  target: Schema.Array(Schema.NullOr(Schema.String)),
});

/** Raw jj commit JSON from json(self) or custom template */
const JjCommitJsonSchema = Schema.Struct({
  commit_id: Schema.String,
  change_id: Schema.String,
  description: Schema.String,
  author: JjSignatureSchema,
  bookmarks: Schema.Array(JjBookmarkSchema),
  is_working_copy: Schema.Boolean,
  is_empty: Schema.Boolean,
  has_conflict: Schema.Boolean,
});

type JjCommitJson = typeof JjCommitJsonSchema.Type;

// === Parsing Functions ===

/**
 * Parse a single Change from jj JSON output
 */
export const parseChange = (json: unknown): Effect.Effect<Change, VcsError> =>
  Schema.decodeUnknown(JjCommitJsonSchema)(json).pipe(
    Effect.mapError(
      (e) => new VcsError({ message: `Failed to parse jj commit: ${e.message}`, cause: e }),
    ),
    Effect.map(jjCommitToChange),
  );

/**
 * Parse a JSON string into a Change
 */
export const parseChangeFromString = (jsonString: string): Effect.Effect<Change, VcsError> =>
  Effect.try({
    try: () => JSON.parse(jsonString),
    catch: (e) => new VcsError({ message: `Invalid JSON from jj: ${e}`, cause: e }),
  }).pipe(Effect.flatMap(parseChange));

/**
 * Parse multiple Changes from newline-separated JSON output
 */
export const parseChanges = (output: string): Effect.Effect<ReadonlyArray<Change>, VcsError> => {
  const lines = output
    .trim()
    .split("\n")
    .filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return Effect.succeed([]);
  }

  return Effect.all(lines.map(parseChangeFromString));
};

/**
 * Extract change ID from jj command output (e.g., jj new, jj commit)
 *
 * jj outputs to stderr in format:
 * "Working copy  (@) now at: <change_id> <commit_id> (empty) <description>"
 *
 * This is used for commands that don't support --template.
 */
export const parseChangeIdFromOutput = (output: string): Effect.Effect<ChangeId, VcsError> =>
  Effect.try({
    try: () => {
      // Pattern matches: "Working copy  (@) now at: <change_id> ..."
      // The (@) and extra spaces are optional for compatibility
      const match = output.match(/Working copy\s+(?:\(@\)\s+)?now at:\s+(\w+)/);
      if (!match) {
        throw new Error(`Could not extract change ID from: ${output}`);
      }
      return match[1] as ChangeId;
    },
    catch: (e) => new VcsError({ message: `Failed to extract change ID: ${e}`, cause: e }),
  });

/**
 * Parse working copy change ID by querying jj log
 *
 * This is more reliable than parsing command output - we run the command,
 * then query the current state with JSON output.
 */
export const getCurrentChangeId = <E extends VcsErrors>(
  runJj: (...args: ReadonlyArray<string>) => Effect.Effect<string, E>,
): Effect.Effect<ChangeId, E | VcsError> =>
  runJj("log", "-r", "@", "--no-graph", "-T", 'change_id ++ "\\n"').pipe(
    Effect.map((output) => output.trim().split("\n")[0] as ChangeId),
    Effect.flatMap((changeId) =>
      changeId
        ? Effect.succeed(changeId)
        : Effect.fail(new VcsError({ message: "No current change found" })),
    ),
  );

// === Internal Helpers ===

/**
 * Convert raw jj JSON to our Change domain type
 */
const jjCommitToChange = (jj: JjCommitJson): Change =>
  new Change({
    id: jj.commit_id as ChangeId,
    changeId: jj.change_id,
    description: jj.description.trim(),
    author: jj.author.email || jj.author.name,
    timestamp: new Date(jj.author.timestamp),
    bookmarks: jj.bookmarks.map((b) => b.name),
    isWorkingCopy: jj.is_working_copy,
    isEmpty: jj.is_empty,
    hasConflict: jj.has_conflict,
  });
