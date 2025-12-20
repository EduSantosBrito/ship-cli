/**
 * Ship OpenCode Plugin
 *
 * Integrates the Ship CLI (Linear task management) with OpenCode.
 *
 * Features:
 * - Context injection via `ship prime` on session start and after compaction
 * - Ship tool for task management operations
 * - Task agent for autonomous issue completion
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { tool as createTool } from "@opencode-ai/plugin";

type OpencodeClient = PluginInput["client"];

const SHIP_GUIDANCE = `## Ship CLI Guidance

Ship integrates Linear issue tracking with your development workflow. Use it to:
- View and manage tasks assigned to you
- Track task dependencies (blockers)
- Start/complete work on tasks
- Create new tasks

### Quick Commands
- \`ship ready\` - Tasks you can work on (no blockers)
- \`ship blocked\` - Tasks waiting on dependencies
- \`ship list\` - All tasks
- \`ship show <ID>\` - Task details
- \`ship start <ID>\` - Begin working on task
- \`ship done <ID>\` - Mark task complete
- \`ship create "title"\` - Create new task

### Best Practices
1. Check \`ship ready\` to see what can be worked on
2. Use \`ship start\` before beginning work
3. Use \`ship done\` when completing tasks
4. Check blockers before starting dependent tasks`;

/**
 * Get the current model/agent context for a session by querying messages.
 */
async function getSessionContext(
  client: OpencodeClient,
  sessionID: string
): Promise<
  { model?: { providerID: string; modelID: string }; agent?: string } | undefined
> {
  try {
    const response = await client.session.messages({
      path: { id: sessionID },
      query: { limit: 50 },
    });

    if (response.data) {
      for (const msg of response.data) {
        if (msg.info.role === "user" && "model" in msg.info && msg.info.model) {
          return { model: msg.info.model, agent: msg.info.agent };
        }
      }
    }
  } catch {
    // On error, return undefined (let opencode use its default)
  }

  return undefined;
}

/**
 * Inject ship context into a session.
 *
 * Runs `ship prime` and injects the output along with CLI guidance.
 * Silently skips if ship is not installed or not initialized.
 */
async function injectShipContext(
  client: OpencodeClient,
  $: PluginInput["$"],
  sessionID: string,
  context?: { model?: { providerID: string; modelID: string }; agent?: string }
): Promise<void> {
  try {
    const primeOutput = await $`ship prime`.text();

    if (!primeOutput || primeOutput.trim() === "") {
      return;
    }

    const shipContext = `<ship-context>
${primeOutput.trim()}
</ship-context>

${SHIP_GUIDANCE}`;

    // Inject content via noReply + synthetic
    // Must pass model and agent to prevent mode/model switching
    await client.session.prompt({
      path: { id: sessionID },
      body: {
        noReply: true,
        model: context?.model,
        agent: context?.agent,
        parts: [{ type: "text", text: shipContext, synthetic: true }],
      },
    });
  } catch {
    // Silent skip if ship prime fails (not installed or not initialized)
  }
}

/**
 * Execute ship CLI command and return output
 */
async function runShip(
  $: PluginInput["$"],
  args: string[]
): Promise<{ success: boolean; output: string }> {
  try {
    const result = await $`ship ${args}`.nothrow();
    const stdout = await new Response(result.stdout).text();
    const stderr = await new Response(result.stderr).text();

    if (result.exitCode !== 0) {
      return { success: false, output: stderr || stdout };
    }

    return { success: true, output: stdout };
  } catch (error) {
    return {
      success: false,
      output: `Failed to run ship: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check if ship is configured by attempting to run a ship command.
 * This handles both local (.ship/config.yaml) and global configurations.
 */
async function isShipConfigured($: PluginInput["$"]): Promise<boolean> {
  try {
    // Try running ship prime - it will fail if not configured
    const result = await $`ship prime`.nothrow();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Format a list of tasks for display
 */
function formatTaskList(
  tasks: Array<{
    identifier: string;
    title: string;
    priority: string;
    status: string;
    url: string;
  }>
): string {
  return tasks
    .map((t) => {
      const priority =
        t.priority === "urgent"
          ? "[!]"
          : t.priority === "high"
            ? "[^]"
            : "   ";
      return `${priority} ${t.identifier.padEnd(10)} ${t.status.padEnd(12)} ${t.title}`;
    })
    .join("\n");
}

/**
 * Format task details for display
 */
function formatTaskDetails(task: {
  identifier: string;
  title: string;
  description?: string;
  priority: string;
  status: string;
  labels: string[];
  url: string;
  branchName?: string;
}): string {
  let output = `# ${task.identifier}: ${task.title}

**Status:** ${task.status}
**Priority:** ${task.priority}
**Labels:** ${task.labels.length > 0 ? task.labels.join(", ") : "none"}
**URL:** ${task.url}`;

  if (task.branchName) {
    output += `\n**Branch:** ${task.branchName}`;
  }

  if (task.description) {
    output += `\n\n## Description\n\n${task.description}`;
  }

  return output;
}

/**
 * Ship tool for task management
 */
const shipTool = createTool({
  description: `Linear task management for the current project.

Use this tool to:
- List tasks ready to work on (no blockers)
- View task details
- Start/complete tasks
- Create new tasks
- Manage task dependencies (blocking relationships)
- Get AI-optimized context about current work

Requires ship to be configured in the project (.ship/config.yaml).
Run 'ship init' in the terminal first if not configured.`,

  args: {
    action: createTool.schema
      .enum([
        "ready",
        "list",
        "blocked",
        "show",
        "start",
        "done",
        "create",
        "block",
        "unblock",
        "prime",
        "status",
      ])
      .describe(
        "Action to perform: ready (unblocked tasks), list (all tasks), blocked (blocked tasks), show (task details), start (begin task), done (complete task), create (new task), block/unblock (dependencies), prime (AI context), status (current config)"
      ),
    taskId: createTool.schema
      .string()
      .optional()
      .describe("Task identifier (e.g., BRI-123) - required for show, start, done"),
    title: createTool.schema
      .string()
      .optional()
      .describe("Task title - required for create"),
    description: createTool.schema
      .string()
      .optional()
      .describe("Task description - optional for create"),
    priority: createTool.schema
      .enum(["urgent", "high", "medium", "low", "none"])
      .optional()
      .describe("Task priority - optional for create"),
    blocker: createTool.schema
      .string()
      .optional()
      .describe("Blocker task ID - required for block/unblock"),
    blocked: createTool.schema
      .string()
      .optional()
      .describe("Blocked task ID - required for block/unblock"),
    filter: createTool.schema
      .object({
        status: createTool.schema
          .enum(["backlog", "todo", "in_progress", "in_review", "done", "cancelled"])
          .optional(),
        priority: createTool.schema.enum(["urgent", "high", "medium", "low", "none"]).optional(),
        mine: createTool.schema.boolean().optional(),
      })
      .optional()
      .describe("Filters for list action"),
  },

  async execute(args, ctx) {
    const $ = (ctx as any).$ as PluginInput["$"];

    // Check if ship is configured
    if (args.action !== "status") {
      const configured = await isShipConfigured($);
      if (!configured) {
        return `Ship is not configured in this project.

Run 'ship init' in the terminal to:
1. Authenticate with Linear (paste your API key from https://linear.app/settings/api)
2. Select your team
3. Optionally select a project

After that, you can use this tool to manage tasks.`;
      }
    }

    switch (args.action) {
      case "status": {
        const configured = await isShipConfigured($);
        if (!configured) {
          return "Ship is not configured. Run 'ship init' first.";
        }
        return "Ship is configured in this project.";
      }

      case "ready": {
        const result = await runShip($, ["ready", "--json"]);
        if (!result.success) {
          return `Failed to get ready tasks: ${result.output}`;
        }
        try {
          const tasks = JSON.parse(result.output);
          if (tasks.length === 0) {
            return "No tasks ready to work on (all tasks are either blocked or completed).";
          }
          return `Ready tasks (no blockers):\n\n${formatTaskList(tasks)}`;
        } catch {
          return result.output;
        }
      }

      case "list": {
        const listArgs = ["list", "--json"];
        if (args.filter?.status) listArgs.push("--status", args.filter.status);
        if (args.filter?.priority) listArgs.push("--priority", args.filter.priority);
        if (args.filter?.mine) listArgs.push("--mine");

        const result = await runShip($, listArgs);
        if (!result.success) {
          return `Failed to list tasks: ${result.output}`;
        }
        try {
          const tasks = JSON.parse(result.output);
          if (tasks.length === 0) {
            return "No tasks found matching the filter.";
          }
          return `Tasks:\n\n${formatTaskList(tasks)}`;
        } catch {
          return result.output;
        }
      }

      case "blocked": {
        const result = await runShip($, ["blocked", "--json"]);
        if (!result.success) {
          return `Failed to get blocked tasks: ${result.output}`;
        }
        try {
          const tasks = JSON.parse(result.output);
          if (tasks.length === 0) {
            return "No blocked tasks.";
          }
          return `Blocked tasks:\n\n${formatTaskList(tasks)}`;
        } catch {
          return result.output;
        }
      }

      case "show": {
        if (!args.taskId) {
          return "Error: taskId is required for show action";
        }
        const result = await runShip($, ["show", args.taskId, "--json"]);
        if (!result.success) {
          return `Failed to get task: ${result.output}`;
        }
        try {
          const task = JSON.parse(result.output);
          return formatTaskDetails(task);
        } catch {
          return result.output;
        }
      }

      case "start": {
        if (!args.taskId) {
          return "Error: taskId is required for start action";
        }
        const result = await runShip($, ["start", args.taskId]);
        if (!result.success) {
          return `Failed to start task: ${result.output}`;
        }
        return `Started working on ${args.taskId}`;
      }

      case "done": {
        if (!args.taskId) {
          return "Error: taskId is required for done action";
        }
        const result = await runShip($, ["done", args.taskId]);
        if (!result.success) {
          return `Failed to complete task: ${result.output}`;
        }
        return `Completed ${args.taskId}`;
      }

      case "create": {
        if (!args.title) {
          return "Error: title is required for create action";
        }
        const createArgs = ["create", args.title, "--json"];
        if (args.description) createArgs.push("--description", args.description);
        if (args.priority) createArgs.push("--priority", args.priority);

        const result = await runShip($, createArgs);
        if (!result.success) {
          return `Failed to create task: ${result.output}`;
        }
        try {
          const task = JSON.parse(result.output);
          return `Created task ${task.identifier}: ${task.title}\nURL: ${task.url}`;
        } catch {
          return result.output;
        }
      }

      case "block": {
        if (!args.blocker || !args.blocked) {
          return "Error: both blocker and blocked task IDs are required";
        }
        const result = await runShip($, ["block", args.blocker, args.blocked]);
        if (!result.success) {
          return `Failed to add blocker: ${result.output}`;
        }
        return `${args.blocker} now blocks ${args.blocked}`;
      }

      case "unblock": {
        if (!args.blocker || !args.blocked) {
          return "Error: both blocker and blocked task IDs are required";
        }
        const result = await runShip($, ["unblock", args.blocker, args.blocked]);
        if (!result.success) {
          return `Failed to remove blocker: ${result.output}`;
        }
        return `Removed ${args.blocker} as blocker of ${args.blocked}`;
      }

      case "prime": {
        const result = await runShip($, ["prime"]);
        if (!result.success) {
          return `Failed to get context: ${result.output}`;
        }
        return result.output;
      }

      default:
        return `Unknown action: ${args.action}`;
    }
  },
});

/**
 * Ship OpenCode Plugin
 */
export const ShipPlugin: Plugin = async ({ client, $ }) => {
  const injectedSessions = new Set<string>();

  return {
    "chat.message": async (_input, output) => {
      const sessionID = output.message.sessionID;

      // Skip if already injected this session
      if (injectedSessions.has(sessionID)) return;

      // Check if ship-context was already injected (handles plugin reload/reconnection)
      try {
        const existing = await client.session.messages({
          path: { id: sessionID },
        });

        if (existing.data) {
          const hasShipContext = existing.data.some((msg) => {
            const parts = (msg as any).parts || (msg.info as any).parts;
            if (!parts) return false;
            return parts.some(
              (part: any) =>
                part.type === "text" && part.text?.includes("<ship-context>")
            );
          });

          if (hasShipContext) {
            injectedSessions.add(sessionID);
            return;
          }
        }
      } catch {
        // On error, proceed with injection
      }

      injectedSessions.add(sessionID);

      // Use output.message which has the resolved model/agent values
      await injectShipContext(client, $, sessionID, {
        model: output.message.model,
        agent: output.message.agent,
      });
    },

    event: async ({ event }) => {
      if (event.type === "session.compacted") {
        const sessionID = event.properties.sessionID;
        const context = await getSessionContext(client, sessionID);
        await injectShipContext(client, $, sessionID, context);
      }
    },

    // Register the ship tool
    tool: {
      ship: shipTool,
    },
  };
};

// Default export for OpenCode
export default ShipPlugin;
