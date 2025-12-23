# Contributing to Ship

Thank you for your interest in contributing to Ship! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md) to help maintain a welcoming and inclusive community.

## Getting Started

### Prerequisites

- Node.js 20, 22, or 24 (LTS versions)
- [pnpm](https://pnpm.io/) (we use pnpm workspaces)
- [jj](https://martinvonz.github.io/jj) (for testing VCS features)
- A [Linear](https://linear.app) account (for testing task management)

### Development Setup

```sh
# Clone the repository
git clone https://github.com/EduSantosBrito/ship-cli
cd ship-cli

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run the CLI in development mode
pnpm ship task ready

# Run tests
pnpm test

# Type check
pnpm check

# Lint
pnpm lint

# Format code
pnpm format
```

## Project Structure

Ship is a monorepo with two packages:

```
packages/
  cli/                    # @ship-cli/core - Main CLI
    src/
      domain/             # Core entities (Task, Config)
      ports/              # Interface definitions
      adapters/
        driven/           # External services (Linear, jj, GitHub)
        driving/cli/      # CLI commands
      infrastructure/     # Dependency injection layers
  opencode-plugin/        # @ship-cli/opencode - OpenCode integration
```

### Architecture

Ship follows **hexagonal architecture** (ports and adapters) with [Effect](https://effect.website) for type-safe, composable code:

- **Domain**: Core business logic and entities
- **Ports**: Interface definitions (what the application needs)
- **Adapters**: Implementations (how needs are fulfilled)
  - **Driven**: External services the application uses (Linear API, jj, GitHub)
  - **Driving**: Entry points into the application (CLI commands)

## Making Changes

### Workflow

1. **Find or create an issue**: Check existing issues or create one describing your change
2. **Fork and branch**: Create a branch with a descriptive name (e.g., `fix/task-parsing`, `feat/webhook-retry`)
3. **Make changes**: Follow the code style guidelines below
4. **Test**: Ensure tests pass and add new tests for new functionality
5. **Submit PR**: Open a pull request with a clear description

### Code Style

- **TypeScript**: We use strict TypeScript with Effect
- **Linting**: Run `pnpm lint` (uses oxlint)
- **Formatting**: Run `pnpm format` (uses oxfmt)
- **Tests**: Run `pnpm test` (uses vitest)

### Commit Messages

Use clear, descriptive commit messages:

```
feat: add webhook retry mechanism
fix: handle empty task descriptions
docs: update installation instructions
refactor: extract Linear client to separate module
test: add tests for Config parsing
```

Prefix with the type of change:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Pull Request Guidelines

- Keep PRs focused on a single change
- Include tests for new functionality
- Update documentation if needed
- Ensure CI passes (lint, type check, tests)
- Provide a clear description of what and why

## Testing

```sh
# Run all tests
pnpm test

# Run tests with coverage
pnpm -C packages/cli coverage

# Run a specific test file
pnpm -C packages/cli test src/domain/Config.test.ts
```

## Reporting Issues

### Bug Reports

Include:
- Ship version (`ship --version`)
- Node.js version (`node --version`)
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Relevant error messages or logs

### Feature Requests

Include:
- Clear description of the feature
- Use case / motivation
- Proposed API or behavior (if applicable)

## Questions?

Feel free to open an issue for questions or discussions. We're happy to help!

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
