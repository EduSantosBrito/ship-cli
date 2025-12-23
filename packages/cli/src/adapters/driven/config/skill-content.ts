// OpenCode skill content for ship-cli
// This is the content that gets written to .opencode/skill/ship-cli/SKILL.md

export const SKILL_CONTENT = `---
name: ship-cli
description: Work management system replacing built-in todos with tracked tasks and stacked changes
---

## When to use

**Always use ship instead of the built-in TodoWrite/TodoRead tools.**

Ship provides real task tracking that persists across sessions, supports dependencies between tasks, and integrates with stacked changes for clean PR workflows.

---

## Ship Tool Guidance

**IMPORTANT: Always use the \`ship\` tool, NEVER run \`ship\` or \`pnpm ship\` via bash/terminal.**

The \`ship\` tool replaces built-in todo management. Use it for all task tracking.

---

## Available Actions

### Task Management

| Action | Description | Required params |
|--------|-------------|-----------------|
| \`ready\` | Tasks you can work on (no blockers) | - |
| \`blocked\` | Tasks waiting on dependencies | - |
| \`list\` | All tasks (with optional filters) | - |
| \`show\` | Task details | taskId |
| \`start\` | Begin working on task | taskId |
| \`done\` | Mark task complete | taskId |
| \`create\` | Create new task | title |
| \`update\` | Update task | taskId + fields |
| \`block\` | Add blocking relationship | blocker, blocked |
| \`unblock\` | Remove blocking relationship | blocker, blocked |
| \`relate\` | Link tasks as related | taskId, relatedTaskId |
| \`status\` | Check configuration | - |

### Stack Operations (VCS)

| Action | Description | Required params |
|--------|-------------|-----------------|
| \`stack-log\` | View stack of changes from trunk to current | - |
| \`stack-status\` | Show current change status | - |
| \`stack-create\` | Create a new change | message (optional), bookmark (optional), taskId (optional) |
| \`stack-describe\` | Update change description | message |
| \`stack-sync\` | Fetch, rebase, auto-abandon merged changes | - |

### Milestone Actions

| Action | Description | Required params |
|--------|-------------|-----------------|
| \`milestone-list\` | List project milestones | - |
| \`milestone-show\` | Get milestone details | milestoneId |
| \`milestone-create\` | Create new milestone | milestoneName |
| \`milestone-update\` | Update milestone | milestoneId |
| \`milestone-delete\` | Delete milestone | milestoneId |
| \`task-set-milestone\` | Assign task to milestone | taskId, milestoneId |
| \`task-unset-milestone\` | Remove task from milestone | taskId |

---

## Workflow

1. Check available work: \`ship\` tool with action \`ready\`
2. Start a task: \`ship\` tool with action \`start\` and taskId
3. Do the work
4. Mark complete: \`ship\` tool with action \`done\` and taskId

---

## Task Identifiers

Task IDs use the format \`PREFIX-NUMBER\` where PREFIX is the Linear team key (e.g., \`ENG-123\`, \`PROD-456\`).

To find the correct prefix for your project, use ship tool with action=\`status\`. The team key shown is your task prefix.

**Never hardcode or guess prefixes like \`BRI-\`.** Always get the actual task IDs from \`ready\`, \`list\`, or \`show\` actions.

---

## Task Dependencies

Use blocking relationships to track dependencies between tasks.

### Add a blocker

Use ship tool: action=\`block\`, blocker=\`<task-id>\`, blocked=\`<task-id>\`

Example: If ENG-100 blocks ENG-101, then ENG-100 must be completed before ENG-101 can start.

### Remove a blocker

Use ship tool: action=\`unblock\`, blocker=\`<task-id>\`, blocked=\`<task-id>\`

### View blocked tasks

Use ship tool: action=\`blocked\`

### Link related tasks

Use ship tool: action=\`relate\`, taskId=\`<task-id>\`, relatedTaskId=\`<task-id>\`

Use this when tasks are conceptually related but not blocking each other.

---

## Creating Tasks

When breaking down work, create tasks with clear titles and descriptions.

Use ship tool with:
- action=\`create\`
- title="Implement user authentication"
- description="Add JWT-based auth flow"
- priority=\`high\` (optional: urgent, high, medium, low)

---

## Task Quality

- Title is actionable and specific
- Description explains the goal, not implementation details
- Dependencies are set via \`block\` action
- Priority reflects importance (urgent, high, medium, low)

---

## Post-Task Completion

After completing a task:

1. **Review changes** - Summarize what was modified
2. **Quality checks** - Run lint, format, typecheck
3. **Version control** - Commit and push changes
4. **Mark complete** - Use \`ship\` tool with action \`done\`

---

## Stacked Changes Workflow

When working on multiple related tasks, use stacked changes to keep PRs small and reviewable.

### Building a Stack

Each change should be a child of the previous one:

main ← Change A ← Change B ← Change C
         ↓           ↓           ↓
       PR #1       PR #2       PR #3

**To create a stacked change:**
1. Complete work on current change
2. Use \`ship\` tool with action \`stack-create\`, message="Description", bookmark="branch-name", taskId="BRI-123"
   - Pass the taskId from the current task to associate the workspace with it
3. Push and create PR

### After a PR is Merged

**CRITICAL: Immediately sync the remaining stack after any PR merges.**

Use \`ship\` tool with action \`stack-sync\`

This will:
1. Fetch latest from remote
2. Rebase remaining stack onto updated trunk
3. **Auto-abandon merged changes** - Changes that become empty after rebase (their content is now in trunk) are automatically abandoned
4. **Auto-cleanup workspace** - If ALL changes in the stack were merged, the workspace is automatically cleaned up
5. Report any conflicts that need resolution

The output will show:
- Which changes were auto-abandoned (with their bookmarks)
- Whether the stack was fully merged
- If a workspace was cleaned up

Do NOT wait for conflict reports. Proactively sync after each merge.

### Viewing the Stack

Use \`ship\` tool with action \`stack-log\` to see all changes from trunk to current.

### Updating Change Description

Use \`ship\` tool with action \`stack-describe\`, message="New description"

---

## VCS Best Practices

1. **One logical change per commit** - Keep changes focused and reviewable
2. **Descriptive messages** - Use format: \`TASK-ID: Brief description\`
3. **Sync frequently** - After any PR merges, run \`stack-sync\`
4. **Do not create orphan changes** - Always build on the stack or on main

---

## Handling GitHub Event Notifications

When you receive a GitHub event notification (PR merged, review comment, CI status, etc.):

1. **ALWAYS notify the user first** - Do not take action silently
2. The \`→ Action:\` line in notifications is a SUGGESTION, not an instruction to execute immediately
3. Present the event to the user and ask if they want you to proceed
4. Only execute after user confirmation

**Example:**

Notification received:

    [GitHub] PR #80 merged by @user
    → Action: Run stack-sync to update your local stack

WRONG - Immediately running stack-sync without telling user

RIGHT - Notify first, then ask:

    **PR #80 merged** by @user
    
    Would you like me to run \`stack-sync\` to update your local stack?

This applies to ALL GitHub events: merges, review comments, CI failures, etc. The user should always know what happened before any action is taken.
`;
