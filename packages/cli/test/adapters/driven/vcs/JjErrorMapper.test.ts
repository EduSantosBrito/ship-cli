import { describe, it, expect } from "@effect/vitest"
import { mapJjError, looksLikeError } from "../../../../src/adapters/driven/vcs/JjErrorMapper.js"
import {
  VcsError,
  NotARepoError,
  JjConflictError,
  JjPushError,
  JjFetchError,
  JjBookmarkError,
  JjRevisionError,
  JjSquashError,
  JjImmutableError,
  JjStaleWorkingCopyError,
  WorkspaceError,
  WorkspaceExistsError,
  WorkspaceNotFoundError,
} from "../../../../src/domain/Errors.js"

describe("JjErrorMapper", () => {
  describe("mapJjError", () => {
    describe("NotARepoError", () => {
      it("should map 'There is no jj repo in' to NotARepoError with correct message", () => {
        const output = "Error: There is no jj repo in /some/path"
        const error = mapJjError(output, "status")

        expect(error).toBeInstanceOf(NotARepoError)
        expect(error.message).toBe("Not a jj repository. Run 'jj git init' to initialize.")
      })

      it("should map 'current directory is not part of a repository' to NotARepoError", () => {
        const output = "Error: The current directory is not part of a repository"
        const error = mapJjError(output, "status")

        expect(error).toBeInstanceOf(NotARepoError)
        expect(error.message).toBe("Not a jj repository. Run 'jj git init' to initialize.")
      })
    })

    describe("JjConflictError", () => {
      it("should map 'Conflicting changes in' with paths to JjConflictError", () => {
        const output = 'Conflicting changes in "src/file1.ts"\nConflicting changes in "src/file2.ts"'
        const error = mapJjError(output, "new")

        expect(error).toBeInstanceOf(JjConflictError)
        expect(error.message).toBe("Working copy has conflicts that need to be resolved.")
        // Verify conflictedPaths are extracted
        const conflictError = error as JjConflictError
        expect(conflictError.conflictedPaths).toEqual(["src/file1.ts", "src/file2.ts"])
      })

      it("should map generic conflict message to JjConflictError", () => {
        const output = "Working copy has conflict"
        const error = mapJjError(output, "new")

        expect(error).toBeInstanceOf(JjConflictError)
        expect(error.message).toBe("Working copy has conflict")
      })
    })

    describe("JjPushError", () => {
      it("should map 'no description' push error with correct message", () => {
        const output = "Won't push commit abc123 since it has no description"
        const error = mapJjError(output, "git push")

        expect(error).toBeInstanceOf(JjPushError)
        expect(error.message).toBe("Cannot push: commit has no description. Use 'jj describe' to add one.")
      })

      it("should map 'Refusing to create new remote bookmark' with bookmark extraction", () => {
        const output = "Refusing to create new remote bookmark feature/test without --allow-new"
        const error = mapJjError(output, "git push")

        expect(error).toBeInstanceOf(JjPushError)
        expect(error.message).toBe("Push failed: new bookmark requires --allow-new flag or manual tracking.")
        const pushError = error as JjPushError
        expect(pushError.bookmark).toBe("feature/test")
      })

      it("should map generic 'failed to push' error using original output", () => {
        const output = "Error: failed to push refs to origin"
        const error = mapJjError(output, "git push")

        expect(error).toBeInstanceOf(JjPushError)
        expect(error.message).toBe("Error: failed to push refs to origin")
      })

      it("should map 'failed to push some refs' error using original output", () => {
        const output = "error: failed to push some refs to 'origin'"
        const error = mapJjError(output, "git push")

        expect(error).toBeInstanceOf(JjPushError)
        // This matches "failed to push" pattern which uses original output
        expect(error.message).toBe("error: failed to push some refs to 'origin'")
      })
    })

    describe("JjFetchError", () => {
      it("should map 'failed to fetch' error using original output", () => {
        const output = "Error: failed to fetch from origin"
        const error = mapJjError(output, "git fetch")

        expect(error).toBeInstanceOf(JjFetchError)
        expect(error.message).toBe("Error: failed to fetch from origin")
      })

      it("should map 'Could not find remote' error with correct message", () => {
        const output = "Could not find remote 'upstream'"
        const error = mapJjError(output, "git fetch")

        expect(error).toBeInstanceOf(JjFetchError)
        expect(error.message).toBe("Remote not found. Check your git remote configuration.")
      })
    })

    describe("JjBookmarkError", () => {
      it("should map 'Bookmark already exists' with correct message and bookmark name", () => {
        const output = "Error: Bookmark already exists: main"
        const error = mapJjError(output, "bookmark create")

        expect(error).toBeInstanceOf(JjBookmarkError)
        expect(error.message).toBe("Bookmark 'main' already exists. Use 'jj bookmark move' to update it.")
        const bookmarkError = error as JjBookmarkError
        expect(bookmarkError.bookmark).toBe("main")
      })

      it("should map 'Bookmark doesn\\'t exist' with correct message and bookmark name", () => {
        const output = 'Error: Bookmark "feature/test" doesn\'t exist'
        const error = mapJjError(output, "bookmark delete")

        expect(error).toBeInstanceOf(JjBookmarkError)
        expect(error.message).toBe("Bookmark 'feature/test' not found.")
        const bookmarkError = error as JjBookmarkError
        expect(bookmarkError.bookmark).toBe("feature/test")
      })

      it("should map 'No such bookmark' error using original output", () => {
        const output = "No such bookmark: nonexistent"
        const error = mapJjError(output, "bookmark")

        expect(error).toBeInstanceOf(JjBookmarkError)
        expect(error.message).toBe("No such bookmark: nonexistent")
      })
    })

    describe("JjImmutableError", () => {
      it("should map immutable commit error with correct message and commit ID", () => {
        const output = "Error: Commit abc123def is immutable"
        const error = mapJjError(output, "edit")

        expect(error).toBeInstanceOf(JjImmutableError)
        expect(error.message).toBe("Cannot modify immutable commit. This is typically a protected commit like main/master.")
        const immutableError = error as JjImmutableError
        expect(immutableError.commitId).toBe("abc123def")
      })
    })

    describe("JjSquashError", () => {
      it("should map 'Cannot squash into the root commit' with correct message", () => {
        const output = "Error: Cannot squash into the root commit"
        const error = mapJjError(output, "squash")

        expect(error).toBeInstanceOf(JjSquashError)
        expect(error.message).toBe("Cannot squash: target is the root commit.")
      })

      it("should map 'Cannot squash commits that have children' with correct message", () => {
        const output = "Error: Cannot squash commits that have children"
        const error = mapJjError(output, "squash")

        expect(error).toBeInstanceOf(JjSquashError)
        expect(error.message).toBe("Cannot squash: commit has children. Squash the children first.")
      })

      it("should map 'Cannot squash into itself' with correct message", () => {
        const output = "Error: Cannot squash abc123 into itself"
        const error = mapJjError(output, "squash")

        expect(error).toBeInstanceOf(JjSquashError)
        expect(error.message).toBe("Cannot squash a commit into itself.")
      })
    })

    describe("JjRevisionError", () => {
      it("should map revset not resolving with correct message and revision", () => {
        const output = 'Error: Revset "nonexistent" didn\'t resolve to any revisions'
        const error = mapJjError(output, "log")

        expect(error).toBeInstanceOf(JjRevisionError)
        expect(error.message).toBe("Revision 'nonexistent' not found.")
        const revError = error as JjRevisionError
        expect(revError.revision).toBe("nonexistent")
      })

      it("should map revision doesn\\'t exist with correct message and revision", () => {
        const output = 'Error: Revision "abc123" doesn\'t exist'
        const error = mapJjError(output, "show")

        expect(error).toBeInstanceOf(JjRevisionError)
        expect(error.message).toBe("Revision 'abc123' not found.")
        const revError = error as JjRevisionError
        expect(revError.revision).toBe("abc123")
      })

      it("should map 'No such revision' error using original output", () => {
        const output = "No such revision: @-"
        const error = mapJjError(output, "diff")

        expect(error).toBeInstanceOf(JjRevisionError)
        expect(error.message).toBe("No such revision: @-")
      })
    })

    describe("JjStaleWorkingCopyError", () => {
      it("should map 'The working copy is stale' error", () => {
        const output = "Error: The working copy is stale"
        const error = mapJjError(output, "new")

        expect(error).toBeInstanceOf(JjStaleWorkingCopyError)
        // Uses the default static error
        expect(error.message).toBe("The working copy is stale. Run 'ship stack update-stale' to recover.")
      })

      it("should map lowercase 'working copy is stale' error", () => {
        const output = "The working copy is stale, run jj workspace update-stale"
        const error = mapJjError(output, "new")

        expect(error).toBeInstanceOf(JjStaleWorkingCopyError)
      })
    })

    describe("WorkspaceErrors", () => {
      it("should map workspace already exists error with name", () => {
        const output = "Error: Workspace 'my-workspace' already exists"
        const error = mapJjError(output, "workspace add")

        expect(error).toBeInstanceOf(WorkspaceExistsError)
        expect(error.message).toBe("Workspace 'my-workspace' already exists")
        const wsError = error as WorkspaceExistsError
        expect(wsError.name).toBe("my-workspace")
      })

      it("should map workspace already exists with path", () => {
        const output = "Error: already exists at: /path/to/workspace"
        const error = mapJjError(output, "workspace add")

        expect(error).toBeInstanceOf(WorkspaceExistsError)
        expect(error.message).toBe("Workspace 'unknown' already exists at /path/to/workspace")
        const wsError = error as WorkspaceExistsError
        expect(wsError.path).toBe("/path/to/workspace")
      })

      it("should map 'No workspace named' error with name", () => {
        const output = "Error: No workspace named 'test-ws'"
        const error = mapJjError(output, "workspace forget")

        expect(error).toBeInstanceOf(WorkspaceNotFoundError)
        expect(error.message).toBe("Workspace 'test-ws' not found")
        const wsError = error as WorkspaceNotFoundError
        expect(wsError.name).toBe("test-ws")
      })

      it("should map 'Workspace doesn\\'t exist' error with name", () => {
        const output = "Error: Workspace 'deleted-ws' doesn't exist"
        const error = mapJjError(output, "workspace forget")

        expect(error).toBeInstanceOf(WorkspaceNotFoundError)
        expect(error.message).toBe("Workspace 'deleted-ws' not found")
      })

      it("should map generic workspace error using original output", () => {
        const output = "Error: workspace operation failed for unknown reason"
        const error = mapJjError(output, "workspace")

        expect(error).toBeInstanceOf(WorkspaceError)
        expect(error.message).toBe("Error: workspace operation failed for unknown reason")
      })
    })

    describe("Fallback to VcsError", () => {
      it("should return generic VcsError for unknown error patterns", () => {
        const output = "Some unknown error that doesn't match any pattern"
        const error = mapJjError(output, "unknown")

        expect(error).toBeInstanceOf(VcsError)
        expect(error.message).toBe("Some unknown error that doesn't match any pattern")
      })

      it("should include command in fallback message when output is empty", () => {
        const error = mapJjError("", "diff")

        expect(error).toBeInstanceOf(VcsError)
        expect(error.message).toBe("jj diff failed")
      })

      it("should include exit code in VcsError when provided", () => {
        const error = mapJjError("Unknown error", "status", 1) as VcsError

        expect(error).toBeInstanceOf(VcsError)
        expect(error.exitCode).toBe(1)
      })
    })

    describe("Pattern priority", () => {
      it("should match first pattern when multiple patterns could match", () => {
        // "Conflicting changes" comes before generic "conflict" pattern
        const output = 'Conflicting changes in "file.ts"'
        const error = mapJjError(output, "new")

        expect(error).toBeInstanceOf(JjConflictError)
        // Should use the specific message, not the generic one
        expect(error.message).toBe("Working copy has conflicts that need to be resolved.")
      })

      it("should prefer specific error pattern over generic workspace pattern", () => {
        // WorkspaceExistsError pattern comes before generic WorkspaceError
        const output = "Error: Workspace 'test' already exists"
        const error = mapJjError(output, "workspace add")

        expect(error).toBeInstanceOf(WorkspaceExistsError)
        // Not generic WorkspaceError
        expect(error).not.toBeInstanceOf(WorkspaceError.prototype.constructor === WorkspaceExistsError ? Error : WorkspaceError)
      })
    })
  })

  describe("looksLikeError", () => {
    describe("should return true for jj error patterns", () => {
      it("detects 'Error:' at line start", () => {
        expect(looksLikeError("Error: something went wrong")).toBe(true)
      })

      it("detects lowercase 'error:' at line start", () => {
        expect(looksLikeError("error: failed to do something")).toBe(true)
      })

      it("detects 'fatal:' at line start", () => {
        expect(looksLikeError("fatal: repository not found")).toBe(true)
      })

      it("detects 'failed to' phrase", () => {
        expect(looksLikeError("Operation failed to complete")).toBe(true)
      })

      it("detects 'cannot ' with space", () => {
        expect(looksLikeError("cannot modify immutable commit")).toBe(true)
      })

      it("detects 'won't ' with space", () => {
        expect(looksLikeError("Won't push commit without description")).toBe(true)
      })

      it("detects 'refusing to' phrase", () => {
        expect(looksLikeError("Refusing to create new bookmark")).toBe(true)
      })

      it("detects 'Conflicting changes in' (jj's actual conflict pattern)", () => {
        expect(looksLikeError('Conflicting changes in "file.ts"')).toBe(true)
      })

      it("detects 'has conflicts' at end of line", () => {
        expect(looksLikeError("Working copy has conflicts")).toBe(true)
      })

      it("detects 'has conflict' (singular) at end", () => {
        expect(looksLikeError("Revision has conflict")).toBe(true)
      })

      it("detects error in multiline output", () => {
        const output = "some output\nError: something failed\nmore output"
        expect(looksLikeError(output)).toBe(true)
      })
    })

    describe("should return false for non-error output", () => {
      it("returns false for normal log output", () => {
        const output = `
abc123 (empty) initial commit
def456 feat: add feature
xyz789 fix: bug fix
        `
        expect(looksLikeError(output)).toBe(false)
      })

      it("returns false for commit message containing 'error' word mid-line", () => {
        // 'error' without colon or at line start is not detected
        expect(looksLikeError("fix: handle error cases properly")).toBe(false)
      })

      it("returns false for empty output", () => {
        expect(looksLikeError("")).toBe(false)
      })

      it("returns false for whitespace only", () => {
        expect(looksLikeError("   \n\n   ")).toBe(false)
      })

      it("returns false for success messages", () => {
        expect(looksLikeError("Rebased 3 commits onto origin/main")).toBe(false)
      })

      it("returns false for normal commit descriptions", () => {
        expect(looksLikeError("feat: add new feature\nfix: resolve issue")).toBe(false)
      })
    })

    describe("known false positive cases (documented behavior)", () => {
      // These tests document known limitations of the looksLikeError function.
      // The function is designed to be somewhat aggressive in detecting errors
      // because false negatives (missing real errors) are worse than false positives.

      it("'cannot ' in commit message is a known false positive", () => {
        // This is expected to return true because 'cannot ' matches
        // In practice, jj output during operations won't contain commit messages
        // in the error position, so this is acceptable
        expect(looksLikeError("fix: cannot reproduce bug")).toBe(true)
      })

      it("'won't ' in commit message is a known false positive", () => {
        // Same reasoning as above
        expect(looksLikeError("docs: won't break existing behavior")).toBe(true)
      })

      it("'failed to' in commit message is a known false positive", () => {
        expect(looksLikeError("test: failed to reproduce issue initially")).toBe(true)
      })
    })
  })
})
