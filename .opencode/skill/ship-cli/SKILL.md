---
name: ship-cli
description: Work management system replacing built-in todos with tracked tasks and stacked changes
---

## CRITICAL RULES - READ FIRST

**NEVER run these commands directly via bash/terminal:**
- `jj` commands (jj new, jj describe, jj bookmark, jj git push, etc.)
- `gh pr` commands (gh pr create, gh pr edit, etc.)
- `git` commands for VCS operations
- `ship` or `pnpm ship` CLI commands

**ALWAYS use the `ship` tool for ALL version control and PR operations.**

The ship tool wraps jj and gh commands with proper error handling, state management, and workflow integration. Using raw commands bypasses these safeguards and can cause:
- Inconsistent state between ship's tracking and actual VCS state
- Missing webhook subscriptions for PR events
- Broken workspace management
- Lost work due to improper change tracking

---

## When to use

**Always use ship instead of the built-in TodoWrite/TodoRead tools.**

Ship provides real task tracking that persists across sessions, supports dependencies between tasks, and integrates with stacked changes for clean PR workflows.

---

## BEFORE YOU START CODING

**You MUST complete these steps before writing any code:**

1. `ship` tool with action `start`, taskId=`<id>` - Mark task as In Progress
2. `ship` tool with action `stack-create`, message=`"<id>: <title>"`, bookmark=`<branch-name>` - Creates workspace
3. **Store the workspace path** from the output (e.g., `/Users/x/project/.ship/workspaces/bri-123-feature`)
4. `bash` with command=`"pnpm install"`, workdir=`<workspace-path>` - Install dependencies
5. **Use `workdir` parameter for ALL subsequent commands** - both bash and ship tool actions

**DO NOT ask the user to `cd` into the workspace.** The agent cannot change the user's shell directory. Instead, use the `workdir` parameter for all commands.

Example:
```
# After stack-create returns workspace path "/Users/x/project/.ship/workspaces/bri-123"
bash: command="pnpm install", workdir="/Users/x/project/.ship/workspaces/bri-123"
bash: command="pnpm test", workdir="/Users/x/project/.ship/workspaces/bri-123"
ship: action="stack-status", workdir="/Users/x/project/.ship/workspaces/bri-123"
```

---

## Ship Tool Guidance

**IMPORTANT: Always use the `ship` tool, NEVER run VCS commands via bash/terminal.**

Forbidden bash commands (use ship tool instead):
- `jj new`, `jj describe`, `jj bookmark`, `jj git push` → use `stack-create`, `stack-describe`, `stack-submit`
- `gh pr create`, `gh pr edit` → use `stack-submit`
- `ship` or `pnpm ship` → use the `ship` tool directly

The `ship` tool replaces built-in todo management. Use it for all task tracking and VCS operations.

---

## Available Actions

### Task Management

| Action | Description | Required params |
|--------|-------------|-----------------|
| `ready` | Tasks you can work on (no blockers) | - |
| `blocked` | Tasks waiting on dependencies | - |
| `list` | All tasks (with optional filters) | - |
| `show` | Task details | taskId |
| `start` | Mark task as In Progress (Linear only) | taskId |
| `done` | Mark task as complete | taskId |
| `create` | Create new task | title |
| `update` | Update task | taskId + fields |
| `block` | Add blocking relationship | blocker, blocked |
| `unblock` | Remove blocking relationship | blocker, blocked |
| `relate` | Link tasks as related | taskId, relatedTaskId |
| `status` | Check configuration | - |

### Stack Actions (VCS)

All stack actions support an optional `workdir` parameter for operating in jj workspaces.

| Action | Description | Required params |
|--------|-------------|-----------------|
| `stack-log` | View stack of changes from trunk to current | workdir (optional) |
| `stack-status` | Show current change status | workdir (optional) |
| `stack-create` | Create new jj change (workspace by default) | message (optional), bookmark (optional), noWorkspace (optional), workdir (optional) |
| `stack-describe` | Update change description | message, workdir (optional) |
| `stack-sync` | Fetch and rebase onto trunk | workdir (optional) |
| `stack-restack` | Rebase stack onto trunk (no fetch) | workdir (optional) |
| `stack-submit` | Push and create/update PR (auto-subscribes to webhook events) | draft (optional), workdir (optional) |
| `stack-squash` | Squash current change into parent | message, workdir (optional) |
| `stack-abandon` | Abandon current change | changeId (optional), workdir (optional) |
| `stack-up` | Move to child change (toward tip of stack) | workdir (optional) |
| `stack-down` | Move to parent change (toward trunk) | workdir (optional) |
| `stack-undo` | Undo the last jj operation | workdir (optional) |
| `stack-update-stale` | Update a stale working copy | workdir (optional) |
| `stack-workspaces` | List all jj workspaces | workdir (optional) |
| `stack-remove-workspace` | Remove a jj workspace | name, deleteFiles (optional), workdir (optional) |

### Webhook Actions (GitHub Event Routing)

| Action | Description | Required params |
|--------|-------------|-----------------|
| `webhook-daemon-status` | Check if webhook daemon is running | - |
| `webhook-subscribe` | Subscribe to PR events | sessionId, prNumbers |
| `webhook-unsubscribe` | Unsubscribe from PR events | sessionId, prNumbers |

---

## Webhook Daemon & GitHub Events

The webhook daemon enables agents to receive real-time GitHub events (PR merges, CI status, review comments).

**You do NOT need to manually subscribe to PR events.** The `stack-submit` action handles this automatically.

### How It Works

1. **User starts daemon once** (in terminal): `ship webhook start`
2. **Agent submits PR**: `stack-submit` **automatically subscribes** to all stack PRs
3. **GitHub events arrive**: Daemon routes events to the agent's session
4. **Agent reacts**: Receives notification and can take action (e.g., rebase on merge)

### Automatic Subscription (No Manual Action Required)

When you use `stack-submit`, the agent is **automatically subscribed** to receive events for:
- The PR being submitted
- All parent PRs in the stack

**You will see confirmation in the output**: "Auto-subscribed to stack PRs: 40, 41, 42"

This enables the **automatic rebase workflow**: when a parent PR is merged, the agent receives the event and can run `stack-sync` to rebase.

**DO NOT manually call `webhook-subscribe`** - it's only needed for advanced cases where you want to subscribe to PRs you didn't create.

### Reacting to GitHub Events

When you receive a GitHub event notification:

1. **PR Merged**: Run `stack-sync` to rebase onto the new trunk
2. **CI Failed**: Investigate and fix the issue
3. **Review Comment**: Address the feedback
4. **PR Approved**: Consider merging or waiting for CI

---

## Workflow (Explicit Steps)

Task management and VCS operations are **separate**. You control when each happens.

### Starting Work on a Task

1. **Sync with trunk**: `ship` tool with action `stack-sync`
2. **Find a task**: `ship` tool with action `ready`
3. **Start the task**: `ship` tool with action `start`, taskId=`<id>`
   - This ONLY updates Linear status to "In Progress"
   - Does NOT create VCS changes
4. **Create VCS change (workspace created automatically)**: `ship` tool with action `stack-create`, message=`"<id>: <title>"`, bookmark=`<branch-name>`
   - Get branch name from `start` output or `show` action
   - **Workspace is created by default** for isolated development
   - **Store the workspace path** from the output for use with `workdir` parameter

### Doing the Work

5. **Install dependencies in workspace** - run the package manager's install command with `workdir` parameter
   - Check the project for `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, or `package-lock.json` to determine the package manager
   - Example: `bash(command="pnpm install", workdir="/path/to/workspace")`
   - This is required for TypeScript type checking to work properly
6. **Use `workdir` parameter for all commands** - pass the workspace path to the `workdir` parameter
   - For bash commands: `bash(command="pnpm test", workdir="/path/to/workspace")`
   - For ship VCS commands: `ship(action="stack-status", workdir="/path/to/workspace")`
   - **DO NOT ask the user to change directories** - use `workdir` instead
   - The agent cannot change the user's shell directory, but can execute commands in any directory
7. Make code changes (use workspace path for all file operations)
8. Run quality checks (lint, format, typecheck) with `workdir` parameter

### Submitting Work

**These steps are MANDATORY. Do not skip any of them.**

7. **Sync before submit**: `ship` tool with action `stack-sync`, workdir=`<workspace-path>`
   - Ensures your changes are rebased on latest trunk
   - **Use `workdir` parameter** when operating from a jj workspace
8. **Submit PR**: `ship` tool with action `stack-submit`, workdir=`<workspace-path>`
   - **IMPORTANT**: This automatically subscribes you to webhook events for all stack PRs
   - You will receive notifications when the PR is merged, CI fails, or reviews are added
   - No need to manually call `webhook-subscribe` - it happens automatically
   - **Use `workdir` parameter** when operating from a jj workspace
9. **Mark complete**: `ship` tool with action `done`, taskId=`<id>`
   - **ONLY after PR is submitted** - the PR URL should be visible in step 8 output

**WARNING**: If you mark a task as `done` without running `stack-sync` and `stack-submit`, the code changes will NOT be pushed and no PR will exist. This is a critical error.

---

## Why Explicit Control?

The agent decides when to:
- **Start a task** - Update Linear status, but maybe not create a branch yet
- **Create a change** - When ready to write code
- **Submit** - When changes are ready for review

This prevents:
- Orphaned branches when investigation doesn't lead to code changes
- Confusion about which change belongs to which task
- Automatic operations that may not be wanted

---

## Task Identifiers

Task IDs use the format `PREFIX-NUMBER` where PREFIX is the Linear team key (e.g., `ENG-123`, `PROD-456`).

To find the correct prefix for your project, use ship tool with action=`status`. The team key shown is your task prefix.

**Never hardcode or guess prefixes like `BRI-`.** Always get the actual task IDs from `ready`, `list`, or `show` actions.

---

## Task Dependencies

Use blocking relationships to track dependencies between tasks.

### Add a blocker

Use ship tool: action=`block`, blocker=`<task-id>`, blocked=`<task-id>`

Example: If ENG-100 blocks ENG-101, then ENG-100 must be completed before ENG-101 can start.

### Remove a blocker

Use ship tool: action=`unblock`, blocker=`<task-id>`, blocked=`<task-id>`

### View blocked tasks

Use ship tool: action=`blocked`

### Link related tasks

Use ship tool: action=`relate`, taskId=`<task-id>`, relatedTaskId=`<task-id>`

Use this when tasks are conceptually related but not blocking each other.

---

## Creating Tasks

When breaking down work, create tasks with clear titles and descriptions.

Use ship tool with:
- action=`create`
- title="Implement user authentication"
- description="Add JWT-based auth flow"
- priority=`high` (optional: urgent, high, medium, low)

### Creating Subtasks

To create a subtask under an existing parent task:

Use ship tool with:
- action=`create`
- title="Implement login form"
- parentId=`BRI-123` (the parent task identifier)

CLI equivalent: `ship create --parent BRI-123 "Implement login form"`

---

## Task Quality

- Title is actionable and specific
- Description explains the goal, not implementation details
- Dependencies are set via `block` action
- Priority reflects importance (urgent, high, medium, low)

---

## Stack Workflow Details

### Sync (fetch + rebase)

```
ship tool: action=`stack-sync`
```

Always sync:
- Before starting new work (get latest trunk)
- Before submitting (ensure clean rebase)
- After receiving a "PR merged" webhook event

### Create Change

```
ship tool: action=`stack-create`, message="BRI-123: Add feature", bookmark="user/bri-123-add-feature"
```

Creates a new jj change with the given description and bookmark (branch name). **By default, a jj workspace is created** in `.ship/workspaces/<bookmark-name>` for isolated development.

**Store the workspace path** from the output and use it with the `workdir` parameter for all subsequent commands. Do NOT ask the user to `cd`.

To skip workspace creation (e.g., when continuing work in an existing workspace), use `noWorkspace=true`.

### Submit PR

```
ship tool: action=`stack-submit`
```

Options:
- `draft=true` - Create as draft PR
- `title="..."` - Override PR title
- `body="..."` - Override PR body

If PR already exists and title/body provided, it will update the existing PR.

**CRITICAL - Auto-subscription**: This action **automatically subscribes** your session to webhook events for all PRs in the stack. You do NOT need to manually call `webhook-subscribe`. The output will confirm: "Auto-subscribed to stack PRs: X, Y, Z"

This means you will automatically receive GitHub event notifications for:
- PR merges (so you can run `stack-sync` to rebase)
- CI status changes
- Review comments and approvals

---

## Post-Task Completion

**CRITICAL: You MUST complete these VCS steps before marking a task as done.**

After completing code changes for a task:

1. **Quality checks** - Run lint, format, typecheck to ensure code is clean
2. **Sync with trunk** - `ship` tool with action `stack-sync`
   - This fetches latest changes and rebases your stack
3. **Submit PR** - `ship` tool with action `stack-submit`
   - This pushes your changes and creates/updates the PR
   - Auto-subscribes you to webhook events for the PR
4. **Mark complete** - `ship` tool with action `done`, taskId=`<id>`
   - Only do this AFTER the PR is submitted

**DO NOT skip steps 2-3.** The PR must exist before marking the task complete. If you mark a task done without submitting the PR, the work is not actually delivered.

### Example Flow

```
# After finishing code changes...
ship tool: action=`stack-sync`           # Rebase onto latest trunk
ship tool: action=`stack-submit`         # Push and create PR
ship tool: action=`done`, taskId=`BRI-123`  # Now mark complete
```

---

## Stacked PRs Workflow

When working on dependent changes (stacked PRs):

```
trunk <- PR A (#34) <- PR B (#35) <- PR C (#36)
              ^           ^           ^
           merged      rebases    rebases
```

1. Each change builds on the previous one
2. When PR A is merged, you receive a webhook event
3. Run `stack-sync` to rebase PRs B and C onto the new trunk
4. Run `stack-submit` to update the PRs with rebased commits

This keeps your stack always up-to-date with trunk.

---

## Workspace Workflow (MANDATORY)

**Workspaces are created by default.** When you create a new stack with `stack-create`, a jj workspace is automatically created in a sibling directory for isolated development.

### Why Workspaces Are Required

Without workspaces, multiple agents editing the same files will cause:
- File conflicts and overwrites
- Inconsistent state between agents
- Failed builds and tests
- Lost work

Each agent MUST work in its own isolated workspace.

### Create Stack (Workspace is Default)

**Workspace is created automatically when creating a new stack:**

```
ship tool: action=`stack-create`, message="BRI-123: Feature X", bookmark="user/bri-123-feature-x"
```

This creates:
1. A new jj workspace at `../bri-123-feature-x` (sibling directory)
2. A bookmark for the stack

Output will include the workspace path (e.g., `/Users/x/project/.ship/workspaces/bri-123-feature-x`).

**IMPORTANT**: Store this path and use it with the `workdir` parameter for all subsequent commands. Do NOT ask the user to `cd` - the agent should use `workdir` instead.

### Skip Workspace Creation

Only skip workspace creation when continuing work in an existing workspace:

```
ship tool: action=`stack-create`, message="Follow-up change", noWorkspace=true
```

### List Workspaces

```
ship tool: action=`stack-workspaces`
```

Shows all jj workspaces with their current change and task associations.

### Remove Workspace

```
ship tool: action=`stack-remove-workspace`, name="bri-123-feature-x"
```

To also delete the files from disk:

```
ship tool: action=`stack-remove-workspace`, name="bri-123-feature-x", deleteFiles=true
```

### Automatic Cleanup

Workspaces are automatically cleaned up when:
- `stack-abandon` is called on a change with an associated workspace

This behavior can be disabled via config: `workspace.autoCleanup: false`

### Using `workdir` for Workspace VCS Operations

When working in a jj workspace, **always pass the `workdir` parameter** to ship tool VCS actions. This ensures commands run in the correct workspace context.

**Example workflow in a workspace:**

```
# Check status in workspace
ship tool: action=`stack-status`, workdir="/path/to/workspace"

# Update change description
ship tool: action=`stack-describe`, message="Updated feature", workdir="/path/to/workspace"

# Sync and submit from workspace
ship tool: action=`stack-sync`, workdir="/path/to/workspace"
ship tool: action=`stack-submit`, workdir="/path/to/workspace"
```

**Why is this important?**

Without `workdir`, VCS commands run in the main project directory (where OpenCode was started), not in the workspace. This causes:
- Changes applied to the wrong jj change
- Bookmarks not found
- Confusing state between the main repo and workspace

**Rule**: If you're working in a workspace (created by `stack-create`), always use `workdir` for all stack-* actions.

---

## Troubleshooting

### "The working copy is stale" Error

This happens when the workspace is modified from another location (e.g., another workspace, remote CI, or after a PR merge).

**To recover:**

```
ship tool: action=`stack-update-stale`, workdir=`<workspace-path>`
```

After updating, you can continue with normal operations like `stack-sync` or `stack-submit`.

### Undo Last Operation

If you made a mistake (e.g., wrong squash, accidental abandon), you can undo:

```
ship tool: action=`stack-undo`, workdir=`<workspace-path>`
```

This undoes the last jj operation. Use sparingly - it's better to be careful than to rely on undo.

### If You Accidentally Used jj/gh Commands Directly

If you ran jj or gh commands via bash instead of using the ship tool:

1. **Stop immediately** - Don't continue with more direct commands
2. **Check the state** - Use `ship tool: action=stack-status` to see current state
3. **Undo if needed** - Use `ship tool: action=stack-undo` to revert the jj operation
4. **Resume with ship tool** - Continue using the ship tool for all subsequent operations

**Why this matters**: Direct jj/gh commands bypass ship's tracking, which can cause:
- PRs without webhook subscriptions (you won't get merge notifications)
- Workspace state inconsistencies
- Missing bookmark associations
- Broken stack tracking

**Prevention**: Always use the ship tool for VCS operations. The ship tool wraps jj/gh with proper state management.
