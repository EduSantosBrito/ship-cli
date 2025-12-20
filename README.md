# Ship

Linear + jj workflow CLI for AI agents.

## Packages

- **@ship-cli/core** - Command-line interface for task management
- **@ship-cli/opencode** - OpenCode plugin for AI integration

## Installation

```sh
# Install the CLI globally
npm install -g @ship-cli/core

# Or use with npx
npx @ship-cli/core init
```

## CLI Usage

```sh
# Initialize ship in a project (authenticate + select team/project)
ship init

# View ready tasks (no blockers)
ship ready

# View all tasks
ship list

# View blocked tasks
ship blocked

# Show task details
ship show BRI-123

# Start working on a task
ship start BRI-123

# Mark task as complete
ship done BRI-123

# Create a new task
ship create "Implement feature X"

# Manage task dependencies
ship block BRI-123 BRI-456   # BRI-123 blocks BRI-456
ship unblock BRI-123 BRI-456 # Remove blocker

# Get AI-optimized context
ship prime
```

## OpenCode Plugin

The OpenCode plugin provides:
- Automatic context injection on session start (`ship prime` output)
- `ship` tool for managing tasks within OpenCode

### Installation

Add to your OpenCode config:

```yaml
# opencode.yaml
plugins:
  - "@ship-cli/opencode"
```

## Development

```sh
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run CLI in development
pnpm ship ready

# Type check
pnpm check

# Lint
pnpm lint

# Format
pnpm format

# Test
pnpm test
```

## Architecture

The CLI follows hexagonal architecture:

```
packages/cli/src/
  domain/          # Core entities (Task, Config)
  ports/           # Interface definitions
  adapters/
    driven/        # External services (Linear, config)
    driving/cli/   # CLI commands
  infrastructure/  # Dependency injection layers
```

## License

MIT
