import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import {
  ShellService,
  ShipCommandError,
  makeShipService,
  createShellService,
} from "../src/services.js";

// =============================================================================
// Test Layer: Captures CLI commands for verification
// =============================================================================

/**
 * Creates a test layer that captures all commands sent to the shell.
 * This allows us to verify that ShipService constructs the correct CLI commands.
 *
 * @param commandsRef - Ref to store captured commands
 * @param responses - Map of command strings to mock responses
 * @param failOnUnmatchedCommand - If true, throw error for unrecognized commands (default: false for backward compat)
 */
const createTestShellLayer = (
  commandsRef: Ref.Ref<string[][]>,
  responses: Map<string, string> = new Map(),
  failOnUnmatchedCommand = false,
) =>
  Layer.succeed(ShellService, {
    run: (args: string[], _cwd?: string) =>
      Effect.gen(function* () {
        // Record the command
        yield* Ref.update(commandsRef, (cmds) => [...cmds, args]);

        // Return mock response if configured
        const key = args.join(" ");
        const response = responses.get(key);

        if (response !== undefined) {
          return response;
        }

        // Fail on unmatched command if strict mode is enabled
        if (failOnUnmatchedCommand) {
          return yield* new ShipCommandError({
            command: key,
            message: `Unmatched command in test: "${key}". Add it to the responses map.`,
          });
        }

        // Default: return empty JSON array (backward compatible)
        return "[]";
      }),
  });

/**
 * Creates a strict test layer that fails on unmatched commands.
 * This ensures tests explicitly define expected responses.
 */
const createStrictTestShellLayer = (
  commandsRef: Ref.Ref<string[][]>,
  responses: Map<string, string>,
) => createTestShellLayer(commandsRef, responses, true);

// =============================================================================
// ShipService Command Construction Tests
// =============================================================================

describe("ShipService", () => {
  describe("task commands use 'task' subcommand", () => {
    it.effect("getReadyTasks calls 'task ready --json'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const layer = createTestShellLayer(commandsRef);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.getReadyTasks();

        const commands = yield* Ref.get(commandsRef);
        expect(commands).toHaveLength(1);
        expect(commands[0]).toEqual(["task", "ready", "--json"]);
      }),
    );

    it.effect("getBlockedTasks calls 'task blocked --json'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const layer = createTestShellLayer(commandsRef);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.getBlockedTasks();

        const commands = yield* Ref.get(commandsRef);
        expect(commands).toHaveLength(1);
        expect(commands[0]).toEqual(["task", "blocked", "--json"]);
      }),
    );

    it.effect("listTasks calls 'task list --json' with filters", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const layer = createTestShellLayer(commandsRef);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.listTasks({ status: "in_progress", priority: "high", mine: true });

        const commands = yield* Ref.get(commandsRef);
        expect(commands).toHaveLength(1);
        expect(commands[0]).toEqual([
          "task",
          "list",
          "--json",
          "--status",
          "in_progress",
          "--priority",
          "high",
          "--mine",
        ]);
      }),
    );

    it.effect("listTasks calls 'task list --json' without filters when none provided", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const layer = createTestShellLayer(commandsRef);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.listTasks();

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["task", "list", "--json"]);
      }),
    );

    it.effect("getTask calls 'task show --json <taskId>'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const responses = new Map([["task show --json BRI-123", '{"identifier": "BRI-123"}']]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.getTask("BRI-123");

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["task", "show", "--json", "BRI-123"]);
      }),
    );

    it.effect("startTask calls 'task start <taskId>'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const layer = createTestShellLayer(commandsRef);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.startTask("BRI-456");

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["task", "start", "BRI-456"]);
      }),
    );

    it.effect("startTask includes session flag when sessionId provided", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const layer = createTestShellLayer(commandsRef);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.startTask("BRI-456", "session-123");

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["task", "start", "--session", "session-123", "BRI-456"]);
      }),
    );

    it.effect("completeTask calls 'task done <taskId>'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const layer = createTestShellLayer(commandsRef);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.completeTask("BRI-789");

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["task", "done", "BRI-789"]);
      }),
    );

    it.effect("createTask calls 'task create --json' with all options", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const responses = new Map([
          [
            "task create --json --description A description --priority high --parent BRI-100 New Task",
            '{"task": {"identifier": "BRI-101"}}',
          ],
        ]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.createTask({
          title: "New Task",
          description: "A description",
          priority: "high",
          parentId: "BRI-100",
        });

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual([
          "task",
          "create",
          "--json",
          "--description",
          "A description",
          "--priority",
          "high",
          "--parent",
          "BRI-100",
          "New Task",
        ]);
      }),
    );

    it.effect("updateTask calls 'task update --json' with provided fields", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const responses = new Map([
          [
            "task update --json --title Updated --status done BRI-123",
            '{"task": {"identifier": "BRI-123"}}',
          ],
        ]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.updateTask("BRI-123", { title: "Updated", status: "done" });

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual([
          "task",
          "update",
          "--json",
          "--title",
          "Updated",
          "--status",
          "done",
          "BRI-123",
        ]);
      }),
    );

    it.effect("addBlocker calls 'task block <blocker> <blocked>'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const layer = createTestShellLayer(commandsRef);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.addBlocker("BRI-1", "BRI-2");

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["task", "block", "BRI-1", "BRI-2"]);
      }),
    );

    it.effect("removeBlocker calls 'task unblock <blocker> <blocked>'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const layer = createTestShellLayer(commandsRef);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.removeBlocker("BRI-1", "BRI-2");

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["task", "unblock", "BRI-1", "BRI-2"]);
      }),
    );

    it.effect("relateTask calls 'task relate <taskId> <relatedId>'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const layer = createTestShellLayer(commandsRef);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.relateTask("BRI-1", "BRI-2");

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["task", "relate", "BRI-1", "BRI-2"]);
      }),
    );
  });

  describe("stack commands use 'stack' subcommand", () => {
    it.effect("getStackLog calls 'stack log --json'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const layer = createTestShellLayer(commandsRef);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.getStackLog();

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["stack", "log", "--json"]);
      }),
    );

    it.effect("getStackStatus calls 'stack status --json'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const responses = new Map([["stack status --json", '{"isRepo": true}']]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.getStackStatus();

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["stack", "status", "--json"]);
      }),
    );

    it.effect("syncStack calls 'stack sync --json'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const responses = new Map([["stack sync --json", '{"fetched": true, "rebased": false}']]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.syncStack();

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["stack", "sync", "--json"]);
      }),
    );

    it.effect("submitStack calls 'stack submit --json' with options", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const responses = new Map([
          ["stack submit --json --draft --title PR Title", '{"pushed": true}'],
        ]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.submitStack({ draft: true, title: "PR Title" });

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["stack", "submit", "--json", "--draft", "--title", "PR Title"]);
      }),
    );
  });

  describe("milestone commands use 'milestone' subcommand", () => {
    it.effect("listMilestones calls 'milestone list --json'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const layer = createTestShellLayer(commandsRef);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.listMilestones();

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["milestone", "list", "--json"]);
      }),
    );

    it.effect("createMilestone calls 'milestone create --json' with options", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const responses = new Map([
          [
            "milestone create --json --description A milestone --target-date 2024-12-31 Q4 Release",
            '{"milestone": {"id": "123", "name": "Q4 Release"}}',
          ],
        ]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.createMilestone({
          name: "Q4 Release",
          description: "A milestone",
          targetDate: "2024-12-31",
        });

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual([
          "milestone",
          "create",
          "--json",
          "--description",
          "A milestone",
          "--target-date",
          "2024-12-31",
          "Q4 Release",
        ]);
      }),
    );
  });

  describe("status command does not use subcommand", () => {
    it.effect("checkConfigured calls 'status --json'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const responses = new Map([["status --json", '{"configured": true}']]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.checkConfigured();

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["status", "--json"]);
      }),
    );
  });

  describe("pr commands use 'pr' subcommand", () => {
    it.effect("getPrReviews calls 'pr reviews --json'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const responses = new Map([
          [
            "pr reviews --json",
            '{"prNumber": 123, "reviews": [], "codeComments": [], "conversationComments": [], "commentsByFile": {}}',
          ],
        ]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.getPrReviews();

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["pr", "reviews", "--json"]);
      }),
    );

    it.effect("getPrReviews calls 'pr reviews --json' with prNumber", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const responses = new Map([
          [
            "pr reviews --json 456",
            '{"prNumber": 456, "reviews": [], "codeComments": [], "conversationComments": [], "commentsByFile": {}}',
          ],
        ]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.getPrReviews(456);

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["pr", "reviews", "--json", "456"]);
      }),
    );

    it.effect("getPrReviews calls 'pr reviews --json --unresolved' with unresolved flag", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const responses = new Map([
          [
            "pr reviews --json --unresolved",
            '{"prNumber": 123, "reviews": [], "codeComments": [], "conversationComments": [], "commentsByFile": {}}',
          ],
        ]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.getPrReviews(undefined, true);

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["pr", "reviews", "--json", "--unresolved"]);
      }),
    );

    it.effect("getPrReviews calls with all options", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const responses = new Map([
          [
            "pr reviews --json --unresolved 789",
            '{"prNumber": 789, "reviews": [], "codeComments": [], "conversationComments": [], "commentsByFile": {}}',
          ],
        ]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.getPrReviews(789, true);

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["pr", "reviews", "--json", "--unresolved", "789"]);
      }),
    );

    it.effect("getPrReviews parses response with reviews and comments", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const mockResponse = {
          prNumber: 123,
          prTitle: "Test PR",
          prUrl: "https://github.com/test/repo/pull/123",
          reviews: [
            {
              id: 1,
              author: "reviewer",
              state: "APPROVED",
              body: "LGTM",
              submittedAt: "2024-01-01T00:00:00Z",
            },
          ],
          codeComments: [
            {
              id: 2,
              path: "src/file.ts",
              line: 10,
              body: "Consider renaming",
              author: "reviewer",
              createdAt: "2024-01-01T00:00:00Z",
              inReplyToId: null,
            },
          ],
          conversationComments: [
            {
              id: 3,
              body: "Great work!",
              author: "commenter",
              createdAt: "2024-01-01T00:00:00Z",
            },
          ],
          commentsByFile: {
            "src/file.ts": [
              {
                line: 10,
                author: "reviewer",
                body: "Consider renaming",
                id: 2,
              },
            ],
          },
        };
        const responses = new Map([["pr reviews --json", JSON.stringify(mockResponse)]]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        const result = yield* shipService.getPrReviews();

        expect(result.prNumber).toBe(123);
        expect(result.prTitle).toBe("Test PR");
        expect(result.reviews).toHaveLength(1);
        expect(result.reviews[0].state).toBe("APPROVED");
        expect(result.codeComments).toHaveLength(1);
        expect(result.codeComments[0].path).toBe("src/file.ts");
        expect(result.conversationComments).toHaveLength(1);
        expect(Object.keys(result.commentsByFile)).toHaveLength(1);
      }),
    );
  });

  describe("webhook commands use 'webhook' subcommand", () => {
    it.effect("getDaemonStatus calls 'webhook status --json'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const responses = new Map([["webhook status --json", '{"running": false}']]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.getDaemonStatus();

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["webhook", "status", "--json"]);
      }),
    );

    it.effect("subscribeToPRs calls 'webhook subscribe --json' with options", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const responses = new Map([
          ["webhook subscribe --json --session sess-123 1,2,3", '{"subscribed": true}'],
        ]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.subscribeToPRs("sess-123", [1, 2, 3]);

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual([
          "webhook",
          "subscribe",
          "--json",
          "--session",
          "sess-123",
          "1,2,3",
        ]);
      }),
    );
  });

  describe("task milestone commands use 'task update'", () => {
    it.effect("setTaskMilestone calls 'task update --json --milestone'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const responses = new Map([
          [
            "task update --json --milestone milestone-123 BRI-456",
            '{"task": {"identifier": "BRI-456"}}',
          ],
        ]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.setTaskMilestone("BRI-456", "milestone-123");

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual([
          "task",
          "update",
          "--json",
          "--milestone",
          "milestone-123",
          "BRI-456",
        ]);
      }),
    );

    it.effect("unsetTaskMilestone calls 'task update --json --milestone \"\"'", () =>
      Effect.gen(function* () {
        const commandsRef = yield* Ref.make<string[][]>([]);
        const responses = new Map([
          ["task update --json --milestone  BRI-456", '{"task": {"identifier": "BRI-456"}}'],
        ]);
        const layer = createTestShellLayer(commandsRef, responses);

        const shipService = yield* makeShipService.pipe(Effect.provide(layer));
        yield* shipService.unsetTaskMilestone("BRI-456");

        const commands = yield* Ref.get(commandsRef);
        expect(commands[0]).toEqual(["task", "update", "--json", "--milestone", "", "BRI-456"]);
      }),
    );
  });
});

// =============================================================================
// createShellService Integration Tests
// =============================================================================

describe("createShellService", () => {
  describe("JSON extraction integration", () => {
    it.effect("extracts JSON when --json flag is present", () =>
      Effect.gen(function* () {
        // Simulate CLI output with pnpm prefix
        const mockExecute = (_args: string[], _cwd?: string) =>
          Effect.succeed(`> ship-monorepo@ ship /path
> tsx packages/cli/src/bin.ts task ready --json

[{"id": "123", "title": "Test"}]`);

        const shellService = createShellService(mockExecute);
        const result = yield* shellService.run(["task", "ready", "--json"]);

        // Should have extracted just the JSON
        expect(result).toBe('[{"id": "123", "title": "Test"}]');
        expect(JSON.parse(result)).toEqual([{ id: "123", title: "Test" }]);
      }),
    );

    it.effect("returns raw output when --json flag is absent", () =>
      Effect.gen(function* () {
        const mockExecute = (_args: string[], _cwd?: string) =>
          Effect.succeed("Task started successfully");

        const shellService = createShellService(mockExecute);
        const result = yield* shellService.run(["task", "start", "BRI-123"]);

        expect(result).toBe("Task started successfully");
      }),
    );

    it.effect("handles spinner output before JSON", () =>
      Effect.gen(function* () {
        const mockExecute = (_args: string[], _cwd?: string) =>
          Effect.succeed(`Loading...
Fetching tasks...
{"configured": true, "teamKey": "TEAM"}`);

        const shellService = createShellService(mockExecute);
        const result = yield* shellService.run(["status", "--json"]);

        expect(JSON.parse(result)).toEqual({ configured: true, teamKey: "TEAM" });
      }),
    );

    it.effect("propagates ShipCommandError from execute function", () =>
      Effect.gen(function* () {
        const mockExecute = (_args: string[], _cwd?: string) =>
          Effect.fail(
            new ShipCommandError({
              command: "task ready --json",
              message: "Not configured",
            }),
          );

        const shellService = createShellService(mockExecute);
        const result = yield* Effect.exit(shellService.run(["task", "ready", "--json"]));

        expect(result._tag).toBe("Failure");
      }),
    );
  });
});

// =============================================================================
// Strict Mode Tests (fail on unmatched commands)
// =============================================================================

describe("Strict test layer", () => {
  it.effect("fails when command is not in responses map", () =>
    Effect.gen(function* () {
      const commandsRef = yield* Ref.make<string[][]>([]);
      const responses = new Map<string, string>(); // Empty - no commands matched
      const layer = createStrictTestShellLayer(commandsRef, responses);

      const shipService = yield* makeShipService.pipe(Effect.provide(layer));
      const result = yield* Effect.exit(shipService.getReadyTasks());

      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("succeeds when command is in responses map", () =>
    Effect.gen(function* () {
      const commandsRef = yield* Ref.make<string[][]>([]);
      const responses = new Map([["task ready --json", "[]"]]);
      const layer = createStrictTestShellLayer(commandsRef, responses);

      const shipService = yield* makeShipService.pipe(Effect.provide(layer));
      const tasks = yield* shipService.getReadyTasks();

      expect(tasks).toEqual([]);
    }),
  );
});
