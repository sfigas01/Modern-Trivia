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
highest applicable Standard rate, including cold cache-write pricing when prompt
caching can apply. Cached-input discounts, Batch/Flex discounts or lower actual
output are savings at settlement, never admission assumptions. S12B does not
automatically retry model calls. Any later retry design must create a distinct
durable attempt, dispatch identity and reservation; an unknown outcome remains
terminal and keeps its full reservation charged.

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

Every PR keeps production dormant. S13 owns gameplay activation, production caps,
release notes and the user-visible release.
