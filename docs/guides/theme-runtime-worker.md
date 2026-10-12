# Themed runtime worker and spend admission (STE-25 / STE-167 S11B)

S11B defines the bounded orchestration and spend-admission seam between durable themed-game admission and the existing source-first repositories without enabling a live provider. The injected worker contract requires generation, independent evidence review, final approval, optional one-repair, and roster-reservation adapters. Final approval must run the full static, quality, and semantic QA suite. The next slice supplies and integration-tests the concrete repository composition before any provider is enabled.

## Spend admission

Every physical paid request needs its own durable reservation before the provider callback can run. `server/lib/theme-budget.ts` serializes the short accounting transaction with a PostgreSQL advisory lock, derives the payer from the game’s immutable signed-in generation owner, and enforces three limits together:

- the account’s UTC-day total;
- the account’s trailing 168-hour total;
- the global UTC-day total.

Current settled charges count at their actual amount. Outstanding reservations, dispatched requests, and unknown outcomes count at the full reserved amount. An unresolved hold remains counted after its original day and review deadline, so a timeout or process failure cannot silently restore spending capacity. Generation and repair candidate slots are consumed in the same transaction and remain consumed for unknown outcomes.

The transaction commits and releases its database connection before the provider is called. An ambiguous commit acknowledgement prohibits the call. Exact dispatch-key replays never call the provider again; changed request or policy fingerprints conflict. Known outcomes settle actual usage and release unused capacity. A request that might have reached the provider keeps its full hold as `unknown`. Actual cost is recorded even if it exceeds the reservation, and any unacknowledged overrun blocks later dispatch. Operator acknowledgement is appended as a separate reconciliation decision; it never changes or removes the original charge.

## Worker behavior

The worker advances one leased job through the lifecycle stages. It checks for unresolved monetary dispatches before the first paid callback and after every stage, and it renews the lease between provider calls. Nonretryable failures are durable terminal failures; retryable failures remain paused. Pause metadata is fenced by the claim token and expected job state so a stale worker cannot overwrite a reclaimed job. S10 performs complete QA before approval. S9 is invoked at most once and only when S10 returns an explicitly repairable result. Approved questions are reserved for the locked roster through an injected transaction boundary; S11B never activates gameplay.

The room route accepts an injected scheduler. A committed waiting job is scheduled after Start and may be rescheduled by Progress; the database lease and the source-first repositories’ durable attempt records make those retries idempotent. Production currently injects no scheduler, model adapter, prices, source policy, prompts, or reviewer identities, so the feature remains dormant.

## Configuration

Both `VITE_THEME_ROUNDS=true` and `THEME_LIVE_GENERATION=true` are required, together with every explicit budget variable documented in `.env.example`. There are no default caps. `THEME_BUDGET_POLICY_VERSION` and the configured limits form a durable policy fingerprint for each allocation. Missing or inconsistent configuration fails closed.

Provider/model selection, bounded request-cost calculations, authoritative policy composition, nested QA transports with automatic SDK retries disabled, and paid cross-theme evaluation belong to the next slice. Production flags remain unset until that evaluation and the separate gameplay release decision pass.

Migration `0018_theme_runtime_budget.sql` adds account and policy identity to allocations, request fingerprints to attempts, preserves financial history when lifecycle rows are cleaned up, permits conservative `unknown` accounting and honest cost-overrun recording, and protects durable accounting identity fields from mutation.
