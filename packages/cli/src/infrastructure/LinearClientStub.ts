import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { LinearClientService } from "../adapters/driven/linear/LinearClient.js";
import { LinearApiError } from "../domain/Errors.js";

/**
 * Stub implementation of LinearClientService for non-Linear providers.
 *
 * This is used for Notion, which doesn't use the Linear API.
 * All operations fail with clear errors explaining that Linear is not configured.
 *
 * Note: The `task start` command currently uses LinearClientService directly
 * to get the current user for auto-assignment. This should eventually be
 * refactored to use a provider-agnostic user service.
 */
const make = Effect.succeed({
  client: () =>
    Effect.fail(
      new LinearApiError({
        message:
          "Linear is not configured. The current provider is Notion. " +
          "Some features like auto-assignment require Linear.",
      }),
    ),
});

/**
 * Stub layer for LinearClientService.
 * Provides a minimal implementation that fails with clear errors.
 */
export const LinearClientStub = Layer.effect(LinearClientService, make);
