/**
 * Test Layers for Service Implementations
 *
 * This module exports test layers for all service interfaces.
 * Each test layer provides a mock implementation that:
 *
 * - Uses in-memory state via Effect Ref
 * - Supports configurable initial state
 * - Exposes _getState() for test assertions
 * - Can simulate both success and failure modes
 * - Tracks method calls for verification
 *
 * @example
 * ```typescript
 * import { describe, it, expect } from "@effect/vitest"
 * import { Effect, Exit } from "effect"
 * import { VcsService } from "../src/ports/VcsService.js"
 * import { TestVcsServiceLayer } from "./layers/index.js"
 *
 * describe("MyService", () => {
 *   it.effect("fails when not in repo", () =>
 *     Effect.gen(function* () {
 *       const vcs = yield* VcsService
 *       const exit = yield* Effect.exit(vcs.createChange("test"))
 *       expect(exit).toEqual(Exit.fail(NotARepoError.default))
 *     }).pipe(Effect.provide(TestVcsServiceLayer({ isRepo: false })))
 *   )
 * })
 * ```
 */

// VcsService test layer
export {
  TestVcsServiceLayer,
  defaultTestVcsState,
  type TestVcsState,
  type TestVcsService,
} from "./VcsService.testLayer.js";

// IssueRepository test layer
export {
  TestIssueRepositoryLayer,
  defaultTestIssueState,
  createTestTask,
  type TestIssueState,
  type TestIssueRepository,
} from "./IssueRepository.testLayer.js";

// ConfigRepository test layer
export {
  TestConfigRepositoryLayer,
  defaultTestConfigState,
  type TestConfigState,
  type TestConfigRepository,
} from "./ConfigRepository.testLayer.js";

// PrService test layer
export {
  TestPrServiceLayer,
  defaultTestPrState,
  createTestPr,
  type TestPrState,
  type TestPrService,
} from "./PrService.testLayer.js";

// WebhookService test layer
export {
  TestWebhookServiceLayer,
  defaultTestWebhookState,
  createTestWebhook,
  createTestEvent,
  type TestWebhookState,
  type TestWebhookService,
} from "./WebhookService.testLayer.js";

// DaemonService test layer
export {
  TestDaemonServiceLayer,
  defaultTestDaemonState,
  type TestDaemonState,
  type TestDaemonService,
} from "./DaemonService.testLayer.js";

// TemplateService test layer
export {
  TestTemplateServiceLayer,
  defaultTestTemplateState,
  createTestTemplate,
  type TestTemplateState,
  type TestTemplateService,
} from "./TemplateService.testLayer.js";

// AuthService test layer
export {
  TestAuthServiceLayer,
  defaultTestAuthState,
  type TestAuthState,
  type TestAuthService,
} from "./AuthService.testLayer.js";

// MilestoneRepository test layer
export {
  TestMilestoneRepositoryLayer,
  defaultTestMilestoneState,
  createTestMilestone,
  type TestMilestoneState,
  type TestMilestoneRepository,
} from "./MilestoneRepository.testLayer.js";

// TeamRepository test layer
export {
  TestTeamRepositoryLayer,
  defaultTestTeamState,
  createTestTeam,
  type TestTeamState,
  type TestTeamRepository,
} from "./TeamRepository.testLayer.js";

// ProjectRepository test layer
export {
  TestProjectRepositoryLayer,
  defaultTestProjectState,
  createTestProject,
  type TestProjectState,
  type TestProjectRepository,
} from "./ProjectRepository.testLayer.js";
