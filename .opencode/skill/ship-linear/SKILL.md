---
name: ship-linear
description: Linear task management with ship CLI for tracking work, dependencies, and completion workflows
---

## When to use

Use this skill when working with Linear tasks, tracking work progress, managing task dependencies, or following completion workflows in projects configured with ship.

---

## Ship Tool Guidance

**IMPORTANT: Always use the `ship` tool, NEVER run `ship` or `pnpm ship` via bash/terminal.**

The `ship` tool is available for Linear task management. Use it instead of CLI commands.

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
| `prime` | Get AI context | - |
| `status` | Check configuration | - |

---

## Best Practices

1. Use `ship` tool with action `ready` to see available work
2. Use `ship` tool with action `start` before beginning work
3. Use `ship` tool with action `done` when completing tasks
4. Use `ship` tool with action `block` for dependency relationships

---

## Linear Task Relationships

Linear has native relationship types. **Always use these instead of writing dependencies in text.**

### Blocking (for dependencies)

- Use ship tool: action=`block`, blocker=`BRI-100`, blocked=`BRI-101`
- Use ship tool: action=`unblock` to remove relationships
- Use ship tool: action=`blocked` to see waiting tasks

### Related (for cross-references)

- Use ship tool: action=`relate`, taskId=`BRI-100`, relatedTaskId=`BRI-101`
- Use this when tasks are conceptually related but not blocking each other

### Mentioning Tasks in Descriptions

To create clickable task pills in descriptions, use full markdown links:
`[BRI-123](https://linear.app/WORKSPACE/issue/BRI-123/slug)`

Get the full URL from ship tool (action=`show`, taskId=`BRI-123`) and use it in markdown link format.
Plain text `BRI-123` will NOT create clickable pills.

---

## Task Description Template

```markdown
## Context
Brief explanation of why this task exists and where it fits.

## Problem Statement
What specific problem does this task solve? Current vs desired behavior.

## Implementation Notes
- Key files: `path/to/file.ts`
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
```

---

## Task Quality Checklist

- Title is actionable and specific (not "Fix bug" but "Fix null pointer in UserService.getById")
- Context explains WHY, not just WHAT
- Acceptance criteria are testable
- Dependencies set via `ship block` AND documented with markdown links
- Links use full URL format: `[BRI-123](https://linear.app/...)`
- Priority reflects business impact (urgent/high/medium/low)

---

## Post-Task Completion Flow

After completing a task, follow this procedure. **Ask the user for permission before starting**, explaining what you're about to do.

### 1. Review Changes

Summarize what was changed, which files were modified, and why.

### 2. Quality Checks

Run the project's lint, format, and typecheck commands. Check package.json scripts or the project's documentation to find the correct commands.

### 3. Version Control

Commit and push changes using the project's VCS workflow:
- Check current status and changed files
- Write a descriptive commit message referencing the task
- Push changes and create a pull request

### 4. Mark Task Complete

Use `ship` tool with action `done` and the task ID to mark the task as done in Linear.
