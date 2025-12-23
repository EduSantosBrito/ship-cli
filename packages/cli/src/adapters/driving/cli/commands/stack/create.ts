/**
 * ship stack create - Create a new jj change with workspace
 *
 * Creates a new change on top of the current one with an optional
 * description and bookmark. By default, creates in a new jj workspace
 * for isolation (one workspace per stack).
 *
 * Use --no-workspace to create in the current workspace instead.
 */

import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Console from "effect/Console";
import * as FileSystem from "@effect/platform/FileSystem";
import * as Path from "@effect/platform/Path";
import { checkVcsAvailability, outputError } from "./shared.js";
import { ChangeId } from "../../../../../ports/VcsService.js";
import { ConfigRepository } from "../../../../../ports/ConfigRepository.js";
import {
  resolveWorkspacePath,
  WorkspaceMetadata,
  WorkspacesFile,
  modifyWorkspacesFile,
  DEFAULT_WORKSPACE_PATH_PATTERN,
} from "../../../../../domain/Config.js";

// === Options ===

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

const messageOption = Options.text("message").pipe(
  Options.withAlias("m"),
  Options.withDescription("Description for the new change"),
  Options.optional,
);

const bookmarkOption = Options.text("bookmark").pipe(
  Options.withAlias("b"),
  Options.withDescription("Create a bookmark at the new change"),
  Options.optional,
);

const noWorkspaceOption = Options.boolean("no-workspace").pipe(
  Options.withDescription("Create in current workspace instead of a new one (not recommended)"),
  Options.withDefault(false),
);

const workspacePathOption = Options.text("workspace-path").pipe(
  Options.withDescription("Custom path for the workspace (overrides config pattern)"),
  Options.optional,
);

const taskIdOption = Options.text("task-id").pipe(
  Options.withAlias("t"),
  Options.withDescription("Associate workspace with a task ID (e.g., BRI-123)"),
  Options.optional,
);

// === Output Types ===

interface CreateOutput {
  created: boolean;
  changeId?: string;
  bookmark?: string | undefined;
  workspace?: {
    name: string;
    path: string;
    created: boolean;
  };
  error?: string;
}

// === Helper Functions ===

/**
 * Derive a stack/workspace name from bookmark or message.
 */
const deriveStackName = (
  bookmark: { _tag: "Some"; value: string } | { _tag: "None" },
  message: { _tag: "Some"; value: string } | { _tag: "None" },
): string => {
  if (bookmark._tag === "Some") {
    // Extract name from bookmark: "user/bri-123-feature" -> "bri-123-feature"
    const parts = bookmark.value.split("/");
    return parts[parts.length - 1];
  }
  if (message._tag === "Some") {
    // Slugify message: "Add user auth" -> "add-user-auth"
    return slugify(message.value);
  }
  return `stack-${Date.now()}`;
};

/**
 * Convert a string to a URL-safe slug.
 */
const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove non-word chars
    .replace(/[\s_-]+/g, "-") // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, "") // Remove leading/trailing hyphens
    .slice(0, 50); // Limit length
};

/**
 * Extract task ID from bookmark or message.
 * Looks for patterns like:
 * - "user/bri-123-feature" -> "BRI-123"
 * - "BRI-123: Some description" -> "BRI-123"
 * - "bri-123-some-feature" -> "BRI-123"
 *
 * Returns null if no task ID pattern is found.
 */
const extractTaskId = (
  bookmark: { _tag: "Some"; value: string } | { _tag: "None" },
  message: { _tag: "Some"; value: string } | { _tag: "None" },
): string | null => {
  // Task ID pattern: letters followed by hyphen and numbers (e.g., BRI-123, ENG-456)
  const taskIdPattern = /\b([a-zA-Z]+-\d+)\b/;

  // Try bookmark first (more reliable since it's typically derived from task)
  if (bookmark._tag === "Some") {
    const match = bookmark.value.match(taskIdPattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  // Fall back to message
  if (message._tag === "Some") {
    const match = message.value.match(taskIdPattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  return null;
};

// === Command ===

export const createCommand = Command.make(
  "create",
  {
    json: jsonOption,
    message: messageOption,
    bookmark: bookmarkOption,
    noWorkspace: noWorkspaceOption,
    workspacePath: workspacePathOption,
    taskId: taskIdOption,
  },
  ({ json, message, bookmark, noWorkspace, workspacePath, taskId }) =>
    Effect.gen(function* () {
      // Check VCS availability (jj installed and in repo)
      const vcsCheck = yield* checkVcsAvailability();
      if (!vcsCheck.available) {
        yield* outputError(vcsCheck.error, json);
        return;
      }
      const { vcs } = vcsCheck;

      // Derive stack name for workspace/bookmark naming
      const stackName = deriveStackName(bookmark, message);
      const description = message._tag === "Some" ? message.value : "(no description)";

      // Default behavior: create workspace (unless --no-workspace)
      if (!noWorkspace) {
        const configRepo = yield* ConfigRepository;
        const config = yield* configRepo.load().pipe(
          Effect.catchAll(() =>
            Effect.succeed({
              workspace: {
                basePath: DEFAULT_WORKSPACE_PATH_PATTERN,
                autoNavigate: true,
                autoCleanup: true,
              },
            }),
          ),
        );
        const workspaceConfig = config.workspace;

        // Get repo root for path resolution
        const repoRoot = yield* vcs.getWorkspaceRoot();
        const repoName = repoRoot.split("/").pop() ?? "repo";

        // Resolve target path
        const targetPath =
          workspacePath._tag === "Some"
            ? workspacePath.value
            : resolveWorkspacePath(workspaceConfig.basePath, {
                repo: repoName,
                stack: stackName,
              });

        // Create the jj workspace
        const workspaceResult = yield* vcs.createWorkspace(stackName, targetPath).pipe(
          Effect.map((info) => ({ success: true as const, info })),
          Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
        );

        if (!workspaceResult.success) {
          yield* outputError(`Failed to create workspace: ${workspaceResult.error}`, json);
          return;
        }

        // Resolve task ID: prefer explicit --task-id, fall back to extraction from bookmark/message
        const resolvedTaskId =
          taskId._tag === "Some" ? taskId.value.toUpperCase() : extractTaskId(bookmark, message);

        // Save workspace metadata for task association tracking
        yield* saveWorkspaceMetadata(configRepo, {
          name: stackName,
          path: workspaceResult.info.path,
          stackName,
          bookmark: bookmark._tag === "Some" ? bookmark.value : null,
          taskId: resolvedTaskId,
        });

        // Create bookmark if requested on the new workspace's working copy
        let bookmarkName: string | undefined;
        let bookmarkError: string | undefined;
        if (bookmark._tag === "Some") {
          // Create bookmark on the workspace's change using its change ID
          const bookmarkResult = yield* vcs
            .createBookmark(bookmark.value, workspaceResult.info.changeId as ChangeId)
            .pipe(
              Effect.map(() => ({ success: true as const })),
              Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
            );

          if (bookmarkResult.success) {
            bookmarkName = bookmark.value;
          } else {
            bookmarkError = bookmarkResult.error;
          }
        }

        const output: CreateOutput = {
          created: true,
          changeId: workspaceResult.info.shortChangeId,
          bookmark: bookmarkName,
          workspace: {
            name: stackName,
            path: workspaceResult.info.path,
            created: true,
          },
          ...(bookmarkError ? { error: bookmarkError } : {}),
        };

        if (json) {
          yield* Console.log(JSON.stringify(output, null, 2));
        } else {
          yield* Console.log(`Created workspace: ${stackName}`);
          yield* Console.log(`Path: ${workspaceResult.info.path}`);
          if (bookmarkName) {
            yield* Console.log(`Created bookmark: ${bookmarkName}`);
          } else if (bookmarkError) {
            yield* Console.log(`Warning: Failed to create bookmark: ${bookmarkError}`);
          }
          if (workspaceConfig.autoNavigate) {
            yield* Console.log(`\nRun: cd ${workspaceResult.info.path}`);
          }
        }
        return;
      }

      // --no-workspace flow: create jj change in current workspace
      const createResult = yield* vcs.createChange(description).pipe(
        Effect.map((changeId) => ({ success: true as const, changeId })),
        Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
      );

      if (!createResult.success) {
        yield* outputError(`Failed to create change: ${createResult.error}`, json);
        return;
      }

      const changeId = createResult.changeId;

      // Optionally create bookmark
      let bookmarkName: string | undefined;
      if (bookmark._tag === "Some") {
        const bookmarkResult = yield* vcs.createBookmark(bookmark.value).pipe(
          Effect.map(() => ({ success: true as const })),
          Effect.catchAll((e) => Effect.succeed({ success: false as const, error: String(e) })),
        );

        if (!bookmarkResult.success) {
          const output: CreateOutput = {
            created: true,
            changeId,
            error: `Change created but bookmark failed: ${bookmarkResult.error}`,
          };
          if (json) {
            yield* Console.log(JSON.stringify(output, null, 2));
          } else {
            yield* Console.log(`Created change: ${changeId}`);
            yield* Console.log(`Warning: Failed to create bookmark: ${bookmarkResult.error}`);
          }
          return;
        }
        bookmarkName = bookmark.value;
      }

      const output: CreateOutput = {
        created: true,
        changeId,
        bookmark: bookmarkName,
      };

      if (json) {
        yield* Console.log(JSON.stringify(output, null, 2));
      } else {
        yield* Console.log(`Created change: ${changeId}`);
        if (bookmarkName) {
          yield* Console.log(`Created bookmark: ${bookmarkName}`);
        }
        yield* Console.log(
          `\nNote: Consider using 'ship stack create' without --no-workspace for isolation.`,
        );
      }
    }),
);

// === Workspace Metadata Helpers ===

interface WorkspaceMetadataInput {
  name: string;
  path: string;
  stackName: string;
  bookmark: string | null;
  taskId: string | null;
}

/**
 * Save workspace metadata to .ship/workspaces.json
 * Uses file locking to prevent race conditions in multi-agent scenarios.
 */
const saveWorkspaceMetadata = (
  configRepo: ConfigRepository,
  metadata: WorkspaceMetadataInput,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  modifyWorkspacesFile(configRepo, (workspacesFile) => {
    const newEntry = new WorkspaceMetadata({
      name: metadata.name,
      path: metadata.path,
      stackName: metadata.stackName,
      bookmark: Option.fromNullable(metadata.bookmark),
      createdAt: new Date(),
      taskId: Option.fromNullable(metadata.taskId),
    });

    const updatedFile = new WorkspacesFile({
      workspaces: [...workspacesFile.workspaces, newEntry],
    });

    return [undefined, updatedFile] as const;
  }).pipe(Effect.catchAll(() => Effect.void));
