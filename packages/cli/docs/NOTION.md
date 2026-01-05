# Using Ship with Notion

Ship supports [Notion](https://notion.so) as an alternative task management backend to Linear. This guide covers how to set up and use Ship with a Notion database.

## Table of Contents

- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
  - [1. Create a Notion Integration](#1-create-a-notion-integration)
  - [2. Create or Prepare Your Database](#2-create-or-prepare-your-database)
  - [3. Share Database with Integration](#3-share-database-with-integration)
  - [4. Initialize Ship](#4-initialize-ship)
- [Recommended Database Schema](#recommended-database-schema)
- [Property Mapping](#property-mapping)
- [Configuration Reference](#configuration-reference)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)

## Quick Start

For experienced users, here's the TL;DR:

```sh
# 1. Create integration at notion.so/my-integrations and copy the secret
# 2. Share your task database with the integration
# 3. Initialize Ship with Notion
ship init
# Select "Notion" when prompted, paste your integration secret
# 4. Start using Ship!
ship task ready
```

For detailed setup instructions, continue reading below.

## Prerequisites

- [Node.js](https://nodejs.org) 20, 22, or 24 (LTS versions)
- A [Notion](https://notion.so) account
- A Notion database for task management
- [jj](https://martinvonz.github.io/jj) installed (for VCS features)

## Setup

### 1. Create a Notion Integration

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Click **"+ New integration"**
3. Configure your integration:
   - **Name**: "Ship CLI" (or your preferred name)
   - **Associated workspace**: Select your workspace
   - **Capabilities**: Ensure "Read content", "Update content", and "Insert content" are enabled
4. Click **Submit**
5. Copy the **Internal Integration Secret** (starts with `secret_...`)

> **Security Note**: Keep your integration secret secure. Never commit it to version control.

### 2. Create or Prepare Your Database

You can use an existing database or create a new one. Ship works best with databases that have the following properties:

| Property | Type | Required | Purpose |
|----------|------|----------|---------|
| Name | Title | Yes | Task title |
| Status | Status | Yes | Workflow state (To Do, In Progress, Done, etc.) |
| Priority | Select | Recommended | Task priority (Urgent, High, Medium, Low, None) |
| Description | Rich Text | Recommended | Task details |
| Labels | Multi-select | Recommended | Tags and labels |
| Type | Select | Optional | Task type (Bug, Feature, Task, etc.) |
| Blocked By | Relation | Optional | Self-referencing relation for dependencies |
| ID | Rich Text | Optional | Custom identifier (e.g., "PROJ-123") |

#### Creating a New Database

1. Create a new page in Notion
2. Add a **Database - Full page** block
3. Add the properties listed above
4. For the **Blocked By** relation, select the same database (self-referencing)

#### Status Property Configuration

Configure your Status property with groups that map to workflow states:

| Group | Example Statuses | Maps To |
|-------|------------------|---------|
| To-do | Backlog, To Do, Open | `unstarted` |
| In Progress | In Progress, Doing, In Review | `started` |
| Complete | Done, Shipped, Resolved | `completed` |

### 3. Share Database with Integration

1. Open your database in Notion
2. Click **"..."** (more options) in the top right
3. Click **"Connections"** (or **"Add connections"**)
4. Find and select your "Ship CLI" integration
5. Confirm the connection

> **Important**: The integration can only access databases explicitly shared with it.

### 4. Initialize Ship

Run the initialization command and select Notion as your provider:

```sh
ship init
```

When prompted:
1. Select **"Notion"** as your task provider
2. Paste your integration secret when asked
3. Select your database from the list

Ship will create a `.ship/config.yaml` file with your Notion configuration.

## Recommended Database Schema

Here's a complete schema for optimal Ship integration:

### Required Properties

| Property | Type | Options |
|----------|------|---------|
| **Name** | Title | - |
| **Status** | Status | To Do, In Progress, In Review, Done, Cancelled |

### Recommended Properties

| Property | Type | Options |
|----------|------|---------|
| **Priority** | Select | Urgent, High, Medium, Low, None |
| **Description** | Rich Text | - |
| **Labels** | Multi-select | (your labels) |
| **Type** | Select | Bug, Feature, Task, Epic, Chore |

### Optional Properties

| Property | Type | Purpose |
|----------|------|---------|
| **Blocked By** | Relation (self) | Task dependencies |
| **ID** | Rich Text | Custom identifier |
| **Parent** | Relation (self) | Parent task/epic |

### Example Status Configuration

```
Status (Status property):
├── To-do
│   ├── Backlog
│   └── To Do
├── In Progress
│   ├── In Progress
│   ├── In Review
│   └── Testing
└── Complete
    ├── Done
    ├── Shipped
    └── Cancelled
```

## Property Mapping

If your database uses different property names, configure the mapping in `.ship/config.yaml`:

```yaml
notion:
  databaseId: "your-database-id"
  propertyMapping:
    # Map Ship's expected property names to your database's property names
    title: "Task Name"        # Default: "Name"
    status: "State"           # Default: "Status"
    priority: "Urgency"       # Default: "Priority"
    description: "Details"    # Default: "Description"
    labels: "Tags"            # Default: "Labels"
    blockedBy: "Dependencies" # Default: "Blocked By"
    type: "Category"          # Default: "Type"
    identifier: "Task ID"     # Default: "ID"
    parent: "Parent Task"     # Default: "Parent"
```

### Default Property Names

If you don't specify a mapping, Ship uses these defaults:

| Ship Property | Default Notion Property |
|---------------|------------------------|
| `title` | Name |
| `status` | Status |
| `priority` | Priority |
| `description` | Description |
| `labels` | Labels |
| `blockedBy` | Blocked By |
| `type` | Type |
| `identifier` | ID |
| `parent` | Parent |

## Configuration Reference

Complete `.ship/config.yaml` example for Notion:

```yaml
# Task provider selection
provider: notion

# Notion configuration
notion:
  # Your Notion database ID (from the database URL)
  databaseId: "abc123def456..."
  
  # Optional: Workspace ID (for multi-workspace setups)
  workspaceId: null
  
  # Property name mapping (all optional, showing defaults)
  propertyMapping:
    title: "Name"
    status: "Status"
    priority: "Priority"
    description: "Description"
    labels: "Labels"
    blockedBy: "Blocked By"
    type: "Type"
    identifier: "ID"
    parent: "Parent"

# Authentication (managed by ship init)
auth:
  apiKey: "secret_..."

# Git configuration
git:
  defaultBranch: main

# PR configuration
pr:
  openBrowser: true

# Commit configuration
commit:
  conventionalFormat: true

# Workspace configuration
workspace:
  basePath: ".ship/workspaces/{stack}"
  autoNavigate: true
  autoCleanup: true
```

### Finding Your Database ID

The database ID is in the URL when you open your database:

```
https://notion.so/workspace/abc123def456?v=...
                         ^^^^^^^^^^^^^^
                         This is your database ID
```

Or from a database page URL:
```
https://notion.so/My-Tasks-abc123def456
                           ^^^^^^^^^^^^^^
```

## Limitations

### Features Not Available with Notion

| Feature | Status | Notes |
|---------|--------|-------|
| **Milestones** | Not supported | Notion doesn't have a native milestone concept |
| **Team management** | Limited | Notion uses workspaces, not teams |
| **Project creation** | Not supported | Databases must be created in Notion UI |
| **Custom identifiers** | Manual | Must be set manually in the ID property |

### Differences from Linear

| Aspect | Linear | Notion |
|--------|--------|--------|
| **Task identifiers** | Auto-generated (BRI-123) | Generated from page ID (N-abc12345) |
| **API speed** | Fast | Slower (REST vs GraphQL) |
| **Teams** | Multiple teams | Single workspace |
| **Milestones** | Native support | Not available |
| **Subtasks** | Native | Via Parent relation |

### Workarounds

#### Milestones
Use a **Select** or **Multi-select** property named "Milestone" to group tasks. Ship won't manage these automatically, but you can filter by them in Notion.

#### Custom Identifiers
If you want identifiers like "PROJ-123":
1. Add a **Rich Text** property named "ID"
2. Manually set identifiers when creating tasks
3. Ship will use these for `getTaskByIdentifier`

## Troubleshooting

### "Notion configuration not found"

Run `ship init` and select Notion as your provider, or manually add the Notion configuration to `.ship/config.yaml`.

### "Failed to query database"

1. Ensure the database is shared with your integration
2. Check that the database ID is correct
3. Verify your API key is valid

### "Property not found" errors

Your database is missing a required property or the property mapping is incorrect. Either:
1. Add the missing property to your database
2. Update the `propertyMapping` in your config

### "Rate limit exceeded"

Notion's API has rate limits. Ship handles these automatically with retries, but if you're making many requests:
1. Wait a few seconds and retry
2. Consider batching operations

### Tasks not appearing in `ship task ready`

Check that:
1. The task's Status is not in a "Complete" group
2. The task has no incomplete blockers (check "Blocked By" relation)
3. The task is in the configured database

### Authentication errors

1. Verify your API key starts with `secret_`
2. Check that the integration has the required capabilities
3. Re-run `ship init` to refresh credentials

## Getting Help

- [Ship GitHub Issues](https://github.com/EduSantosBrito/ship-cli/issues)
- [Notion API Documentation](https://developers.notion.com)
- [Notion Integration Guide](https://developers.notion.com/docs/getting-started)
