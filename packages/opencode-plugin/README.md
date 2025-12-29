# @ship-cli/opencode

[![npm version](https://img.shields.io/npm/v/@ship-cli/opencode)](https://www.npmjs.com/package/@ship-cli/opencode)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

OpenCode plugin for [Ship](https://github.com/EduSantosBrito/ship-cli) - Linear task management and stacked changes for AI coding agents.

## Installation

Add to your `opencode.json`:

```json
{
  "plugins": ["@ship-cli/opencode"]
}
```

## Prerequisites

- [Ship CLI](https://www.npmjs.com/package/@ship-cli/core) installed and configured (`ship init`)
- [jj](https://martinvonz.github.io/jj) for VCS operations
- [Linear](https://linear.app) account

## What It Provides

This plugin exposes the `ship` tool to OpenCode, enabling AI agents to:

### Task Management

| Action | Description |
|--------|-------------|
| `ready` | Find tasks with no blockers |
| `list` | List all tasks with optional filters |
| `show` | View task details |
| `start` | Mark task as in progress |
| `done` | Mark task as complete |
| `create` | Create new tasks |
| `block` / `unblock` | Manage task dependencies |

### Stacked Changes (jj)

| Action | Description |
|--------|-------------|
| `stack-create` | Create isolated workspace for a task |
| `stack-describe` | Update commit message (use `title` + `description` params for multi-line) |
| `stack-sync` | Fetch and rebase onto trunk |
| `stack-submit` | Push and create/update PR |
| `stack-status` | View current change info |
| `stack-log` | View stack of changes |
| `stack-squash` | Squash current change into parent |
| `stack-abandon` | Abandon current change |
| `stack-up` / `stack-down` | Navigate stack |

### PR Workflow

| Action | Description |
|--------|-------------|
| `pr-review` | Fetch PR reviews in AI-friendly format |
| `stack-submit` | Auto-creates PRs with Linear context |

### Webhooks

| Action | Description |
|--------|-------------|
| `webhook-subscribe` | Subscribe to PR events |
| `webhook-unsubscribe` | Unsubscribe from events |

## Skill Integration

For best results, pair this plugin with the ship-cli skill which provides workflow guidance:

```
.opencode/skill/ship-cli/SKILL.md
```

The skill teaches the agent the proper workflow:
1. Find ready tasks
2. Create isolated workspaces
3. Make changes and sync
4. Submit PRs with proper context

## Links

- [Ship CLI Documentation](https://github.com/EduSantosBrito/ship-cli#readme)
- [OpenCode](https://opencode.ai)
- [Linear](https://linear.app)
- [jj (Jujutsu)](https://martinvonz.github.io/jj)
