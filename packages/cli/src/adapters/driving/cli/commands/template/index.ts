import * as Command from "@effect/cli/Command";
import { listCommand } from "./list.js";
import { initTemplateCommand } from "./init.js";

export const templateCommand = Command.make("template").pipe(
  Command.withDescription("Manage task templates"),
  Command.withSubcommands([listCommand, initTemplateCommand]),
);
