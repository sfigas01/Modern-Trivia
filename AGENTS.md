# Modern Trivia Agent Manual (Shared)

**Last updated:** 2026-03-06
**Maintainer:** Modern Trivia maintainers (owner: Stephanie Figas)
**Review cadence:** Monthly (or immediately after major workflow/tooling changes)

This file is intentionally shared across agent entrypoints:

- `AGENTS.md`
- `CLAUDE.md`
- `replit.md`

All three files must contain the same policy content so every agent operates with the same context and rules.

## Sync Contract

### Required behavior

1. If any shared rule is added/changed/removed in one file, mirror the exact policy update in the other two files in the same change.
2. Do not treat any one file as canonical-only for policy; all three are equal entrypoints for agents.
3. If all three files cannot be synced in one pass, do not finalize silently. Add an explicit mismatch note in all three files.

## Agent Team & Scope

This repository is actively worked on by multiple agents:

- Claude Code (desktop/web)
- Replit agent
- Codex
- Antigravity (multi-model)

All agents must follow the same operating rules in this manual.

## Current Priority

Follow the current prioritized work in Linear (Modern Trivia project) as the source of truth.

Do not assume a static priority (for example, feature freeze vs feature work) unless it is explicitly reflected in current Linear priorities/issues.

Default work categories:

1. Security
2. DevOps
3. Observability
4. Process
5. Critical bug fixes

If Linear priority changes, update this section in all three shared files in the same change.

## Security Rules

1. Never commit `.env` files, API keys, credentials, or secrets.
2. Use `.env.example` as the reference template.
3. Put production secrets in Replit Secrets.
4. If hardcoded secrets are found, stop and flag immediately.

## Git, Branch, and Worktree Rules

### Core workflow

1. Never push directly to `main`; use pull requests.
2. CI must pass before merge.
3. Do not bypass hooks with `--no-verify`.
4. Use issue-linked branch names with one normalized pattern set:
   - `feature/STE-XX-short-description`
   - `fix/STE-XX-short-description`
   - `chore/STE-XX-short-description`
   - `docs/STE-XX-short-description`
   - `codex/ste-XX-short-description` (when Codex-specific branch prefix is required)

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

## Linear Parent Sync Rule

When completing a Linear sub-issue with a `parentId`, always sync the parent in the same workflow unless the user explicitly says not to.

### Required sequence

1. Update/close the sub-issue first.
2. Read all current child issues of the parent and recompute progress (`done/total` and percentage).
3. Update parent description so status, completed/open/canceled child lists, critical path, and next recommended issue are current.
4. Add a parent comment summarizing refresh with concrete counts and issue IDs.
5. If parent sync fails, do not silently skip it.
6. If parent sync fails, add a sub-issue comment stating parent sync failed and why.
7. If parent sync fails, keep sub-issue in `In Review` instead of `Done` until parent sync is resolved.

## Quality Gates

Configured CI checks are the source of truth for required merge gates.

Reference:

- `.github/workflows/ci.yml`

At minimum, expect type-check, build, lint, tests, and dependency/security checks to pass when configured as required in CI.

If any required CI gate fails, fix it before merge.

## Commands & Environment

Use `package.json` scripts as the source of truth for runnable commands.

Common script entrypoints include:

- `npm run dev`
- `npm run db:push`
- `npm run build`
- `npm run check`
- `npm test`
- `npm run lint`
- `npm run lint:fix`
- `npm run format`

Use `.env.example` as the source of truth for required environment variables and expected names.

## Repository Context

Use canonical docs instead of duplicating volatile technical details in this manual.

Primary references:

- Product and project context: `README.md`, `docs/PRODUCT_ROADMAP.md`
- App behavior and state flow: `docs/guides/game_state_machine.md`
- Admin and operational setup: `docs/guides/admin_setup.md`, `docs/guides/ai_tool_setup.md`
- Code-level implementation details: source files under `client/`, `server/`, and `shared/`

If architecture, endpoints, or implementation details change, update the dedicated docs above rather than expanding this shared manual.

## Documentation & Process

1. Follow documentation standards in `docs/guides/documentation_standards.md`.
2. Keep roadmap updated in `docs/PRODUCT_ROADMAP.md` when scope changes.
3. Current doc structure:
   - Epics: `docs/epics/`
   - Features: `docs/features/`
   - Guides: `docs/guides/`
4. Use `.agent/workflows/` workflows when applicable.

## Trivia Content QA Rules

For QA sessions, read `docs/guides/qa_instructions.md` first.

Key references:

- Questions: `client/src/lib/questions.json`
- Editorial strategy: `CONTENT_STRATEGY.md`
- QA instructions: `docs/guides/qa_instructions.md`

Hard constraints:

1. Verify facts before changing content.
2. GlobalEh content must not be US-centric.
3. FreshPrints content must be recent.
4. Verify nationality before assigning regional tags.

## When Uncertain

1. Flag uncertainty early.
2. Preserve data integrity over speed.
3. Ask one focused clarification when needed.
