/**
 * ship stack - VCS operations for AI agents
 *
 * This command group wraps jj operations in a controlled interface
 * that AI agents can use safely without running raw CLI commands.
 *
 * All commands output JSON when --json is passed, making them
 * suitable for programmatic consumption by agents.
 */

import * as Command from "@effect/cli/Command";
import * as Console from "effect/Console";
import { logCommand } from "./log.js";
import { statusCommand } from "./status.js";
import { createCommand } from "./create.js";
import { describeCommand } from "./describe.js";
import { syncCommand } from "./sync.js";
import { restackCommand } from "./restack.js";
import { submitCommand } from "./submit.js";
import { squashCommand } from "./squash.js";
import { abandonCommand } from "./abandon.js";
import { bookmarkCommand } from "./bookmark.js";
import { workspacesCommand } from "./workspaces.js";
import { removeWorkspaceCommand } from "./remove-workspace.js";
import { upCommand } from "./up.js";
import { downCommand } from "./down.js";
import { undoCommand } from "./undo.js";
import { updateStaleCommand } from "./update-stale.js";

// Stack parent command
const stack = Command.make("stack", {}, () =>
  Console.log(`ship stack - VCS operations for jj

Usage: ship stack <command> [options]

Commands:
  log               View stack of changes from trunk to current
  status            Show current change status
  create            Create a new change (workspace by default, --no-workspace to skip)
  describe          Update change description
  bookmark          Create or move a bookmark on current change
  sync              Fetch and rebase onto trunk
  restack           Fetch, rebase, and push entire stack
  submit            Push and create/update PR
  squash            Squash current change into parent
  abandon           Abandon a change
  up                Move to child change (toward tip)
  down              Move to parent change (toward trunk)
  undo              Undo the last operation
  update-stale      Update a stale working copy
  workspaces        List jj workspaces
  remove-workspace  Remove a jj workspace

Run 'ship stack <command> --help' for more information.`),
);

// Combine stack subcommands
export const stackCommand = stack.pipe(
  Command.withSubcommands([
    logCommand,
    statusCommand,
    createCommand,
    describeCommand,
    bookmarkCommand,
    syncCommand,
    restackCommand,
    submitCommand,
    squashCommand,
    abandonCommand,
    upCommand,
    downCommand,
    undoCommand,
    updateStaleCommand,
    workspacesCommand,
    removeWorkspaceCommand,
  ]),
);
