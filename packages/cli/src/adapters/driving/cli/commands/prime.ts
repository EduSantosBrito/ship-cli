import * as Command from "@effect/cli/Command";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";

export const primeCommand = Command.make("prime", {}, () =>
  Effect.gen(function* () {
    const config = yield* ConfigRepository;
    const cfg = yield* config.load();

    const lines: string[] = [];

    // Configuration info
    lines.push("# Ship CLI Context");
    lines.push("");
    lines.push(`**Team:** ${cfg.linear.teamKey}`);
    if (Option.isSome(cfg.linear.projectId)) {
      lines.push(`**Project:** ${cfg.linear.projectId.value}`);
    }

    // Available commands
    lines.push("");
    lines.push("## Available Commands");
    lines.push("");
    lines.push("### Task Management");
    lines.push("- `ship ready` - List tasks ready to work on (no blockers)");
    lines.push("- `ship blocked` - List tasks waiting on dependencies");
    lines.push("- `ship list` - List all tasks with optional filters");
    lines.push("- `ship show <id>` - Show task details");
    lines.push("- `ship create <title>` - Create a new task");
    lines.push("- `ship start <id>` - Start working on a task");
    lines.push("- `ship done <id>` - Mark task as complete");
    lines.push("- `ship update <id>` - Update task details");
    lines.push("");
    lines.push("### Task Relationships");
    lines.push("- `ship block <blocker> <blocked>` - Mark a task as blocking another");
    lines.push("- `ship unblock <blocker> <blocked>` - Remove blocking relationship");
    lines.push("- `ship relate <id1> <id2>` - Link two tasks as related");

    // Post-task completion flow
    lines.push("");
    lines.push("## Post-Task Completion Flow");
    lines.push("");
    lines.push(
      "After completing a task, follow this procedure. **Ask the user for permission before starting**, explaining what you're about to do.",
    );
    lines.push("");
    lines.push("### 1. Review Changes");
    lines.push("Summarize what was changed, which files were modified, and why.");
    lines.push("");
    lines.push("### 2. Quality Checks");
    lines.push(
      "Run the project's lint, format, and typecheck commands. Check package.json scripts or the project's documentation to find the correct commands.",
    );
    lines.push("");
    lines.push("### 3. Version Control");
    lines.push("Commit and push changes using the project's VCS workflow:");
    lines.push("- Check current status and changed files");
    lines.push("- Write a descriptive commit message referencing the task");
    lines.push("- Push changes and create a pull request");
    lines.push("");
    lines.push("### 4. Mark Task Complete");
    lines.push("Use `ship done <task-id>` to mark the task as done in Linear.");

    yield* Console.log(lines.join("\n"));
  }),
);
