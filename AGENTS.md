# Modern Trivia Agent Manual (Shared)

This file is shared across `AGENTS.md`, `CLAUDE.md`, and `replit.md`. All three must contain identical content.

Multiple agents work on this repo (Claude Code, Replit, Codex, Antigravity). Expect uncommitted changes from other sessions.

## Sync Contract

1. If any rule is added/changed/removed in one file, mirror it in the other two in the same change.
2. All three files are equal entrypoints; none is canonical-only.
3. If sync cannot complete in one pass, add a mismatch note in all three files.

## Linear as Shared Memory

Linear (Modern Trivia project) is the source of truth for priorities, status, and context. All agents must keep it current.

1. **Before starting work:** Read the full issue description and comments for context. Check that no one else is already working on it (status should not be `In Progress`).
2. **When starting work:** Move the issue to `In Progress`.
3. **When opening a PR:** Move the issue to `In Review`. Include the Linear issue ID (e.g., `STE-XX`) in the PR title or description.
4. **When work is blocked or paused:** Comment on the issue explaining why, so other agents and the user have context.
5. Do not assume a static priority unless explicitly reflected in Linear.

## Security Rules

1. Never commit `.env` files, API keys, credentials, or secrets.
2. Use `.env.example` as the reference template for environment variables.
3. Put production secrets in Replit Secrets.
4. If hardcoded secrets are found, stop and flag immediately.

## Git, Branch, and Worktree Rules

### Core workflow

1. Never push directly to `main`; use pull requests.
2. CI must pass before merge.
3. Do not bypass hooks with `--no-verify`. Pre-commit hooks run `lint-staged` (eslint + prettier) and `tsc --noEmit`.
4. Pull or rebase from `main` before pushing to avoid merge conflicts.
5. Keep commits atomic: one logical change per commit. Do not bundle unrelated changes.
6. Never commit generated files (`node_modules/`, `dist/`, `.DS_Store`, build output).
7. Use issue-linked branch names:
   - `feature/STE-XX-short-description`
   - `fix/STE-XX-short-description`
   - `chore/STE-XX-short-description`
   - `docs/STE-XX-short-description`
   - `codex/ste-XX-short-description` (Codex-specific)

### Hygiene requirements

1. At task start and before handoff, check git state:
   - `git status --short --branch`
   - `git worktree list`
   - local branch inventory
2. Do not leave temporary worktrees behind; remove them when done and run `git worktree prune`.
3. Do not leave abandoned dirty state in old worktrees/branches; either commit, stash with a clear dated message, or explicitly report why cleanup was not possible.
4. Delete local branches that are fully merged into the target base branch; never delete unmerged branches without explicit user approval.
5. Handoff should leave a clean working tree unless the user asked to preserve local changes; if anything remains, provide a concise inventory.

### Worktree continuation guardrails

1. Before continuing work in an existing worktree, verify it still maps to an active issue/task and has not already been completed.
2. Treat the worktree as "do not continue" and warn the user when any of these are true:
   - the current branch is already merged into the target base branch
   - the linked PR is merged/closed, or the linked Linear issue is `Done`/`Canceled`
   - the worktree has unrelated dirty changes from a different task and the user did not explicitly ask to preserve them
   - issue-specific work is being done directly on `main` instead of an issue branch/worktree
3. If a "do not continue" condition is hit, stop and provide a concise warning plus the recommended next step (new branch/worktree, cleanup, or explicit override).
4. Do not silently continue after warning; require explicit user confirmation to override.

## Commit Messages

Use Conventional Commits: `<type>(<scope>): <description>`

- Types: `feat`, `fix`, `chore`, `docs`
- Scopes should match area of change (e.g., `api`, `deps`, `client`)
- Imperative mood, lowercase, no trailing period
- Examples: `fix(api): validate count parameter`, `feat(client): add dark mode toggle`

## Testing

- Framework: Vitest (not Jest). Use `vitest` APIs.
- Test files: `*.test.ts` / `*.test.tsx`
- Run `npm test` before marking work complete.
- If tests fail: fix them. Do not skip, mock around, or ignore failures.

## Error Handling

- Server routes: try/catch with `console.error('Context:', error)` + appropriate HTTP status codes.
- Validation: use Zod schemas. Return 422 for validation errors, 400 for bad input, 500 for server errors.
- Do not swallow errors silently.

## Linear Parent Sync

When closing a sub-issue with a `parentId`, follow `.agent/workflows/linear-parent-sync.md` to sync the parent. This workflow verifies PR links, updates parent progress, and can be invoked standalone.

## Pull Requests

1. Include the Linear issue ID in the PR title (e.g., `feat(api): add endpoint [STE-42]`) or link it in the description.
2. Write a brief description: what changed and why. Reviewers should understand the PR without reading every diff.
3. Keep PRs focused on a single issue or feature. Split large changes into smaller PRs when possible.

## Quality Gates

CI gates (`.github/workflows/ci.yml`) must pass before merge. Fix failures, don't bypass.

## Documentation Confirmation

When finishing any task, **always confirm to the user what documentation was updated**. Report:

1. **What** was documented — issue state change, release notes, PR description, test coverage, README/guide edits, config changes, etc.
2. **Where** it lives — Linear issue ID + URL, GitHub release tag, file path, PR number, etc.

This applies to every task completion. Specific expectations:

- **Linear:** Move the issue to the correct state. Leave a closing comment summarizing what was shipped (what changed, what files, any trade-offs or follow-ups).
- **GitHub releases:** Create a release when shipping a user-visible fix or feature. Bug fixes → patch version (e.g. v0.5.1). New features → minor version (e.g. v0.6.0). Breaking changes → major version.
- **PR descriptions:** Must clearly describe what changed and why before requesting merge.
- **`CLAUDE.md` / `AGENTS.md` / `replit.md`:** Update all three files in sync whenever agent workflow rules change. See Sync Contract above.

Do not report a task as complete until documentation is confirmed. The user's signal that this is working: every task handoff includes an explicit "Documentation updated" confirmation listing the what and where.

## References

- Product context: `README.md`, `docs/PRODUCT_ROADMAP.md`
- Guides and standards: `docs/guides/`
- Documentation standards: `docs/guides/documentation_standards.md`
- QA work: read `docs/guides/qa_instructions.md` first
- Workflows: `.agent/workflows/`

## Permission Gate

1. Ask for explicit approval before any major action:
   - Implementing or changing product behavior
   - Editing more than 1-2 source files
   - Dependency changes, database migrations, or CI/workflow changes
   - Any destructive git action (`reset --hard`, branch delete, force push, rebase)
2. Do not ask for approval for minor actions:
   - Read-only inspection commands
   - Small git hygiene commands (`git status`, `git diff`, `git log`, `git worktree list`, `git branch --list`, `git add`)
3. For major actions, pause and ask: "Proceed with <action>?"

## When Uncertain

1. Flag uncertainty early.
2. Preserve data integrity over speed.
3. Ask one focused clarification when needed.
