import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import { AuthConfig } from "../../../domain/Config.js";
import { AuthError, ConfigError, NotAuthenticatedError } from "../../../domain/Errors.js";
import { AuthService } from "../../../ports/AuthService.js";
import { ConfigRepository } from "../../../ports/ConfigRepository.js";

const LINEAR_API_URL = "https://api.linear.app/graphql";

const make = Effect.gen(function* () {
  const config = yield* ConfigRepository;

  const validateApiKey = (apiKey: string): Effect.Effect<boolean, AuthError> =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;

      // Simple query to validate the token
      const query = `{ viewer { id name } }`;

      const request = HttpClientRequest.post(LINEAR_API_URL).pipe(
        HttpClientRequest.setHeader("Content-Type", "application/json"),
        HttpClientRequest.setHeader("Authorization", apiKey),
        HttpClientRequest.bodyJson({ query }),
      );

      const response = yield* request.pipe(
        Effect.flatMap((req) => client.execute(req)),
        Effect.flatMap((res) => res.json),
        Effect.catchAll((e) =>
          Effect.fail(new AuthError({ message: `Failed to validate API key: ${e}`, cause: e })),
        ),
      );

      const data = response as {
        data?: { viewer?: { id: string } };
        errors?: Array<{ message: string }>;
      };

      if (data.errors && data.errors.length > 0) {
        return false;
      }

      return !!data.data?.viewer?.id;
    }).pipe(Effect.provide(FetchHttpClient.layer));

  const saveApiKey = (apiKey: string): Effect.Effect<AuthConfig, AuthError> =>
    Effect.gen(function* () {
      const isValid = yield* validateApiKey(apiKey);

      if (!isValid) {
        return yield* Effect.fail(
          new AuthError({ message: "Invalid API key. Please check and try again." }),
        );
      }

      const auth = new AuthConfig({ apiKey });

      yield* config
        .saveAuth(auth)
        .pipe(
          Effect.mapError(
            (e) => new AuthError({ message: `Failed to save API key: ${e.message}`, cause: e }),
          ),
        );

      // Ensure .ship is in .gitignore (API key is sensitive)
      yield* config
        .ensureGitignore()
        .pipe(
          Effect.mapError(
            (e) =>
              new AuthError({ message: `Failed to update .gitignore: ${e.message}`, cause: e }),
          ),
        );

      return auth;
    });

  const getApiKey = (): Effect.Effect<string, NotAuthenticatedError | ConfigError> =>
    Effect.gen(function* () {
      const cfg = yield* config.loadPartial();

      if (Option.isNone(cfg.auth)) {
        return yield* Effect.fail(
          new NotAuthenticatedError({ message: "Not authenticated. Run 'ship login' first." }),
        );
      }

      return cfg.auth.value.apiKey;
    });

  const logout = (): Effect.Effect<void, never> =>
    config.delete().pipe(
      Effect.tapError((e) =>
        Effect.logWarning(`Failed to delete config during logout: ${e.message}`),
      ),
      Effect.ignore,
    );

  const isAuthenticated = (): Effect.Effect<boolean, never> =>
    Effect.gen(function* () {
      const cfg = yield* config.loadPartial();
      return Option.isSome(cfg.auth);
    }).pipe(
      // Config errors mean we can't determine auth status - log and return false
      Effect.catchTag("ConfigError", (e) =>
        Effect.logWarning(`Error checking authentication: ${e.message}`).pipe(
          Effect.map(() => false),
        ),
      ),
    );

  return {
    saveApiKey,
    validateApiKey,
    getApiKey,
    logout,
    isAuthenticated,
  };
});

export const AuthServiceLive = Layer.effect(AuthService, make);
