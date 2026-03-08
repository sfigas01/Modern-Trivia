---
description: Clean up git branches, worktrees, and stale refs. Run this after vibe coding sessions with Codex or Claude Code, or whenever the git tree feels messy.
---

# Git Cleanup

Perform a safe, step-by-step cleanup of the git repository. This removes stale worktrees (from Claude Code), merged local branches, orphaned local branches, and stale remote-tracking refs.

## Pre-flight

// turbo-all

1. Show current state to the user:

```bash
echo "=== WORKTREES ===" && git worktree list && echo "" && echo "=== LOCAL BRANCHES ===" && git branch && echo "" && echo "=== REMOTE BRANCHES ===" && git branch -r && echo "" && echo "=== STATUS ===" && git status --short
```

2. If there are uncommitted changes, stash them first:

```bash
git stash push -m "git-cleanup: auto-stash before cleanup"
```

## Step 1: Sync main

3. Pull the latest main branch:

```bash
git pull origin main
```

## Step 2: Remove stale worktrees

4. List all worktrees and remove any that are NOT the main project directory. These are leftover from Claude Code sessions. Use `--force` if needed:

```bash
git worktree list
```

For each non-main worktree, run:

```bash
git worktree remove --force <path>
```

5. Also clean up leftover `.claude/worktrees/` directories:

```bash
rm -rf .claude/worktrees/*
```

6. Prune worktree metadata:

```bash
git worktree prune
```

## Step 3: Delete merged local branches

7. Delete all local branches that have been merged into main (except main itself and any protected branches like develop, staging, production):

```bash
git branch --merged main | grep -v '^\*' | grep -vE '^\s*(main|master|develop|staging|production)\s*$' | xargs -r git branch -d
```

## Step 4: Delete orphaned local branches

8. Delete local branches whose remote tracking branch has been deleted (the PR was merged or branch was removed on GitHub):

```bash
git branch -vv | grep ': gone]' | awk '{print $1}' | xargs -r git branch -D
```

## Step 5: Delete remaining stale local branches

9. For any remaining non-main local branches, check if their associated PR was merged on GitHub. If so, delete them with `git branch -D`. Common patterns to look for:
   - `claude/*` branches — always safe to delete
   - `codex/*` branches — always safe to delete
   - `dependabot/*` branches — safe to delete if the PR was merged or closed
   - `feature/*`, `fix/*`, `chore/*` branches — check if the PR was merged first

## Step 6: Prune remote refs

10. Fetch and prune stale remote-tracking references:

```bash
git fetch --prune
```

## Step 7: Delete stale remote branches (optional)

11. Check for remaining remote branches that are not merged into main:

```bash
git branch -r --no-merged origin/main
```

12. If there are stale remote branches (old codex/*, claude/*, dependabot/* branches), offer to delete them from GitHub:

```bash
git push origin --delete <branch-name>
```

**Ask the user before deleting remote branches** — they may have open PRs.

## Step 8: Garbage collection

13. Run git garbage collection to compress objects:

```bash
git gc --quiet
```

## Step 9: Restore stash (if applicable)

14. If changes were stashed in the pre-flight step, pop the stash. Resolve any conflicts if needed:

```bash
git stash pop
```

## Step 10: Final report

15. Show the final clean state and summarize what was cleaned up:

```bash
echo "=== FINAL STATE ===" && echo "Local branches:" && git branch && echo "" && echo "Remote branches:" && git branch -r && echo "" && echo "Worktrees:" && git worktree list && echo "" && echo "Status:" && git status --short
```

Provide a summary table showing:
- Worktrees removed
- Local branches deleted
- Remote branches deleted
- Remote refs pruned
- .git size before/after (if gc was run)
