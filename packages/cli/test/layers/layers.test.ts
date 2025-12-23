/**
 * Tests for Test Layer implementations
 *
 * These tests verify that the test layers work correctly and can be used
 * to test service implementations. Each test layer should:
 * - Provide configurable initial state
 * - Allow failure simulation
 * - Track method calls
 * - Expose internal state for assertions
 */

import { describe, it, expect } from "@effect/vitest";
import { Effect, Exit, Cause, Option } from "effect";

import { VcsService } from "../../src/ports/VcsService.js";
import { IssueRepository } from "../../src/ports/IssueRepository.js";
import { ConfigRepository } from "../../src/ports/ConfigRepository.js";
import { PrService, CreatePrInput } from "../../src/ports/PrService.js";
import { WebhookService, CreateCliWebhookInput } from "../../src/ports/WebhookService.js";
import { DaemonService } from "../../src/ports/DaemonService.js";
import { TemplateService } from "../../src/ports/TemplateService.js";
import { TaskId } from "../../src/domain/Task.js";
import { WebhookPermissionError } from "../../src/domain/Errors.js";

import {
  TestVcsServiceLayer,
  TestIssueRepositoryLayer,
  TestConfigRepositoryLayer,
  TestPrServiceLayer,
  TestWebhookServiceLayer,
  TestDaemonServiceLayer,
  TestTemplateServiceLayer,
} from "./index.js";

describe("Test Layers", () => {
  describe("TestVcsServiceLayer", () => {
    it.effect("should provide default state", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const isRepo = yield* vcs.isRepo();
        expect(isRepo).toBe(true);
      }).pipe(Effect.provide(TestVcsServiceLayer())),
    );

    it.effect("should fail with NotARepoError when isRepo is false", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const result = yield* vcs.createChange("test").pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const error = Cause.failureOption(result.cause);
          expect(Option.isSome(error)).toBe(true);
          if (Option.isSome(error)) {
            expect(error.value._tag).toBe("NotARepoError");
          }
        }
      }).pipe(Effect.provide(TestVcsServiceLayer({ isRepo: false }))),
    );

    it.effect("should report jj not available", () =>
      Effect.gen(function* () {
        const vcs = yield* VcsService;
        const isAvailable = yield* vcs.isAvailable();
        expect(isAvailable).toBe(false);
      }).pipe(Effect.provide(TestVcsServiceLayer({ isAvailable: false }))),
    );
  });

  describe("TestIssueRepositoryLayer", () => {
    it.effect("should provide default task", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const task = yield* repo.getTask("test-task-id" as TaskId);
        expect(task.identifier).toBe("TEST-123");
      }).pipe(Effect.provide(TestIssueRepositoryLayer())),
    );

    it.effect("should fail with TaskNotFoundError for unknown task", () =>
      Effect.gen(function* () {
        const repo = yield* IssueRepository;
        const result = yield* repo.getTask("unknown" as TaskId).pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const error = Cause.failureOption(result.cause);
          expect(Option.isSome(error)).toBe(true);
          if (Option.isSome(error)) {
            expect(error.value._tag).toBe("TaskNotFoundError");
          }
        }
      }).pipe(Effect.provide(TestIssueRepositoryLayer({ tasks: new Map() }))),
    );
  });

  describe("TestConfigRepositoryLayer", () => {
    it.effect("should load config when initialized", () =>
      Effect.gen(function* () {
        const repo = yield* ConfigRepository;
        const config = yield* repo.load();
        expect(config.linear.teamKey).toBe("TEST");
      }).pipe(Effect.provide(TestConfigRepositoryLayer())),
    );

    it.effect("should fail when workspace not initialized", () =>
      Effect.gen(function* () {
        const repo = yield* ConfigRepository;
        const result = yield* repo.load().pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const error = Cause.failureOption(result.cause);
          expect(Option.isSome(error)).toBe(true);
          if (Option.isSome(error)) {
            expect(error.value._tag).toBe("WorkspaceNotInitializedError");
          }
        }
      }).pipe(Effect.provide(TestConfigRepositoryLayer({ exists: false, config: null }))),
    );
  });

  describe("TestPrServiceLayer", () => {
    it.effect("should create PR successfully", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const result = yield* pr.createPr(
          new CreatePrInput({
            title: "Test PR",
            body: "Test body",
            head: "feature-test",
            base: "main",
          }),
        );
        expect(result.title).toBe("Test PR");
        expect(result.number).toBe(2); // First available number
      }).pipe(Effect.provide(TestPrServiceLayer())),
    );

    it.effect("should fail when gh not installed", () =>
      Effect.gen(function* () {
        const pr = yield* PrService;
        const result = yield* pr
          .createPr(
            new CreatePrInput({
              title: "Test",
              body: "Test",
              head: "test",
            }),
          )
          .pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const error = Cause.failureOption(result.cause);
          expect(Option.isSome(error)).toBe(true);
          if (Option.isSome(error)) {
            expect(error.value._tag).toBe("GhNotInstalledError");
          }
        }
      }).pipe(Effect.provide(TestPrServiceLayer({ ghInstalled: false }))),
    );
  });

  describe("TestWebhookServiceLayer", () => {
    it.effect("should create webhook successfully", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const result = yield* webhook.createCliWebhook(
          new CreateCliWebhookInput({
            repo: "owner/repo",
            events: ["pull_request"],
          }),
        );
        expect(result.events).toContain("pull_request");
        expect(result.active).toBe(true);
      }).pipe(Effect.provide(TestWebhookServiceLayer())),
    );

    it.effect("should fail with permission error when configured", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const result = yield* webhook
          .createCliWebhook(
            new CreateCliWebhookInput({
              repo: "owner/repo",
              events: ["pull_request"],
            }),
          )
          .pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const error = Cause.failureOption(result.cause);
          expect(Option.isSome(error)).toBe(true);
          if (Option.isSome(error)) {
            expect(error.value._tag).toBe("WebhookPermissionError");
          }
        }
      }).pipe(
        Effect.provide(
          TestWebhookServiceLayer({
            permissionErrors: new Map([
              ["owner/repo", WebhookPermissionError.forRepo("owner/repo")],
            ]),
          }),
        ),
      ),
    );
  });

  describe("TestDaemonServiceLayer", () => {
    it.effect("should report running status", () =>
      Effect.gen(function* () {
        const daemon = yield* DaemonService;
        const isRunning = yield* daemon.isRunning();
        expect(isRunning).toBe(true);
      }).pipe(Effect.provide(TestDaemonServiceLayer())),
    );

    it.effect("should fail when daemon not running", () =>
      Effect.gen(function* () {
        const daemon = yield* DaemonService;
        const result = yield* daemon.getStatus().pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const error = Cause.failureOption(result.cause);
          expect(Option.isSome(error)).toBe(true);
          if (Option.isSome(error)) {
            expect(error.value._tag).toBe("DaemonNotRunningError");
          }
        }
      }).pipe(Effect.provide(TestDaemonServiceLayer({ running: false }))),
    );
  });

  describe("TestTemplateServiceLayer", () => {
    it.effect("should return default templates", () =>
      Effect.gen(function* () {
        const template = yield* TemplateService;
        const templates = yield* template.listTemplates();
        expect(templates.length).toBeGreaterThan(0);
        expect(templates.some((t) => t.name === "bug")).toBe(true);
      }).pipe(Effect.provide(TestTemplateServiceLayer())),
    );

    it.effect("should fail with TemplateNotFoundError for unknown template", () =>
      Effect.gen(function* () {
        const template = yield* TemplateService;
        const result = yield* template.getTemplate("unknown").pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const error = Cause.failureOption(result.cause);
          expect(Option.isSome(error)).toBe(true);
          if (Option.isSome(error)) {
            expect(error.value._tag).toBe("TemplateNotFoundError");
          }
        }
      }).pipe(Effect.provide(TestTemplateServiceLayer({ templates: new Map() }))),
    );
  });
});
