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
import { AuthService } from "../../src/ports/AuthService.js";
import { MilestoneRepository } from "../../src/ports/MilestoneRepository.js";
import { TeamRepository } from "../../src/ports/TeamRepository.js";
import { ProjectRepository } from "../../src/ports/ProjectRepository.js";
import { TaskId, MilestoneId, ProjectId, TeamId, CreateMilestoneInput } from "../../src/domain/Task.js";
import { WebhookPermissionError } from "../../src/domain/Errors.js";

import {
  TestVcsServiceLayer,
  TestIssueRepositoryLayer,
  TestConfigRepositoryLayer,
  TestPrServiceLayer,
  TestWebhookServiceLayer,
  TestDaemonServiceLayer,
  TestTemplateServiceLayer,
  TestAuthServiceLayer,
  TestMilestoneRepositoryLayer,
  TestTeamRepositoryLayer,
  TestProjectRepositoryLayer,
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

  describe("TestAuthServiceLayer", () => {
    it.effect("should report authenticated when API key exists", () =>
      Effect.gen(function* () {
        const auth = yield* AuthService;
        const isAuthenticated = yield* auth.isAuthenticated();
        expect(isAuthenticated).toBe(true);
      }).pipe(Effect.provide(TestAuthServiceLayer())),
    );

    it.effect("should get API key when authenticated", () =>
      Effect.gen(function* () {
        const auth = yield* AuthService;
        const apiKey = yield* auth.getApiKey();
        expect(apiKey).toBe("test-api-key");
      }).pipe(Effect.provide(TestAuthServiceLayer())),
    );

    it.effect("should fail with NotAuthenticatedError when no API key", () =>
      Effect.gen(function* () {
        const auth = yield* AuthService;
        const result = yield* auth.getApiKey().pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const error = Cause.failureOption(result.cause);
          expect(Option.isSome(error)).toBe(true);
          if (Option.isSome(error)) {
            expect(error.value._tag).toBe("NotAuthenticatedError");
          }
        }
      }).pipe(Effect.provide(TestAuthServiceLayer({ apiKey: Option.none() }))),
    );

    it.effect("should save API key", () =>
      Effect.gen(function* () {
        const auth = yield* AuthService;
        const result = yield* auth.saveApiKey("new-api-key");
        expect(result.apiKey).toBe("new-api-key");

        // Verify it's now retrievable
        const apiKey = yield* auth.getApiKey();
        expect(apiKey).toBe("new-api-key");
      }).pipe(Effect.provide(TestAuthServiceLayer({ apiKey: Option.none() }))),
    );

    it.effect("should logout successfully", () =>
      Effect.gen(function* () {
        const auth = yield* AuthService;

        // First verify we're authenticated
        const before = yield* auth.isAuthenticated();
        expect(before).toBe(true);

        // Logout
        yield* auth.logout();

        // Verify we're no longer authenticated
        const after = yield* auth.isAuthenticated();
        expect(after).toBe(false);
      }).pipe(Effect.provide(TestAuthServiceLayer())),
    );

    it.effect("should validate API key based on isValid state", () =>
      Effect.gen(function* () {
        const auth = yield* AuthService;
        const isValid = yield* auth.validateApiKey("any-key");
        expect(isValid).toBe(false);
      }).pipe(Effect.provide(TestAuthServiceLayer({ isValid: false }))),
    );
  });

  describe("TestMilestoneRepositoryLayer", () => {
    it.effect("should provide default milestone", () =>
      Effect.gen(function* () {
        const repo = yield* MilestoneRepository;
        const milestone = yield* repo.getMilestone("test-milestone-id" as MilestoneId);
        expect(milestone.name).toBe("Test Milestone");
      }).pipe(Effect.provide(TestMilestoneRepositoryLayer())),
    );

    it.effect("should fail with MilestoneNotFoundError for unknown milestone", () =>
      Effect.gen(function* () {
        const repo = yield* MilestoneRepository;
        const result = yield* repo.getMilestone("unknown" as MilestoneId).pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const error = Cause.failureOption(result.cause);
          expect(Option.isSome(error)).toBe(true);
          if (Option.isSome(error)) {
            expect(error.value._tag).toBe("MilestoneNotFoundError");
          }
        }
      }).pipe(Effect.provide(TestMilestoneRepositoryLayer({ milestones: new Map() }))),
    );

    it.effect("should list milestones for a project", () =>
      Effect.gen(function* () {
        const repo = yield* MilestoneRepository;
        const milestones = yield* repo.listMilestones("test-project-id" as ProjectId);
        expect(milestones.length).toBe(1);
        expect(milestones[0].name).toBe("Test Milestone");
      }).pipe(Effect.provide(TestMilestoneRepositoryLayer())),
    );

    it.effect("should create a new milestone", () =>
      Effect.gen(function* () {
        const repo = yield* MilestoneRepository;
        const milestone = yield* repo.createMilestone(
          "test-project-id" as ProjectId,
          new CreateMilestoneInput({
            name: "New Milestone",
            description: Option.none(),
            targetDate: Option.none(),
            sortOrder: 1,
          }),
        );
        expect(milestone.name).toBe("New Milestone");
        expect(milestone.projectId).toBe("test-project-id");
      }).pipe(Effect.provide(TestMilestoneRepositoryLayer())),
    );

    it.effect("should delete a milestone", () =>
      Effect.gen(function* () {
        const repo = yield* MilestoneRepository;
        yield* repo.deleteMilestone("test-milestone-id" as MilestoneId);

        const result = yield* repo.getMilestone("test-milestone-id" as MilestoneId).pipe(Effect.exit);
        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(TestMilestoneRepositoryLayer())),
    );
  });

  describe("TestTeamRepositoryLayer", () => {
    it.effect("should provide default team", () =>
      Effect.gen(function* () {
        const repo = yield* TeamRepository;
        const teams = yield* repo.getTeams();
        expect(teams.length).toBe(1);
        expect(teams[0].name).toBe("Test Team");
        expect(teams[0].key).toBe("TEST");
      }).pipe(Effect.provide(TestTeamRepositoryLayer())),
    );

    it.effect("should get team by id", () =>
      Effect.gen(function* () {
        const repo = yield* TeamRepository;
        const team = yield* repo.getTeam("test-team-id" as TeamId);
        expect(team.name).toBe("Test Team");
      }).pipe(Effect.provide(TestTeamRepositoryLayer())),
    );

    it.effect("should fail with TeamNotFoundError for unknown team", () =>
      Effect.gen(function* () {
        const repo = yield* TeamRepository;
        const result = yield* repo.getTeam("unknown" as TeamId).pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const error = Cause.failureOption(result.cause);
          expect(Option.isSome(error)).toBe(true);
          if (Option.isSome(error)) {
            expect(error.value._tag).toBe("TeamNotFoundError");
          }
        }
      }).pipe(Effect.provide(TestTeamRepositoryLayer())),
    );

    it.effect("should create team successfully", () =>
      Effect.gen(function* () {
        const repo = yield* TeamRepository;
        const team = yield* repo.createTeam({ name: "New Team", key: "NEW" });
        expect(team.name).toBe("New Team");
        expect(team.key).toBe("NEW");

        // Verify it's in the list
        const teams = yield* repo.getTeams();
        expect(teams.length).toBe(2);
      }).pipe(Effect.provide(TestTeamRepositoryLayer())),
    );
  });

  describe("TestProjectRepositoryLayer", () => {
    it.effect("should list projects for a team", () =>
      Effect.gen(function* () {
        const repo = yield* ProjectRepository;
        const projects = yield* repo.getProjects("test-team-id" as TeamId);
        expect(projects.length).toBe(1);
        expect(projects[0].name).toBe("Test Project");
      }).pipe(Effect.provide(TestProjectRepositoryLayer())),
    );

    it.effect("should return empty array for unknown team", () =>
      Effect.gen(function* () {
        const repo = yield* ProjectRepository;
        const projects = yield* repo.getProjects("unknown-team" as TeamId);
        expect(projects.length).toBe(0);
      }).pipe(Effect.provide(TestProjectRepositoryLayer())),
    );

    it.effect("should create project successfully", () =>
      Effect.gen(function* () {
        const repo = yield* ProjectRepository;
        const project = yield* repo.createProject("test-team-id" as TeamId, {
          name: "New Project",
          description: "A test project",
        });
        expect(project.name).toBe("New Project");
        expect(project.teamId).toBe("test-team-id");

        // Verify it's in the list
        const projects = yield* repo.getProjects("test-team-id" as TeamId);
        expect(projects.length).toBe(2);
      }).pipe(Effect.provide(TestProjectRepositoryLayer())),
    );
  });
});
