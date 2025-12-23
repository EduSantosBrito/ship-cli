# Ship

[![npm version](https://img.shields.io/npm/v/@ship-cli/core?label=CLI)](https://www.npmjs.com/package/@ship-cli/core)
[![npm version](https://img.shields.io/npm/v/@ship-cli/opencode?label=OpenCode%20Plugin)](https://www.npmjs.com/package/@ship-cli/opencode)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Linear + jj workflow CLI for AI coding agents.**

Ship bridges [Linear](https://linear.app) task management with [jj](https://martinvonz.github.io/jj) version control, providing AI coding agents with structured context about what to work on and how changes relate to tasks.

## Table of Contents

- [Why Ship?](#why-ship)
- [Way of Working](#way-of-working)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Commands](#commands)
- [OpenCode Integration](#opencode-integration)
  - [Webhook Integration](#webhook-integration)
- [Architecture](#architecture)
- [Development](#development)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)

## Why Ship?

AI coding agents need structured workflows. Ship provides:

- **Task context** - Know exactly what to work on next with `ship ready`
- **Dependency tracking** - Understand what blocks what with `ship blocked`
- **Stacked changes** - Manage jj-based stacked diffs tied to Linear tasks
- **AI-first design** - Built as an [OpenCode](https://opencode.ai) plugin for seamless integration

## Way of Working

Ship enforces a structured workflow that keeps AI agents (and humans) productive:

### The Core Loop

```
1. ship ready          → Find a task with no blockers
2. ship start <id>     → Mark it "In Progress" in Linear
3. ship stack create   → Create an isolated workspace + jj change
4. [make changes]      → Code in the workspace
5. ship stack sync     → Rebase onto latest trunk
6. ship stack submit   → Push and create/update PR
7. ship done <id>      → Mark task complete
```

### Why Workspaces?

Every `stack create` spins up an **isolated jj workspace**. This means:

- **Parallel work** - Multiple agents can work on different tasks simultaneously without conflicts
- **Clean context** - Each task gets its own working directory
- **Safe experimentation** - Abandon a workspace without affecting other work

### Stacked Changes

Ship uses [jj](https://martinvonz.github.io/jj) for stacked diffs:

```
trunk ← PR #1 (merged) ← PR #2 (in review) ← PR #3 (draft)
```

When PR #1 merges, `ship stack sync` automatically rebases your stack onto the new trunk. The webhook daemon notifies you when this happens.

### Task Dependencies

Use `ship block` to model dependencies between tasks:

```sh
ship block BRI-100 BRI-101  # BRI-100 must complete before BRI-101
```

`ship ready` only shows tasks with **no blockers**, so agents always know what they can work on.

## Quick Start

```sh
# Install globally
npm install -g @ship-cli/core

# Initialize in your project
ship init

# See what's ready to work on
ship ready
```

## Installation

### CLI

| Method | Command |
|--------|---------|
| npm (global) | `npm install -g @ship-cli/core` |
| pnpm (global) | `pnpm add -g @ship-cli/core` |
| npx (one-off) | `npx @ship-cli/core init` |

### OpenCode Plugin

Add to your `opencode.json`:

```json
{
  "plugins": ["@ship-cli/opencode"]
}
```

### Requirements

- Node.js 18+
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
| `ship update <id>` | Update task properties |

### Dependencies

| Command | Description |
|---------|-------------|
| `ship block <blocker> <blocked>` | Mark task as blocking another |
| `ship unblock <blocker> <blocked>` | Remove blocking relationship |
| `ship relate <task> <related>` | Link related tasks |

### Stacked Changes (jj)

| Command | Description |
|---------|-------------|
| `ship stack log` | Show stack of changes |
| `ship stack status` | Show current change status |
| `ship stack create` | Create a new change in the stack |
| `ship stack sync` | Sync with remote (fetch + rebase) |
| `ship stack submit` | Push changes and create/update PRs |
| `ship stack squash` | Squash changes in the stack |

## OpenCode Integration

The [@ship-cli/opencode](https://www.npmjs.com/package/@ship-cli/opencode) plugin provides:

- **`ship` tool** - Full task management within OpenCode sessions
- **Skill system** - Detailed workflow guidance for AI agents
- **Webhook events** - Real-time notifications for PR reviews and comments

### Available Actions

The `ship` tool exposes these actions to AI agents:

```
ready, list, blocked, show, start, done, create, update,
block, unblock, relate, status, stack-log, stack-status,
stack-create, stack-describe, stack-sync, stack-submit, ...
```

### Webhook Integration

Ship's webhook daemon enables **real-time GitHub event notifications** to AI agents. This closes the feedback loop between code review and agent response.

#### How It Works

```
GitHub PR Event → smee.io → ship webhook daemon → OpenCode session
```

1. **Start the daemon** (once per machine):
   ```sh
   ship webhook start
   ```

2. **Auto-subscription on submit**: When you run `ship stack submit`, the agent is automatically subscribed to receive events for all PRs in the stack.

3. **Events routed to agents**: The daemon routes GitHub events (merges, CI status, review comments) to the correct OpenCode session.

#### Supported Events

| Event | What Happens |
|-------|--------------|
| **PR Merged** | Agent receives notification, can run `stack-sync` to rebase |
| **CI Failed** | Agent receives notification with failure details |
| **Review Comment** | Agent receives the comment, can address feedback |
| **Changes Requested** | Agent receives the review, can make fixes |
| **PR Approved** | Agent receives notification, can proceed with merge |

#### Example Flow

```
1. Agent submits PR #42 with `stack-submit`
   → Automatically subscribed to PR #42 events

2. Reviewer requests changes on PR #42
   → Agent receives: "[GitHub] Changes requested on PR #42"

3. Agent addresses feedback, runs `stack-submit` again
   → PR updated with new commits

4. PR #42 merged
   → Agent receives: "[GitHub] PR #42 merged"
   → Agent runs `stack-sync` to rebase remaining stack
```

This enables a tight feedback loop where agents can respond to code review without manual intervention.

## Architecture

Ship follows hexagonal architecture with [Effect](https://effect.website) for type-safe, composable code:

```
packages/
  cli/                    # @ship-cli/core
    src/
      domain/             # Core entities (Task, Config)
      ports/              # Interface definitions
      adapters/
        driven/           # External services (Linear, jj, GitHub)
        driving/cli/      # CLI commands
      infrastructure/     # Dependency injection layers
  opencode-plugin/        # @ship-cli/opencode
```

## Development

```sh
# Clone and install
git clone https://github.com/tripdee/ship-cli
cd ship-cli
pnpm install

# Build all packages
pnpm build

# Run CLI in development
pnpm ship ready

# Type check
pnpm check

# Test
pnpm test
```

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details on our development process, code style, and how to submit pull requests.

## Acknowledgments

Ship is heavily inspired by:

- **[beads](https://github.com/steveyegge/beads)** - Distributed, git-backed graph issue tracker for AI agents. The concept of giving AI agents structured task context and dependency tracking comes directly from beads.
- **[opencode-beads](https://github.com/joshuadavidthomas/opencode-beads)** - OpenCode plugin for beads integration. Inspired the plugin architecture and OpenCode integration patterns.

Built with [Effect](https://effect.website) for robust, type-safe TypeScript.

## License

[MIT](LICENSE)
