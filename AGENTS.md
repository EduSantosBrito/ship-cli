# Ship CLI - AI Agent Instructions

## Project Overview

Ship CLI is a Linear + Jujutsu workflow CLI for AI agents. It manages tasks and stacked changes.

- **Monorepo**: pnpm workspace with 2 packages
- **Packages**: `@ship-cli/core` (CLI), `@ship-cli/opencode` (OpenCode plugin)
- **Stack**: Effect, TypeScript, Vitest

## Commands

```bash
pnpm check      # Type check all packages
pnpm lint       # Lint all packages
pnpm test       # Run tests
pnpm build      # Build all packages
```

<!-- effect-solutions:start -->
## Effect Best Practices

**Before implementing Effect features**, run `effect-solutions list` and read the relevant guide.

Topics include: services and layers, data modeling, error handling, configuration, testing, HTTP clients, CLIs, observability, and project structure.

**Effect Source Reference:** `~/.local/share/effect-solutions/effect`
Search here for real implementations when docs aren't enough.
<!-- effect-solutions:end -->
