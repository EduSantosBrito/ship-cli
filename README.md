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
  - [Task Providers](#task-providers)
- [Commands](#commands)
- [OpenCode Integration](#opencode-integration)
  - [Webhook Integration](#webhook-integration)
- [Architecture](#architecture)
- [Development](#development)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)

## Why Ship?

AI coding agents need structured workflows. Ship provides:

- **Task context** - Know exactly what to work on next with `ship task ready`
- **Dependency tracking** - Understand what blocks what with `ship task blocked`
- **Stacked changes** - Manage jj-based stacked diffs tied to Linear tasks
- **AI-first design** - Built as an [OpenCode](https://opencode.ai) plugin for seamless integration

## Way of Working

Ship enforces a structured workflow that keeps AI agents (and humans) productive:

### The Core Loop

```
1. ship task ready        → Find a task with no blockers
2. ship task start <id>   → Mark it "In Progress" in Linear
3. ship stack create      → Create an isolated workspace + jj change
4. [make changes]         → Code in the workspace
5. ship stack sync        → Rebase onto latest trunk
6. ship stack submit      → Push and create/update PR
7. ship task done <id>    → Mark task complete
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

Use `ship task block` to model dependencies between tasks:

```sh
ship task block BRI-100 BRI-101  # BRI-100 must complete before BRI-101
```

`ship task ready` only shows tasks with **no blockers**, so agents always know what they can work on.

## Quick Start

```sh
# Install globally
npm install -g @ship-cli/core

# Initialize in your project
ship init

# See what's ready to work on
ship task ready
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
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@ship-cli/opencode"]
}
```

### Requirements

- Node.js 20, 22, or 24 (LTS versions)
- [Linear](https://linear.app) or [Notion](https://notion.so) account
- [jj](https://martinvonz.github.io/jj) (for VCS features)

### Task Providers

Ship supports multiple task management backends:

| Provider | Status | Best For |
|----------|--------|----------|
| [Linear](https://linear.app) | Default | Teams using Linear for project management |
| [Notion](https://notion.so) | Supported | Teams using Notion databases for tasks |

To use Notion instead of Linear, run `ship init` and select "Notion" when prompted, or see the [Notion Setup Guide](packages/cli/docs/NOTION.md).

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
| `ship task update <id>` | Update task properties |

### Dependencies

| Command | Description |
|---------|-------------|
| `ship task block <blocker> <blocked>` | Mark task as blocking another |
| `ship task unblock <blocker> <blocked>` | Remove blocking relationship |
| `ship task relate <task> <related>` | Link related tasks |

### Stacked Changes (jj)

| Command | Description |
|---------|-------------|
| `ship stack log` | Show stack of changes |
| `ship stack status` | Show current change status |
| `ship stack create` | Create a new change in the stack |
| `ship stack sync` | Sync with remote (fetch + rebase) |
| `ship stack submit` | Push changes and create/update PRs |
| `ship stack squash` | Squash changes in the stack |

### Pull Requests

| Command | Description |
|---------|-------------|
| `ship pr create` | Create PR for current bookmark with Linear task context |
| `ship pr stack` | Create stacked PRs for entire stack |
| `ship pr review [number]` | Fetch PR reviews and comments |

#### `ship pr create`

Creates a GitHub PR for the current bookmark with auto-populated task information:

```sh
ship pr create              # Create PR with task context from Linear
ship pr create --draft      # Create as draft PR
ship pr create --open       # Open PR in browser after creation
```

The command extracts the task ID from your bookmark name (e.g., `user/BRI-123-feature` → `BRI-123`) and fetches task details from Linear to generate a rich PR body with summary, acceptance criteria, and task link.

#### `ship pr stack`

Creates PRs for your entire stack with proper base branch targeting:

```sh
ship pr stack               # Create PRs for all changes in stack
ship pr stack --dry-run     # Preview what would be created
```

Each PR targets the previous PR's branch, enabling incremental code review:

```
trunk ← PR #1 (base: main) ← PR #2 (base: PR #1 branch) ← PR #3 (base: PR #2 branch)
```

#### `ship pr review`

Fetches PR reviews and comments in an AI-friendly format:

```sh
ship pr review              # Review for current bookmark's PR
ship pr review 42           # Review for PR #42
ship pr review --unresolved # Show only actionable comments
ship pr review --json       # Machine-readable output
```

Output includes review verdicts, inline code comments with file:line context, and conversation threads - formatted for AI agents to understand and address feedback.

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

### Compaction Context Preservation

When OpenCode sessions are compacted to reduce context size, the Ship plugin automatically preserves task state:

- **Current task ID** - Which task the agent is working on
- **Workspace path** - The active jj workspace directory

After compaction, the agent is instructed to re-read the ship-cli skill and can seamlessly continue work on the same task without losing context.

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
git clone https://github.com/EduSantosBrito/ship-cli
cd ship-cli
pnpm install

# Build all packages
pnpm build

# Run CLI in development
pnpm ship task ready

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
