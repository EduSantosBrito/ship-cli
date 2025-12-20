import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type { AuthConfig } from "../domain/Config.js";
import type { AuthError, ConfigError, NotAuthenticatedError } from "../domain/Errors.js";

export interface AuthService {
  /** Save API key after user pastes it */
  readonly saveApiKey: (apiKey: string) => Effect.Effect<AuthConfig, AuthError>;
  /** Validate an API key by making a test request */
  readonly validateApiKey: (apiKey: string) => Effect.Effect<boolean, AuthError>;
  /** Get the stored API key - may fail if config is corrupted */
  readonly getApiKey: () => Effect.Effect<string, NotAuthenticatedError | ConfigError>;
  /** Remove stored credentials */
  readonly logout: () => Effect.Effect<void, never>;
  /** Check if we have stored credentials */
  readonly isAuthenticated: () => Effect.Effect<boolean, never>;
}

export const AuthService = Context.GenericTag<AuthService>("AuthService");
