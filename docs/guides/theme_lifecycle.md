# Theme lifecycle B1

This guide documents the first runtime lifecycle slice for `theme-reliability-v1`. It adds durable game and preparation-job creation, worker leases, explicit job transitions, and spoiler-safe progress projection. It does not dispatch provider work, reserve budget or candidates, select questions, record history or exposures, integrate routes, or enable the feature.

## Creation and idempotency

`server/lib/theme-lifecycle.ts` validates the shared `createThemeGameRequestSchema` and requires an exact locked roster of two, three, or four unique identities matching `playerCount`. Creation writes one `theme_game_sessions` row in `preflight`, all roster rows, and one queued `theme_preparation_jobs` row in a single transaction.

The client idempotency key is bound to both a hashed owner key and a fingerprint covering the normalized request, room binding, roster order, and seats. An exact retry returns the original game and job. Reuse by a different owner or with a changed request, room, or roster fails with `idempotency_conflict`. Raw owner keys are never persisted.

The session uses the frozen plan from `themeGamePlanFor`: 40/60/80 questions, 50/75/100 candidate ceilings, and 16/24/32 opening buffers for two, three, or four participants.

## Worker leases

Each lease acquisition generates a fresh opaque claim token and atomically writes it with an expiry. A second worker cannot claim an active lease. After expiry, another worker can reclaim the job with a new token; the old token cannot renew, release, or transition it. Services must use a unique token per acquisition rather than a stable process identifier.

Renewal and release require the current token and an unexpired lease. Terminal jobs cannot be acquired or transitioned. A transition is a compare-and-set against the current status and lease, so another worker or lifecycle update cannot be overwritten.

## Job transitions

The lifecycle module owns an explicit transition graph. The normal path is:

`queued → researching → retrieving → extracting → writing → reviewing → qa → semantic_check → reserving → ready → completed`

Stages can move to `waiting`, `failed`, `canceled`, or `expired` where allowed. `shortfall` can wait or return to reservation. Terminal statuses have no outgoing transitions. Provider orchestration may skip only transitions explicitly represented by the graph; it must not write arbitrary status changes.

## Public progress

The projection returns the shared `publicThemeJobSchema` and includes counts, public stage, safe failure code, and timestamps. It does not include provider names, raw failures, prompts, source material, questions, answers, costs, identities, lease tokens, or internal request keys.

`canStart` remains false until both the game and job are `ready`, the opening count is complete, the 75/25 opening targets are met, and any required host mix decision is accepted. B1 does not update readiness counts, so a newly created game always projects `canStart: false`.

## Testing

`server/lib/theme-lifecycle.test.ts` covers deterministic creation, owner-bound retries, roster validation, lease acquisition and recovery, stale-worker rejection, legal transitions, terminal protection, and public projection with fixed time and token injection.

`server/lib/theme-lifecycle-postgres.test.ts` is opt-in through `THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL`. It must point only to a disposable PostgreSQL database. The test creates an isolated schema, applies migration `0009_theme_reliability_foundation.sql`, proves concurrent creation produces one game/job and concurrent lease acquisition produces one winner, then verifies expired-lease recovery and stale-token rejection.
