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
} from "../../../domain/Task.js";
import { LinearApiError, TaskError, TaskNotFoundError } from "../../../domain/Errors.js";
import { mapIssueToTask, priorityToLinear, statusToLinearStateType } from "./Mapper.js";

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

        return yield* Effect.tryPromise({
          try: (signal) => withAbortSignal(mapIssueToTask(issue), signal),
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
          const stateType = statusToLinearStateType(filter.status.value);
          linearFilter.state = { type: { eq: stateType } };
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
  };
});

export const IssueRepositoryLive = Layer.effect(IssueRepository, make);
