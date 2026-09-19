# Themed games — lean MVP (STE-167)

The minimum playable slice of on-demand, player-requested themed games. A host
enters a free-text theme (e.g. "baseball"), adjusts the suggested categories,
and starts a normal-length multiplayer game whose questions lean toward that
theme — reusing eligible approved questions first and generating the rest
through the existing Guardian quality pipeline.

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
a `theme` sent to room creation is ignored, and **ordinary category games are
completely unchanged.**

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

## Question sourcing (`server/lib/theme-game.ts`)

`prepareThemedQuestions` sources exactly `numRounds × teams × 4` questions (the
same math as the ordinary `/start`):

1. **Reuse first.** Select eligible approved questions already tagged
   `theme:<slug>` (within the room's categories), ordered by the existing
   room-wide seen-question tiering (STE-81 / STE-273) — reused **as-is**.
2. **Generate the remainder.** For the shortfall, call the existing
   `generateQuestions` (coverage planning, static QA, fact/coherence/obviousness,
   bounded repair — STE-247/249/228) then `filterNovelQuestions` (semantic
   novelty — STE-26). Only strict passes with no high QA findings survive.
   Accepted questions are persisted immediately as **`approved`** rows with
   **`origin = 'player_ai'`** and the `theme:<slug>` tag, so they enrich the
   shared library for everyone (including ordinary category games).
3. **Top up.** If generation underperforms, fill from approved questions in the
   room's categories so a full-length game is always assembled; otherwise prep
   reports an error and the host can retry, broaden the theme, or reduce rounds.

Play order is theme-leaning: freshly generated (bespoke, never-seen) first, then
reused theme questions, then any category fill.

### Cost guard

A simple per-game **candidate ceiling** (`THEME_MAX_GENERATED_CANDIDATES`)
bounds how many candidates the pipeline is asked to produce, alongside the
existing `aiLimiter` on the routes. There is no global daily budget system (full
plan).

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
