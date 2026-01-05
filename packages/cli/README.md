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
ship task ready

# Start working on a task
ship task start BRI-123

# Create a workspace and change
ship stack create

# Submit your changes
ship stack submit

# Mark task complete
ship task done BRI-123
```

## Requirements

- Node.js 20, 22, or 24 (LTS versions)
- [Linear](https://linear.app) or [Notion](https://notion.so) account
- [jj](https://martinvonz.github.io/jj) (for VCS features)

## Task Providers

Ship supports Linear (default) and Notion as task backends. To use Notion:

```sh
ship init  # Select "Notion" when prompted
```

See [Notion Setup Guide](docs/NOTION.md) for detailed configuration.

## Commands

### Task Management

| Command | Description |
|---------|-------------|
| `ship init` | Initialize ship (authenticate + select team/project) |
| `ship task ready` | List tasks with no blockers |
| `ship task list` | List all tasks |
| `ship task blocked` | List blocked tasks |
| `ship task show <id>` | Show task details |
| `ship task start <id>` | Start working on a task |
| `ship task done <id>` | Mark task as complete |
| `ship task create "<title>"` | Create a new task |

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
