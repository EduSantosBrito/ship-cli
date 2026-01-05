import * as Layer from "effect/Layer";
import * as NodeContext from "@effect/platform-node/NodeContext";
import { ConfigRepositoryLive } from "../adapters/driven/config/ConfigRepositoryLive.js";
import { AuthServiceLive } from "../adapters/driven/auth/AuthServiceLive.js";
import { LinearClientLive } from "../adapters/driven/linear/LinearClient.js";
import { TeamRepositoryLive } from "../adapters/driven/linear/TeamRepositoryLive.js";
import { ProjectRepositoryLive } from "../adapters/driven/linear/ProjectRepositoryLive.js";
import { IssueRepositoryLive } from "../adapters/driven/linear/IssueRepositoryLive.js";
import { MilestoneRepositoryLive } from "../adapters/driven/linear/MilestoneRepositoryLive.js";
import { NotionClientLive } from "../adapters/driven/notion/NotionClient.js";
import { TeamRepositoryNotion } from "../adapters/driven/notion/TeamRepositoryNotion.js";
import { ProjectRepositoryNotion } from "../adapters/driven/notion/ProjectRepositoryNotion.js";
import { IssueRepositoryNotion } from "../adapters/driven/notion/IssueRepositoryNotion.js";
import { VcsServiceLive } from "../adapters/driven/vcs/VcsServiceLive.js";
import { PrServiceLive } from "../adapters/driven/github/PrServiceLive.js";
import { WebhookServiceLive } from "../adapters/driven/github/WebhookServiceLive.js";
import { OpenCodeServiceLive } from "../adapters/driven/opencode/OpenCodeServiceLive.js";
import { DaemonServiceLive } from "../adapters/driven/daemon/DaemonServiceLive.js";
import { TemplateServiceLive } from "../adapters/driven/template/TemplateServiceLive.js";
import { PromptsLive } from "../adapters/driven/prompts/PromptsLive.js";
import { MilestoneRepositoryStub } from "./MilestoneRepositoryStub.js";
import { LinearClientStub } from "./LinearClientStub.js";

// =============================================================================
// Layer Dependencies Documentation
// =============================================================================

// ConfigRepositoryLive: FileSystem + Path -> ConfigRepository
// AuthServiceLive: ConfigRepository -> AuthService
// LinearClientLive: AuthService -> LinearClientService
// NotionClientLive: AuthService -> NotionClientService
// TeamRepositoryLive: LinearClientService -> TeamRepository
// TeamRepositoryNotion: NotionClientService -> TeamRepository
// ProjectRepositoryLive: LinearClientService -> ProjectRepository
// ProjectRepositoryNotion: NotionClientService -> ProjectRepository
// IssueRepositoryLive: LinearClientService -> IssueRepository
// IssueRepositoryNotion: NotionClientService + ConfigRepository -> IssueRepository
// VcsServiceLive: CommandExecutor -> VcsService
// PrServiceLive: CommandExecutor -> PrService
// WebhookServiceLive: CommandExecutor -> WebhookService
// OpenCodeServiceLive: (no dependencies) -> OpenCodeService
// TemplateServiceLive: ConfigRepository + FileSystem + Path -> TemplateService

// =============================================================================
// Base Layers (Provider-Agnostic)
// =============================================================================

// Build the layer chain - each layer provides what the next needs
// ConfigRepository provides what AuthService needs
const ConfigAndAuth = AuthServiceLive.pipe(Layer.provideMerge(ConfigRepositoryLive));

// =============================================================================
// Linear Provider Layers
// =============================================================================

// AuthService provides what LinearClient needs
const ConfigAuthAndLinear = LinearClientLive.pipe(Layer.provideMerge(ConfigAndAuth));

// LinearClientService provides what repositories need
// Merge all repository layers together
const LinearRepositoryLayers = Layer.mergeAll(
  TeamRepositoryLive,
  ProjectRepositoryLive,
  IssueRepositoryLive,
  MilestoneRepositoryLive,
);

// =============================================================================
// Notion Provider Layers
// =============================================================================

// AuthService provides what NotionClient needs
const ConfigAuthAndNotion = NotionClientLive.pipe(Layer.provideMerge(ConfigAndAuth));

// Notion repository layers - depend on NotionClientService and ConfigRepository
// IssueRepositoryNotion needs ConfigRepository for property mapping
const NotionRepositoryLayers = Layer.mergeAll(
  TeamRepositoryNotion,
  ProjectRepositoryNotion,
  IssueRepositoryNotion.pipe(Layer.provide(ConfigRepositoryLive)),
  MilestoneRepositoryStub, // Notion doesn't have milestones
  LinearClientStub, // Stub for Linear-specific code (e.g., task start auto-assignment)
);

// =============================================================================
// Provider-Agnostic Services
// =============================================================================

// VcsService, PrService, WebhookService depend on CommandExecutor (from NodeContext)
// OpenCodeService has no dependencies
// TemplateService depends on ConfigRepository + FileSystem + Path
// PromptsLive has no dependencies (uses @clack/prompts directly)
// First merge services that don't have inter-service dependencies
const ProviderAgnosticServices = Layer.mergeAll(
  VcsServiceLive,
  PrServiceLive,
  WebhookServiceLive,
  OpenCodeServiceLive,
  TemplateServiceLive,
  PromptsLive,
);

// =============================================================================
// Linear Application Layer (Default)
// =============================================================================

const LinearBaseServices = Layer.mergeAll(LinearRepositoryLayers, ProviderAgnosticServices).pipe(
  Layer.provideMerge(ConfigAuthAndLinear),
);

// DaemonService depends on WebhookService and OpenCodeService
// Provide it after those services are available
const LinearAllServices = DaemonServiceLive.pipe(Layer.provideMerge(LinearBaseServices));

/**
 * Full application layer for Linear provider.
 * This is the default layer used by the CLI.
 *
 * Use provideMerge to:
 * 1. Satisfy platform deps (FileSystem, Path) that ConfigRepositoryLive needs
 * 2. Keep platform services (FileSystem, Path, Terminal) in output for @effect/cli
 */
export const AppLayer = LinearAllServices.pipe(Layer.provideMerge(NodeContext.layer));

// =============================================================================
// Notion Application Layer
// =============================================================================

const NotionBaseServices = Layer.mergeAll(NotionRepositoryLayers, ProviderAgnosticServices).pipe(
  Layer.provideMerge(ConfigAuthAndNotion),
);

const NotionAllServices = DaemonServiceLive.pipe(Layer.provideMerge(NotionBaseServices));

/**
 * Full application layer for Notion provider.
 * Use this when the config specifies Notion as the provider.
 */
export const NotionAppLayer = NotionAllServices.pipe(Layer.provideMerge(NodeContext.layer));

// =============================================================================
// Minimal Layers (for init/login commands)
// =============================================================================

// Minimal layer for init/login commands (before full config exists)
// Also includes TeamRepository and ProjectRepository for init flow
// PromptsLive is included for interactive prompts in login/init
const LinearMinimalRepositories = Layer.mergeAll(TeamRepositoryLive, ProjectRepositoryLive, PromptsLive);
const LinearMinimalServices = LinearMinimalRepositories.pipe(Layer.provideMerge(ConfigAuthAndLinear));

/**
 * Minimal layer for init/login commands using Linear provider.
 * This is the default minimal layer.
 */
export const MinimalLayer = LinearMinimalServices.pipe(Layer.provideMerge(NodeContext.layer));

/**
 * Minimal layer for init/login commands using Notion provider.
 */
const NotionMinimalRepositories = Layer.mergeAll(TeamRepositoryNotion, ProjectRepositoryNotion, PromptsLive);
const NotionMinimalServices = NotionMinimalRepositories.pipe(Layer.provideMerge(ConfigAuthAndNotion));
export const NotionMinimalLayer = NotionMinimalServices.pipe(Layer.provideMerge(NodeContext.layer));

// =============================================================================
// Exported Provider-Specific Layers
// =============================================================================

/**
 * Linear-specific application layer.
 * Alias for AppLayer (Linear is the default).
 */
export const LinearAppLayer = AppLayer;

/**
 * Linear-specific minimal layer for init flow.
 * Alias for MinimalLayer (Linear is the default).
 */
export const LinearMinimalLayer = MinimalLayer;
