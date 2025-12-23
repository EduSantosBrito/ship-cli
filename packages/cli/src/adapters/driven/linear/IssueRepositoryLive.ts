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

/**
 * Wraps a promise with abort signal support.
 * When the signal is aborted, the returned promise rejects immediately.
 * Note: The underlying promise continues to run, but we stop waiting for it.
 */
const withAbortSignal = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const abortHandler = () => {
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abortHandler, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abortHandler);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abortHandler);
        reject(error);
      },
    );
  });
};

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

const make = Effect.gen(function* () {
  const linearClient = yield* LinearClientService;

  const getTask = (id: TaskId): Effect.Effect<Task, TaskNotFoundError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();
        const issue = yield* Effect.tryPromise({
          try: (signal) => withAbortSignal(client.issue(id), signal),
          catch: (e) => new LinearApiError({ message: `Failed to fetch issue: ${e}`, cause: e }),
        });
        if (!issue) {
          return yield* Effect.fail(new TaskNotFoundError({ taskId: id }));
        }
        return yield* Effect.tryPromise({
          try: (signal) => withAbortSignal(mapIssueToTask(issue), signal),
          catch: (e) => new LinearApiError({ message: `Failed to map issue: ${e}`, cause: e }),
        });
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
          try: (signal) =>
            withAbortSignal(
              client.issues({
                filter: {
                  number: { eq: number },
                  team: { key: { eq: teamKey.toUpperCase() } },
                },
              }),
              signal,
            ),
          catch: (e) => new LinearApiError({ message: `Failed to search issues: ${e}`, cause: e }),
        });

        const issue = issues.nodes[0];
        if (!issue) {
          return yield* Effect.fail(new TaskNotFoundError({ taskId: identifier }));
        }

        return yield* Effect.tryPromise({
          try: (signal) => withAbortSignal(mapIssueToTask(issue), signal),
          catch: (e) => new LinearApiError({ message: `Failed to map issue: ${e}`, cause: e }),
        });
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
        try: (signal) => withAbortSignal(client.issue(id), signal),
        catch: (e) => new LinearApiError({ message: `Failed to fetch issue: ${e}`, cause: e }),
      });

      if (!issue) {
        return yield* Effect.fail(new TaskError({ message: `Issue not found: ${id}` }));
      }

      // Get current labels on the issue
      const currentLabels = yield* Effect.tryPromise({
        try: (signal) => withAbortSignal(issue.labels(), signal),
        catch: (e) =>
          new LinearApiError({ message: `Failed to fetch issue labels: ${e}`, cause: e }),
      });

      // Get the team to fetch team-level labels
      const team = yield* Effect.tryPromise({
        try: (signal) => withAbortSignal(issue.team!, signal),
        catch: (e) => new LinearApiError({ message: `Failed to fetch team: ${e}`, cause: e }),
      });

      const targetLabelName = `${TYPE_LABEL_PREFIX}${type}`;

      // Get all labels in the workspace/team that start with "type:"
      const allLabels = yield* Effect.tryPromise({
        try: (signal) =>
          withAbortSignal(
            client.issueLabels({
              filter: {
                name: { startsWith: TYPE_LABEL_PREFIX },
              },
            }),
            signal,
          ),
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
          try: (signal) =>
            withAbortSignal(
              client.createIssueLabel({
                name: targetLabelName,
                teamId: team.id,
                color: getTypeColor(type),
                description: `Task type: ${type}`,
              }),
              signal,
            ),
          catch: (e) =>
            new LinearApiError({ message: `Failed to create type label: ${e}`, cause: e }),
        });

        if (!createResult.success) {
          return yield* Effect.fail(new TaskError({ message: "Failed to create type label" }));
        }

        // Fetch the created label to get its ID
        const createdLabel = yield* Effect.tryPromise({
          try: async (signal) => {
            if (!createResult.issueLabel) throw new Error("Label not returned");
            return withAbortSignal(createResult.issueLabel, signal);
          },
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
        try: (signal) => withAbortSignal(client.updateIssue(id, { labelIds: newLabelIds }), signal),
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

        const issuePayload = yield* Effect.tryPromise({
          try: (signal) => withAbortSignal(client.createIssue(createInput), signal),
          catch: (e) => new LinearApiError({ message: `Failed to create issue: ${e}`, cause: e }),
        });

        if (!issuePayload.success) {
          return yield* Effect.fail(new TaskError({ message: "Failed to create issue" }));
        }

        const issue = yield* Effect.tryPromise({
          try: async (signal) => {
            if (!issuePayload.issue) throw new Error("Issue not returned");
            const i = await withAbortSignal(issuePayload.issue, signal);
            if (!i) throw new Error("Issue not returned");
            return i;
          },
          catch: (e) =>
            new LinearApiError({ message: `Failed to get created issue: ${e}`, cause: e }),
        });

        // Set type label if provided (default is "task")
        yield* setTypeLabelInternal(client, issue.id as TaskId, input.type);

        // Re-fetch to get updated labels
        const updatedIssue = yield* Effect.tryPromise({
          try: (signal) => withAbortSignal(client.issue(issue.id), signal),
          catch: (e) =>
            new LinearApiError({ message: `Failed to fetch updated issue: ${e}`, cause: e }),
        });

        return yield* Effect.tryPromise({
          try: (signal) => withAbortSignal(mapIssueToTask(updatedIssue!), signal),
          catch: (e) => new LinearApiError({ message: `Failed to map issue: ${e}`, cause: e }),
        });
      }),
      "Creating task",
    );

  const updateTask = (
    id: TaskId,
    input: UpdateTaskInput,
  ): Effect.Effect<Task, TaskNotFoundError | TaskError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const updatePayload: Record<string, unknown> = {};

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

        if (Option.isSome(input.status)) {
          const issue = yield* Effect.tryPromise({
            try: (signal) => withAbortSignal(client.issue(id), signal),
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
            try: (signal) => withAbortSignal(teamFetch, signal),
            catch: (e) => new LinearApiError({ message: `Failed to fetch team: ${e}`, cause: e }),
          });

          const states = yield* Effect.tryPromise({
            try: (signal) => withAbortSignal(team.states(), signal),
            catch: (e) => new LinearApiError({ message: `Failed to fetch states: ${e}`, cause: e }),
          });

          const targetStateType = statusToLinearStateType(input.status.value);
          const targetState = states.nodes.find((s: WorkflowState) => s.type === targetStateType);

          if (targetState) {
            updatePayload.stateId = targetState.id;
          }
        }

        const result = yield* Effect.tryPromise({
          try: (signal) => withAbortSignal(client.updateIssue(id, updatePayload), signal),
          catch: (e) => new LinearApiError({ message: `Failed to update issue: ${e}`, cause: e }),
        });

        if (!result.success) {
          return yield* Effect.fail(new TaskError({ message: "Failed to update issue" }));
        }

        const updatedIssue = yield* Effect.tryPromise({
          try: async (signal) => {
            if (!result.issue) throw new Error("Issue not returned");
            const i = await withAbortSignal(result.issue, signal);
            if (!i) throw new Error("Issue not returned");
            return i;
          },
          catch: (e) =>
            new LinearApiError({ message: `Failed to get updated issue: ${e}`, cause: e }),
        });

        return yield* Effect.tryPromise({
          try: (signal) => withAbortSignal(mapIssueToTask(updatedIssue), signal),
          catch: (e) => new LinearApiError({ message: `Failed to map issue: ${e}`, cause: e }),
        });
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

        if (filter.assignedToMe) {
          const viewer = yield* Effect.tryPromise({
            try: (signal) => withAbortSignal(client.viewer, signal),
            catch: (e) => new LinearApiError({ message: `Failed to fetch viewer: ${e}`, cause: e }),
          });
          linearFilter.assignee = { id: { eq: viewer.id } };
        }

        const issues = yield* Effect.tryPromise({
          try: (signal) => withAbortSignal(client.issues({ filter: linearFilter }), signal),
          catch: (e) => new LinearApiError({ message: `Failed to fetch issues: ${e}`, cause: e }),
        });

        return yield* Effect.all(
          issues.nodes.map((issue: Issue) =>
            Effect.tryPromise({
              try: (signal) => withAbortSignal(mapIssueToTask(issue), signal),
              catch: (e) => new LinearApiError({ message: `Failed to map issue: ${e}`, cause: e }),
            }),
          ),
        );
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
          try: (signal) => withAbortSignal(client.issues({ filter }), signal),
          catch: (e) => new LinearApiError({ message: `Failed to fetch issues: ${e}`, cause: e }),
        });

        const tasks = yield* Effect.all(
          issues.nodes.map((issue: Issue) =>
            Effect.tryPromise({
              try: async (signal) => {
                const task = await withAbortSignal(mapIssueToTask(issue), signal);
                const relations = await withAbortSignal(issue.relations(), signal);
                const blockedByRelations = relations?.nodes?.filter(
                  (r: IssueRelation) => r.type === "blocks",
                );
                if (blockedByRelations && blockedByRelations.length > 0) {
                  return null;
                }
                return task;
              },
              catch: (e) => new LinearApiError({ message: `Failed to map issue: ${e}`, cause: e }),
            }),
          ),
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
          try: (signal) => withAbortSignal(client.issues({ filter }), signal),
          catch: (e) => new LinearApiError({ message: `Failed to fetch issues: ${e}`, cause: e }),
        });

        const tasks = yield* Effect.all(
          issues.nodes.map((issue: Issue) =>
            Effect.tryPromise({
              try: async (signal) => {
                const relations = await withAbortSignal(issue.relations(), signal);
                const blockedByRelations = relations?.nodes?.filter(
                  (r: IssueRelation) => r.type === "blocks",
                );
                if (!blockedByRelations || blockedByRelations.length === 0) {
                  return null;
                }
                return withAbortSignal(mapIssueToTask(issue), signal);
              },
              catch: (e) =>
                new LinearApiError({ message: `Failed to process issue: ${e}`, cause: e }),
            }),
          ),
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
          try: (signal) =>
            withAbortSignal(
              client.createIssueRelation({
                issueId: blockedId,
                relatedIssueId: blockerId,
                type: LinearDocument.IssueRelationType.Blocks,
              }),
              signal,
            ),
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
          try: (signal) => withAbortSignal(client.issue(blockedId), signal),
          catch: (e) => new LinearApiError({ message: `Failed to fetch issue: ${e}`, cause: e }),
        });

        if (!blocked) {
          return yield* Effect.fail(new TaskNotFoundError({ taskId: blockedId }));
        }

        const relations = yield* Effect.tryPromise({
          try: (signal) => withAbortSignal(blocked.relations(), signal),
          catch: (e) =>
            new LinearApiError({ message: `Failed to fetch relations: ${e}`, cause: e }),
        });

        const relationToDelete = yield* Effect.tryPromise({
          try: async (signal) => {
            for (const r of relations?.nodes ?? []) {
              if (r.type === "blocks") {
                const relatedIssue = await withAbortSignal(
                  (r as IssueRelation & { relatedIssue: Promise<Issue> }).relatedIssue,
                  signal,
                );
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
          try: (signal) => withAbortSignal(client.deleteIssueRelation(relationToDelete.id), signal),
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
          try: (signal) =>
            withAbortSignal(
              client.createIssueRelation({
                issueId: taskId,
                relatedIssueId: relatedTaskId,
                type: LinearDocument.IssueRelationType.Related,
              }),
              signal,
            ),
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
          try: (signal) => withAbortSignal(client.issue(id), signal),
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
          try: (signal) => withAbortSignal(client.issue(id), signal),
          catch: (e) => new LinearApiError({ message: `Failed to fetch issue: ${e}`, cause: e }),
        });

        if (!issue) {
          return yield* Effect.fail(new TaskNotFoundError({ taskId: id }));
        }

        // Get current labels on the issue
        const currentLabels = yield* Effect.tryPromise({
          try: (signal) => withAbortSignal(issue.labels(), signal),
          catch: (e) =>
            new LinearApiError({ message: `Failed to fetch issue labels: ${e}`, cause: e }),
        });

        // Get the team to fetch team-level labels
        const team = yield* Effect.tryPromise({
          try: (signal) => withAbortSignal(issue.team!, signal),
          catch: (e) => new LinearApiError({ message: `Failed to fetch team: ${e}`, cause: e }),
        });

        const targetLabelName = `${SESSION_LABEL_PREFIX}${sessionId}`;

        // Get all labels in the workspace/team that start with "session:"
        const allLabels = yield* Effect.tryPromise({
          try: (signal) =>
            withAbortSignal(
              client.issueLabels({
                filter: {
                  name: { startsWith: SESSION_LABEL_PREFIX },
                },
              }),
              signal,
            ),
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
            try: (signal) =>
              withAbortSignal(
                client.createIssueLabel({
                  name: targetLabelName,
                  teamId: team.id,
                  color: "#6B7280", // Gray color for session labels
                  description: `OpenCode agent session ${sessionId}`,
                }),
                signal,
              ),
            catch: (e) =>
              new LinearApiError({ message: `Failed to create session label: ${e}`, cause: e }),
          });

          if (!createResult.success) {
            return yield* Effect.fail(new TaskError({ message: "Failed to create session label" }));
          }

          // Fetch the created label to get its ID
          const createdLabel = yield* Effect.tryPromise({
            try: async (signal) => {
              if (!createResult.issueLabel) throw new Error("Label not returned");
              return withAbortSignal(createResult.issueLabel, signal);
            },
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
          try: (signal) =>
            withAbortSignal(client.updateIssue(id, { labelIds: newLabelIds }), signal),
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
          try: (signal) => withAbortSignal(client.issue(id), signal),
          catch: (e) => new LinearApiError({ message: `Failed to fetch issue: ${e}`, cause: e }),
        });

        if (!issue) {
          return yield* Effect.fail(new TaskNotFoundError({ taskId: id }));
        }

        // Get current labels on the issue
        const currentLabels = yield* Effect.tryPromise({
          try: (signal) => withAbortSignal(issue.labels(), signal),
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
          try: (signal) =>
            withAbortSignal(client.updateIssue(id, { labelIds: nonSessionLabelIds }), signal),
          catch: (e) =>
            new LinearApiError({ message: `Failed to update issue labels: ${e}`, cause: e }),
        });

        if (!result.success) {
          return yield* Effect.fail(new TaskError({ message: "Failed to remove session label" }));
        }

        // For each session label, check if it's still in use and delete if not
        for (const sessionLabel of sessionLabels) {
          // Find issues using this label
          const issuesWithLabel = yield* Effect.tryPromise({
            try: (signal) =>
              withAbortSignal(
                client.issues({
                  filter: {
                    labels: { some: { id: { eq: sessionLabel.id } } },
                  },
                  first: 1, // We only need to know if at least one issue uses it
                }),
                signal,
              ),
            catch: (e) =>
              new LinearApiError({ message: `Failed to check label usage: ${e}`, cause: e }),
          });

          // If no issues use this label, delete it (non-fatal if this fails)
          if (issuesWithLabel.nodes.length === 0) {
            yield* Effect.tryPromise({
              try: (signal) => withAbortSignal(client.deleteIssueLabel(sessionLabel.id), signal),
              catch: (e) =>
                new LinearApiError({ message: `Failed to delete session label: ${e}`, cause: e }),
            }).pipe(Effect.ignore);
          }
        }
      }),
      "Clearing session label",
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
  };
});

export const IssueRepositoryLive = Layer.effect(IssueRepository, make);
