# Themed provider integration and evaluation plan (STE-25 / STE-167 S12B)

## Purpose and stop point

S12B connects the dormant source-first runtime to a real provider in the Railway
`preview` environment and measures whether it can produce reliable complete games.
It does not enable production gameplay.

This plan has two checkpoints:

1. Implement and validate the provider, scheduler, nested QA accounting and
   evaluation tooling without a credential or paid request.
2. Stop for owner approval of the exact model configuration, current prices,
   sample sizes and maximum spend before adding the preview key or running a
   paid evaluation.

Production keeps `VITE_THEME_ROUNDS` and `THEME_LIVE_GENERATION` unset through
S12B. The database runtime control also remains disabled in production.

## Smallest viable runtime

Use the existing application service and PostgreSQL durability. Do not add an
external queue for the first preview evaluation.

- Inject one process-local scheduler with concurrency `1` into the room routes.
- Starting a job or polling progress may enqueue its durable job ID.
- On application startup, scan for runnable jobs whose leases are absent or
  expired and enqueue them.
- A short periodic sweep may recover committed jobs missed during a restart.
- PostgreSQL leases remain authoritative, so duplicate scheduling from two
  processes cannot create duplicate physical work.
- Queue state is disposable. Plans, attempts, reservations, failures and costs
  remain durable in PostgreSQL.
- Shutdown stops accepting work and waits only for the current bounded callback;
  the expired lease and immutable attempt identities handle recovery.

The scheduler must refuse to start unless all preview configuration is valid,
the database runtime control is enabled and the environment is explicitly
`preview`. Ordinary production startup must continue to instantiate no themed
provider runtime.

## Source discovery

Wikipedia is the default discovery source for stable facts because it has broad
coverage, consistent page structure and useful citations. The simple first
version should use the MediaWiki search API to obtain canonical English article
URLs, then pass those URLs through the existing source registry, safe retriever,
extractor and immutable evidence capture.

The model never supplies or approves a source URL. A URL is eligible only when a
deterministic discovery adapter returns it and the pinned source registry accepts
its origin and path.

Source policy:

- Stable biographical, historical, scientific, geographic, sports-history and
  entertainment facts may use an eligible Wikipedia passage.
- Current standings, active officeholders, records described as current,
  superlatives, disputed claims and other time-sensitive facts require an
  eligible first-party or specialist source in addition to Wikipedia. If that
  source is unavailable, withhold the candidate.
- Search snippets, model memory and agreement between two model calls are not
  evidence.
- Unsupported or poorly sourced themes return a clear inventory shortfall. The
  runtime does not silently broaden the theme.

The preview source registry should begin with English Wikipedia plus only the
small number of first-party domains needed by the frozen evaluation themes.
Adding a domain requires a new immutable source-policy version.

## Provider and model routing

Use the OpenAI Responses API with strict Structured Outputs. Every adapter has a
versioned prompt, JSON schema, requested model, reasoning setting, token ceiling,
timeout and retry policy. Configure the OpenAI client with `maxRetries: 0` so one
durable attempt equals exactly one physical provider request. Those values belong
in the immutable request identity and budget fingerprint. Store token counts,
provider request ID, returned model identifier, latency and calculated cost;
never store hidden reasoning or secrets.

Initial candidate configuration:

| Operation                    | Starting model           | Effort | Reason                                             |
| ---------------------------- | ------------------------ | ------ | -------------------------------------------------- |
| Fact proposal                | `gpt-6-luna`             | low    | Narrow extraction from retrieved passages          |
| Question writing             | `gpt-6-luna`             | low    | Structured, evidence-bound drafting                |
| Eligible repair              | `gpt-6-luna`             | low    | One constrained wording or explanation edit        |
| Independent fact review      | `gpt-6.1-sol`            | medium | Critical scope, qualifier and contradiction review |
| Question evidence review     | `gpt-6.1-sol`            | medium | Critical answer, alias and explanation review      |
| Coherence and obviousness QA | `gpt-6.1-sol`            | medium | Adverse review gate before approval                |
| Semantic adjudication        | `gpt-6.1-sol`            | low    | Bounded pair classification after embeddings       |
| Semantic vectors             | `text-embedding-3-small` | n/a    | Existing similarity candidate screen               |

This keeps drafting inexpensive while separating it from the stronger approval
model. It does not claim model independence as human ground truth. `gpt-6-astra`
is an optional challenger for a small frozen subset only if the Sol baseline
misses critical cases; it is not the initial per-candidate runtime model.

The official OpenAI model guide describes Luna as the efficient model for
focused high-volume work, Sol as the balance of intelligence and cost, and Astra
as the highest-capability choice. Current model IDs, account access and pricing
must be rechecked immediately before the paid run:

- https://developers.openai.com/api/docs/guides/model-selection
- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/prompt-caching

Do not use a deprecated model merely because it is cheaper. If a stable snapshot
is available, freeze it for the evaluation. Otherwise record the requested alias
and exact returned model identifier and treat an alias change as a new policy
version requiring regression evaluation.

## Complete spend accounting

The existing budget gateway already wraps fact proposal, fact review, question
writing, evidence review and repair. S12B must also route these nested operations
through the same gateway before live mode is allowed:

- coherence and obviousness QA;
- embeddings;
- every semantic pair adjudication;
- any paid source-planning operation added later.

Limit semantic adjudication to four candidate pairs per proposed question. More
than four possible matches is an incomplete result and withholds that candidate.
It must never create an unbounded series of paid calls.

Each reservation uses the maximum configured input and output tokens at the
highest applicable Standard rate. Cached-input discounts, Batch/Flex discounts
or lower actual output are savings at settlement, never admission assumptions.
The adapter explicitly requests the Standard service tier and settles cached and
uncached input against separate rates from the versioned pricing snapshot. S12B
does not automatically retry model calls. Any later retry design must create a
distinct durable attempt, dispatch identity and reservation; an unknown outcome
remains terminal and keeps its full reservation charged.

### Planning estimate

The following is a conservative planning envelope based on the published
Standard prices checked on 2026-10-17. It prices every model input at the cold
cache-write rate: Luna at $0.125 per million input tokens and $0.50 per million
output tokens; GPT-6.1 Sol at $2.50 and $10; embeddings at $0.02 per million
input tokens. Prices are external configuration and must not be hard-coded as
timeless facts.

| Candidate work                        |                 Token ceiling | Reserved estimate |
| ------------------------------------- | ----------------------------: | ----------------: |
| Luna fact proposal                    |    6,000 input + 1,000 output |           $0.0013 |
| Sol fact review                       |    6,000 input + 1,200 output |           $0.0270 |
| Luna question writing                 |      4,000 input + 800 output |           $0.0009 |
| Sol evidence review                   |    6,000 input + 1,200 output |           $0.0270 |
| Sol quality review                    |      4,000 input + 800 output |           $0.0180 |
| Embedding screen                      |            up to 10,000 input |           $0.0002 |
| Up to four Sol semantic adjudications | each 1,500 input + 400 output |           $0.0310 |

Reserve **$0.12 per candidate before repair** after rounding the $0.10535
envelope upward. A repaired candidate repeats the evidence and QA gates; reserve
**$0.20 for the full one-repair path** after rounding the $0.18245 envelope
upward. These are safety ceilings, not expected prices.
Implementation must derive the actual micro-dollar values from versioned pricing
configuration and reject a request whose configured token limits exceed its
reservation.

At the current 50/75/100 candidate ceilings, the absolute one-repair envelope is
$10.00/$15.00/$20.00 per job. This shows why measured yield and token use are
required before choosing daily or weekly limits. It is not a proposed player
price or production allowance.

## Evaluation sequence and budget checkpoints

### E0 — offline integration

- Cost: $0.
- Use deterministic provider fixtures and a disposable PostgreSQL database.
- Prove scheduler recovery, lease contention, runtime disable between reservation
  and invocation, budget denial, unknown outcomes, token/cost settlement, exact
  replay, semantic-call limits and complete answer-redacted reporting.
- No Railway variable, credential or network provider call.

### E1 — paid calibration

- Requires owner approval immediately before execution.
- Railway preview only, with its separate database and key.
- Three themes: one common, one potentially ambiguous and one niche.
- At most 12 candidate attempts total.
- Maximum provider spend: **$2.00**. The database global cap and a separate
  evaluator stop must both enforce it.
- Purpose: measure real token use, latency, schema failures, repair frequency and
  accepted-question yield. E1 cannot establish release accuracy.

After E1, publish every denominator and recalculate the larger evaluation from
observed p95 cost per candidate. Do not weaken review gates to improve yield.

### E2 — frozen cross-theme holdout and complete games

- Requires a second owner approval with the recalculated maximum spend.
- Use separately reviewed tuning and untouched holdout sets spanning sports,
  history, science, geography, entertainment and a niche theme.
- Include the World Baseball Classic location defect, the underspecified
  night-baseball question, false premises, missing qualifiers, alternate valid
  answers, aliases, stale facts, source disagreement, fabricated/missing sources,
  explanation defects and clean controls.
- Generate at least one complete two-player game for every domain above. Preserve
  all failed runs and candidate denominators.
- Recheck every accepted question against its cited source before labels are
  finalized. Model-assisted labels are identified as such; independent human
  review supplies release labels.
- Proposed maximum program envelope: **$12 after E1**, with the exact value
  recalculated and approved before execution. If the measured plan cannot fit,
  raise the OpenAI project limit or use a separately capped evaluation key rather
  than shrinking the evidence required for release.

The current $20 monthly project hard limit is shared by preview and production.
E1 plus E2 must leave headroom for unrelated usage and unknown outcomes. No agent
may infer approval from the budget written here.

## Release gates

Freeze these gates before E2 starts:

- zero accepted known-bad critical factual or scoring cases;
- zero source citations that do not support the stored claim;
- zero incomplete or malformed review paths recorded as passes;
- every evaluated domain completes a 40-question two-player game without
  weakening review or exceeding its candidate ceiling;
- every accepted question has exact evidence, fact, question-review, QA and
  approval provenance;
- accepted-question factual correctness is reported with its sample size and a
  confidence interval, by theme and overall;
- ambiguity, alternate-answer, explanation, duplicate, repair, rejection, yield,
  latency and cost metrics are reported by theme;
- p95 preparation time and cost per completed game fit limits chosen after E1;
- provider outage, source outage, process restart, runtime disable and budget
  exhaustion all fail closed without duplicate spending;
- a known critical escape blocks release and requires a fresh untouched rerun
  after the fix.

Passing E2 supports an S13 activation decision. It does not automatically change
production flags or budgets.

## Implementation order

Keep S12B reviewable by separating it into focused pull requests if the code diff
would become large:

1. Wikipedia-first deterministic discovery and an immutable live-plan contract.
2. Responses API adapters, versioned pricing and budgeted nested QA/semantic
   transports, still fixture-only and disabled.
3. Preview scheduler/bootstrap integration plus PostgreSQL recovery tests and
   the answer-redacted evaluator.
4. Owner checkpoint, E1 calibration, updated cost model, second owner checkpoint
   and E2.

S12B-1 implements the first item as a dormant library boundary: the English
MediaWiki adapter, immutable claim-risk policy and strict live-plan snapshot use
fixtures only and add no scheduler, provider credential, model call, route or
production flag. The selected plan records article identities separately from
later scoped fact identities.

S12B-2 implements the second item as another dormant boundary. The shared
Responses adapter accepts only an injected transport, uses strict JSON Schema,
pins prompt/model/service tier/reasoning/token/timeout/no-retry identity, and
derives both reservations and measured settlement from an explicit versioned
pricing snapshot. Refusals, incomplete output, model changes and invalid
structured output fail closed. Transport errors remain unknown outcomes so the
durable budget gateway retains the full reservation. Settled provider request
IDs, returned model IDs and latency pass through a required recorder in the same
transaction as budget settlement; S12B-3 supplies its PostgreSQL implementation.
If either settlement or metadata recording fails, the attempt remains unresolved
with its full hold. Input-estimation failures occur before transport invocation
and settle as known zero-cost failures. Nested quality review, embeddings and one
immutable batch of at most four semantic adjudications per candidate must use the
injected budget dispatch seam. S12B-3 must persist that selected pair batch
before live invocation so process recovery cannot select four more pairs. This
slice contains fixtures only and still creates no client, credential lookup,
scheduler, route, migration, flag or paid call.

Every PR keeps production dormant. S13 owns gameplay activation, production caps,
release notes and the user-visible release.

## S12B-3 implementation checkpoint

S12B-3 implements the third item without credentials or paid requests:

- append-only PostgreSQL provider metadata recorded on the budget-settlement transaction;
- one immutable, exact-content-bound semantic pair batch persisted before dispatch;
- a Railway-preview-only, concurrency-one scheduler bootstrap with bounded recovery, database control checks and clean stop behavior;
- an answer-redacted evaluator for explicit job IDs; and
- fixture tests plus an opt-in disposable-PostgreSQL migration test.

The application does not install this scheduler during ordinary startup. The
concrete pipeline and its nested QA transports are available only through
explicit dependency injection, so production remains dormant and the scheduler
boundary does not imply that a provider-backed run is enabled.

## S12B-4A nested QA and E0 accounting checkpoint

S12B-4A closes the provider-recovery gap that was discovered while mapping the
live pipeline. Validated parsed provider results are now stored append-only with
their attempt settlement and provider metadata. An exact request replay can
reload that result without a second physical call; a missing, changed, corrupt
or unknown result fails closed. Raw provider payloads and free-form errors are
not stored in the replay record.

The concrete pipeline can now map quality/coherence/obviousness review,
embeddings and at most four semantic adjudications through the same durable
budget gateway as fact proposal, fact review, writing, evidence review and
repair. Embedding inputs are divided into bounded, independently replayable
chunks and reassembled in order before duplicate screening. The themed duplicate detector uses injected transports, reports every
candidate-versus-corpus pair and withholds rather than truncating when more than
four pairs need model adjudication. Preview recovery also has an explicit
per-job plan loader, so a scheduler ID cannot inherit another job's plan.

The zero-cost PostgreSQL proof ran against a disposable local PostgreSQL 16
database. It covered real migrations through
`0021_theme_provider_result_replay.sql`, exact result replay with one physical
fixture invocation, measured token/cost and metadata settlement, budget denial,
unknown-outcome holds and runtime disable after reservation but before
invocation. The companion PostgreSQL suite covered recovery scans, lease
contention and the source-first repositories. Fixture tests covered the
four-pair semantic boundary and answer-redacted evaluator contract. No provider
network request, credential, Railway variable or production flag was used.

This completes the durable accounting and nested-QA subset of E0. It is not the
full scheduler-to-approval E0 gate.

This is not yet the paid-evaluation checkpoint. The live plan pins article
identities, while the existing pipeline still assumes one preselected fact per
source.

## S12B-4B proposal allocation checkpoint

S12B-4B adds a separate `theme-live-runtime-plan-v2` contract for bounded fact
proposal work. It allocates a fixed number of slots in deterministic round-robin
order over the exact pinned Wikipedia source list, with an explicit total and
per-source maximum. The v1 preview and live plan formats remain readable. Slot
keys identify work only; they never become fact identities and rejected or
withheld work does not create replacement slots.

Migration `0022_theme_fact_proposal_slots.sql` persists the complete allocation
and terminal proposal outcomes as append-only records. A proposed outcome is
accepted only after the existing fact-derivation validator rechecks the durable
passages, source-registry binding, freshness, source classes, origin-group
minimums, citations and temporal rules. The proposal must also be anchored to
the slot's pinned Wikipedia article and the plan's risk-specific evidence policy.
Exact recovery can load the normalized proposal and provenance without retaining
process memory or invoking a provider again.

Canonical fact keys are derived after validation from the complete normalized
scope: entity, relation, time, geography, domain, qualifiers and `asOf`. The key
does not include page, passage, answer, job or slot identity. This makes the same
scoped fact converge across slots while keeping evidence provenance separate.
Lexical normalization does not establish semantic equivalence, so later duplicate
review remains required.

The zero-cost PostgreSQL proof covers concurrent atomic allocation, migration
reapplication, exact restart loading, conflicting replay, pinned-source and
passage-hash rejection, temporal failure, duplicate-scope convergence, strict SQL
null handling and append-only enforcement. It uses local fixtures only.

## S12B-4C dormant worker integration checkpoint

S12B-4C maps the v2 proposal manifest into the existing bounded pipeline. Slots
over the same pinned article share one source retrieval and capture. Proposal and
all later model-stage identities are derived from the slot key, so their durable
attempt and execution IDs do not collide. The proposal request is dispatched under
the slot identity, and its validated terminal outcome is stored before the local
fact write.

The local fact writer revalidates the stored normalized proposal against current
durable evidence and resumes an exact unresolved local attempt without another
provider call. Runtime-specific fact review, generation and evidence-review
repositories can also complete an exact unresolved header after reloading and
revalidating the locked inputs. Their provider callbacks are protected by the
existing settled-result replay boundary. General-purpose repository construction
keeps the prior fail-closed behavior.

Withheld proposals and duplicate canonical scopes are skipped without replacement.
An incompatible plan whose slot ordinals exceed the job candidate ceiling fails
preflight. Unknown outcomes, changed inputs and conflicting replay remain terminal.
The zero-cost E0 evidence combines the v2 pipeline recovery fixture, the bounded
worker fixture, the disposable PostgreSQL proposal/fact/review/generation/
evidence-review suites and the PostgreSQL budget replay/disable/unknown-outcome
proof. These deterministic fixtures prove the covered wiring and recovery
boundaries; they do not establish factual quality or a complete live scheduler run.

No scheduler startup, credential, route, Railway variable, production flag or paid
call is added. Production remains dormant, and E1 still requires the owner
checkpoint before a key is connected or any provider request is made.

## S12B-4D preview runtime composition and E0 checkpoint

S12B-4D adds one callable preview bootstrap that joins the existing durable
scheduler, runtime control, recovery scan, immutable per-job plan loader and
PostgreSQL preparation runtime. The scheduler must pass the Railway-preview,
feature, budget and database-control gates before the source-first repositories
or injected pipeline can be constructed. Every recovered job reloads and
hash-verifies its own stored plan before runtime composition. The caller must
also supply an independently calculated worst-case pipeline callback duration;
startup fails closed when it exceeds either the configured callback cap or the
worker lease.

The zero-cost E0 proof now covers the complete deterministic boundary in two
parts: the concrete worker/pipeline fixture proves proposal through approval and
reservation, while the disposable PostgreSQL suite proves that the real control,
recovery scan and plan repository select a stored job and invoke that same runtime
composition seam. The remaining PostgreSQL suites continue to prove the durable
stage, budget, replay, disable and unknown-outcome records. No provider network
request or credential is used. This is an integration and recovery gate; it does
not claim factual quality or release readiness.

Ordinary application startup still does not install the preview runtime, and no
concrete OpenAI transport reads a key. The next checkpoint is the separately
approved E1 preview connection and calibration slice. Connecting a preview key or
executing even one paid request still requires the owner's explicit approval.

## E1 preview connection plumbing

The E1 plumbing adds a concrete OpenAI SDK transport for Responses and embeddings
behind the existing budgeted provider interfaces. It forwards the adapter's strict
Structured Outputs request, abort signal and zero-retry policy; captures response
or request IDs, returned model, token usage and cached-input usage; and leaves
refusal, incomplete-output, model-pin, schema, cost and timeout decisions in the
existing fail-closed adapters.

`bootstrapOpenAIThemePreviewRuntime()` preserves the earlier scheduler boundary.
It constructs neither an OpenAI client nor its transports until the Railway
preview configuration, database runtime control, recovery record and immutable
stored plan have passed their existing checks and the per-plan pipeline is being
created. One client is then shared by that process. The factory accepts a
credential explicitly; it does not discover or read a key from the environment,
does not log one and does not make a request merely by being constructed. The
scheduler's returned `stop()` remains the clean application-shutdown seam.

This slice deliberately does not install the runtime in ordinary application
startup, freeze the live prompt/model/pricing bundle, add a Railway variable,
enable database runtime control or make a provider request. Those actions form
the owner-attended API hookup checkpoint below.

### Owner-attended API hookup checkpoint

Perform these steps together immediately before E1, not as part of unattended
engineering work:

1. Recheck current OpenAI model availability and Standard prices, then approve
   the exact versioned prompt, schema, model, reasoning, token-ceiling and pricing
   bundle for every paid operation.
2. Confirm the E1 limits remain at most 12 candidate attempts and $2.00, and set
   the preview database budget caps and evaluator stop at or below that amount.
3. Create or select the separately capped Railway-preview OpenAI service-account
   key. Enter it directly as `THEME_E1_OPENAI_API_KEY` in Railway preview; never
   paste it into chat, source, Linear, GitHub, logs or a shell command. Existing
   generation keeps its separate `AI_INTEGRATIONS_OPENAI_API_KEY`. Keep
   `AI_INTEGRATIONS_OPENAI_BASE_URL` unset for the official OpenAI endpoint.
4. Confirm the reviewed frozen provider/pipeline bundle is installed in
   application startup and its scheduler `stop()` is registered in graceful
   shutdown. The installed callback reads the Railway-preview credential lazily
   only after the runtime gates and a stored plan pass; production must still
   instantiate no themed provider runtime.
5. Deploy the reviewed branch to Railway preview, enable only the preview feature,
   scheduler and database-control gates, and first verify a zero-candidate startup
   and shutdown before authorizing the capped E1 requests.

The checkpoint is reached when the plumbing PR is reviewed and merged. A key by
itself cannot activate this code, and no agent may infer permission to connect or
test it from the presence of the variable.

## E1 frozen preview bundle and application wiring

The zero-cost configuration checkpoint freezes
`theme-e1-openai-2026-11-08-v1` as the first plan-bound E1 bundle. It uses Luna
with low reasoning for fact proposal, question writing and the single eligible
repair; Sol with medium reasoning for independent fact review, question evidence
review and coherence/obviousness QA; Sol with low reasoning for at most four
semantic adjudications; and `text-embedding-3-small` with 512 dimensions for the
candidate screen. Every operation has its own versioned prompt, strict JSON
schema, token ceiling, 30-second timeout and zero-retry policy.
The stored runtime plan must use that exact bundle version as its `planVersion`
and must match the active budget-policy fingerprint; older or mismatched plans
fail before the credential callback is reached.

The accompanying `openai-standard-2026-11-08-v1` price snapshot uses the
published Standard output and embedding rates. For safe admission, uncached
model input is charged at the higher 30-minute cache-write rate; cached input is
charged at the cache-read rate. This deliberately avoids assuming a cache or a
discount before dispatch. A price or model change requires a new immutable
bundle version and a new regression evaluation.

Application startup now installs the runtime seam, but it remains inert unless
all of the following are true: Railway names the environment `preview`, both
theme feature flags and the preview scheduler flag are enabled, every budget and
scheduler limit is valid, and the durable database runtime control is enabled.
Only a recovered or newly scheduled job with a hash-valid v2 plan can then reach
the lazy credential callback. Production performs no runtime-control query and
constructs no OpenAI client. A disabled database control also constructs no
client. An empty preview queue starts and shuts down without reading a key.

The duplicate corpus is capped at 512 questions for this first paid envelope.
The approval path reads one extra row and withholds the candidate if the cap is
exceeded; it never truncates the corpus and claims a partial duplicate check as
complete. This bounds the composite QA callback at 540 seconds, including nine
embedding batches, four semantic adjudications, a repair/evidence pass and
margin. Preview must therefore configure
`THEME_PREVIEW_MAX_CALLBACK_MS=540000` and a strictly larger worker lease (the
initial value is `THEME_PREVIEW_WORKER_LEASE_MS=600000`).

Each proposal slot receives at most 12 passages and 12,000 passage characters.
Repeated slots over one Wikipedia article deterministically partition the
article passages for coverage. Only passages actually cited by the accepted
proposal are carried into fact derivation, whose existing validator rechecks
their hashes, source binding, freshness and support.

The worker's completion target comes from the durable game mix
(`accepted_themed_target` when present, otherwise `themed_question_target`),
not from the number of proposal slots. All planned slots remain available as
bounded replacement attempts, while reservation still requires exactly the
game's target. An eligible repair also reloads the repaired candidate's evidence
context and the complete bounded PostgreSQL comparison corpus before rerunning
QA; it cannot reuse the original candidate's context or bypass duplicate checks.

No key was read or set, no Railway variable or database control was changed, and
no provider request was made in this checkpoint. The next action is the
owner-attended hookup: review this bundle, enter the separately capped key in
Railway preview, deploy with the durable control still off, prove zero-candidate
startup/shutdown, and only then separately authorize the capped paid E1 run.

## E1 preview plan preparation

The operator command `npm run theme:e1:prepare -- --job <uuid> --job <uuid>
--job <uuid>` is the only supported path for attaching the three E1 plans. It is
dry-run by default. Add `--apply` only after the dry-run report is reviewed and
the owner explicitly authorizes the preview database write.

The command requires `THEME_EVALUATION_ENVIRONMENT=preview` and
`THEME_EVALUATION_DATABASE_URL`; it never falls back to the application's
`DATABASE_URL`. Supply the same non-secret USD budget configuration used by the
preview deployment so the immutable plan records the expected fingerprint. It
accepts exactly three distinct job IDs created through the signed-in-host
admission flow, verifies the durable runtime control is disabled, and refuses
jobs that have started candidate work, hold a lease, expired, or already use a
different plan version. Each selected game must remain in its waiting state with
its linked room still in the lobby. For this evaluation path only, a selected job
may be in `shortfall` when it has the admission `inventory_shortfall` marker, zero
candidate work, no lease, no prior plan and no active gameplay reservation. This
does not relax gameplay admission: dry-run reports that the selected job would be
promoted, and only the atomic `--apply` changes it to `waiting` while attaching the
evaluation-mode plan and clearing that obsolete admission marker. The evaluation
still terminalizes without gameplay reservations and never claims the room has a
playable question set.

Dry-run reports the intended shared hold deadline without writing it. Apply locks
the three jobs, games, and rooms, then extends both game and room expiry to at
least 14 hours 32 minutes from the post-discovery preparation boundary;
`GREATEST` preserves any later existing expiry. That conservative window covers
all 96 callbacks in the complete serialized path: three jobs, four slots per job,
and research, retrieval, extraction, generation, review, approval, repair and
reapproval per slot at the 540-second callback bound, plus an eight-minute
operator margin.

Preparation performs one bounded deterministic Wikipedia discovery per job,
freezes four proposal slots per theme (12 total), appends the immutable source
registry, extends the selected preview lobby/game lifetimes, and attaches all
three plans in one database transaction. Its output is answer-redacted and
contains only job IDs, counts, the shared hold deadline, plan hashes and policy
identifiers. It does not import the E1 credential, construct an OpenAI client,
enable the scheduler or authorize a provider request. Wikipedia availability is
a prerequisite; discovery failures withhold the entire apply operation.

The runtime independently rechecks the frozen E1 source registry, discovery,
claim-evidence and four-slot policies. Merely labeling a changed plan with the
E1 bundle version cannot bypass that check.

E1 plans execute in an explicit evaluation mode. The worker processes every
proposal slot and preserves pass, fail and withhold outcomes even when fewer
than four questions pass review. It then terminalizes the evaluation job as
completed without creating gameplay reservations. The enclosing admitted game
therefore remains unstartable; a four-slot calibration can never be mistaken for
a prepared 30-, 45- or 60-question game. Plan preparation also verifies each
job's durable candidate ceiling can hold all four evaluation slots before a plan
is attached.
