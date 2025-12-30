import { describe, expect, it } from "@effect/vitest";
import {
  RepoIssue,
  formatRepoError,
} from "../../../../../../src/adapters/driving/cli/commands/webhook/diagnostics.js";

// === formatRepoError Tests ===

describe("formatRepoError", () => {
  describe("NotGitRepo", () => {
    it("returns correct error message and hint", () => {
      const lines = formatRepoError(RepoIssue.NotGitRepo());

      expect(lines).toContain("Error: Not in a git repository.");
      expect(lines).toContain("Hint: Initialize a repository first:");
      expect(lines).toContain("  git init && gh repo create");
    });

    it("has exactly 4 lines", () => {
      const lines = formatRepoError(RepoIssue.NotGitRepo());
      expect(lines).toHaveLength(4);
    });
  });

  describe("NoRemote with git only", () => {
    it("returns git-specific hints when hasJj is false", () => {
      const lines = formatRepoError(RepoIssue.NoRemote({ hasJj: false }));

      expect(lines).toContain("Error: No GitHub remote configured.");
      expect(lines).toContain("Hint: Create a GitHub repository:");
      expect(lines).toContain("  gh repo create REPO --source=. --remote=origin");
      expect(lines).toContain("Or add an existing remote:");
      expect(lines).toContain("  git remote add origin git@github.com:OWNER/REPO.git");
    });

    it("does not mention jj commands", () => {
      const lines = formatRepoError(RepoIssue.NoRemote({ hasJj: false }));
      const joined = lines.join("\n");

      expect(joined).not.toContain("jj git remote");
    });
  });

  describe("NoRemote with jj", () => {
    it("returns jj-specific hints when hasJj is true", () => {
      const lines = formatRepoError(RepoIssue.NoRemote({ hasJj: true }));

      expect(lines).toContain("Error: No GitHub remote configured.");
      expect(lines).toContain("Hint: Add a GitHub remote to your jj repository:");
      expect(lines).toContain("  jj git remote add origin git@github.com:OWNER/REPO.git");
      expect(lines).toContain("Or create a new GitHub repo:");
      expect(lines).toContain("  gh repo create REPO --source=. --remote=origin");
    });

    it("mentions jj git remote command", () => {
      const lines = formatRepoError(RepoIssue.NoRemote({ hasJj: true }));
      const joined = lines.join("\n");

      expect(joined).toContain("jj git remote add origin");
    });
  });

  describe("JjNotInitialized", () => {
    it("returns correct error message and jj init hint", () => {
      const lines = formatRepoError(RepoIssue.JjNotInitialized());

      expect(lines).toContain("Error: This is a git repository but jj is not initialized.");
      expect(lines).toContain("Hint: Ship CLI works best with jj. Initialize jj for this repo:");
      expect(lines).toContain("  jj git init --colocate");
    });

    it("has exactly 4 lines", () => {
      const lines = formatRepoError(RepoIssue.JjNotInitialized());
      expect(lines).toHaveLength(4);
    });
  });
});

// === RepoIssue Type Tests ===

describe("RepoIssue", () => {
  describe("NotGitRepo", () => {
    it("creates variant with correct tag", () => {
      const issue = RepoIssue.NotGitRepo();
      expect(issue._tag).toBe("NotGitRepo");
    });
  });

  describe("NoRemote", () => {
    it("creates variant with hasJj false", () => {
      const issue = RepoIssue.NoRemote({ hasJj: false });
      expect(issue._tag).toBe("NoRemote");
      expect(issue.hasJj).toBe(false);
    });

    it("creates variant with hasJj true", () => {
      const issue = RepoIssue.NoRemote({ hasJj: true });
      expect(issue._tag).toBe("NoRemote");
      expect(issue.hasJj).toBe(true);
    });
  });

  describe("JjNotInitialized", () => {
    it("creates variant with correct tag", () => {
      const issue = RepoIssue.JjNotInitialized();
      expect(issue._tag).toBe("JjNotInitialized");
    });
  });
});

// === Error Message Content Tests ===

describe("error message content", () => {
  it("NotGitRepo suggests git init first", () => {
    const lines = formatRepoError(RepoIssue.NotGitRepo());
    expect(lines.some((l) => l.includes("git init"))).toBe(true);
  });

  it("NoRemote (git) suggests gh repo create", () => {
    const lines = formatRepoError(RepoIssue.NoRemote({ hasJj: false }));
    expect(lines.some((l) => l.includes("gh repo create"))).toBe(true);
  });

  it("NoRemote (jj) suggests jj git remote add", () => {
    const lines = formatRepoError(RepoIssue.NoRemote({ hasJj: true }));
    expect(lines.some((l) => l.includes("jj git remote add"))).toBe(true);
  });

  it("JjNotInitialized suggests jj git init --colocate", () => {
    const lines = formatRepoError(RepoIssue.JjNotInitialized());
    expect(lines.some((l) => l.includes("jj git init --colocate"))).toBe(true);
  });

  it("all errors start with 'Error:'", () => {
    const issues = [
      RepoIssue.NotGitRepo(),
      RepoIssue.NoRemote({ hasJj: false }),
      RepoIssue.NoRemote({ hasJj: true }),
      RepoIssue.JjNotInitialized(),
    ];

    for (const issue of issues) {
      const lines = formatRepoError(issue);
      expect(lines[0]).toMatch(/^Error:/);
    }
  });

  it("all errors contain a Hint:", () => {
    const issues = [
      RepoIssue.NotGitRepo(),
      RepoIssue.NoRemote({ hasJj: false }),
      RepoIssue.NoRemote({ hasJj: true }),
      RepoIssue.JjNotInitialized(),
    ];

    for (const issue of issues) {
      const lines = formatRepoError(issue);
      expect(lines.some((l) => l.includes("Hint:"))).toBe(true);
    }
  });
});
