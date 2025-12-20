import * as Layer from "effect/Layer";
import * as NodeContext from "@effect/platform-node/NodeContext";
import { ConfigRepositoryLive } from "../adapters/driven/config/ConfigRepositoryLive.js";
import { AuthServiceLive } from "../adapters/driven/auth/AuthServiceLive.js";
import { LinearClientLive } from "../adapters/driven/linear/LinearClient.js";
import { TeamRepositoryLive } from "../adapters/driven/linear/TeamRepositoryLive.js";
import { ProjectRepositoryLive } from "../adapters/driven/linear/ProjectRepositoryLive.js";
import { IssueRepositoryLive } from "../adapters/driven/linear/IssueRepositoryLive.js";

// Layer dependencies:
// ConfigRepositoryLive: FileSystem + Path -> ConfigRepository
// AuthServiceLive: ConfigRepository -> AuthService
// LinearClientLive: AuthService -> LinearClientService
// TeamRepositoryLive: LinearClientService -> TeamRepository
// ProjectRepositoryLive: LinearClientService -> ProjectRepository
// IssueRepositoryLive: LinearClientService -> IssueRepository

// Build the layer chain - each layer provides what the next needs
// ConfigRepository provides what AuthService needs
const ConfigAndAuth = AuthServiceLive.pipe(Layer.provideMerge(ConfigRepositoryLive));

// AuthService provides what LinearClient needs
const ConfigAuthAndLinear = LinearClientLive.pipe(Layer.provideMerge(ConfigAndAuth));

// LinearClientService provides what repositories need
// Merge all three repository layers together
const RepositoryLayers = Layer.mergeAll(
  TeamRepositoryLive,
  ProjectRepositoryLive,
  IssueRepositoryLive,
);

const AllServices = RepositoryLayers.pipe(Layer.provideMerge(ConfigAuthAndLinear));

// Full application layer for Phase 1 (Linear + Config + Auth)
// Use provideMerge to:
// 1. Satisfy platform deps (FileSystem, Path) that ConfigRepositoryLive needs
// 2. Keep platform services (FileSystem, Path, Terminal) in output for @effect/cli
export const AppLayer = AllServices.pipe(Layer.provideMerge(NodeContext.layer));

// Minimal layer for init/login commands (before full config exists)
// Also includes TeamRepository and ProjectRepository for init flow
const MinimalRepositories = Layer.mergeAll(TeamRepositoryLive, ProjectRepositoryLive);
const MinimalServices = MinimalRepositories.pipe(Layer.provideMerge(ConfigAuthAndLinear));
export const MinimalLayer = MinimalServices.pipe(Layer.provideMerge(NodeContext.layer));
