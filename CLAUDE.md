# Modern Trivia Agent Manual (Shared)

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

Feature development is paused. Focus on security, DevOps, observability, process hardening, and critical bug fixes.

Primary work categories:

1. Security
2. DevOps
3. Observability
4. Process
5. Critical bug fixes

Track project work in Linear under the Modern Trivia project.

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
4. Use issue-linked branch names, e.g. `feature/STE-XX-short-description`, `fix/STE-XX-short-description`, or `codex/ste-XX-short-description`.

### Hygiene requirements

1. At task start and before handoff, check git state:
   - `git status --short --branch`
   - `git worktree list`
   - local branch inventory
2. Do not leave temporary worktrees behind; remove them when done and run `git worktree prune`.
3. Do not leave abandoned dirty state in old worktrees/branches; either commit, stash with a clear dated message, or explicitly report why cleanup was not possible.
4. Delete local branches that are fully merged into the target base branch; never delete unmerged branches without explicit user approval.
5. Handoff should leave a clean working tree unless the user asked to preserve local changes; if anything remains, provide a concise inventory.

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

Required checks before merge:

1. TypeScript check: `npm run check`
2. Build: `npm run build`
3. Lint: `npm run lint`
4. Tests: `npm test`
5. Dependency audit and security checks in CI

If any required gate fails, fix before merge.

## Commands & Environment

Common commands:

- Dev: `npm run dev`
- DB push: `npm run db:push`
- Build: `npm run build`
- Type-check: `npm run check`
- Test: `npm test`
- Lint: `npm run lint`
- Lint fix: `npm run lint:fix`
- Format: `npm run format`

Required environment variables:

- `DATABASE_URL`
- `SESSION_SECRET`
- `PORT`
- `LINEAR_API_KEY`

## Product + Architecture Context

Modern Trivia is a browser-based multiplayer trivia game (local play) with dispute resolution tooling for admins.

Core stack:

- Frontend: React 18 + TypeScript + Vite + Wouter + TanStack Query + Tailwind + shadcn/ui
- Backend: Node + Express + TypeScript
- Data: PostgreSQL + Drizzle ORM
- Auth: Replit OIDC/Auth + session storage in Postgres

Important app areas:

- Gameplay loop/state machine: `SETUP -> QUESTION -> VERIFYING -> REVEAL -> SCORE_UPDATE -> GAME_OVER`
- Admin pages:
  - `/admin` (question management)
  - `/admin/disputes` (dispute review + resolution)
  - `/admin/settings` (admin configuration)
- Dispute API endpoints:
  - `POST /api/disputes`
  - `GET /api/disputes`
  - `POST /api/disputes/:id/analyze`
  - `PATCH /api/disputes/:id`
  - `DELETE /api/disputes`

Primary file areas:

- `client/src/` for frontend
- `server/` for backend
- `shared/` for shared schema/types
- `docs/` for product/process docs

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
