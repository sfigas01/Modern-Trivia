# Themed runtime worker and composition (STE-25 / STE-167 S11B-S12A)

S11B defines the bounded worker and spend-admission seam between durable themed-game admission and the existing source-first repositories. S11C assembles those repositories and maps the source registry, retrieval, extraction, fact derivation, independent fact review, question generation, independent question review, complete approval QA, one eligible repair and final roster reservation into that worker. The composition registers no route, scheduler, provider credential or production flag.

S12A adds the last durable controls that can be completed without selecting or contacting a provider. Each preparation job can receive one immutable, hash-verified preview runtime plan with fixed source items, policy identity and hold deadline. A database singleton is created disabled and acts as an emergency stop for new dispatch admissions. S12A still does not register a scheduler, route, provider adapter or application bootstrap hook.

## Spend admission

Every physical paid request needs its own durable reservation before the provider callback can run. `server/lib/theme-budget.ts` serializes the short accounting transaction with a PostgreSQL advisory lock, derives the payer from the game’s immutable signed-in generation owner, and enforces three limits together:

- the account’s UTC-day total;
- the account’s trailing 168-hour total;
- the global UTC-day total.

Current settled charges count at their actual amount. Outstanding reservations, dispatched requests, and unknown outcomes count at the full reserved amount. An unresolved hold remains counted after its original day and review deadline, so a timeout or process failure cannot silently restore spending capacity. Generation and repair candidate slots are consumed in the same transaction and remain consumed for unknown outcomes.

The transaction commits and releases its database connection before the provider is called. An ambiguous commit acknowledgement prohibits the call. Exact dispatch-key replays never call the provider again; changed request or policy fingerprints conflict. Known outcomes settle actual usage and release unused capacity. A request that might have reached the provider keeps its full hold as `unknown`. Actual cost is recorded even if it exceeds the reservation, and any unacknowledged overrun blocks later dispatch. Operator acknowledgement is appended as a separate reconciliation decision; it never changes or removes the original charge.

The runtime-control check uses the same PostgreSQL advisory lock as reservation and settlement. After a disable commits, no later reservation is admitted. A second check immediately before invocation releases an admitted zero-cost attempt if the stop was committed between reservation and invocation. A physical request admitted before a later disable may finish and must settle normally. Disabling never erases costs, restores candidate allowance, releases an unknown hold or rewrites an attempt.

The control row is intentionally seeded disabled by migration `0019_theme_preview_runtime_control.sql`. There is no public control route. It must remain disabled in production through this pre-provider checkpoint.

## Worker behavior

The worker advances one leased job through the lifecycle stages. It checks for unresolved monetary dispatches before the first paid callback and after every stage item, and it renews the lease between source items and provider calls. Nonretryable failures are durable terminal failures; retryable failures remain paused. Pause metadata is fenced by the claim token and expected job state so a stale worker cannot overwrite a reclaimed job. S10 performs complete QA before approval. S9 is invoked at most once and only when S10 returns an explicitly repairable result. Approved questions are reserved for the locked roster in one transaction; neither S11B nor S11C activates gameplay or records exposure.

The room route accepts an injected scheduler. A committed waiting job is scheduled after Start and may be rescheduled by Progress; the database lease and the source-first repositories’ durable attempt records make those retries idempotent. Production currently injects no scheduler, model adapter, prices, source policy, prompts, or reviewer identities, so the feature remains dormant.

## S11C composition

`server/lib/theme-runtime-composition.ts` constructs the PostgreSQL lifecycle, budget, evidence, fact, question, approval, repair and reservation repositories under one explicit policy configuration. `server/lib/theme-runtime-pipeline.ts` provides the concrete stage mapping. A caller supplies an immutable, versioned work plan, stable source URLs and injected transports; deterministic IDs derived from the job, plan version, item and stage let repository outcomes replay after process replacement.

Every fact proposal, fact review, question-writing, question-review and repair callback passes through the monetary gateway before its physical transport runs. The request body and provider configuration are fingerprinted, and the plan supplies one durable hold deadline so a restart cannot change dispatch identity. A budget denial or unknown provider outcome is terminal for that job: the source-first repositories register their stable attempt before invoking a transport, so retrying the same attempt later would replay its terminal result. This is fail-closed and avoids hidden repeat spend.

Final reservation rechecks the approved question's current content, latest fact and question revisions, current evidence eligibility and exact evidence-review identity while holding the fact, revision and candidate locks in the same order used by generation and approval. It then rechecks participant history and active fact reservations before inserting the complete themed set. Changed or expired evidence, incomplete coverage or a replay mismatch rolls back the whole batch.

The deterministic S11C proof uses injected offline transports. Approval and repair QA are explicitly restricted to offline callbacks because their existing nested quality and semantic interfaces are not yet individually budget-wrapped. The runtime rejects any composition declared as live. A real PostgreSQL concurrency run was not performed locally because no disposable database URL is configured; the SQL boundary has focused transaction tests, and production remains dormant.

## Durable preview plans

`server/lib/theme-runtime-plan.ts` validates, hashes, attaches and reloads the exact offline preview plan. Plan identity covers the plan version, closed fixture mode, fixture and source-policy versions, budget-policy fingerprint, ordered source items and fixed hold deadline. The database accepts the first complete plan only; an exact retry replays it, while changed content or a corrupted stored hash fails closed. The plan fields are either all absent or all present.

This plan is not a provider configuration. It stores no credential, raw model response or secret. It cannot schedule itself, and ordinary application startup does not instantiate it.

## Configuration

Both `VITE_THEME_ROUNDS=true` and `THEME_LIVE_GENERATION=true` are required, together with every explicit budget variable documented in `.env.example`. There are no default caps. `THEME_BUDGET_POLICY_VERSION` and the configured limits form a durable policy fingerprint for each allocation. Missing or inconsistent configuration fails closed.

The next checkpoint is provider and scheduler integration under the design and
spend gates in `docs/guides/theme-provider-evaluation-plan.md`: select runtime
models, price every physical request conservatively, budget the nested
QA/semantic transports, and inject both the evidence policy and scheduler into
the room routes. That work must preserve signed-in host ownership and requires
explicit approval before any credential is connected or any paid call is
executed. Production flags remain unset until evaluation and the separate
gameplay release decision pass.

Migration `0018_theme_runtime_budget.sql` adds account and policy identity to allocations, request fingerprints to attempts, preserves financial history when lifecycle rows are cleaned up, permits conservative `unknown` accounting and honest cost-overrun recording, and protects durable accounting identity fields from mutation.

Migration `0019_theme_preview_runtime_control.sql` adds the immutable job-bound plan and disabled singleton runtime control. The optional PostgreSQL migration test uses `THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL`; without a disposable database it is skipped rather than touching Railway data.
