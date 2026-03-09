---
description: Sync a Linear parent issue after completing a sub-issue. Links PRs, updates progress, and keeps the parent issue current. Can be invoked standalone or triggered automatically when closing a sub-issue.
---

# Linear Parent Sync

Sync a parent issue in Linear after completing a sub-issue. Ensures the parent reflects current progress, PR links, and next steps.

## Inputs

If invoked standalone, determine the sub-issue from:
1. A sub-issue ID provided by the user, OR
2. The Linear issue linked to the current branch (parse from branch name `STE-XX`)

If the sub-issue has no `parentId`, inform the user and stop.

## Step 1: Verify PR link on sub-issue

Before marking a sub-issue as `Done`, verify it has a linked pull request in Linear.

- If a PR exists for this work but is not linked, link it now (use the PR URL from GitHub).
- If no PR exists and this is a code change, stop and warn: "Sub-issue STE-XX has no linked PR. Create and link a PR before closing, or confirm this is a no-code-change issue."
- If the user confirms it's a no-code-change issue (docs-only, process, etc.), proceed without a PR link.

## Step 2: Update the sub-issue

1. Move the sub-issue to `Done` (or the appropriate completed state).
2. Confirm the PR URL is attached to the sub-issue.

## Step 3: Sync the parent issue

1. Read all current child issues of the parent.
2. Recompute progress: `done/total` count and percentage.
3. For each child issue, collect its status and linked PR URL (if any).

### Update parent description

Update the parent issue description to include a persistent status table of all child issues:

```
## Sub-issue Progress: X/Y complete (Z%)

| Issue | Title | Status | PR |
|-------|-------|--------|----|
| STE-10 | Add endpoint | Done | #42 |
| STE-11 | Write tests | In Progress | #45 |
| STE-12 | Update docs | Todo | — |

**Next recommended:** STE-12 — Update docs
```

### Add parent comment

Add a comment to the parent issue summarizing this sync:

```
Parent sync: STE-10 completed (PR #42 merged).
Progress: 2/3 sub-issues done (67%).
Remaining: STE-12 (Todo).
```

## Step 4: Handle failures

1. If parent sync fails, do not silently skip it.
2. Add a comment to the sub-issue stating parent sync failed and why.
3. Keep the sub-issue in `In Review` instead of `Done` until parent sync is resolved.
