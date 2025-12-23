import * as Command from "@effect/cli/Command";
import { listMilestoneCommand } from "./list.js";
import { showMilestoneCommand } from "./show.js";
import { createMilestoneCommand } from "./create.js";
import { updateMilestoneCommand } from "./update.js";
import { deleteMilestoneCommand } from "./delete.js";

export const milestoneCommand = Command.make("milestone").pipe(
  Command.withDescription("Manage project milestones"),
  Command.withSubcommands([
    listMilestoneCommand,
    showMilestoneCommand,
    createMilestoneCommand,
    updateMilestoneCommand,
    deleteMilestoneCommand,
  ]),
);
