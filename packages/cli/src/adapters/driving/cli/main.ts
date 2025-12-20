import * as Command from "@effect/cli/Command";
import * as Console from "effect/Console";
import { initCommand } from "./commands/init.js";
import { loginCommand } from "./commands/login.js";
import { teamCommand } from "./commands/team.js";
import { projectCommand } from "./commands/project.js";
import { readyCommand } from "./commands/ready.js";
import { listCommand } from "./commands/list.js";
import { showCommand } from "./commands/show.js";
import { startCommand } from "./commands/start.js";
import { doneCommand } from "./commands/done.js";
import { createCommand } from "./commands/create.js";
import { blockCommand } from "./commands/block.js";
import { unblockCommand } from "./commands/unblock.js";
import { blockedCommand } from "./commands/blocked.js";
import { primeCommand } from "./commands/prime.js";

// Root command
const ship = Command.make("ship", {}, () =>
  Console.log(`ship - Linear + jj workflow CLI

Usage: ship <command> [options]

Commands:
  init              Initialize workspace and authenticate
  login             Re-authenticate with Linear
  team              Switch team
  project           Switch project
  
  ready             List tasks ready to work on (no blockers)
  blocked           List blocked tasks
  list              List all tasks with filters
  show <id>         Show task details
  create <title>    Create new task
  
  start <id>        Start working on a task
  done <id>         Mark task as complete
  
  block <a> <b>     Mark task A as blocking task B
  unblock <a> <b>   Remove blocking relationship
  
  prime             Output AI-optimized context

Run 'ship <command> --help' for more information on a command.`),
);

// Combine all commands
export const command = ship.pipe(
  Command.withSubcommands([
    initCommand,
    loginCommand,
    teamCommand,
    projectCommand,
    readyCommand,
    listCommand,
    showCommand,
    startCommand,
    doneCommand,
    createCommand,
    blockCommand,
    unblockCommand,
    blockedCommand,
    primeCommand,
  ]),
);

export const run = Command.run(command, {
  name: "ship",
  version: "0.0.1",
});
