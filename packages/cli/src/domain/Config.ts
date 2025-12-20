import * as Schema from "effect/Schema";
import { ProjectId, TeamId } from "./Task.js";

// Personal API key from https://linear.app/settings/api
export class AuthConfig extends Schema.Class<AuthConfig>("AuthConfig")({
  apiKey: Schema.String,
}) {}

export class LinearConfig extends Schema.Class<LinearConfig>("LinearConfig")({
  teamId: TeamId,
  teamKey: Schema.String,
  projectId: Schema.OptionFromNullOr(ProjectId),
}) {}

export class GitConfig extends Schema.Class<GitConfig>("GitConfig")({
  defaultBranch: Schema.optionalWith(Schema.String, { default: () => "main" }),
}) {}

export class PrConfig extends Schema.Class<PrConfig>("PrConfig")({
  openBrowser: Schema.optionalWith(Schema.Boolean, { default: () => true }),
}) {}

export class CommitConfig extends Schema.Class<CommitConfig>("CommitConfig")({
  conventionalFormat: Schema.optionalWith(Schema.Boolean, { default: () => true }),
}) {}

export class ShipConfig extends Schema.Class<ShipConfig>("ShipConfig")({
  linear: LinearConfig,
  auth: AuthConfig,
  git: Schema.optionalWith(GitConfig, { default: () => new GitConfig({}) }),
  pr: Schema.optionalWith(PrConfig, { default: () => new PrConfig({}) }),
  commit: Schema.optionalWith(CommitConfig, { default: () => new CommitConfig({}) }),
}) {}

// Partial config for when we're initializing
export class PartialShipConfig extends Schema.Class<PartialShipConfig>("PartialShipConfig")({
  linear: Schema.OptionFromNullOr(LinearConfig),
  auth: Schema.OptionFromNullOr(AuthConfig),
  git: Schema.optionalWith(GitConfig, { default: () => new GitConfig({}) }),
  pr: Schema.optionalWith(PrConfig, { default: () => new PrConfig({}) }),
  commit: Schema.optionalWith(CommitConfig, { default: () => new CommitConfig({}) }),
}) {}
