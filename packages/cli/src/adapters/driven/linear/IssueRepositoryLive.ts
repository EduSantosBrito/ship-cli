import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Duration from "effect/Duration";
import { LinearDocument, type Issue, type WorkflowState, type IssueRelation } from "@linear/sdk";
import { IssueRepository } from "../../../ports/IssueRepository.js";
import { LinearClientService } from "./LinearClient.js";
import {
  Task,
  TaskId,
  TeamId,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  type ProjectId,
  type TaskType,
} from "../../../domain/Task.js";
import { LinearApiError, TaskError, TaskNotFoundError } from "../../../domain/Errors.js";
import {
  mapIssueToTask,
  priorityToLinear,
  statusToLinearStateType,
  TYPE_LABEL_PREFIX,
} from "./Mapper.js";

// Retry policy: exponential backoff with max 3 retries
const retryPolicy = Schedule.intersect(
  Schedule.exponential(Duration.millis(100)),
  Schedule.recurs(3),
);

// Timeout for API calls: 30 seconds
const API_TIMEOUT = Duration.seconds(30);

const withRetryAndTimeout = <A, E>(
  effect: Effect.Effect<A, E>,
  operation: string,
): Effect.Effect<A, E | LinearApiError> =>
  effect.pipe(
    Effect.timeoutFail({
      duration: API_TIMEOUT,
      onTimeout: () => new LinearApiError({ message: `${operation} timed out after 30 seconds` }),
    }),
    Effect.retry(retryPolicy),
  );

/**
 * Checks if an issue has any incomplete (non-completed, non-canceled) blockers.
 * Returns true if the issue is blocked by at least one incomplete task.
 */
const hasIncompleteBlockers = (issue: Issue): Effect.Effect<boolean, LinearApiError> =>
  Effect.gen(function* () {
    const inverseRelations = yield* Effect.tryPromise({
      try: () => issue.inverseRelations(),
      catch: (e) =>
        new LinearApiError({ message: `Failed to fetch inverse relations: ${e}`, cause: e }),
    });

    const blockedByRelations =
      inverseRelations?.nodes?.filter((r: IssueRelation) => r.type === "blocks") ?? [];

    if (blockedByRelations.length === 0) {
      return false;
    }

    // Check each blocker's state - if any is incomplete, the issue is blocked
    const blockerStates = yield* Effect.forEach(
      blockedByRelations,
      (relation) =>
        Effect.gen(function* () {
          const relatedIssueFetch = relation.relatedIssue;
          if (!relatedIssueFetch) return null;

          const blockerIssue = yield* Effect.tryPromise({
            try: () => relatedIssueFetch,
            catch: (e) =>
              new LinearApiError({ message: `Failed to fetch blocker issue: ${e}`, cause: e }),
          });

          if (!blockerIssue) return null;

          const stateFetch = blockerIssue.state;
          if (!stateFetch) return null;

          const state = yield* Effect.tryPromise({
            try: () => stateFetch,
            catch: (e) =>
              new LinearApiError({ message: `Failed to fetch blocker state: ${e}`, cause: e }),
          });

          return state?.type ?? null;
        }),
      { concurrency: 5 },
    );

    // If any blocker is incomplete (not completed/canceled), the issue is blocked
    return blockerStates.some(
      (stateType) => stateType !== null && stateType !== "completed" && stateType !== "canceled",
    );
  });

const make = Effect.gen(function* () {
  const linearClient = yield* LinearClientService;

  const getTask = (id: TaskId): Effect.Effect<Task, TaskNotFoundError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();
        const issue = yield* Effect.tryPromise({
          try: () => client.issue(id),
          catch: (e) => new LinearApiError({ message: `Failed to fetch issue: ${e}`, cause: e }),
        });
        if (!issue) {
          return yield* Effect.fail(new TaskNotFoundError({ taskId: id }));
        }
        return yield* mapIssueToTask(issue);
      }),
      "Fetching task",
    );

  const getTaskByIdentifier = (
    identifier: string,
  ): Effect.Effect<Task, TaskNotFoundError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        // Validate identifier format (e.g., "BRI-123")
        const match = identifier.match(/^([A-Z]+)-(\d+)$/i);
        if (!match) {
          return yield* Effect.fail(new TaskNotFoundError({ taskId: identifier }));
        }
        const [, teamKey, numberStr] = match;
        const number = parseInt(numberStr, 10);

        const issues = yield* Effect.tryPromise({
          try: () =>
            client.issues({
              filter: {
                number: { eq: number },
                team: { key: { eq: teamKey.toUpperCase() } },
              },
            }),
          catch: (e) => new LinearApiError({ message: `Failed to search issues: ${e}`, cause: e }),
        });

        const issue = issues.nodes[0];
        if (!issue) {
          return yield* Effect.fail(new TaskNotFoundError({ taskId: identifier }));
        }

        return yield* mapIssueToTask(issue);
      }),
      "Fetching task by identifier",
    );

  // Helper to get color for type labels
  const getTypeColor = (type: TaskType): string => {
    switch (type) {
      case "bug":
        return "#EF4444"; // Red
      case "feature":
        return "#10B981"; // Green
      case "task":
        return "#3B82F6"; // Blue
      case "epic":
        return "#8B5CF6"; // Purple
      case "chore":
        return "#6B7280"; // Gray
    }
  };

  // Internal helper to set type label (used by both createTask and setTypeLabel)
  const setTypeLabelInternal = (
    client: ReturnType<typeof linearClient.client> extends Effect.Effect<infer C, unknown, unknown>
      ? C
      : never,
    id: TaskId,
    type: TaskType,
  ): Effect.Effect<void, TaskError | LinearApiError> =>
    Effect.gen(function* () {
      // Fetch the issue to get team and current labels
      const issue = yield* Effect.tryPromise({
        try: () => client.issue(id),
        catch: (e) => new LinearApiError({ message: `Failed to fetch issue: ${e}`, cause: e }),
      });

      if (!issue) {
        return yield* Effect.fail(new TaskError({ message: `Issue not found: ${id}` }));
      }

      // Get current labels on the issue
      const currentLabels = yield* Effect.tryPromise({
        try: () => issue.labels(),
        catch: (e) =>
          new LinearApiError({ message: `Failed to fetch issue labels: ${e}`, cause: e }),
      });

      // Get the team to fetch team-level labels
      const team = yield* Effect.tryPromise({
        try: () => issue.team!,
        catch: (e) => new LinearApiError({ message: `Failed to fetch team: ${e}`, cause: e }),
      });

      const targetLabelName = `${TYPE_LABEL_PREFIX}${type}`;

      // Get all labels in the workspace/team that start with "type:"
      const allLabels = yield* Effect.tryPromise({
        try: () =>
          client.issueLabels({
            filter: {
              name: { startsWith: TYPE_LABEL_PREFIX },
            },
          }),
        catch: (e) =>
          new LinearApiError({ message: `Failed to fetch type labels: ${e}`, cause: e }),
      });

      // Find or create the target type label
      let targetLabelId: string | undefined = allLabels.nodes.find(
        (l) => l.name === targetLabelName,
      )?.id;

      if (!targetLabelId) {
        // Create the new type label (at team level)
        const createResult = yield* Effect.tryPromise({
          try: () =>
            client.createIssueLabel({
              name: targetLabelName,
              teamId: team.id,
              color: getTypeColor(type),
              description: `Task type: ${type}`,
            }),
          catch: (e) =>
            new LinearApiError({ message: `Failed to create type label: ${e}`, cause: e }),
        });

        if (!createResult.success) {
          return yield* Effect.fail(new TaskError({ message: "Failed to create type label" }));
        }

        // Fetch the created label to get its ID
        if (!createResult.issueLabel) {
          return yield* Effect.fail(
            new TaskError({ message: "Label not returned after createIssueLabel" }),
          );
        }
        const createdLabel = yield* Effect.tryPromise({
          try: () => createResult.issueLabel!,
          catch: (e) =>
            new LinearApiError({ message: `Failed to get created label: ${e}`, cause: e }),
        });
        targetLabelId = createdLabel.id;
      }

      // Build the new label IDs list:
      // 1. Keep all non-type labels from current issue
      // 2. Add the target type label
      const currentLabelIds =
        currentLabels?.nodes
          ?.filter((l) => !l.name.startsWith(TYPE_LABEL_PREFIX))
          .map((l) => l.id) ?? [];

      const newLabelIds = [...currentLabelIds, targetLabelId];

      // Update the issue with new labels
      const result = yield* Effect.tryPromise({
        try: () => client.updateIssue(id, { labelIds: newLabelIds }),
        catch: (e) =>
          new LinearApiError({ message: `Failed to update issue labels: ${e}`, cause: e }),
      });

      if (!result.success) {
        return yield* Effect.fail(new TaskError({ message: "Failed to update issue labels" }));
      }
    });

  const createTask = (
    teamId: TeamId,
    input: CreateTaskInput,
  ): Effect.Effect<Task, TaskError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const createInput: Parameters<typeof client.createIssue>[0] = {
          teamId,
          title: input.title,
          priority: priorityToLinear(input.priority),
        };

        if (Option.isSome(input.description)) {
          createInput.description = input.description.value;
        }

        if (Option.isSome(input.projectId)) {
          createInput.projectId = input.projectId.value;
        }

        if (Option.isSome(input.parentId)) {
          createInput.parentId = input.parentId.value;
        }

        if (Option.isSome(input.milestoneId)) {
          createInput.projectMilestoneId = input.milestoneId.value;
        }

        const issuePayload = yield* Effect.tryPromise({
          try: () => client.createIssue(createInput),
          catch: (e) => new LinearApiError({ message: `Failed to create issue: ${e}`, cause: e }),
        });

        if (!issuePayload.success) {
          return yield* Effect.fail(new TaskError({ message: "Failed to create issue" }));
        }

        if (!issuePayload.issue) {
          return yield* Effect.fail(new TaskError({ message: "Issue not returned after create" }));
        }
        const issue = yield* Effect.tryPromise({
          try: () => issuePayload.issue!,
          catch: (e) =>
            new LinearApiError({ message: `Failed to get created issue: ${e}`, cause: e }),
        });
        if (!issue) {
          return yield* Effect.fail(new TaskError({ message: "Issue not returned after create" }));
        }

        // Set type label if provided (default is "task")
        yield* setTypeLabelInternal(client, issue.id as TaskId, input.type);

        // Re-fetch to get updated labels
        const updatedIssue = yield* Effect.tryPromise({
          try: () => client.issue(issue.id),
          catch: (e) =>
            new LinearApiError({ message: `Failed to fetch updated issue: ${e}`, cause: e }),
        });

        if (!updatedIssue) {
          return yield* Effect.fail(
            new TaskError({ message: `Issue ${issue.id} not found after creation` }),
          );
        }

        return yield* mapIssueToTask(updatedIssue);
      }),
      "Creating task",
    );

  /** Typed payload for Linear issue update API */
  interface LinearIssueUpdatePayload {
    title?: string;
    description?: string;
    priority?: number;
    stateId?: string;
    assigneeId?: string;
    parentId?: string | null;
    projectMilestoneId?: string | null;
  }

  const updateTask = (
    id: TaskId,
    input: UpdateTaskInput,
  ): Effect.Effect<Task, TaskNotFoundError | TaskError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const updatePayload: LinearIssueUpdatePayload = {};

        if (Option.isSome(input.title)) {
          updatePayload.title = input.title.value;
        }

        if (Option.isSome(input.description)) {
          updatePayload.description = input.description.value;
        }

        if (Option.isSome(input.priority)) {
          updatePayload.priority = priorityToLinear(input.priority.value);
        }

        if (Option.isSome(input.assigneeId)) {
          updatePayload.assigneeId = input.assigneeId.value;
        }

        if (Option.isSome(input.parentId)) {
          // Empty string means remove parent, otherwise set the parent ID
          updatePayload.parentId = input.parentId.value === "" ? null : input.parentId.value;
        }

        if (Option.isSome(input.milestoneId)) {
          // Empty string means remove milestone, otherwise set the milestone ID
          updatePayload.projectMilestoneId =
            input.milestoneId.value === "" ? null : input.milestoneId.value;
        }

        if (Option.isSome(input.status)) {
          const issue = yield* Effect.tryPromise({
            try: () => client.issue(id),
            catch: (e) => new LinearApiError({ message: `Failed to fetch issue: ${e}`, cause: e }),
          });

          if (!issue) {
            return yield* Effect.fail(new TaskNotFoundError({ taskId: id }));
          }

          const teamFetch = issue.team;
          if (!teamFetch) {
            return yield* Effect.fail(new TaskError({ message: "Issue has no team" }));
          }

          const team = yield* Effect.tryPromise({
            try: () => teamFetch,
            catch: (e) => new LinearApiError({ message: `Failed to fetch team: ${e}`, cause: e }),
          });

          const states = yield* Effect.tryPromise({
            try: () => team.states(),
            catch: (e) => new LinearApiError({ message: `Failed to fetch states: ${e}`, cause: e }),
          });

          const targetStateType = statusToLinearStateType(input.status.value);
          const targetState = states.nodes.find((s: WorkflowState) => s.type === targetStateType);

          if (targetState) {
            updatePayload.stateId = targetState.id;
          }
        }

        const result = yield* Effect.tryPromise({
          try: () => client.updateIssue(id, updatePayload),
          catch: (e) => new LinearApiError({ message: `Failed to update issue: ${e}`, cause: e }),
        });

        if (!result.success) {
          return yield* Effect.fail(new TaskError({ message: "Failed to update issue" }));
        }

        if (!result.issue) {
          return yield* Effect.fail(new TaskError({ message: "Issue not returned after update" }));
        }
        const updatedIssue = yield* Effect.tryPromise({
          try: () => result.issue!,
          catch: (e) =>
            new LinearApiError({ message: `Failed to get updated issue: ${e}`, cause: e }),
        });
        if (!updatedIssue) {
          return yield* Effect.fail(new TaskError({ message: "Issue not returned after update" }));
        }

        return yield* mapIssueToTask(updatedIssue);
      }),
      "Updating task",
    );

  const listTasks = (
    teamId: TeamId,
    filter: TaskFilter,
  ): Effect.Effect<ReadonlyArray<Task>, LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const linearFilter: Record<string, unknown> = {
          team: { id: { eq: teamId } },
        };

        if (Option.isSome(filter.status)) {
          // Explicit status filter provided - use it directly
          const stateType = statusToLinearStateType(filter.status.value);
          linearFilter.state = { type: { eq: stateType } };
        } else if (!filter.includeCompleted) {
          // No status filter and not including completed - exclude completed/canceled
          linearFilter.state = { type: { nin: ["completed", "canceled"] } };
        }

        if (Option.isSome(filter.priority)) {
          linearFilter.priority = { eq: priorityToLinear(filter.priority.value) };
        }

        if (Option.isSome(filter.projectId)) {
          linearFilter.project = { id: { eq: filter.projectId.value } };
        }

        if (Option.isSome(filter.milestoneId)) {
          linearFilter.projectMilestone = { id: { eq: filter.milestoneId.value } };
        }

        if (filter.assignedToMe) {
          const viewer = yield* Effect.tryPromise({
            try: () => client.viewer,
            catch: (e) => new LinearApiError({ message: `Failed to fetch viewer: ${e}`, cause: e }),
          });
          linearFilter.assignee = { id: { eq: viewer.id } };
        }

        const issues = yield* Effect.tryPromise({
          try: () => client.issues({ filter: linearFilter }),
          catch: (e) => new LinearApiError({ message: `Failed to fetch issues: ${e}`, cause: e }),
        });

        return yield* Effect.all(issues.nodes.map((issue: Issue) => mapIssueToTask(issue)));
      }),
      "Listing tasks",
    );

  const getReadyTasks = (
    teamId: TeamId,
    projectId?: ProjectId,
  ): Effect.Effect<ReadonlyArray<Task>, LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const filter: Record<string, unknown> = {
          team: { id: { eq: teamId } },
          state: { type: { in: ["backlog", "unstarted"] } },
        };

        if (projectId) {
          filter.project = { id: { eq: projectId } };
        }

        const issues = yield* Effect.tryPromise({
          try: () => client.issues({ filter }),
          catch: (e) => new LinearApiError({ message: `Failed to fetch issues: ${e}`, cause: e }),
        });

        const tasks = yield* Effect.forEach(
          issues.nodes,
          (issue: Issue) =>
            Effect.gen(function* () {
              const isBlocked = yield* hasIncompleteBlockers(issue);
              if (isBlocked) {
                return null;
              }
              return yield* mapIssueToTask(issue);
            }),
          { concurrency: 5 },
        );

        return tasks.filter((t): t is Task => t !== null);
      }),
      "Fetching ready tasks",
    );

  const getBlockedTasks = (
    teamId: TeamId,
    projectId?: ProjectId,
  ): Effect.Effect<ReadonlyArray<Task>, LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const filter: Record<string, unknown> = {
          team: { id: { eq: teamId } },
          state: { type: { in: ["backlog", "unstarted", "started"] } },
        };

        if (projectId) {
          filter.project = { id: { eq: projectId } };
        }

        const issues = yield* Effect.tryPromise({
          try: () => client.issues({ filter }),
          catch: (e) => new LinearApiError({ message: `Failed to fetch issues: ${e}`, cause: e }),
        });

        const tasks = yield* Effect.forEach(
          issues.nodes,
          (issue: Issue) =>
            Effect.gen(function* () {
              const isBlocked = yield* hasIncompleteBlockers(issue);
              if (!isBlocked) {
                return null;
              }
              return yield* mapIssueToTask(issue);
            }),
          { concurrency: 5 },
        );

        return tasks.filter((t): t is Task => t !== null);
      }),
      "Fetching blocked tasks",
    );

  const addBlocker = (
    blockedId: TaskId,
    blockerId: TaskId,
  ): Effect.Effect<void, TaskNotFoundError | TaskError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const result = yield* Effect.tryPromise({
          try: () =>
            client.createIssueRelation({
              issueId: blockedId,
              relatedIssueId: blockerId,
              type: LinearDocument.IssueRelationType.Blocks,
            }),
          catch: (e) =>
            new LinearApiError({ message: `Failed to create relation: ${e}`, cause: e }),
        });

        if (!result.success) {
          return yield* Effect.fail(
            new TaskError({ message: "Failed to create blocking relation" }),
          );
        }
      }),
      "Adding blocker",
    );

  const removeBlocker = (
    blockedId: TaskId,
    blockerId: TaskId,
  ): Effect.Effect<void, TaskNotFoundError | TaskError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const blocked = yield* Effect.tryPromise({
          try: () => client.issue(blockedId),
          catch: (e) => new LinearApiError({ message: `Failed to fetch issue: ${e}`, cause: e }),
        });

        if (!blocked) {
          return yield* Effect.fail(new TaskNotFoundError({ taskId: blockedId }));
        }

        const relations = yield* Effect.tryPromise({
          try: () => blocked.relations(),
          catch: (e) =>
            new LinearApiError({ message: `Failed to fetch relations: ${e}`, cause: e }),
        });

        const relationToDelete = yield* Effect.tryPromise({
          try: async () => {
            for (const r of relations?.nodes ?? []) {
              if (r.type === "blocks") {
                const relatedIssue = await (r as IssueRelation & { relatedIssue: Promise<Issue> })
                  .relatedIssue;
                if (relatedIssue?.id === blockerId) {
                  return r;
                }
              }
            }
            return undefined;
          },
          catch: (e) => new LinearApiError({ message: `Failed to find relation: ${e}`, cause: e }),
        });

        if (!relationToDelete) {
          return;
        }

        yield* Effect.tryPromise({
          try: () => client.deleteIssueRelation(relationToDelete.id),
          catch: (e) =>
            new LinearApiError({ message: `Failed to delete relation: ${e}`, cause: e }),
        });
      }),
      "Removing blocker",
    );

  const addRelated = (
    taskId: TaskId,
    relatedTaskId: TaskId,
  ): Effect.Effect<void, TaskNotFoundError | TaskError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const result = yield* Effect.tryPromise({
          try: () =>
            client.createIssueRelation({
              issueId: taskId,
              relatedIssueId: relatedTaskId,
              type: LinearDocument.IssueRelationType.Related,
            }),
          catch: (e) =>
            new LinearApiError({ message: `Failed to create relation: ${e}`, cause: e }),
        });

        if (!result.success) {
          return yield* Effect.fail(
            new TaskError({ message: "Failed to create related relation" }),
          );
        }
      }),
      "Adding related",
    );

  const getBranchName = (id: TaskId): Effect.Effect<string, TaskNotFoundError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const issue = yield* Effect.tryPromise({
          try: () => client.issue(id),
          catch: (e) => new LinearApiError({ message: `Failed to fetch issue: ${e}`, cause: e }),
        });

        if (!issue) {
          return yield* Effect.fail(new TaskNotFoundError({ taskId: id }));
        }

        if (issue.branchName) {
          return issue.branchName;
        }

        const slug = issue.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 50);

        return `${issue.identifier.toLowerCase()}-${slug}`;
      }),
      "Getting branch name",
    );

  const SESSION_LABEL_PREFIX = "session:";

  const setTypeLabel = (
    id: TaskId,
    type: TaskType,
  ): Effect.Effect<void, TaskNotFoundError | TaskError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();
        yield* setTypeLabelInternal(client, id, type);
      }),
      "Setting type label",
    );

  const setSessionLabel = (
    id: TaskId,
    sessionId: string,
  ): Effect.Effect<void, TaskNotFoundError | TaskError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        // Fetch the issue to get team and current labels
        const issue = yield* Effect.tryPromise({
          try: () => client.issue(id),
          catch: (e) => new LinearApiError({ message: `Failed to fetch issue: ${e}`, cause: e }),
        });

        if (!issue) {
          return yield* Effect.fail(new TaskNotFoundError({ taskId: id }));
        }

        // Get current labels on the issue
        const currentLabels = yield* Effect.tryPromise({
          try: () => issue.labels(),
          catch: (e) =>
            new LinearApiError({ message: `Failed to fetch issue labels: ${e}`, cause: e }),
        });

        // Get the team to fetch team-level labels
        const team = yield* Effect.tryPromise({
          try: () => issue.team!,
          catch: (e) => new LinearApiError({ message: `Failed to fetch team: ${e}`, cause: e }),
        });

        const targetLabelName = `${SESSION_LABEL_PREFIX}${sessionId}`;

        // Get all labels in the workspace/team that start with "session:"
        const allLabels = yield* Effect.tryPromise({
          try: () =>
            client.issueLabels({
              filter: {
                name: { startsWith: SESSION_LABEL_PREFIX },
              },
            }),
          catch: (e) =>
            new LinearApiError({ message: `Failed to fetch session labels: ${e}`, cause: e }),
        });

        // Find or create the target session label
        let targetLabelId: string | undefined = allLabels.nodes.find(
          (l) => l.name === targetLabelName,
        )?.id;

        if (!targetLabelId) {
          // Create the new session label (at team level)
          const createResult = yield* Effect.tryPromise({
            try: () =>
              client.createIssueLabel({
                name: targetLabelName,
                teamId: team.id,
                color: "#6B7280", // Gray color for session labels
                description: `OpenCode agent session ${sessionId}`,
              }),
            catch: (e) =>
              new LinearApiError({ message: `Failed to create session label: ${e}`, cause: e }),
          });

          if (!createResult.success) {
            return yield* Effect.fail(new TaskError({ message: "Failed to create session label" }));
          }

          // Fetch the created label to get its ID
          if (!createResult.issueLabel) {
            return yield* Effect.fail(
              new TaskError({ message: "Label not returned after createIssueLabel" }),
            );
          }
          const createdLabel = yield* Effect.tryPromise({
            try: () => createResult.issueLabel!,
            catch: (e) =>
              new LinearApiError({ message: `Failed to get created label: ${e}`, cause: e }),
          });
          targetLabelId = createdLabel.id;
        }

        // Build the new label IDs list:
        // 1. Keep all non-session labels from current issue
        // 2. Add the target session label
        const currentLabelIds =
          currentLabels?.nodes
            ?.filter((l) => !l.name.startsWith(SESSION_LABEL_PREFIX))
            .map((l) => l.id) ?? [];

        const newLabelIds = [...currentLabelIds, targetLabelId];

        // Update the issue with new labels
        const result = yield* Effect.tryPromise({
          try: () => client.updateIssue(id, { labelIds: newLabelIds }),
          catch: (e) =>
            new LinearApiError({ message: `Failed to update issue labels: ${e}`, cause: e }),
        });

        if (!result.success) {
          return yield* Effect.fail(new TaskError({ message: "Failed to update issue labels" }));
        }
      }),
      "Setting session label",
    );

  const clearSessionLabel = (
    id: TaskId,
  ): Effect.Effect<void, TaskNotFoundError | TaskError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        // Fetch the issue to get current labels
        const issue = yield* Effect.tryPromise({
          try: () => client.issue(id),
          catch: (e) => new LinearApiError({ message: `Failed to fetch issue: ${e}`, cause: e }),
        });

        if (!issue) {
          return yield* Effect.fail(new TaskNotFoundError({ taskId: id }));
        }

        // Get current labels on the issue
        const currentLabels = yield* Effect.tryPromise({
          try: () => issue.labels(),
          catch: (e) =>
            new LinearApiError({ message: `Failed to fetch issue labels: ${e}`, cause: e }),
        });

        // Find session labels on this issue
        const sessionLabels =
          currentLabels?.nodes?.filter((l) => l.name.startsWith(SESSION_LABEL_PREFIX)) ?? [];

        // If no session labels, nothing to do
        if (sessionLabels.length === 0) {
          return;
        }

        // Remove session labels from the issue
        const nonSessionLabelIds =
          currentLabels?.nodes
            ?.filter((l) => !l.name.startsWith(SESSION_LABEL_PREFIX))
            .map((l) => l.id) ?? [];

        const result = yield* Effect.tryPromise({
          try: () => client.updateIssue(id, { labelIds: nonSessionLabelIds }),
          catch: (e) =>
            new LinearApiError({ message: `Failed to update issue labels: ${e}`, cause: e }),
        });

        if (!result.success) {
          return yield* Effect.fail(new TaskError({ message: "Failed to remove session label" }));
        }

        // For each session label, check if it's still in use and delete if not
        for (const sessionLabel of sessionLabels) {
          // Find issues using this label (fetch a few to account for the current issue)
          const issuesWithLabel = yield* Effect.tryPromise({
            try: () =>
              client.issues({
                filter: {
                  labels: { some: { id: { eq: sessionLabel.id } } },
                },
                first: 5, // Fetch a few to check if any OTHER issues use it
              }),
            catch: (e) =>
              new LinearApiError({ message: `Failed to check label usage: ${e}`, cause: e }),
          });

          // Filter out the current issue - due to Linear's eventual consistency,
          // the issue we just updated might still appear in results
          const otherIssuesUsingLabel = issuesWithLabel.nodes.filter((i) => i.id !== id);

          // If no OTHER issues use this label, delete it (non-fatal if this fails)
          if (otherIssuesUsingLabel.length === 0) {
            yield* Effect.tryPromise({
              try: () => client.deleteIssueLabel(sessionLabel.id),
              catch: (e) =>
                new LinearApiError({ message: `Failed to delete session label: ${e}`, cause: e }),
            }).pipe(Effect.ignore);
          }
        }
      }),
      "Clearing session label",
    );

  const removeAsBlocker = (
    blockerId: TaskId,
  ): Effect.Effect<ReadonlyArray<string>, TaskNotFoundError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        // Fetch the blocker issue
        const blocker = yield* Effect.tryPromise({
          try: () => client.issue(blockerId),
          catch: (e) => new LinearApiError({ message: `Failed to fetch issue: ${e}`, cause: e }),
        });

        if (!blocker) {
          return yield* Effect.fail(new TaskNotFoundError({ taskId: blockerId }));
        }

        // Get inverse relations - these are issues that THIS task blocks
        const inverseRelations = yield* Effect.tryPromise({
          try: () => blocker.inverseRelations(),
          catch: (e) =>
            new LinearApiError({ message: `Failed to fetch inverse relations: ${e}`, cause: e }),
        });

        // Filter to only "blocks" relations (where this task is the blocker)
        const blockingRelations =
          inverseRelations?.nodes?.filter((r: IssueRelation) => r.type === "blocks") ?? [];

        if (blockingRelations.length === 0) {
          return [];
        }

        // Delete each blocking relation in parallel and collect the unblocked task identifiers.
        // Uses partial failure handling - if one deletion fails, we log a warning and continue
        // with the others rather than failing the entire operation.
        const results = yield* Effect.forEach(
          blockingRelations,
          (relation) =>
            Effect.gen(function* () {
              // The Linear SDK types don't expose `issue` on IssueRelation, but it exists
              // on inverse relations as a Promise<Issue> pointing to the blocked issue.
              const blockedIssue = yield* Effect.tryPromise({
                try: () => (relation as IssueRelation & { issue: Promise<Issue> }).issue,
                catch: (e) =>
                  new LinearApiError({ message: `Failed to fetch blocked issue: ${e}`, cause: e }),
              });

              // Delete the relation
              yield* Effect.tryPromise({
                try: () => client.deleteIssueRelation(relation.id),
                catch: (e) =>
                  new LinearApiError({ message: `Failed to delete relation: ${e}`, cause: e }),
              });

              return blockedIssue?.identifier ?? null;
            }).pipe(
              Effect.catchAll((error) =>
                Effect.gen(function* () {
                  yield* Effect.logWarning(`Failed to remove blocking relation: ${error}`);
                  return null;
                }),
              ),
            ),
          { concurrency: 3 },
        );

        return results.filter((id): id is string => id !== null);
      }),
      "Removing task as blocker",
    );

  return {
    getTask,
    getTaskByIdentifier,
    createTask,
    updateTask,
    listTasks,
    getReadyTasks,
    getBlockedTasks,
    addBlocker,
    removeBlocker,
    addRelated,
    getBranchName,
    setSessionLabel,
    setTypeLabel,
    clearSessionLabel,
    removeAsBlocker,
  };
});

export const IssueRepositoryLive = Layer.effect(IssueRepository, make);
