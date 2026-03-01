# AGENTS.md

## Instruction Sync Rule

`AGENTS.md` and `CLAUDE.md` must stay aligned for shared agent-operating policies.

### Required behavior

1. If either file is updated with a new shared rule, mirror that rule in the other file in the same change.
2. Do not treat either file as canonical-only; both must remain in sync.
3. If you cannot sync both files in the same pass, do not finalize the update without explicitly noting the mismatch in both files.

## Linear Parent Sync Rule

When completing a Linear sub-issue that has a `parentId`, always perform parent synchronization in the same workflow.

### Required sequence

1. Update/close the sub-issue first.
2. Read all current child issues of the parent and recompute progress (`done/total` and percentage).
3. Update the parent issue description so status, completed/open child lists, critical path, and next recommended issue are current.
4. Add a parent issue comment summarizing the refresh with concrete numbers and issue IDs.
5. If parent sync fails, do not silently skip it.
6. If parent sync fails, add a sub-issue comment stating parent sync failed and why.
7. If parent sync fails, leave the sub-issue in `In Review` instead of `Done` until parent sync is resolved.

### Scope

Apply this rule to all Linear work in this repository unless the user explicitly asks not to update the parent.

## Git Hygiene & Worktree Cleanliness Rule

Agents must proactively keep local git state clean so the user does not need to manually reconcile stale branches/worktrees.

### Required behavior

1. At task start and before handoff, check git state (`git status --short --branch`, `git worktree list`, and local branch inventory) and account for dirty files, stashes, and temporary worktrees.
2. Do not leave temporary worktrees behind after task completion; remove them when no longer needed and run `git worktree prune`.
3. Do not leave accidental uncommitted changes in abandoned branches/worktrees; either commit, stash with a clear dated message, or explicitly report why cleanup was not performed.
4. After work is merged or no longer needed, delete local branches that are fully merged into the target base branch; never delete unmerged branches without explicit user approval.
5. Final handoff should leave a clean working tree unless the user explicitly asked to keep local changes; if anything remains, provide a concise inventory of what and why.
