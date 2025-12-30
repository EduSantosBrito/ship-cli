import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { LinearClient as LinearSDK } from "@linear/sdk";
import { AuthService } from "../../../ports/AuthService.js";
import { LinearApiError } from "../../../domain/Errors.js";

export interface LinearClientService {
  readonly client: () => Effect.Effect<LinearSDK, LinearApiError>;
}

export const LinearClientService = Context.GenericTag<LinearClientService>(
  "LinearClientService",
);

const make = Effect.gen(function* () {
  const auth = yield* AuthService;

  const client = (): Effect.Effect<LinearSDK, LinearApiError> =>
    Effect.gen(function* () {
      const apiKey = yield* auth.getApiKey().pipe(
        Effect.mapError(
          (e) =>
            new LinearApiError({
              message: `Authentication required: ${e.message}`,
            }),
        ),
      );

      return new LinearSDK({ apiKey });
    });

  return { client };
});

export const LinearClientLive = Layer.effect(LinearClientService, make);
