# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/EduSantosBrito/ship-cli/commits/main
