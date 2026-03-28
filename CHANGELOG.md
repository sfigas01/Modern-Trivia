# Changelog

All notable changes to Modern Trivia will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No unreleased changes._

## [v0.4.0] - 2026-03-27

### Added

- **Guardian Lite content guardrails** — Server-side validation layer that screens AI-generated trivia for quality, accuracy, and content-policy compliance before questions enter the staging queue (STE-8)
- **Staging database migration** — New `staging_questions` table with status tracking, enabling a proper review pipeline for AI-generated content (STE-32)
- **Staging generation with validation** — End-to-end pipeline: generate → validate → stage, with status filtering in the admin UI (STE-32)
- **Time-based question recycling with escalating cooldown** — When the pool runs low, previously-seen questions become eligible again after an increasing cooldown period; unseen questions are always preferred (STE-120)
- **Inline field editing** — Hover any field in the admin question panel to reveal an edit pencil; saves via a single-field `PATCH` without touching other fields (STE-117)
- **AI fix suggestions** — Fields flagged by QA show a `Fix with AI` button that calls a field-specific AI prompt and pre-fills the corrected value for admin review before saving (STE-117)
- **Audit changelog** — Every field save writes an old→new record to a new `question_edits` table; the `ChangeLog` component in each question's detail panel shows full edit history with AI-assisted edits clearly badged (STE-117)
- **Bulk Accept All** — Green _Accept All_ button in the staging queue header promotes every pending question to approved in a single operation via `POST /api/staging/promote-all` (STE-118)
- **Spoiler-free staging review** — Answers hidden by default in the staging queue with a per-card _Reveal answer_ toggle, so reviewers can scan question text without spoiling answers (STE-118)
- **Spoiler-free question browser** — Answer removed from the collapsed row summary in the admin question browser; still visible in the expanded edit panel (STE-118)
- **Mixed pillar option** — Question generation can now produce questions across multiple pillars in a single batch
- **Three visual game variations** — Three distinct visual layouts for the trivia game component
- **AI source verification** — AI-generated questions now include verifiable source information
- **Question auto-repair** — Failed question generations are automatically retried with corrective prompts
- **Category QA tags** — Category names added to question tags for improved quality auditing
- **Game page smoke test** — UI-level gameplay test covering question → reveal → round score → next round → game over
- **Game mechanics regression coverage** — Tests for full-question consumption before `GAME_OVER`, duplicate score guards, and short question-pool scenarios
- **Husky pre-push hook** — Runs `npm test` before pushes so gameplay regressions are caught locally
- **Linear parent sync workflow** — Automated workflow for syncing parent issue status when sub-issues close

### Changed

- Trivia categories updated to use consistent naming conventions
- Streamlined agent manual and added linear-parent-sync workflow docs
- Expanded game mechanics regression coverage to verify full-question consumption before `GAME_OVER`, guard against duplicate score advancement, and cover short question-pool scenarios
- Extended setup-screen regression coverage to keep the insufficient-question warning visible during game configuration

### Fixed

- Removed auto-accept toggle from the staging generate form — it was causing a React infinite render loop due to Radix UI `Switch` + `Label htmlFor` double-toggling (STE-118)
- Bulk status update now uses `inArray()` instead of a raw SQL template, fixing a query-builder safety issue
- Seen-questions upsert is now idempotent against replays

### Dependencies

- `react-day-picker` 9.11.1 → 9.14.0
- `react-resizable-panels` 4.7.1 → 4.7.2
- `@hookform/resolvers` 3.10.0 → 5.2.2
- `zod-validation-error` 4.0.2 → 5.0.0
- `@typescript-eslint/eslint-plugin` bumped
- `actions/upload-artifact` 4 → 7

## [v0.3.0] - 2026-03-07

### Added

- **Questions in database** — Migrated trivia questions from static JSON to PostgreSQL with seen-question tracking (STE-81)
- **Game flow regression tests** — Automated test suite covering core game states and CI quality gate (STE-98)
- **Dependabot** — Automated dependency scanning and security audit baseline (STE-59)
- **Husky pre-commit hooks** — Lint-staged enforcement on every commit (STE-57)
- **AGENTS.md** — Unified shared operating policies for AI coding agents
- **Postgres env template** — `.env.example` with database connectivity checks (STE-13)
- **Dispute workflow improvements** — Editable dispute fix workflow with admin guide refresh (STE-16, STE-17, STE-78)
- **Question quality audit** — Scripts to audit question database quality with CI-strict mode
- **Linear CLI utility** — Scripts to manage and comment on Linear issues from the command line
- **Git cleanup workflow** — Automated branch and worktree cleanup

### Changed

- Display question counts and insufficient-question warnings on the game home screen
- Improved game startup flow to prevent premature game-over screen
- Updated social media sharing image

### Fixed

- Rate limiting now correctly handles IPv6 addresses
- Image provider fails fast on empty responses (STE-54)

### Security

- Secrets guidance and env template added (STE-53)
- Updated dependencies: `pg` 8.19.0, `vite` 7.3.1, `eslint` 10.0.2, `framer-motion` 12.34.0, `esbuild` 0.27.3, `lucide-react` 0.564.0, `bufferutil` 4.1.0, `react-resizable-panels` 4.7.0, `actions/checkout` v6, `actions/setup-node` v6

## [v0.2.0] - 2026-02-15

### Added

- **Vitest test suite** — Unit and integration tests for game logic (STE-55)
- **ESLint & Prettier** — Code quality tooling with CI enforcement (STE-56)
- **CI quality gates** — ESLint checks enforced in GitHub Actions pipeline
- **State machine documentation** — `docs/STATE_MACHINE.md` describing game flow

### Changed

- Applied Prettier formatting across the entire codebase
- Resolved merge import regression in batch utilities

## [v0.1.0] - 2026-01-01

### Added

- **Core trivia gameplay** — Team-based (2-6 teams) multiplayer trivia party game
- **200 trivia questions** — Canadian-focused content and global general knowledge, organized by category, difficulty, and regional tags
- **Category selection** — Filter by Geography, Science, History, Music, Sports, Pop Culture, and more
- **Intelligent answer verification** — Fuzzy matching (80% similarity threshold) with support for punctuation, articles, number words, and case-insensitivity
- **Difficulty-based scoring** — Easy (±1), Medium (±2), Hard (±3) points
- **Round system** — Team rotation every 4 questions with round score displays
- **Replit authentication** — Secure OpenID Connect-based login
- **Dispute system** — Challenge answers with explanations (requires authentication)
- **Admin panel** — Add, edit, delete custom questions; manage dispute logs; grant/revoke admin roles
- **Role-based access control** — Admin-only features protected by database roles
- **Responsive design** — Mobile-friendly interface with Tailwind CSS and Framer Motion animations
- **PostgreSQL database** — Session storage, user accounts, disputes, admin roles, app config
- **Production deployment** — Replit autoscale deployment with build pipeline

### Fixed

- Session handling uses memory store fallback when database is unavailable
- Trivia questions updated with factual corrections and improved explanations

[v0.4.0]: https://github.com/sfigas01/Modern-Trivia/releases/tag/v0.4.0
[v0.3.0]: https://github.com/sfigas01/Modern-Trivia/releases/tag/v0.3.0
[v0.2.0]: https://github.com/sfigas01/Modern-Trivia/releases/tag/v0.2.0
[v0.1.0]: https://github.com/sfigas01/Modern-Trivia/releases/tag/v0.1.0
