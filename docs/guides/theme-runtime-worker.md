# Themed runtime worker and composition (STE-25 / STE-167 S11B-S12B-3)

S11B defines the bounded worker and spend-admission seam between durable themed-game admission and the existing source-first repositories. S11C assembles those repositories and maps the source registry, retrieval, extraction, fact derivation, independent fact review, question generation, independent question review, complete approval QA, one eligible repair and final roster reservation into that worker. The composition registers no route, scheduler, provider credential or production flag.

S12A adds durable preview controls without selecting or contacting a provider. Each preparation job can receive one immutable, hash-verified preview runtime plan with fixed source items, policy identity and hold deadline. A database singleton is created disabled and acts as an emergency stop for new dispatch admissions.

S12B-3 adds the dormant Railway-preview scheduler bootstrap, provider metadata persistence, immutable semantic-batch persistence and an answer-redacted evaluator. These pieces are callable integration boundaries; ordinary application startup still does not construct them because the live pipeline remains deliberately rejected until its QA and semantic transports are fully mapped. No provider credential or paid call is part of this slice.

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

The room route accepts an injected scheduler. A committed waiting job is scheduled after Start and may be rescheduled by Progress; the database lease and the source-first repositories’ durable attempt records make those retries idempotent. S12B-3 supplies a concurrency-one, bounded, deduplicating scheduler that scans on startup and periodically for recoverable job IDs. It checks the Railway `preview` environment, all live-generation and budget configuration, and the database runtime control before constructing the runtime, before enqueueing, and again when queued work is about to start. Shutdown rejects new work, drops queued work and signals the worker to settle its active bounded callback, pause durably and release its lease before returning. Production injects no scheduler, model adapter, prices, source policy, prompts, or reviewer identities, so the feature remains dormant.

## Provider recovery records

Migration `0020_theme_provider_runtime_persistence.sql` adds two append-only records. Provider request ID, returned model and latency are written with the attempt settlement on the caller's PostgreSQL transaction. The first semantic adjudication batch stores the complete ordered inputs, policy fingerprint and batch fingerprint before dispatch and binds them to the candidate's exact content hash. A replay must match exactly. The database limits the batch to four pairs and 256 KiB, rejects candidate-content mismatches, and blocks updates and deletes.

The PostgreSQL factory installs the metadata recorder by default. The lower-level composition keeps explicit dependency injection for deterministic offline tests. Semantic-batch persistence is available to the S12B-2 adapter, but live composition remains unavailable until that adapter is mapped into a live pipeline.

## Preview evaluation report

`npx tsx script/theme-runtime-evaluation.ts --job <uuid> [--job <uuid> ...]` reads one to 100 explicit jobs from `THEME_EVALUATION_DATABASE_URL` only when `THEME_EVALUATION_ENVIRONMENT=preview`. Its projections share one read-only, repeatable-read PostgreSQL snapshot so settlement cannot be split across incompatible cost views. It writes `reports/theme-runtime-evaluation.json` by default. Reports include allowlisted IDs, enums, counts, token/cost totals and latency percentiles. They cannot include question text, answers, themes, evidence, prompts, provider payloads or free-form errors, and they explicitly make no factual-accuracy claim.

## S11C composition

`server/lib/theme-runtime-composition.ts` constructs the PostgreSQL lifecycle, budget, evidence, fact, question, approval, repair and reservation repositories under one explicit policy configuration. `server/lib/theme-runtime-pipeline.ts` provides the concrete stage mapping. A caller supplies an immutable, versioned work plan, stable source URLs and injected transports; deterministic IDs derived from the job, plan version, item and stage let repository outcomes replay after process replacement.

Every fact proposal, fact review, question-writing, question-review and repair callback passes through the monetary gateway before its physical transport runs. The request body and provider configuration are fingerprinted, and the plan supplies one durable hold deadline so a restart cannot change dispatch identity. A budget denial or unknown provider outcome is terminal for that job: the source-first repositories register their stable attempt before invoking a transport, so retrying the same attempt later would replay its terminal result. This is fail-closed and avoids hidden repeat spend.

Final reservation rechecks the approved question's current content, latest fact and question revisions, current evidence eligibility and exact evidence-review identity while holding the fact, revision and candidate locks in the same order used by generation and approval. It then rechecks participant history and active fact reservations before inserting the complete themed set. Changed or expired evidence, incomplete coverage or a replay mismatch rolls back the whole batch.

The deterministic S11C proof uses injected offline transports. Approval and repair QA are explicitly restricted to offline callbacks because their existing nested quality and semantic interfaces are not yet individually budget-wrapped. The runtime rejects any composition declared as live. A real PostgreSQL concurrency run was not performed locally because no disposable database URL is configured; the SQL boundary has focused transaction tests, and production remains dormant.

## Durable preview plans

`server/lib/theme-runtime-plan.ts` validates, hashes, attaches and reloads both
strict plan shapes. The existing offline preview contract is unchanged: its
identity covers the plan version, closed fixture mode, fixture and source-policy
versions, budget-policy fingerprint, ordered source items and fixed hold
deadline. S12B-1 adds a distinct live-plan contract that pins the normalized
theme, exact MediaWiki request, discovery policy, source-registry version and
hash, claim-risk evidence policy, ordered selected article identities and budget
fingerprint. It deliberately does not assign article IDs as fact IDs; scoped
facts are created only after retrieval and evidence extraction.

The database already stores arbitrary strict plan JSON behind one immutable hash,
so S12B-1 requires no migration. It accepts the first complete plan only; an
exact retry replays it, while changed content, source selection, policy identity,
hold deadline or a corrupted stored hash fails closed. Loading an attached live
plan never reruns discovery.

These plans are not provider configurations. They store no credential, raw model
response or secret. A live-plan schema does not enable execution: the runtime
pipeline still accepts only offline QA, no scheduler/bootstrap hook was added,
and ordinary application startup does not instantiate themed generation.

## Configuration

Both `VITE_THEME_ROUNDS=true` and `THEME_LIVE_GENERATION=true` are required, together with every explicit budget variable documented in `.env.example`. There are no default caps. `THEME_BUDGET_POLICY_VERSION` and the configured limits form a durable policy fingerprint for each allocation. Missing or inconsistent configuration fails closed. Scheduler bootstrap additionally requires Railway's environment name to be exactly `preview`, every `THEME_PREVIEW_*` value to be a positive bounded integer and the worker lease to exceed both the configured callback cap and the runtime's declared worst-case callback duration, including composite QA. Keep all scheduler variables unset in production.

The next checkpoint is completing the live pipeline mapping under the design and spend gates in `docs/guides/theme-provider-evaluation-plan.md`, then running E0 with a disposable PostgreSQL database. That work must preserve signed-in host ownership and requires explicit approval before any credential is connected or any paid call is executed. Production flags remain unset until evaluation and the separate gameplay release decision pass.

Migration `0018_theme_runtime_budget.sql` adds account and policy identity to allocations, request fingerprints to attempts, preserves financial history when lifecycle rows are cleaned up, permits conservative `unknown` accounting and honest cost-overrun recording, and protects durable accounting identity fields from mutation.

Migration `0019_theme_preview_runtime_control.sql` adds the immutable job-bound plan and disabled singleton runtime control. The optional PostgreSQL migration test uses `THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL`; without a disposable database it is skipped rather than touching Railway data.

Migration `0020_theme_provider_runtime_persistence.sql` adds immutable provider and semantic recovery records. Its optional PostgreSQL test uses the same disposable-database variable. Focused fixture tests do not satisfy E0's database and full-pipeline gates by themselves.
