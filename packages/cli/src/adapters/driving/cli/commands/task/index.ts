import * as Command from "@effect/cli/Command";
import { readyTaskCommand } from "./ready.js";
import { listTaskCommand } from "./list.js";
import { showTaskCommand } from "./show.js";
import { startTaskCommand } from "./start.js";
import { doneTaskCommand } from "./done.js";
import { createTaskCommand } from "./create.js";
import { updateTaskCommand } from "./update.js";
import { blockTaskCommand } from "./block.js";
import { unblockTaskCommand } from "./unblock.js";
import { blockedTaskCommand } from "./blocked.js";
import { relateTaskCommand } from "./relate.js";

export const taskCommand = Command.make("task").pipe(
  Command.withDescription("Manage Linear tasks"),
  Command.withSubcommands([
    readyTaskCommand,
    listTaskCommand,
    showTaskCommand,
    startTaskCommand,
    doneTaskCommand,
    createTaskCommand,
    updateTaskCommand,
    blockTaskCommand,
    unblockTaskCommand,
    blockedTaskCommand,
    relateTaskCommand,
  ]),
);
