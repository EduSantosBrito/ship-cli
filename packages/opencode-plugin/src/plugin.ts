/**
 * Ship OpenCode Plugin
 *
 * Integrates the Ship CLI (Linear task management) with OpenCode.
 * Rewritten using Effect for consistency and reliability.
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { tool as createTool } from "@opencode-ai/plugin";
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

// =============================================================================
// Types & Errors
// =============================================================================

type OpencodeClient = PluginInput["client"];
type BunShell = PluginInput["$"];

class ShipCommandError extends Data.TaggedError("ShipCommandError")<{
  readonly command: string;
  readonly message: string;
}> {}

class ShipNotConfiguredError extends Data.TaggedError("ShipNotConfiguredError")<{
  readonly reason?: string;
}> {}

class JsonParseError extends Data.TaggedError("JsonParseError")<{
  readonly raw: string;
  readonly cause: unknown;
}> {}

interface ShipStatus {
  configured: boolean;
  teamId?: string;
  teamKey?: string;
  projectId?: string | null;
}

interface ShipTask {
  identifier: string;
  title: string;
  description?: string;
  priority: string;
  status: string;
  state?: string;
  labels: string[];
  url: string;
  branchName?: string;
}

// =============================================================================
// Shell Service
// =============================================================================

interface ShellService {
  readonly run: (
    args: string[]
  ) => Effect.Effect<string, ShipCommandError>;
}

const ShellService = Context.GenericTag<ShellService>("ShellService");

const makeShellService = (_$: BunShell): ShellService => {
  const getCommand = (): string[] => {
    if (process.env.NODE_ENV === "development") {
      return ["pnpm", "ship"];
    }
    return ["ship"];
  };

  const extractJson = (output: string): string => {
    // When using pnpm, stdout may include pnpm's prefix lines before actual output
    const jsonMatch = output.match(/^\s*[\[{]/m);
    if (jsonMatch && jsonMatch.index !== undefined) {
      return output.slice(jsonMatch.index);
    }
    return output;
  };

  return {
    run: (args: string[]) =>
      Effect.gen(function* () {
        const cmd = getCommand();
        const fullArgs = [...cmd, ...args];
        
        const result = yield* Effect.tryPromise({
          try: async (signal) => {
            // Use Bun.spawn with AbortSignal for proper interruption support
            const proc = Bun.spawn(fullArgs, {
              stdout: "pipe",
              stderr: "pipe",
              signal,
            });

            const [stdout, stderr, exitCode] = await Promise.all([
              new Response(proc.stdout).text(),
              new Response(proc.stderr).text(),
              proc.exited,
            ]);

            return { exitCode, stdout, stderr };
          },
          catch: (e) =>
            new ShipCommandError({
              command: args.join(" "),
              message: `Failed to execute: ${e}`,
            }),
        });

        if (result.exitCode !== 0) {
          return yield* new ShipCommandError({
            command: args.join(" "),
            message: result.stderr || result.stdout,
          });
        }

        // Extract JSON if args include --json
        if (args.includes("--json")) {
          return extractJson(result.stdout);
        }

        return result.stdout;
      }),
  };
};

// =============================================================================
// Ship Service
// =============================================================================

interface ShipService {
  readonly checkConfigured: () => Effect.Effect<ShipStatus, ShipCommandError | JsonParseError>;
  readonly getReadyTasks: () => Effect.Effect<ShipTask[], ShipCommandError | JsonParseError>;
  readonly getBlockedTasks: () => Effect.Effect<ShipTask[], ShipCommandError | JsonParseError>;
  readonly listTasks: (filter?: {
    status?: string;
    priority?: string;
    mine?: boolean;
  }) => Effect.Effect<ShipTask[], ShipCommandError | JsonParseError>;
  readonly getTask: (
    taskId: string
  ) => Effect.Effect<ShipTask, ShipCommandError | JsonParseError>;
  readonly startTask: (taskId: string) => Effect.Effect<void, ShipCommandError>;
  readonly completeTask: (taskId: string) => Effect.Effect<void, ShipCommandError>;
  readonly createTask: (input: {
    title: string;
    description?: string;
    priority?: string;
  }) => Effect.Effect<ShipTask, ShipCommandError | JsonParseError>;
  readonly updateTask: (
    taskId: string,
    input: {
      title?: string;
      description?: string;
      priority?: string;
      status?: string;
    }
  ) => Effect.Effect<ShipTask, ShipCommandError | JsonParseError>;
  readonly addBlocker: (
    blocker: string,
    blocked: string
  ) => Effect.Effect<void, ShipCommandError>;
  readonly removeBlocker: (
    blocker: string,
    blocked: string
  ) => Effect.Effect<void, ShipCommandError>;
  readonly relateTask: (
    taskId: string,
    relatedTaskId: string
  ) => Effect.Effect<void, ShipCommandError>;
  readonly getPrimeContext: () => Effect.Effect<string, ShipCommandError>;
}

const ShipService = Context.GenericTag<ShipService>("ShipService");

const parseJson = <T>(raw: string): Effect.Effect<T, JsonParseError> =>
  Effect.try({
    try: () => JSON.parse(raw) as T,
    catch: (cause) => new JsonParseError({ raw, cause }),
  });

const makeShipService = Effect.gen(function* () {
  const shell = yield* ShellService;

  const checkConfigured = () =>
    Effect.gen(function* () {
      const output = yield* shell.run(["status", "--json"]);
      return yield* parseJson<ShipStatus>(output);
    });

  const getReadyTasks = () =>
    Effect.gen(function* () {
      const output = yield* shell.run(["ready", "--json"]);
      return yield* parseJson<ShipTask[]>(output);
    });

  const getBlockedTasks = () =>
    Effect.gen(function* () {
      const output = yield* shell.run(["blocked", "--json"]);
      return yield* parseJson<ShipTask[]>(output);
    });

  const listTasks = (filter?: { status?: string; priority?: string; mine?: boolean }) =>
    Effect.gen(function* () {
      const args = ["list", "--json"];
      if (filter?.status) args.push("--status", filter.status);
      if (filter?.priority) args.push("--priority", filter.priority);
      if (filter?.mine) args.push("--mine");

      const output = yield* shell.run(args);
      return yield* parseJson<ShipTask[]>(output);
    });

  const getTask = (taskId: string) =>
    Effect.gen(function* () {
      const output = yield* shell.run(["show", "--json", taskId]);
      return yield* parseJson<ShipTask>(output);
    });

  const startTask = (taskId: string) =>
    shell.run(["start", taskId]).pipe(Effect.asVoid);

  const completeTask = (taskId: string) =>
    shell.run(["done", taskId]).pipe(Effect.asVoid);

  const createTask = (input: { title: string; description?: string; priority?: string }) =>
    Effect.gen(function* () {
      const args = ["create", "--json"];
      if (input.description) args.push("--description", input.description);
      if (input.priority) args.push("--priority", input.priority);
      args.push(input.title);

      const output = yield* shell.run(args);
      const response = yield* parseJson<{ task: ShipTask }>(output);
      return response.task;
    });

  const updateTask = (
    taskId: string,
    input: { title?: string; description?: string; priority?: string; status?: string }
  ) =>
    Effect.gen(function* () {
      const args = ["update", "--json"];
      if (input.title) args.push("--title", input.title);
      if (input.description) args.push("--description", input.description);
      if (input.priority) args.push("--priority", input.priority);
      if (input.status) args.push("--status", input.status);
      args.push(taskId);

      const output = yield* shell.run(args);
      const response = yield* parseJson<{ task: ShipTask }>(output);
      return response.task;
    });

  const addBlocker = (blocker: string, blocked: string) =>
    shell.run(["block", blocker, blocked]).pipe(Effect.asVoid);

  const removeBlocker = (blocker: string, blocked: string) =>
    shell.run(["unblock", blocker, blocked]).pipe(Effect.asVoid);

  const relateTask = (taskId: string, relatedTaskId: string) =>
    shell.run(["relate", taskId, relatedTaskId]).pipe(Effect.asVoid);

  const getPrimeContext = () => shell.run(["prime"]);

  return {
    checkConfigured,
    getReadyTasks,
    getBlockedTasks,
    listTasks,
    getTask,
    startTask,
    completeTask,
    createTask,
    updateTask,
    addBlocker,
    removeBlocker,
    relateTask,
    getPrimeContext,
  } satisfies ShipService;
});

// =============================================================================
// Formatters
// =============================================================================

const formatTaskList = (tasks: ShipTask[]): string =>
  tasks
    .map((t) => {
      const priority =
        t.priority === "urgent" ? "[!]" : t.priority === "high" ? "[^]" : "   ";
      return `${priority} ${t.identifier.padEnd(10)} ${(t.state || t.status).padEnd(12)} ${t.title}`;
    })
    .join("\n");

const formatTaskDetails = (task: ShipTask): string => {
  let output = `# ${task.identifier}: ${task.title}

**Status:** ${task.state || task.status}
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
};

// =============================================================================
// Tool Actions
// =============================================================================

type ToolArgs = {
  action: string;
  taskId?: string;
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  blocker?: string;
  blocked?: string;
  relatedTaskId?: string;
  filter?: {
    status?: string;
    priority?: string;
    mine?: boolean;
  };
};

const executeAction = (
  args: ToolArgs
): Effect.Effect<string, ShipCommandError | JsonParseError | ShipNotConfiguredError, ShipService> =>
  Effect.gen(function* () {
    const ship = yield* ShipService;

    // Check configuration for all actions except status
    if (args.action !== "status") {
      const status = yield* ship.checkConfigured().pipe(
        Effect.catchAll(() => Effect.succeed({ configured: false }))
      );
      if (!status.configured) {
        return yield* new ShipNotConfiguredError({});
      }
    }

    switch (args.action) {
      case "status": {
        const status = yield* ship.checkConfigured();
        if (status.configured) {
          return `Ship is configured.\n\nTeam: ${status.teamKey}\nProject: ${status.projectId || "none"}`;
        }
        return "Ship is not configured. Run 'ship init' first.";
      }

      case "ready": {
        const tasks = yield* ship.getReadyTasks();
        if (tasks.length === 0) {
          return "No tasks ready to work on (all tasks are either blocked or completed).";
        }
        return `Ready tasks (no blockers):\n\n${formatTaskList(tasks)}`;
      }

      case "blocked": {
        const tasks = yield* ship.getBlockedTasks();
        if (tasks.length === 0) {
          return "No blocked tasks.";
        }
        return `Blocked tasks:\n\n${formatTaskList(tasks)}`;
      }

      case "list": {
        const tasks = yield* ship.listTasks(args.filter);
        if (tasks.length === 0) {
          return "No tasks found matching the filter.";
        }
        return `Tasks:\n\n${formatTaskList(tasks)}`;
      }

      case "show": {
        if (!args.taskId) {
          return "Error: taskId is required for show action";
        }
        const task = yield* ship.getTask(args.taskId);
        return formatTaskDetails(task);
      }

      case "start": {
        if (!args.taskId) {
          return "Error: taskId is required for start action";
        }
        yield* ship.startTask(args.taskId);
        return `Started working on ${args.taskId}`;
      }

      case "done": {
        if (!args.taskId) {
          return "Error: taskId is required for done action";
        }
        yield* ship.completeTask(args.taskId);
        return `Completed ${args.taskId}`;
      }

      case "create": {
        if (!args.title) {
          return "Error: title is required for create action";
        }
        const task = yield* ship.createTask({
          title: args.title,
          description: args.description,
          priority: args.priority,
        });
        return `Created task ${task.identifier}: ${task.title}\nURL: ${task.url}`;
      }

      case "update": {
        if (!args.taskId) {
          return "Error: taskId is required for update action";
        }
        if (!args.title && !args.description && !args.priority && !args.status) {
          return "Error: at least one of title, description, priority, or status is required for update";
        }
        const task = yield* ship.updateTask(args.taskId, {
          title: args.title,
          description: args.description,
          priority: args.priority,
          status: args.status,
        });
        return `Updated task ${task.identifier}: ${task.title}\nURL: ${task.url}`;
      }

      case "block": {
        if (!args.blocker || !args.blocked) {
          return "Error: both blocker and blocked task IDs are required";
        }
        yield* ship.addBlocker(args.blocker, args.blocked);
        return `${args.blocker} now blocks ${args.blocked}`;
      }

      case "unblock": {
        if (!args.blocker || !args.blocked) {
          return "Error: both blocker and blocked task IDs are required";
        }
        yield* ship.removeBlocker(args.blocker, args.blocked);
        return `Removed ${args.blocker} as blocker of ${args.blocked}`;
      }

      case "relate": {
        if (!args.taskId || !args.relatedTaskId) {
          return "Error: both taskId and relatedTaskId are required for relate action";
        }
        yield* ship.relateTask(args.taskId, args.relatedTaskId);
        return `Linked ${args.taskId} ↔ ${args.relatedTaskId} as related`;
      }

      case "prime": {
        return yield* ship.getPrimeContext();
      }

      default:
        return `Unknown action: ${args.action}`;
    }
  });

// =============================================================================
// Constants
// =============================================================================

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

// =============================================================================
// Tool Creation
// =============================================================================

const createShipTool = ($: BunShell) => {
  const shellService = makeShellService($);
  const ShellServiceLive = Layer.succeed(ShellService, shellService);
  const ShipServiceLive = Layer.effect(ShipService, makeShipService).pipe(
    Layer.provide(ShellServiceLive)
  );

  const runEffect = <A, E>(effect: Effect.Effect<A, E, ShipService>): Promise<A> =>
    Effect.runPromise(Effect.provide(effect, ShipServiceLive));

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
      const result = await runEffect(
        executeAction(args).pipe(
          Effect.catchAll((error) => {
            if (error._tag === "ShipNotConfiguredError") {
              return Effect.succeed(`Ship is not configured in this project.

Run 'ship init' in the terminal to:
1. Authenticate with Linear (paste your API key from https://linear.app/settings/api)
2. Select your team
3. Optionally select a project

After that, you can use this tool to manage tasks.`);
            }
            if (error._tag === "ShipCommandError") {
              return Effect.succeed(`Command failed: ${error.message}`);
            }
            if (error._tag === "JsonParseError") {
              return Effect.succeed(`Failed to parse response: ${error.raw}`);
            }
            return Effect.succeed(`Unknown error: ${JSON.stringify(error)}`);
          })
        )
      );
      return result;
    },
  });
};

// =============================================================================
// Session Context Helpers
// =============================================================================

const getSessionContext = async (
  client: OpencodeClient,
  sessionID: string
): Promise<{ model?: { providerID: string; modelID: string }; agent?: string } | undefined> => {
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
    // On error, return undefined
  }
  return undefined;
};

const injectShipContext = async (
  client: OpencodeClient,
  sessionID: string,
  context?: { model?: { providerID: string; modelID: string }; agent?: string }
): Promise<void> => {
  try {
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
};

// =============================================================================
// Plugin Export
// =============================================================================

export const ShipPlugin: Plugin = async ({ client, $ }) => {
  const injectedSessions = new Set<string>();
  const shipTool = createShipTool($);

  return {
    "chat.message": async (_input, output) => {
      const sessionID = output.message.sessionID;

      if (injectedSessions.has(sessionID)) return;

      try {
        const existing = await client.session.messages({
          path: { id: sessionID },
        });

        if (existing.data) {
          const hasShipContext = existing.data.some((msg) => {
            const parts = (msg as any).parts || (msg.info as any).parts;
            if (!parts) return false;
            return parts.some(
              (part: any) => part.type === "text" && part.text?.includes("<ship-context>")
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
      config.command = { ...config.command, ...SHIP_COMMANDS };
    },

    tool: {
      ship: shipTool,
    },
  };
};

export default ShipPlugin;
