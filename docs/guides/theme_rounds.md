# Themed games — lean MVP (STE-167)

Themed games use source-reviewed inventory by default. Live generation is experimental and opt-in. A host
enters a free-text theme (e.g. "baseball"), adjusts the suggested categories,
and starts a normal-length multiplayer game whose questions lean toward that
theme. The server starts only when a complete reviewed set is available.

This is deliberately lean. The full production plan (durable jobs, atomic
reservations, the 30-day/last-5-games eligibility system, two-rounds-ahead
replenishment, cost/telemetry benchmarking, dad-joke waiting screen, live-spend
gating) remains the plan of record in Linear **STE-167** and is **not** built
here. Components here are self-contained so that work can extend or replace them.

## Feature flag

Everything is gated behind **`VITE_THEME_ROUNDS`** (documented by name in
`.env.example`). It is read on:

- the **client** (Vite build) — `client/src/lib/featureFlags.ts` → `THEME_ROUNDS`;
- the **server** (runtime) — `server/lib/theme-game.ts` → `isThemeRoundsEnabled()`.

When off (the default), the theme UI is hidden, the theme endpoints return 404,
a `theme` sent to room creation is ignored. The source-evidence eligibility rule for
automatically approved AI rows applies to ordinary category play regardless of this UI flag.

## Flow

1. **Setup (HostGame).** With the flag on, the host sees an optional **Theme**
   input and a **Suggest** button. Suggest calls `POST /api/theme/suggest`,
   which returns related canonical categories; they are applied to the existing
   category picker so the host can adjust them. The theme is sent on room
   creation and stored on the room (`rooms.theme`).
2. **Lobby.** A themed room renders a self-contained `ThemedStartButton`
   (instead of the ordinary Start button). Pressing it calls
   `POST /api/rooms/:code/theme-start`, which validates the lobby (host, ≥2
   players, themed room) and kicks off **best-effort background preparation**,
   returning `202` with initial progress.
3. **Waiting UX.** The button polls `GET /api/rooms/:code/theme-progress` and
   shows "generating… X of N ready" (reused vs. newly written). No durable jobs
   or recovery — if the server restarts mid-prep, the room stays in the lobby
   and the host can retry.
4. **Play.** When enough questions are ready, preparation transitions the room
   to `active`; the room's ordinary snapshot poll flips the client into the
   game. At reveal, AI-generated (`player_ai`) questions show an **AI-generated**
   badge and the game shows a **theme** badge, alongside the existing source link.

## Publishing the reviewed baseball set

The included set contains **40 source-reviewed baseball terminology questions**. It supports a five-round, two-player game. It is a limited release set, not evidence that arbitrary live themes now generate reliably. Existing seen-question tiering still permits repeats when inventory is exhausted; one set is not enough for repeat-free games. Larger games require more reviewed content and will remain in the lobby if the set is short.

1. Preserve Replit-local changes and reconcile them with this PR before pulling. Do not reset or overwrite them. After the PR is merged and CI passes, sync Replit with `git pull origin main`.
2. Keep `THEME_LIVE_GENERATION=false`. Set `VITE_THEME_ROUNDS=true` in the intended Replit environment, at both build and runtime.
3. Validate the pack without connecting to a database:

   ```sh
   npx tsx script/import-reviewed-baseball.ts
   ```

4. Import against the intended **development** database first:

   ```sh
   npx tsx script/import-reviewed-baseball.ts --apply
   ```

   This inserts missing stable IDs in a transaction, never overwrites existing rows, and prints counts without answers. A rerun preserves administrator edits and withdrawals. Require `40/40` reviewed/approved rows in its output. An edited or withdrawn existing row must be reviewed separately; import does not silently reapprove it.

5. Test theme `baseball`, category Sports, two players, five rounds. The full game must finish with 40 questions. After owner approval, run the same import in the production environment and publish the tested build. Development and production databases may be separate in Replit; importing into development alone does not prepare production.

No production import, paid generation or deployment was performed as part of preparing this change. The pack lives in `server/content/baseball-reviewed.ts`; every question includes an MLB source URL and a short reviewed excerpt. The content review was performed on 2026-09-19. Re-review when changing wording, aliases, difficulty, pillar, tags or sources; the previous review no longer matches after such edits. Current evidence is version/content based, not automatically refreshed from changing websites.

## Approval and source evidence

`server/lib/source-review.ts` is the shared approval boundary:

- Themed reuse and category fallback require `approved` status plus a matching source-review version and exact reviewed content snapshot.
- Previously auto-approved `player_ai` rows without evidence or complete quality checks cannot enter themed **or ordinary category** selection. Legacy curated category rows retain their existing policy; this is not a production content sweep.
- Missing coherence/obviousness results are `flag`, not an assumed pass. A factual fail stays fail even when other checks are incomplete.
- Experimental generation requires factual/coherence/obviousness passes for the same question ID, no high static-QA findings, retrieved evidence, and completed semantic filtering before approval.
- Retrieval accepts a small exact-host HTTPS allowlist, refuses redirects/credentials/custom ports, and bounds time, response bytes and text size. Unreadable or unsupported sources withhold the question.
- The evidence reviewer reads actual source text and checks the premise, precise scope, explanation and accepted answers. It must return literal supporting passages that include the primary answer. Invented quotations and missing results are rejected. This reduces unsupported approvals; it does not prove that an AI verdict is always correct.
- Room activation rechecks selected rows under locks, so withdrawals or edits during preparation cause a lobby error rather than starting with invalidated content.

## Question sourcing (`server/lib/theme-game.ts`)

`prepareThemedQuestions` needs exactly `numRounds × players × 4` questions.

**Default (`THEME_LIVE_GENERATION=false` or unset):** select source-reviewed, approved questions matching the theme and chosen categories. Return immediately without AI requests, paid retries or category fill. A short set leaves the room in the lobby with an explicit count. Theme category suggestions use the existing local heuristic.

**Experimental (`THEME_LIVE_GENERATION=true`):** reuse first, then generate missing candidates with strict quality and source review, followed by semantic filtering. Eligible survivors are persisted as approved `player_ai` rows. Category fallback also requires valid source evidence. The existing limit of 120 requested candidates and 20 batches remains; repairs and evidence-review requests are additional calls, so this is not a dollar cap. No reliable cold-theme yield or latency claim is made. Do not enable for production merely because mocked tests pass; benchmark authorized live runs and independently review their accepted content first.

The full STE-167 durable-job, reservation, strict-history and cost-budget plan remains deferred.

## Schema changes (migration `0008_theme_rounds.sql`)

- `questions.origin` — `varchar(20) NOT NULL DEFAULT 'curated'`. Values:
  `'curated'` (legacy/hand-curated/seeded) and `'player_ai'` (generated for a
  theme). `player_ai` rows are ordinary approved library questions and are **not**
  excluded from normal play.
- `rooms.theme` — nullable `varchar(60)`. `NULL` ⇒ ordinary category game.

Both columns are added idempotently (`ADD COLUMN IF NOT EXISTS`) so the SQL
migration and `db:push` paths converge.

## API

| Method + path                         | Purpose                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `POST /api/theme/suggest`             | `{ theme }` → `{ theme, categories }`. Rate-limited (`aiLimiter`). 404 when flag off.                           |
| `POST /api/rooms/:code/theme-start`   | Host-only. Validates the lobby, starts background prep, returns `202` with initial progress. 404 when flag off. |
| `GET /api/rooms/:code/theme-progress` | `{ status, ready, total, reused, generated, error }` for the waiting UX. 404 when flag off / no prep.           |

The ordinary `POST /api/rooms/:code/start` rejects themed rooms with `409` so a
themed game always goes through the async path.

## Tests

- `server/lib/theme-game.test.ts` — sourcing (reuse-first, persistence as
  `approved`/`player_ai`, candidate ceiling), slug/tag, category suggestion
  fallback, seen-input union, progress store.
- `server/routes.theme.test.ts` — the three new routes (validation, host/roster
  checks, flag gating, progress passthrough).
- Client: `HostGame.theme.test.tsx`, `ThemedStartButton.test.tsx`, and reveal
  labelling in `RevealView.test.tsx`.
- E2E: `e2e/theme-rounds.spec.ts` drives the themed setup → lobby → progress →
  play flow with the theme/room endpoints intercepted (generation can't run in
  CI).

## Validation added for the publishing fix

- `server/lib/source-review.test.ts`: incomplete evidence, wrong-answer/confident-pass regression, source restrictions, invented quotations, content edits and strict quality checks.
- `server/lib/source-review.database.test.ts`: actual PostgreSQL JSONB eligibility, all 40 rows, legacy AI, edited answers/aliases and withdrawn content. Opt in only with `THEME_REVIEW_TEST_DATABASE_URL` pointing at a disposable database.
- `server/lib/theme-game.test.ts`: flagged/incomplete/unsupported candidates and 0/26/40 reviewed-inventory outcomes with no generation calls in default mode.
- `e2e/theme-rounds.spec.ts`: an inventory shortfall keeps the host in the lobby.
- `e2e/theme-reviewed.spec.ts`: real HTTP server, PostgreSQL, two players, canonical answers, synchronized scores and all 40 questions through game over; no AI calls or endpoint mocks. Requires the local disposable `trivia_test` database used by CI.

Linear follow-up creation/update was blocked by this session's connector approval policy. STE-167 remains the reference for the merged feature; this fix is documented by its PR and this guide. No claim is made that the deferred full plan is complete.

### Local validation evidence

The complete Vitest run passed 701 tests across 66 files, including both optional PostgreSQL suites against a disposable database. TypeScript and ESLint passed (existing lint warnings remain). Dependency audit found no high/critical issues; moderate advisories remain unchanged. The production bundle built successfully.

The real-server E2E passed with Linux Node 22, PostgreSQL 16, live generation disabled and an unreachable test AI endpoint. Two players answered all 40 questions correctly (including accepted aliases), completed five rounds and observed matching final scores. All 40 source excerpts were checked against retrieved MLB pages. Pack dry-run reported 40 questions and zero high QA findings.

Local browser UI checks could not launch Chromium because the macOS sandbox denied its process permissions. These tests remain enabled in GitHub CI and must pass there before merge. The Mac server startup also uses an existing Linux-only socket option; the real-server check therefore ran the unchanged production bundle in Linux. No tests were disabled to bypass either environment limitation.
