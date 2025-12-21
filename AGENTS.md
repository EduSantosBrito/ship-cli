# Agent Guidelines

## jj (Jujutsu) Command Reference

This project uses **jj** (Jujutsu) for version control, not git directly. jj is a Git-compatible VCS with different commands and concepts.

### Key Concepts

- **Working copy (@)**: Always a commit, not a dirty state. Changes are automatically tracked.
- **Change vs Commit**: A change is a logical unit that may be rewritten. The commit ID changes, but the change ID stays the same.
- **No staging area**: All file changes are automatically included.
- **Bookmarks**: jj's equivalent of git branches.

### Common Command Mapping

| Use case | Git command | jj command |
|----------|-------------|------------|
| Create a new repo | `git init` | `jj git init [--colocate]` |
| Clone | `git clone <url>` | `jj git clone <url>` |
| Fetch | `git fetch` | `jj git fetch` |
| Push all | `git push --all` | `jj git push --all` |
| Push bookmark | `git push origin <branch>` | `jj git push -b <bookmark>` |
| Status | `git status` | `jj status` or `jj st` |
| Show diff of current change | `git diff HEAD` | `jj diff` |
| Show diff of a revision | `git diff <rev>^ <rev>` | `jj diff -r <revision>` |
| Show description and diff | `git show <rev>` | `jj show <revision>` |
| Add a file | `git add <file>` | Just create the file - auto-tracked |
| Remove a file | `git rm <file>` | Just `rm <file>` |
| Commit (finish current change) | `git commit -a` | `jj commit` |
| Create new change on top | N/A | `jj new` |
| Create new change with message | N/A | `jj new -m "message"` |
| Log | `git log --oneline --graph` | `jj log` |
| Log ancestors of current | `git log --oneline --graph` | `jj log -r ::@` |
| Log all | `git log --oneline --graph --all` | `jj log -r 'all()'` |
| Abandon change | `git reset --hard` | `jj abandon` |
| Restore (discard changes) | `git restore <paths>` | `jj restore <paths>` |
| Edit description | `git commit --amend --only` | `jj describe` |
| Edit description of revision | N/A | `jj describe <revision>` |
| Amend into parent | `git commit --amend -a` | `jj squash` |
| Interactive amend | `git add -p; git commit --amend` | `jj squash -i` |
| Squash into ancestor | `git commit --fixup=X; git rebase --autosquash X^` | `jj squash --into X` |
| Rebase | `git rebase B A` | `jj rebase -b A -d B` |
| Rebase revision and descendants | `git rebase --onto B A^` | `jj rebase -s A -d B` |
| Move single revision | N/A | `jj rebase -r <rev> -d <dest>` |
| Split a change | `git commit -p` | `jj split` |
| Edit diff interactively | N/A | `jj diffedit -r <revision>` |
| Cherry-pick | `git cherry-pick <source>` | `jj duplicate <source>` |
| List bookmarks | `git branch` | `jj bookmark list` or `jj b l` |
| Create bookmark | `git branch <name>` | `jj bookmark create <name>` |
| Create bookmark at revision | `git branch <name> <rev>` | `jj bookmark create <name> -r <revision>` |
| Move bookmark | `git branch -f <name> <rev>` | `jj bookmark move <name> --to <revision>` |
| Delete bookmark | `git branch -d <name>` | `jj bookmark delete <name>` |
| Undo last operation | N/A | `jj undo` |
| Operation log | N/A | `jj op log` |

### Important Notes

1. **jj outputs to stderr**: Most jj command output goes to stderr, not stdout. When capturing output programmatically, redirect stderr: `jj command 2>&1`

2. **Working copy format**: The output format is `Working copy  (@) now at: <change_id> <commit_id> ...`

3. **Creating changes**: Use `jj new -m "message"` to create a new change. This creates an empty change on top of the current one.

4. **Describing changes**: Use `jj describe -m "message"` to set/update the description of the current change.

5. **Bookmarks vs Branches**: jj uses "bookmarks" instead of "branches". They work similarly but are conceptually different.

6. **Pushing new bookmarks**: When pushing a new bookmark for the first time, use `--allow-new` flag or track it manually.

7. **Colocated repos**: When using `jj git init --colocate`, both jj and git work on the same repo. Changes sync automatically.

### Revsets

Common revset expressions:
- `@` - Current working copy
- `@-` - Parent of working copy
- `trunk()` - The main branch (main/master)
- `trunk()..@` - All changes from trunk to current
- `all()` - All commits
- `::@` - All ancestors of current

### Reference

- [Full documentation](https://jj-vcs.github.io/jj/latest/)
- [Git command table](https://jj-vcs.github.io/jj/latest/git-command-table/)
