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

For every existing, accessible path returned, run:

```bash
git -C <worktree-path> status --short --branch
```

If any existing worktree is dirty or cannot be inspected, stop all cleanup. A missing directory is also a blocker unless it qualifies as verified stale metadata below. Report the path, changed files or inspection error, and a recommended next step. Do not automatically stash, commit, reset, remove, or partially clean other candidates. The owning session decides how to preserve its changes.

A missing path may be treated as stale metadata only when `git worktree list --porcelain` explicitly marks its record `prunable`, the directory is confirmed permanently removed (not an unmounted volume or temporarily unavailable path), and owner/session and issue/PR checks confirm no active work depends on it. A locked record is not eligible. Record the path, administrative record ID, recorded HEAD and branch; preserve branch refs and unique commits. If any evidence is uncertain, stop and ask the owner. Do not run `git -C` against a verified missing directory.

## 2. Audit remote refs and metadata

When all existing worktrees are clean and any missing records are verified stale as above, run read-only previews:

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

Show the exact candidate, evidence, and command. Obtain explicit approval before each worktree removal or branch deletion, and for the exact set of stale metadata records before pruning. Immediately before executing, recheck every worktree for changes and confirm the candidate is still inactive. Stop if anything changed or any worktree is dirty.

Approved inactive worktree removal must use ordinary removal:

```bash
git worktree remove <approved-worktree-path>
```

After verifying integration into the intended target base (not merely its configured upstream), first attempt approved merged local branch deletion with:

```bash
git branch -d <approved-branch-name>
```

If ordinary worktree removal refuses, stop; never force-remove it. If `git branch -d` refuses, report why. Only for a verified squash-merged branch may you propose a separate, candidate-specific force deletion:

1. Verify the PR is merged into the intended target branch and its squash commit is reachable from the freshly fetched target.
2. Record the local branch tip and PR head SHA. Verify the local tip equals the merged PR head; if they differ, stop for manual review rather than guessing that later commits are disposable.
3. Compare the PR's aggregate patch with the squash commit's patch and confirm all intended changes were integrated. Investigate any mismatch; a merged PR label alone is insufficient evidence. Confirm no unique work remains to preserve.
4. Confirm the branch is not checked out in any worktree and no active issue/session depends on it.
5. Present the exact branch, tip, PR, squash commit and evidence, then obtain explicit approval for `git branch -D <approved-squash-merged-branch>`. Earlier approval for `-d` is not approval for `-D`.
6. Immediately before execution, recheck the worktree inventory and cleanliness, branch tip and target ref. Stop if anything changed.

This exception never permits deleting unverified or unmerged work. Hard resets, force-removing worktrees, and filesystem deletion remain prohibited. Do not delete remote branches as incidental cleanup; that requires a separate explicit request and review.

## 5. Refresh and verify

If remote-ref maintenance was requested and every existing worktree remains clean, with missing records verified as above, perform only the reviewed maintenance:

```bash
git fetch --prune origin
```

For verified stale metadata, `git worktree prune` operates repository-wide and does not take a candidate path. First show `git worktree prune --dry-run --verbose`, map every listed record to the verified stale inventory, and obtain explicit approval for that exact set. Immediately before executing `git worktree prune --verbose`, repeat the dry run and inventory checks. If the candidate set changes or includes any unverified record, stop. Use the same expiration settings for preview and execution; do not add `--expire now` to broaden an approved operation. Preserve the recorded branches and commits; metadata approval is not branch-deletion approval. If no records are listed, no pruning is needed.

Do not run unrelated garbage collection or rewrite history. Verify each changed candidate after its operation, then finish with:

```bash
git status --short --branch
git worktree list
git branch -vv
```

Report the current state, exact operations performed, preserved active worktrees, unresolved candidates, and one recommended next step. Distinguish previews from executed changes. Confirm documentation updates and their locations; never claim a failed operation succeeded.
