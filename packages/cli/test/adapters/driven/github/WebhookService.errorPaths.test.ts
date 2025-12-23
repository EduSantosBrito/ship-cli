/**
 * WebhookService Error Path Tests
 *
 * Tests all error paths in WebhookService using the TestWebhookServiceLayer.
 * Each error type is tested with at least one scenario that:
 * 1. Triggers the error condition via test layer configuration
 * 2. Verifies error `_tag`
 * 3. Verifies error message/context properties
 */

import { describe, it, expect } from "@effect/vitest";
import { Effect, Exit, Cause, Option, Stream, Chunk } from "effect";

import {
  WebhookService,
  CreateCliWebhookInput,
  WebhookId,
} from "../../../../src/ports/WebhookService.js";
import {
  GhNotInstalledError,
  GhNotAuthenticatedError,
  WebhookError,
  WebhookConnectionError,
  WebhookPermissionError,
  WebhookAlreadyExistsError,
  WebhookRateLimitError,
} from "../../../../src/domain/Errors.js";
import { TestWebhookServiceLayer, createTestEvent } from "../../../layers/index.js";

// Helper to extract failure from Exit
const getFailure = <E>(exit: Exit.Exit<unknown, E>): E | null => {
  if (Exit.isFailure(exit)) {
    const option = Cause.failureOption(exit.cause);
    return Option.isSome(option) ? option.value : null;
  }
  return null;
};

describe("WebhookService Error Paths", () => {
  describe("GhNotInstalledError", () => {
    it.effect("createCliWebhook fails with GhNotInstalledError when gh not installed", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const exit = yield* webhook
          .createCliWebhook(
            new CreateCliWebhookInput({
              repo: "owner/repo",
              events: ["pull_request"],
            }),
          )
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("GhNotInstalledError");
        expect((error as GhNotInstalledError).message).toContain("gh CLI is not installed");
      }).pipe(Effect.provide(TestWebhookServiceLayer({ ghInstalled: false }))),
    );

    it.effect("activateWebhook fails with GhNotInstalledError when gh not installed", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const exit = yield* webhook.activateWebhook("owner/repo", 1 as WebhookId).pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("GhNotInstalledError");
      }).pipe(Effect.provide(TestWebhookServiceLayer({ ghInstalled: false }))),
    );

    it.effect("deactivateWebhook fails with GhNotInstalledError when gh not installed", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const exit = yield* webhook.deactivateWebhook("owner/repo", 1 as WebhookId).pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("GhNotInstalledError");
      }).pipe(Effect.provide(TestWebhookServiceLayer({ ghInstalled: false }))),
    );

    it.effect("deleteWebhook fails with GhNotInstalledError when gh not installed", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const exit = yield* webhook.deleteWebhook("owner/repo", 1 as WebhookId).pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("GhNotInstalledError");
      }).pipe(Effect.provide(TestWebhookServiceLayer({ ghInstalled: false }))),
    );

    it.effect("listWebhooks fails with GhNotInstalledError when gh not installed", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const exit = yield* webhook.listWebhooks("owner/repo").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("GhNotInstalledError");
      }).pipe(Effect.provide(TestWebhookServiceLayer({ ghInstalled: false }))),
    );
  });

  describe("GhNotAuthenticatedError", () => {
    it.effect("createCliWebhook fails with GhNotAuthenticatedError when not authenticated", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const exit = yield* webhook
          .createCliWebhook(
            new CreateCliWebhookInput({
              repo: "owner/repo",
              events: ["pull_request"],
            }),
          )
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("GhNotAuthenticatedError");
        expect((error as GhNotAuthenticatedError).message).toContain("not authenticated");
      }).pipe(Effect.provide(TestWebhookServiceLayer({ ghAuthenticated: false }))),
    );

    it.effect("listWebhooks fails with GhNotAuthenticatedError when not authenticated", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const exit = yield* webhook.listWebhooks("owner/repo").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("GhNotAuthenticatedError");
      }).pipe(Effect.provide(TestWebhookServiceLayer({ ghAuthenticated: false }))),
    );
  });

  describe("WebhookPermissionError", () => {
    it.effect("createCliWebhook fails with WebhookPermissionError for configured repo", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const exit = yield* webhook
          .createCliWebhook(
            new CreateCliWebhookInput({
              repo: "owner/repo",
              events: ["pull_request"],
            }),
          )
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("WebhookPermissionError");
        expect((error as WebhookPermissionError).message).toContain("owner/repo");
        expect((error as WebhookPermissionError).repo).toBe("owner/repo");
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

    it.effect("createCliWebhook succeeds for repos without permission errors", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const result = yield* webhook.createCliWebhook(
          new CreateCliWebhookInput({
            repo: "other/repo",
            events: ["pull_request"],
          }),
        );
        expect(result.events).toContain("pull_request");
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

  describe("WebhookAlreadyExistsError", () => {
    it.effect("createCliWebhook fails with WebhookAlreadyExistsError when creating second webhook for same repo", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        // First creation should succeed
        yield* webhook.createCliWebhook(
          new CreateCliWebhookInput({
            repo: "owner/repo",
            events: ["pull_request"],
          }),
        );
        // Second creation should fail with WebhookAlreadyExistsError
        const exit = yield* webhook
          .createCliWebhook(
            new CreateCliWebhookInput({
              repo: "owner/repo",
              events: ["issue_comment"],
            }),
          )
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("WebhookAlreadyExistsError");
        expect((error as WebhookAlreadyExistsError).message).toContain("owner/repo");
      }).pipe(Effect.provide(TestWebhookServiceLayer())),
    );
  });

  describe("WebhookRateLimitError", () => {
    it.effect("createCliWebhook fails with WebhookRateLimitError when rate limited", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const exit = yield* webhook
          .createCliWebhook(
            new CreateCliWebhookInput({
              repo: "owner/repo",
              events: ["pull_request"],
            }),
          )
          .pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("WebhookRateLimitError");
        expect((error as WebhookRateLimitError).message).toContain("rate limit");
        expect((error as WebhookRateLimitError).retryAfter).toBe(60);
      }).pipe(
        Effect.provide(
          TestWebhookServiceLayer({
            rateLimitError: WebhookRateLimitError.fromHeaders(60),
          }),
        ),
      ),
    );
  });

  describe("WebhookError (global)", () => {
    it.effect("operations fail with global WebhookError when configured", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const exit = yield* webhook.listWebhooks("owner/repo").pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("WebhookError");
        expect((error as WebhookError).message).toContain("service unavailable");
      }).pipe(
        Effect.provide(
          TestWebhookServiceLayer({
            globalError: new WebhookError({ message: "GitHub service unavailable" }),
          }),
        ),
      ),
    );
  });

  describe("WebhookConnectionError", () => {
    it.effect("connectAndStream fails with WebhookConnectionError when connection fails", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const stream = webhook.connectAndStream("wss://test.github.com/webhook/1");
        const exit = yield* Stream.runCollect(stream).pipe(Effect.exit);

        const error = getFailure(exit);
        expect(error).not.toBeNull();
        expect(error!._tag).toBe("WebhookConnectionError");
        expect((error as WebhookConnectionError).message).toContain("connection refused");
        expect((error as WebhookConnectionError).wsUrl).toBe("wss://test.github.com/failed");
      }).pipe(
        Effect.provide(
          TestWebhookServiceLayer({
            connectionError: new WebhookConnectionError({
              message: "WebSocket connection refused",
              wsUrl: "wss://test.github.com/failed",
            }),
          }),
        ),
      ),
    );
  });

  describe("Success paths (sanity checks)", () => {
    it.effect("createCliWebhook creates and returns webhook", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const result = yield* webhook.createCliWebhook(
          new CreateCliWebhookInput({
            repo: "owner/repo",
            events: ["pull_request", "issue_comment"],
          }),
        );
        expect(result.events).toContain("pull_request");
        expect(result.events).toContain("issue_comment");
        expect(result.active).toBe(true);
        expect(result.wsUrl).toContain("wss://");
      }).pipe(Effect.provide(TestWebhookServiceLayer())),
    );

    it.effect("activateWebhook activates webhook", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        // Create a webhook first
        const created = yield* webhook.createCliWebhook(
          new CreateCliWebhookInput({
            repo: "owner/repo",
            events: ["pull_request"],
          }),
        );
        // Deactivate and reactivate
        yield* webhook.deactivateWebhook("owner/repo", created.id);
        yield* webhook.activateWebhook("owner/repo", created.id);
        // No error = success
      }).pipe(Effect.provide(TestWebhookServiceLayer())),
    );

    it.effect("deactivateWebhook deactivates webhook", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        // Create a webhook first
        const created = yield* webhook.createCliWebhook(
          new CreateCliWebhookInput({
            repo: "owner/repo",
            events: ["pull_request"],
          }),
        );
        yield* webhook.deactivateWebhook("owner/repo", created.id);
        // No error = success
      }).pipe(Effect.provide(TestWebhookServiceLayer())),
    );

    it.effect("deleteWebhook removes webhook", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        // Create a webhook first
        const created = yield* webhook.createCliWebhook(
          new CreateCliWebhookInput({
            repo: "owner/repo",
            events: ["pull_request"],
          }),
        );
        yield* webhook.deleteWebhook("owner/repo", created.id);
        // Verify it's gone
        const webhooks = yield* webhook.listWebhooks("owner/repo");
        expect(webhooks.length).toBe(0);
      }).pipe(Effect.provide(TestWebhookServiceLayer())),
    );

    it.effect("listWebhooks returns webhooks for repo", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        // Create a webhook first
        const created = yield* webhook.createCliWebhook(
          new CreateCliWebhookInput({
            repo: "owner/repo",
            events: ["pull_request"],
          }),
        );
        // List should return the created webhook
        const webhooks = yield* webhook.listWebhooks("owner/repo");
        expect(webhooks.length).toBe(1);
        expect(webhooks[0].id).toBe(created.id);
      }).pipe(Effect.provide(TestWebhookServiceLayer())),
    );

    it.effect("listWebhooks returns empty array when no webhooks", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const webhooks = yield* webhook.listWebhooks("owner/repo");
        expect(webhooks).toEqual([]);
      }).pipe(Effect.provide(TestWebhookServiceLayer())),
    );

    it.effect("connectAndStream returns queued events", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const stream = webhook.connectAndStream("wss://test.github.com/webhook/1");
        const events = yield* Stream.runCollect(stream);
        expect(Chunk.toArray(events).length).toBe(2);
        expect(Chunk.toArray(events)[0].event).toBe("pull_request");
        expect(Chunk.toArray(events)[1].event).toBe("issue_comment");
      }).pipe(
        Effect.provide(
          TestWebhookServiceLayer({
            eventQueue: [
              createTestEvent({ event: "pull_request", action: "opened" }),
              createTestEvent({ event: "issue_comment", action: "created" }),
            ],
          }),
        ),
      ),
    );

    it.effect("connectAndStream returns empty stream when no events", () =>
      Effect.gen(function* () {
        const webhook = yield* WebhookService;
        const stream = webhook.connectAndStream("wss://test.github.com/webhook/1");
        const events = yield* Stream.runCollect(stream);
        expect(Chunk.toArray(events)).toEqual([]);
      }).pipe(Effect.provide(TestWebhookServiceLayer())),
    );
  });
});
