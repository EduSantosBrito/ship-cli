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

const SHIP_GUIDANCE = `## Ship Tool Guidance

**IMPORTANT: Always use the \`ship\` tool, NEVER run \`ship\` or \`pnpm ship\` via bash/terminal.**

The \`ship\` tool is available for Linear task management. Use it instead of CLI commands.

### Available Actions (via ship tool)
- \`ready\` - Tasks you can work on (no blockers)
- \`blocked\` - Tasks waiting on dependencies  
- \`list\` - All tasks (with optional filters)
- \`show\` - Task details (requires taskId)
- \`start\` - Begin working on task (requires taskId)
- \`done\` - Mark task complete (requires taskId)
- \`create\` - Create new task (requires title)
- \`update\` - Update task (requires taskId + fields to update)
- \`block\` - Add blocking relationship (requires blocker + blocked)
- \`unblock\` - Remove blocking relationship (requires blocker + blocked)
- \`relate\` - Link tasks as related (requires taskId + relatedTaskId)
- \`prime\` - Get AI context
- \`status\` - Check configuration

### Best Practices
1. Use \`ship\` tool with action \`ready\` to see available work
2. Use \`ship\` tool with action \`start\` before beginning work
3. Use \`ship\` tool with action \`done\` when completing tasks
4. Use \`ship\` tool with action \`block\` for dependency relationships

### Linear Task Relationships

Linear has native relationship types. **Always use these instead of writing dependencies in text:**

**Blocking (for dependencies):**
- Use ship tool: action=\`block\`, blocker=\`BRI-100\`, blocked=\`BRI-101\`
- Use ship tool: action=\`unblock\` to remove relationships
- Use ship tool: action=\`blocked\` to see waiting tasks

**Related (for cross-references):**
- Use ship tool: action=\`relate\`, taskId=\`BRI-100\`, relatedTaskId=\`BRI-101\`
- Use this when tasks are conceptually related but not blocking each other

**Mentioning Tasks in Descriptions (Clickable Pills):**
To create clickable task pills in descriptions, use full markdown links:
\`[BRI-123](https://linear.app/WORKSPACE/issue/BRI-123/slug)\`

Get the full URL from ship tool (action=\`show\`, taskId=\`BRI-123\`) and use it in markdown link format.
Plain text \`BRI-123\` will NOT create clickable pills.

### Task Description Template

\`\`\`markdown
## Context
Brief explanation of why this task exists and where it fits.

## Problem Statement
What specific problem does this task solve? Current vs desired behavior.

## Implementation Notes
- Key files: \`path/to/file.ts\`
- Patterns: Reference existing implementations
- Technical constraints

## Acceptance Criteria
- [ ] Specific, testable requirement 1
- [ ] Specific, testable requirement 2
- [ ] Tests pass

## Out of Scope
- What NOT to include

## Dependencies
- Blocked by: [BRI-XXX](url) (brief reason)
- Blocks: [BRI-YYY](url) (brief reason)
\`\`\`

**Important:** 
1. Set blocking relationships via ship tool action=\`block\` (appears in Linear sidebar)
2. ALSO document in description using markdown links for context
3. Get task URLs from ship tool action=\`show\`

### Task Quality Checklist
- Title is actionable and specific (not "Fix bug" but "Fix null pointer in UserService.getById")
- Context explains WHY, not just WHAT
- Acceptance criteria are testable
- **Dependencies set via \`ship block\`** AND documented with markdown links
- Links use full URL format: \`[BRI-123](https://linear.app/...)\`
- Priority reflects business impact (urgent/high/medium/low)`;

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
 * Get the ship command based on NODE_ENV.
 * 
 * - NODE_ENV=development: Use "pnpm ship" (for developing the CLI in this repo)
 * - Otherwise: Use "ship" (globally installed CLI)
 */
function getShipCommand(): string[] {
  if (process.env.NODE_ENV === "development") {
    return ["pnpm", "ship"];
  }
  return ["ship"];
}

/**
 * Inject ship context into a session.
 *
 * Injects static guidance for using the ship tool. Does NOT fetch live data
 * from Linear - the AI should use the ship tool to get task data.
 * This ensures instant response on first message.
 */
async function injectShipContext(
  client: OpencodeClient,
  sessionID: string,
  context?: { model?: { providerID: string; modelID: string }; agent?: string }
): Promise<void> {
  try {
    // Inject only the static guidance - no API calls
    // The AI will use the ship tool to fetch live data when needed
    await client.session.prompt({
      path: { id: sessionID },
      body: {
        noReply: true,
        model: context?.model,
        agent: context?.agent,
        parts: [{ type: "text", text: SHIP_GUIDANCE, synthetic: true }],
      },
    });
  } catch {
    // Silent skip on error
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
    const cmd = getShipCommand();
    // Use quiet() to prevent output from bleeding into TUI
    const result = await $`${cmd} ${args}`.quiet().nothrow();
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
    const cmd = getShipCommand();
    // Try running ship prime - it will fail if not configured
    // Use quiet() to suppress stdout/stderr from bleeding into TUI
    const result = await $`${cmd} prime`.quiet().nothrow();
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
 * Create ship tool with captured $ from plugin context
 */
function createShipTool($: PluginInput["$"]) {
  return createTool({
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
          "update",
          "block",
          "unblock",
          "relate",
          "prime",
          "status",
        ])
        .describe(
          "Action to perform: ready (unblocked tasks), list (all tasks), blocked (blocked tasks), show (task details), start (begin task), done (complete task), create (new task), update (modify task), block/unblock (dependencies), relate (link related tasks), prime (AI context), status (current config)"
        ),
      taskId: createTool.schema
        .string()
        .optional()
        .describe("Task identifier (e.g., BRI-123) - required for show, start, done, update"),
      title: createTool.schema
        .string()
        .optional()
        .describe("Task title - required for create, optional for update"),
      description: createTool.schema
        .string()
        .optional()
        .describe("Task description - optional for create/update"),
      priority: createTool.schema
        .enum(["urgent", "high", "medium", "low", "none"])
        .optional()
        .describe("Task priority - optional for create/update"),
      status: createTool.schema
        .enum(["backlog", "todo", "in_progress", "in_review", "done", "cancelled"])
        .optional()
        .describe("Task status - optional for update"),
      blocker: createTool.schema
        .string()
        .optional()
        .describe("Blocker task ID - required for block/unblock"),
      blocked: createTool.schema
        .string()
        .optional()
        .describe("Blocked task ID - required for block/unblock"),
      relatedTaskId: createTool.schema
        .string()
        .optional()
        .describe("Related task ID - required for relate (use with taskId)"),
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

    async execute(args) {
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
          const result = await runShip($, ["show", "--json", args.taskId]);
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
          const createArgs = ["create", "--json"];
          if (args.description) createArgs.push("--description", args.description);
          if (args.priority) createArgs.push("--priority", args.priority);
          createArgs.push(args.title);

          const result = await runShip($, createArgs);
          if (!result.success) {
            return `Failed to create task: ${result.output}`;
          }
          try {
            const response = JSON.parse(result.output);
            const task = response.task;
            return `Created task ${task.identifier}: ${task.title}\nURL: ${task.url}`;
          } catch {
            return result.output;
          }
        }

        case "update": {
          if (!args.taskId) {
            return "Error: taskId is required for update action";
          }
          if (!args.title && !args.description && !args.priority && !args.status) {
            return "Error: at least one of title, description, priority, or status is required for update";
          }
          const updateArgs = ["update", "--json"];
          if (args.title) updateArgs.push("--title", args.title);
          if (args.description) updateArgs.push("--description", args.description);
          if (args.priority) updateArgs.push("--priority", args.priority);
          if (args.status) updateArgs.push("--status", args.status);
          updateArgs.push(args.taskId);

          const result = await runShip($, updateArgs);
          if (!result.success) {
            return `Failed to update task: ${result.output}`;
          }
          try {
            const response = JSON.parse(result.output);
            const task = response.task;
            return `Updated task ${task.identifier}: ${task.title}\nURL: ${task.url}`;
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

        case "relate": {
          if (!args.taskId || !args.relatedTaskId) {
            return "Error: both taskId and relatedTaskId are required for relate action";
          }
          const result = await runShip($, ["relate", args.taskId, args.relatedTaskId]);
          if (!result.success) {
            return `Failed to relate tasks: ${result.output}`;
          }
          return `Linked ${args.taskId} ↔ ${args.relatedTaskId} as related`;
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
}

/**
 * Ship OpenCode Plugin
 */
// Pre-define commands (loaded at plugin init, not lazily in config hook)
const SHIP_COMMANDS = {
  ready: {
    description: "Find ready-to-work tasks with no blockers",
    template: `Use the \`ship\` tool with action \`ready\` to find tasks that are ready to work on (no blocking dependencies).

Present the results in a clear format showing:
- Task ID (e.g., BRI-123)
- Title  
- Priority
- URL

If there are ready tasks, ask the user which one they'd like to work on. If they choose one, use the \`ship\` tool with action \`start\` to begin work on it.

If there are no ready tasks, suggest checking blocked tasks (action \`blocked\`) or creating a new task (action \`create\`).`,
  },
};

export const ShipPlugin: Plugin = async ({ client, $ }) => {
  const injectedSessions = new Set<string>();

  // Create the ship tool with captured $
  const shipTool = createShipTool($);

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
      await injectShipContext(client, sessionID, {
        model: output.message.model,
        agent: output.message.agent,
      });
    },

    event: async ({ event }) => {
      if (event.type === "session.compacted") {
        const sessionID = event.properties.sessionID;
        const context = await getSessionContext(client, sessionID);
        await injectShipContext(client, sessionID, context);
      }
    },

    config: async (config) => {
      // Register commands (using pre-defined SHIP_COMMANDS for reliability)
      config.command = { ...config.command, ...SHIP_COMMANDS };
    },

    // Register the ship tool
    tool: {
      ship: shipTool,
    },
  };
};

// Default export for OpenCode
export default ShipPlugin;
