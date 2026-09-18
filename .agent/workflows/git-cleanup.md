---
description: Audit git hygiene and preserve parallel sessions; clean verified inactive work only with explicit approval.
---

# Git Cleanup

Use this workflow for audits and requested cleanup. Audit-only requests authorize no deletions. Follow the shared agent manual and preserve active implementation and planning sessions.

## 1. Inspect every worktree

Run from the repository:

```bash
git status --short --branch
git worktree list --porcelain
git branch -vv
```

For every path returned, run:

```bash
git -C <worktree-path> status --short --branch
```

If any worktree is dirty or cannot be inspected, stop all cleanup. Report the path, changed files or inspection error, and a recommended next step. Do not automatically stash, commit, reset, remove, or partially clean other candidates. The owning session decides how to preserve its changes.

## 2. Audit remote refs and metadata

When all worktrees are clean, run read-only previews:

```bash
git fetch --prune --dry-run origin
git remote prune origin --dry-run
git worktree prune --dry-run --verbose
```

A dry run does not update refs or prove that a branch was merged. If network checks fail, report remote state as unverified and retry with the appropriate access; do not infer deletion safety.

When synchronization is requested, fetch and fast-forward the clean main checkout only after confirming it is not being edited by another session:

```bash
git fetch origin
git -C <main-worktree-path> merge --ff-only origin/main
```

Verify that the target checkout is on main first. Stop if it has diverged. Do not change the branch, HEAD, or files of another session's worktree. New implementation sessions start in separate named issue branches and worktrees based on current main.

## 3. Classify candidates individually

For each proposed worktree or branch cleanup, record:

- Full path, branch and commit, and whether the worktree is clean.
- Owner/session and linked Linear issue status, including planning sessions.
- Linked PR state and target branch. Preserve open or unmerged work.
- Verified merge evidence against the current target base. Ancestry checks alone may not detect squash merges; ambiguous cases need review.
- Whether the branch is checked out anywhere or has unique work to preserve.

Preserve active or uncertain candidates. Detached HEAD, a missing upstream, age, and prefixes such as codex/ or claude/ are never sufficient evidence. Do not enumerate unregistered directories for blanket deletion.

## 4. Request approval for one concrete cleanup action

Show the exact candidate, evidence, and command. Obtain explicit approval before each worktree removal or branch deletion. Immediately before executing, recheck every worktree for changes and confirm the candidate is still inactive. Stop if anything changed or any worktree is dirty.

Approved inactive worktree removal must use ordinary removal:

```bash
git worktree remove <approved-worktree-path>
```

Approved merged local branch deletion must use the safe form:

```bash
git branch -d <approved-branch-name>
```

If either refuses, stop and report why. Do not escalate to force-removal, force deletion, hard reset, or filesystem deletion. Do not delete remote branches as incidental cleanup; that requires a separate explicit request and review.

## 5. Refresh and verify

If non-destructive ref/metadata maintenance was requested and every worktree remains clean, perform only the reviewed maintenance:

```bash
git fetch --prune origin
git worktree prune --verbose
```

Do not run unrelated garbage collection or rewrite history. Verify each changed candidate after its operation, then finish with:

```bash
git status --short --branch
git worktree list
git branch -vv
```

Report the current state, exact operations performed, preserved active worktrees, unresolved candidates, and one recommended next step. Distinguish previews from executed changes. Confirm documentation updates and their locations; never claim a failed operation succeeded.
