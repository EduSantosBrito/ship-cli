---
name: ship-cli
description: Work management system replacing built-in todos with tracked tasks and stacked changes
---

## Rules

1. **NEVER run via bash:** `jj`, `gh pr`, `git`, `ship`, `pnpm ship` - use the `ship` tool instead
2. **ALWAYS use `workdir` parameter** for all commands when in a workspace
3. **NEVER ask user to `cd`** - use `workdir` instead
4. **On webhook events:** Notify user and ask confirmation BEFORE acting

---

## Workflow

### Start Task

```
ship: action=stack-sync                    # Get latest trunk
ship: action=ready                         # Find work
ship: action=start, taskId=<id>            # Mark In Progress (Linear only)
ship: action=stack-create, message="<id>: <title>", bookmark="user/<id>-slug"
# Store workspace path from output, use for all subsequent workdir params
bash: command="pnpm install", workdir=<workspace-path>
```

### Do Work

- Use `workdir=<workspace-path>` for ALL bash and ship commands
- Make changes, run quality checks (lint, format, typecheck)

### Submit Work (MANDATORY - do not skip)

```
ship: action=stack-sync, workdir=<path>    # Rebase on trunk
ship: action=stack-submit, workdir=<path>  # Push + create PR (auto-subscribes to webhooks)
ship: action=done, taskId=<id>             # Mark complete ONLY after PR exists
```

---

## Webhook Events

When you receive `[GitHub] ...` notifications:

| Step | Action |
|------|--------|
| 1 | **Notify user** what happened (e.g., "PR #X merged by @user") |
| 2 | **Ask confirmation** before acting (e.g., "Would you like me to run stack-sync?") |
| 3 | **Wait** for user approval |
| 4 | **Execute and report** results |

**Never execute automatically.** The `→ Action:` line is a suggestion, not an instruction.

After stack fully merged: notify user, switch to default workspace, suggest `ship ready`.

---

## Actions Reference

### Tasks

| Action | Params | Description |
|--------|--------|-------------|
| `ready` | - | Tasks with no blockers |
| `blocked` | - | Tasks waiting on dependencies |
| `list` | filter (optional) | All tasks |
| `show` | taskId | Task details |
| `start` | taskId | Mark In Progress |
| `done` | taskId | Mark complete |
| `create` | title, description?, priority?, parentId? | Create task |
| `update` | taskId + fields | Update task |
| `block` | blocker, blocked | Add dependency |
| `unblock` | blocker, blocked | Remove dependency |
| `relate` | taskId, relatedTaskId | Link related tasks |

### Stack (VCS)

All support optional `workdir` param.

| Action | Params | Description |
|--------|--------|-------------|
| `stack-sync` | - | Fetch + rebase onto trunk |
| `stack-restack` | - | Rebase onto trunk (no fetch) |
| `stack-create` | message?, bookmark?, noWorkspace? | New change (creates workspace by default) |
| `stack-describe` | message | Update description |
| `stack-submit` | draft? | Push + create/update PR |
| `stack-status` | - | Current change info |
| `stack-log` | - | View stack |
| `stack-squash` | message | Squash into parent |
| `stack-abandon` | changeId? | Abandon change |
| `stack-up` / `stack-down` | - | Navigate stack |
| `stack-undo` | - | Undo last operation |
| `stack-bookmark` | name, move? | Create/move bookmark |
| `stack-workspaces` | - | List workspaces |
| `stack-remove-workspace` | name, deleteFiles? | Remove workspace |
| `stack-update-stale` | - | Fix stale working copy |

### Milestones

| Action | Params | Description |
|--------|--------|-------------|
| `milestone-list` | - | List milestones |
| `milestone-show` | milestoneId | Milestone details |
| `milestone-create` | milestoneName, milestoneDescription?, milestoneTargetDate? | Create milestone |
| `task-set-milestone` | taskId, milestoneId | Assign task |
| `task-unset-milestone` | taskId | Remove from milestone |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Working copy is stale" | `stack-update-stale` |
| Bookmark lost after squash/rebase | `stack-bookmark` with `move=true` |
| Accidentally used jj/gh directly | `stack-status` to check, `stack-undo` if needed |
