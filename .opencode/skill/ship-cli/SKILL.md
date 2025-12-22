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

| Action | Description | Required params |
|--------|-------------|-----------------|
| `stack-log` | View stack of changes from trunk to current | - |
| `stack-status` | Show current change status | - |
| `stack-create` | Create a new jj change with bookmark | message (optional), bookmark (optional) |
| `stack-describe` | Update change description | message |
| `stack-sync` | Fetch and rebase onto trunk | - |
| `stack-submit` | Push and create/update PR | draft (optional), title (optional), body (optional) |

---

## Workflow (Explicit Steps)

Task management and VCS operations are **separate**. You control when each happens.

### Starting Work on a Task

1. **Sync with trunk**: `ship` tool with action `stack-sync`
2. **Find a task**: `ship` tool with action `ready`
3. **Start the task**: `ship` tool with action `start`, taskId=`<id>`
   - This ONLY updates Linear status to "In Progress"
   - Does NOT create VCS changes
4. **Create VCS change**: `ship` tool with action `stack-create`, message=`"<id>: <title>"`, bookmark=`<branch-name>`
   - Get branch name from `start` output or `show` action

### Doing the Work

5. Make code changes
6. Run quality checks (lint, format, typecheck)

### Submitting Work

7. **Sync before submit**: `ship` tool with action `stack-sync`
8. **Submit PR**: `ship` tool with action `stack-submit`
9. **Mark complete**: `ship` tool with action `done`, taskId=`<id>`

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

### Create Change

```
ship tool: action=`stack-create`, message="BRI-123: Add feature", bookmark="user/bri-123-add-feature"
```

Creates a new jj change with the given description and bookmark (branch name).

### Submit PR

```
ship tool: action=`stack-submit`
```

Options:
- `draft=true` - Create as draft PR
- `title="..."` - Override PR title
- `body="..."` - Override PR body

If PR already exists and title/body provided, it will update the existing PR.

---

## Post-Task Completion

After completing a task:

1. **Review changes** - Summarize what was modified
2. **Quality checks** - Run lint, format, typecheck
3. **Sync** - `ship` tool with action `stack-sync`
4. **Submit PR** - `ship` tool with action `stack-submit`
5. **Mark complete** - `ship` tool with action `done`
