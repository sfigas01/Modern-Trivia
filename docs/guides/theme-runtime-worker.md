# Themed runtime worker and composition (STE-25 / STE-167 S11B-S11C)

S11B defines the bounded worker and spend-admission seam between durable themed-game admission and the existing source-first repositories. S11C assembles those repositories and maps the source registry, retrieval, extraction, fact derivation, independent fact review, question generation, independent question review, complete approval QA, one eligible repair and final roster reservation into that worker. The composition registers no route, scheduler, provider credential or production flag.

## Spend admission

Every physical paid request needs its own durable reservation before the provider callback can run. `server/lib/theme-budget.ts` serializes the short accounting transaction with a PostgreSQL advisory lock, derives the payer from the game’s immutable signed-in generation owner, and enforces three limits together:

- the account’s UTC-day total;
- the account’s trailing 168-hour total;
- the global UTC-day total.

Current settled charges count at their actual amount. Outstanding reservations, dispatched requests, and unknown outcomes count at the full reserved amount. An unresolved hold remains counted after its original day and review deadline, so a timeout or process failure cannot silently restore spending capacity. Generation and repair candidate slots are consumed in the same transaction and remain consumed for unknown outcomes.

The transaction commits and releases its database connection before the provider is called. An ambiguous commit acknowledgement prohibits the call. Exact dispatch-key replays never call the provider again; changed request or policy fingerprints conflict. Known outcomes settle actual usage and release unused capacity. A request that might have reached the provider keeps its full hold as `unknown`. Actual cost is recorded even if it exceeds the reservation, and any unacknowledged overrun blocks later dispatch. Operator acknowledgement is appended as a separate reconciliation decision; it never changes or removes the original charge.

## Worker behavior

The worker advances one leased job through the lifecycle stages. It checks for unresolved monetary dispatches before the first paid callback and after every stage item, and it renews the lease between source items and provider calls. Nonretryable failures are durable terminal failures; retryable failures remain paused. Pause metadata is fenced by the claim token and expected job state so a stale worker cannot overwrite a reclaimed job. S10 performs complete QA before approval. S9 is invoked at most once and only when S10 returns an explicitly repairable result. Approved questions are reserved for the locked roster in one transaction; neither S11B nor S11C activates gameplay or records exposure.

The room route accepts an injected scheduler. A committed waiting job is scheduled after Start and may be rescheduled by Progress; the database lease and the source-first repositories’ durable attempt records make those retries idempotent. Production currently injects no scheduler, model adapter, prices, source policy, prompts, or reviewer identities, so the feature remains dormant.

## S11C composition

`server/lib/theme-runtime-composition.ts` constructs the PostgreSQL lifecycle, budget, evidence, fact, question, approval, repair and reservation repositories under one explicit policy configuration. `server/lib/theme-runtime-pipeline.ts` provides the concrete stage mapping. A caller supplies an immutable, versioned work plan, stable source URLs and injected transports; deterministic IDs derived from the job, plan version, item and stage let repository outcomes replay after process replacement.

Every fact proposal, fact review, question-writing, question-review and repair callback passes through the monetary gateway before its physical transport runs. The request body and provider configuration are fingerprinted, and the plan supplies one durable hold deadline so a restart cannot change dispatch identity. A budget denial or unknown provider outcome is terminal for that job: the source-first repositories register their stable attempt before invoking a transport, so retrying the same attempt later would replay its terminal result. This is fail-closed and avoids hidden repeat spend.

Final reservation rechecks the approved question's current content, latest fact and question revisions, current evidence eligibility and exact evidence-review identity while holding the fact, revision and candidate locks in the same order used by generation and approval. It then rechecks participant history and active fact reservations before inserting the complete themed set. Changed or expired evidence, incomplete coverage or a replay mismatch rolls back the whole batch.

The deterministic S11C proof uses injected offline transports. Approval and repair QA are explicitly restricted to offline callbacks because their existing nested quality and semantic interfaces are not yet individually budget-wrapped. The runtime rejects any composition declared as live. A real PostgreSQL concurrency run was not performed locally because no disposable database URL is configured; the SQL boundary has focused transaction tests, and production remains dormant.

## Configuration

Both `VITE_THEME_ROUNDS=true` and `THEME_LIVE_GENERATION=true` are required, together with every explicit budget variable documented in `.env.example`. There are no default caps. `THEME_BUDGET_POLICY_VERSION` and the configured limits form a durable policy fingerprint for each allocation. Missing or inconsistent configuration fails closed.

Live provider/model selection, bounded request-cost calculations, budgeted nested QA transports with automatic SDK retries disabled, and paid cross-theme evaluation belong to the next slice. Production flags remain unset until that evaluation and the separate gameplay release decision pass.

Migration `0018_theme_runtime_budget.sql` adds account and policy identity to allocations, request fingerprints to attempts, preserves financial history when lifecycle rows are cleaned up, permits conservative `unknown` accounting and honest cost-overrun recording, and protects durable accounting identity fields from mutation.
