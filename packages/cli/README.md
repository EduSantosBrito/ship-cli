# @ship-cli/core

[![npm version](https://img.shields.io/npm/v/@ship-cli/core)](https://www.npmjs.com/package/@ship-cli/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

**Linear + jj workflow CLI for AI coding agents.**

This is the core CLI package for [Ship](https://github.com/EduSantosBrito/ship-cli). See the [main README](../../README.md) for full documentation.

## Installation

```sh
# npm
npm install -g @ship-cli/core

# pnpm
pnpm add -g @ship-cli/core

# npx (one-off)
npx @ship-cli/core init
```

## Quick Start

```sh
# Initialize in your project
ship init

# See what's ready to work on
ship ready

# Start working on a task
ship start BRI-123

# Create a workspace and change
ship stack create

# Submit your changes
ship stack submit

# Mark task complete
ship done BRI-123
```

## Requirements

- Node.js 20, 22, or 24 (LTS versions)
- [Linear](https://linear.app) account
- [jj](https://martinvonz.github.io/jj) (for VCS features)

## Commands

### Task Management

| Command | Description |
|---------|-------------|
| `ship init` | Initialize ship (authenticate + select team/project) |
| `ship ready` | List tasks with no blockers |
| `ship list` | List all tasks |
| `ship blocked` | List blocked tasks |
| `ship show <id>` | Show task details |
| `ship start <id>` | Start working on a task |
| `ship done <id>` | Mark task as complete |
| `ship create "<title>"` | Create a new task |

### Stacked Changes (jj)

| Command | Description |
|---------|-------------|
| `ship stack log` | Show stack of changes |
| `ship stack status` | Show current change status |
| `ship stack create` | Create a new change in the stack |
| `ship stack sync` | Sync with remote (fetch + rebase) |
| `ship stack submit` | Push changes and create/update PRs |

See [full command reference](../../README.md#commands) in the main documentation.

## OpenCode Integration

For AI agent integration, install the [@ship-cli/opencode](https://www.npmjs.com/package/@ship-cli/opencode) plugin:

```json
{
  "plugins": ["@ship-cli/opencode"]
}
```

## License

[MIT](../../LICENSE)
