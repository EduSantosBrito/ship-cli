# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2025-12-30

### Changed

- Upgraded @opencode-ai/plugin from 1.0.208 to 1.0.210
- Upgraded @opencode-ai/sdk from 1.0.208 to 1.0.210
- Upgraded @effect/cli from 0.69.0 to 0.73.0
- Upgraded @effect/language-service from 0.62.4 to 0.63.2
- Upgraded @effect/platform from 0.90.3 to 0.94.0
- Upgraded @effect/platform-node from 0.96.0 to 0.104.0
- Upgraded @effect/vitest from 0.25.1 to 0.27.0

## [0.1.0] - 2025-12-30

### Added

- Initial public release
- Linear integration for task management
- Jujutsu (jj) VCS integration for stacked changes workflow
- OpenCode plugin for AI agent integration
- GitHub webhook support for real-time PR notifications
- Milestone management commands
- Template system for project initialization

### Task Commands

- `ship task ready` - List tasks with no blockers
- `ship task list` - List all tasks with optional filters
- `ship task show` - View task details
- `ship task start` - Mark task as in progress
- `ship task done` - Mark task as complete
- `ship task create` - Create new tasks
- `ship task update` - Update existing tasks
- `ship task block/unblock` - Manage task dependencies
- `ship task relate` - Link related tasks

### Stack (VCS) Commands

- `ship stack log` - View change stack
- `ship stack status` - Current change info
- `ship stack create` - Create new change with workspace
- `ship stack describe` - Update change description
- `ship stack sync` - Fetch and rebase onto trunk
- `ship stack submit` - Push and create/update PR
- `ship stack squash` - Squash into parent change
- `ship stack abandon` - Abandon a change
- `ship stack up/down` - Navigate the stack
- `ship stack undo` - Undo last VCS operation

### Webhook Commands

- `ship webhook start` - Start webhook daemon
- `ship webhook stop` - Stop webhook daemon
- `ship webhook status` - Check daemon status
- `ship webhook subscribe` - Subscribe to PR events
- `ship webhook unsubscribe` - Unsubscribe from PR events

### Milestone Commands

- `ship milestone list` - List milestones
- `ship milestone show` - View milestone details
- `ship milestone create` - Create new milestone
- `ship milestone update` - Update milestone
- `ship milestone delete` - Delete milestone

[Unreleased]: https://github.com/EduSantosBrito/ship-cli/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/EduSantosBrito/ship-cli/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/EduSantosBrito/ship-cli/releases/tag/v0.1.0
