---
name: ship-cli
description: Work management system replacing built-in todos with tracked tasks and stacked changes
---

## When to use

**Always use ship instead of the built-in TodoWrite/TodoRead tools.**

Ship provides real task tracking that persists across sessions, supports dependencies between tasks, and integrates with stacked changes for clean PR workflows.

---

## Ship Tool Guidance

**IMPORTANT: Always use the `ship` tool, NEVER run `ship` or `pnpm ship` via bash/terminal.**

The `ship` tool replaces built-in todo management. Use it for all task tracking.

---

## Available Actions

| Action | Description | Required params |
|--------|-------------|-----------------|
| `ready` | Tasks you can work on (no blockers) | - |
| `blocked` | Tasks waiting on dependencies | - |
| `list` | All tasks (with optional filters) | - |
| `show` | Task details | taskId |
| `start` | Begin working on task | taskId |
| `done` | Mark task complete | taskId |
| `create` | Create new task | title |
| `update` | Update task | taskId + fields |
| `block` | Add blocking relationship | blocker, blocked |
| `unblock` | Remove blocking relationship | blocker, blocked |
| `relate` | Link tasks as related | taskId, relatedTaskId |
| `status` | Check configuration | - |

### Stack Actions (VCS)

| Action | Description | Required params |
|--------|-------------|-----------------|
| `stack-log` | View stack of changes from trunk to current | - |
| `stack-status` | Show current change status | - |
| `stack-create` | Create a new change | message (optional), bookmark (optional) |
| `stack-describe` | Update change description | message |
| `stack-sync` | Fetch and rebase onto trunk | - |
| `stack-submit` | Push and create/update PR | draft (optional), title (optional), body (optional) |

---

## Workflow

1. **Sync with trunk**: `ship` tool with action `stack-sync` (ensures you're on latest code)
2. Check available work: `ship` tool with action `ready`
3. Start a task: `ship` tool with action `start` and taskId (creates change + bookmark)
4. Do the work
5. Submit changes: `ship` tool with action `stack-submit`
6. Mark complete: `ship` tool with action `done` and taskId

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

---

## Task Quality

- Title is actionable and specific
- Description explains the goal, not implementation details
- Dependencies are set via `block` action
- Priority reflects importance (urgent, high, medium, low)

---

## Stack Workflow (VCS)

Use stack actions to manage changes with jj:

1. **Sync before starting**: `ship` tool with action `stack-sync` (fetch + rebase onto trunk)
2. **Check stack status**: `ship` tool with action `stack-status`
3. **Create new change**: `ship` tool with action `stack-create`, message="Description"
4. **Update description**: `ship` tool with action `stack-describe`, message="New description"
5. **Sync before submitting**: `ship` tool with action `stack-sync` (rebase onto latest trunk)
6. **Submit for review**: `ship` tool with action `stack-submit`

**Always sync before starting work and before submitting** to avoid merge conflicts and ensure clean PRs.

---

## Post-Task Completion

After completing a task:

1. **Review changes** - Summarize what was modified
2. **Quality checks** - Run lint, format, typecheck
3. **Submit PR** - Use `ship` tool with action `stack-submit`
4. **Mark complete** - Use `ship` tool with action `done`
