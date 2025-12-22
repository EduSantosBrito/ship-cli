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

---

## Workflow

1. Check available work: `ship` tool with action `ready`
2. Start a task: `ship` tool with action `start` and taskId
3. Do the work
4. Mark complete: `ship` tool with action `done` and taskId

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

## Post-Task Completion

After completing a task:

1. **Review changes** - Summarize what was modified
2. **Quality checks** - Run lint, format, typecheck
3. **Version control** - Commit and push changes
4. **Mark complete** - Use `ship` tool with action `done`
