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
import { updateCommand } from "./commands/update.js";
import { relateCommand } from "./commands/relate.js";
import { statusCommand } from "./commands/status.js";
import { wipCommand } from "./commands/wip.js";
import { stackCommand } from "./commands/stack/index.js";
import { webhookCommand } from "./commands/webhook/index.js";
import { templateCommand } from "./commands/template/index.js";
import { milestoneCommand } from "./commands/milestone/index.js";
import { prCommand } from "./commands/pr/index.js";

// Root command
const ship = Command.make("ship", {}, () =>
  Console.log(`ship - Linear + jj workflow CLI

Usage: ship <command> [options]

Commands:
  init              Initialize workspace and authenticate
  login             Re-authenticate with Linear
  team              Switch team
  project           Switch project
  status            Check configuration status
  wip               Show work in progress (tasks + changes + PRs)
  
  ready             List tasks ready to work on (no blockers)
  blocked           List blocked tasks
  list              List all tasks with filters
  show <id>         Show task details
  create <title>    Create new task
  
  start <id>        Start working on a task
  done <id>         Mark task as complete
  update <id>       Update task details
  
  block <a> <b>     Mark task A as blocking task B
  unblock <a> <b>   Remove blocking relationship
  relate <a> <b>    Link two tasks as related
  
  template          Manage task templates
  milestone         Manage project milestones
  stack             VCS operations (jj wrapper for AI agents)
  webhook           GitHub webhook operations
  pr                PR workflow commands (create, stack)

Run 'ship <command> --help' for more information on a command.`),
);

// Combine all commands
export const command = ship.pipe(
  Command.withSubcommands([
    initCommand,
    loginCommand,
    teamCommand,
    projectCommand,
    statusCommand,
    wipCommand,
    readyCommand,
    listCommand,
    showCommand,
    startCommand,
    doneCommand,
    updateCommand,
    createCommand,
    blockCommand,
    unblockCommand,
    relateCommand,
    blockedCommand,
    templateCommand,
    milestoneCommand,
    stackCommand,
    webhookCommand,
    prCommand,
  ]),
);

export const run = Command.run(command, {
  name: "ship",
  version: "0.0.1",
});
