# Theme reliability foundation contract

This guide describes the additive `theme-reliability-v1` foundation and the STE-25 S7 through S9 candidate, evidence-review, provisional QA, and bounded-repair boundaries. It defines durable contracts and database invariants plus fail-closed orchestration boundaries; it does not enable live model calls, themed-game orchestration, client behavior, or end-to-end reliable generation by itself.

## Reliability boundary

The intended pipeline is:

`coverage plan → research/retrieval → supported scoped facts → candidate writing → independent evidence review → existing QA → semantic novelty → optional bounded repair and full re-review → atomic approval/persistence → roster-specific reservation`

Evidence support, exact-question approval, and roster eligibility are separate decisions. A pass in one layer never implies a pass in another. Missing, malformed, stale, incomplete, conflicting, or flagged evidence withholds the question. An answer appearing in a passage does not prove that the question is entailed or that it has only one valid answer.

The existing static QA, coherence, obviousness, and semantic novelty checks remain required before atomic approval. They are outside this foundation slice. The foundation is therefore an enforcement surface for a later reliability pipeline, not proof that generation is currently reliable.

S7 can persist one pending candidate from one currently eligible, independently reviewed fact revision. It does not mark that candidate accepted or eligible for gameplay; the existing QA, question evidence review, semantic novelty, and approval stages remain separate gates.

S8a adds `migrations/0014_theme_question_evidence_reviews.sql` and mirrored Drizzle definitions for immutable question-review attempt headers and terminal outcomes. A header binds the exact S7 generation attempt, candidate, question revision, content hash, fact revision, increasing review sequence, reviewer identity, and policy/prompt/input hashes. A reviewed outcome binds the existing seven-dimension `theme_evidence_reviews` row and its fact/passage links; failed attempts contain only allowlisted safe failure codes. The newest attempt controls eligibility even if it has no outcome or an adverse result. S8a does not change candidate status or grant gameplay eligibility.

S8b composes the existing static, fact/coherence/obviousness, and STE-26 semantic checks without changing those algorithms. Every check is mandatory and fail-closed: any static finding, non-pass or incomplete quality verdict, semantic match, conflict, uncertainty, incomplete comparison, dependency failure, or evidence/corpus change withholds the candidate. Source metadata for static QA comes from the current cited supporting evidence rather than being invented or copied into the gameplay-content hash. S8b is read-only and intentionally adds no schema: its pass is provisional, leaves the candidate pending, and cannot authorize approval, persistence into the shared question pool, reservation, or gameplay. Durable provider-attempt accounting and an atomic final approval recheck remain required before runtime activation.

S9 adds one durable repair claim for an original candidate withheld specifically by a static finding or an adverse complete quality verdict. It does not repair evidence, semantic, incomplete, dependency, or recheck failures and never repairs a repair child. The new child has a new candidate ID, revision ID, ordinal, content hash, S8a attempt, and complete S8b evaluation. Only question wording and explanation can change; trusted answer and policy fields are projected again from the same fact. An unchanged result fails terminally. The repair outcome is append-only and exact retries replay without model work. A successful result is still pending and provisional, so the later approval transaction must recheck current evidence, corpus, and roster state before shared-pool insertion.

## Immutable evidence and revisions

`shared/models/theme-evidence.ts` contains the versioned Zod contracts. A source document is an immutable retrieval capture with a canonical URL and SHA-256 body hash. Multiple captures may retain the same URL and body hash when retrieval time, validity, policy, extractor, redirect path, or status differs. Its provenance records `publisherId`, `originGroup`, `sourcePolicyVersion`, `extractorVersion`, and the requested, final, and canonical URLs, alongside status, freshness, and content metadata. Passages are immutable, ordered records tied to one capture and content hash.

The canonical identity of a fact lives in `theme_facts`. Its changing statement, scope, answer, aliases, and validity live in immutable `theme_fact_revisions`. The fact-revision hash covers the complete revision snapshot, including time sensitivity and validity, so a freshness renewal receives a new revision/hash even when the wording is unchanged. A scoped fact carries entity, relation, time, geography, domain, qualifiers, and optional `asOf`; time-sensitive facts require an expiry. Fact-to-passage bindings record whether a passage supports, conflicts with, or provides context for a revision.

Question revisions bind one immutable candidate or persisted question to a complete gameplay-content snapshot and SHA-256 content hash. Evidence reviews bind to both the revision ID and exact content hash through a composite foreign key. Reviews and their fact/passage bindings are append-only. A changed question, fact, evidence version, policy, or prompt creates a new revision or review; it must not mutate the old record.

The later source lane must add and maintain an immutable, versioned source registry. The registry owns publisher identity, allowed origins and paths, source class, scope, and policy versions. A retrieved document must retain the registry and extraction versions used for that retrieval; a hardcoded source list is not a substitute for this registry.

Evidence reviews are repeatable records and include review policy and reviewer prompt versions. Eligibility is deterministic: select the latest applicable review for the exact question revision and current policy/freshness window; it must be a complete `pass`, with every required dimension passing. Any later applicable `flag` or `fail` withholds the question until a later passing review supersedes it. Human and model review provenance stays distinct.

## Game plans and lifecycle

The approved plans are frozen in `shared/models/theme.ts`:

| Participants | Questions | Theme / related | Candidate ceiling | Opening buffer |
| ------------ | --------: | --------------: | ----------------: | -------------: |
| 2            |        40 |         30 / 10 |                50 |             16 |
| 3            |        60 |         45 / 15 |                75 |             24 |
| 4            |        80 |         60 / 20 |               100 |             32 |

Candidate ceilings count every candidate slot consumed, including repairs and unknown provider outcomes. Reserved cost remains held until an unknown outcome is reconciled. Research, retrieval, extraction, generation, review, repair, embedding, and semantic checks each have durable attempt records. Network and model work must run outside database transactions.

Game sessions persist the lifecycle from `setup` and `preflight` through `preparing`, optional `awaiting_mix_consent`, `ready`, `active`, `paused`/`waiting`, and terminal `completed`, `failed`, `abandoned`, or `expired` states. Preparation jobs retain their internal stages, lease data, candidate usage, reviewed-ready counts, and public stage. Public progress contains aggregate counts and safe failure codes only; it never exposes questions, answers, sources, prompts, costs, provider details, or raw errors.

Host mix consent is durable on the game session. `mixConsentStatus` is `not_required`, `pending`, `accepted`, or `declined`; an accepted decision must persist the accepted themed and related targets, the decision-maker hash, and decision time. Other statuses must clear those acceptance fields. This makes reconnects and worker restarts deterministic.

Create-game idempotency is owner-bound. A session stores the client idempotency key, a SHA-256 owner hash, and a SHA-256 request fingerprint. A retry with the same key but a different owner or request must not reuse the original session. The hashes are operational identifiers only; raw browser identifiers and tokens are not stored.

## Identity, history, and reservations

Game identity is independent of a multiplayer room and supports account, guest-browser, and shared-device participants. Only stable-key hashes are stored for browser/device identity. Identity links support a later explicit guest-to-account history transition without rewriting historical exposure records.

Every displayed question will create one idempotent exposure per participant. Future selection must enforce both a 30-day exposure window and absence of the canonical fact from the participant's five most recent games. The nullable fact bridge for legacy ordinary questions is conservative and is not evidence eligibility. Existing `seen_questions` data remains untouched until a later integration lane can migrate it with a reviewed history policy.

Reservations bind the exact composite identities: `(questionRevisionId, questionId)` and `(factRevisionId, factId)`, with the job bound to its game. Per-game uniqueness prevents duplicate questions or canonical facts. Participant bindings carry the same reservation fact and use a partial unique index on `(identityId, factId)` while active, preventing overlapping games from reserving the same fact for one participant. Reservation commit must recheck corpus and history revisions, exact question content, current evidence eligibility, and active same-fact reservations in a short transaction with participant locks in stable order. Retrieval and model work never runs while those locks are held.

## What the foundation guarantees, and what it does not

The application schemas provide useful validation and public-contract checks. PostgreSQL adds the durable guarantees that application-only validation cannot provide: composite foreign-key identity bindings, uniqueness under concurrent writes, append-only triggers for evidence/fact/review records, and partial uniqueness for active participant/fact reservations. Application code still owns policy evaluation, latest-review selection, roster/history rechecks, lease recovery, and transaction ordering.

The migration has an opt-in PostgreSQL integration test path. It is intended to validate the real constraints and append-only behavior against a disposable database; it does not run against production as part of this foundation. Concurrency races, worker restart recovery, complete five-game history reconstruction, source retrieval safety, provider reliability, factual truth, and end-to-end 40-question readiness remain deferred to the later source, lifecycle, evaluation, and rollout lanes.

The additive S6a migration adds immutable fact-derivation attempt headers and terminal outcomes. A new fact revision written through the derivation repository is atomically bound to its attempt outcome by exact revision ID and content hash. The stored header identifies the policy, prompt hash/version, producer, execution, and bounded evidence manifest; it does not retain raw prompt or passage text. Legacy fact revisions remain valid without a provenance link. These records do not establish factual truth, independent review, or eligibility for a game.

The additive S6b migration adds immutable review attempt headers and outcomes. Each review binds by composite foreign key to one persisted S6a derivation outcome and exact fact revision/hash. The attempt records trusted reviewer identity/execution, sequence, policy/prompt/input hashes, and evaluation time; the outcome stores either six strict dimension results plus an application-computed aggregate verdict and bounded validity, or an allowlisted safe failure code. The reviewer receives every passage in the original derivation manifest, including uncited evidence, after exact provenance and freshness checks. Reviewer identity and execution must differ from the producer; model reviewers must also use a different provider/model pair. Replays return a completed result without redispatch, while unresolved attempts are never retried automatically.

The pure S6b eligibility selector considers the newest sequence before its outcome, so a newer pending or adverse review blocks older approval. It requires the exact current revision, complete unchanged evidence, minimum supporting-origin count, no conflict edge, six passing dimensions, and unexpired fact and review validity. This is fact candidacy only and does not authorize question writing or gameplay. The review result and migration are documented in `docs/guides/theme_source_pipeline.md` and `migrations/0012_theme_fact_reviews.sql`.

## Later integration boundaries

- STE-25 source lane: safe URL resolution, bounded retrieval, immutable source registry, extraction, fact revisions, independent review, freshness, and exact-content activation checks.
- STE-167 lifecycle lane: roster lock, jobs and leases, budget admission, disconnect grace, replenishment, reservation transactions, history eligibility, and adapter wiring for current routes.
- Evaluation lane: held-out fixtures and regression evidence; model agreement is not human factual truth.
- Client lane: spoiler-safe public preparation and host-decision contracts.

PR #180 remains a reference for strict missing-check behavior, bounded retrieval, content binding, and activation rechecks. Its hardcoded source list, freshness-free approval, one-page answer matching, editorial bypass, and baseball-specific release policy are not part of this general contract.
