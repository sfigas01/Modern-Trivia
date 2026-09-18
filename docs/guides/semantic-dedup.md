# Semantic duplicate and conflicting-answer detection (STE-26)

The generation gate and library sweep compare question-only embeddings, then ask
the existing GPT-4o integration to distinguish equivalent facts, incompatible
answers, distinct facts, and uncertain pairs. Factual scope includes entity,
attribute, time period, location and qualifiers. Similarity alone does not prove
contradiction. Equivalent spellings/aliases must not become answer conflicts.

Exact questions with identical normalized answers use the cheap exact path.
Every other retrieved pair, including fuzzy text matches, is adjudicated. The
retrieval threshold is 0.55, with 0.80 string similarity and the existing
answer-similarity fallback. Live controlled-fixture results are recorded below;
these settings are not yet validated on a separately held-out real-library set. Embeddings use text-embedding-3-small with
1536 dimensions; see the [official embedding guide](https://developers.openai.com/api/docs/guides/embeddings).

## Storage and deployment

Apply `migrations/0007_question_embeddings.sql` through the normal migration
runner before enabling the code. It creates an additive JSONB cache with a
question foreign key and delete cascade; no extension or dependency is added.
Do not run migrations against production merely to test this feature.

The cache stores question-only vectors, model, dimensions, purpose and a hash
of question plus answer. Every lookup checks those fields and vector validity.
Edits refresh lazily before the next comparison. Conditional writes skip rows
that changed or disappeared after the snapshot. Unsaved generated candidates
remain in memory. Backfill is lazy in batches of 64; valid cached batches can be
reused after an interrupted run. For a large cold corpus, run the sweep first.

Existing integration variables are `AI_INTEGRATIONS_OPENAI_API_KEY` and optional
`AI_INTEGRATIONS_OPENAI_BASE_URL`. A direct OpenAI key must use a compatible base
URL. Keep credentials in ignored local environment files or deployment secrets.

## Generation decisions and failures

Keep the public async `filterNovelQuestions(batch, existing)` contract. Ordinary
duplicates retain canonical winner selection. Every candidate participating in
a conflict is withheld, including both endpoints within a batch. A conflict with
an existing row withholds the candidate; it never overwrites the stored answer.
Uncertain pairs are withheld with a separate review-required reason.

Provider or cache failures make the check incomplete. Generation returns an
error before inserting any questions. Sweeps show an incomplete warning, failed
pair count and partial findings; the CLI exits nonzero after writing its partial
report. No incomplete result is a clean-library verdict. Successful generation
reports duplicate, conflict and uncertain drop counts separately.

Provider requests use 30-second timeouts and at most two SDK retries. A detector
run has a 120-second total deadline including cache work, provider retries and
adjudication; up to three adjudications run concurrently. At most 500 candidate
pairs are adjudicated in one run. Exceeding the cap is explicitly incomplete;
repeating an unchanged oversized sweep will not finish it. A larger-corpus
resumable sweep is a follow-up, not silently implemented by lifting cost limits.
Aborting the stage cancels provider requests and further retries. A cache SQL
operation already submitted may finish after the deadline; it cannot stage or
change a question. Generation is still stopped before insertion.

## Admin review and reports

Conflicts appear at high severity, with neither answer declared correct. No
automatic library correction, merge or deletion is performed. Dismissal keys
include the sorted pair, finding type and content hash. Older pair-only
dismissals intentionally do not suppress new versioned findings; edits and new
conflict classifications resurface for review.

The existing admin answer-reveal controls remain. Detector reasons use fixed,
answer-free text. CLI reports redact all free-text finding details, including
questions, answers, suggested rewrites and model reasoning. Logs contain counts,
model names, token usage where returned and timings, never provider error bodies.

## Validation and current limits

See `test/fixtures/benchmark/README.md` for both required live benchmarks. The
pair corpus contains synthetic controlled fixtures and is not a substitute for
sampling the real library. No precision or production latency claim is justified
until the live benchmarks and representative cold/warm corpus measurements run.
Unit tests exercise control flow using provider mocks; route tests and browser
tests cover user-visible status, withholding and dismissal behavior.

The STE-249 owner connects strategy quotas after this feature merges, using the
sequential routes.ts handoff recorded in both Linear cards. This branch does not
import the unmerged quota helper or change guardian.ts.

## Validation record — 2026-09-18

- TypeScript and production build pass. ESLint has zero errors and 23 existing warnings.
- 606 tests across 54 files pass; all four admin sweep/staging browser tests pass.
- PostgreSQL 16 disposable-database checks pass: migration idempotence, unsaved-ID
  exclusion, cache round-trip, conditional edit refresh and cascade deletion.
- Initial live pair run: 130 cases, 99.23% agreement, duplicate TP/FP/FN 49/0/1,
  conflict TP/FP/FN 40/1/0. One alias control was incorrectly classified as conflict.
- Clarified that adjudication compares answer referents rather than answer-writing
  quality. Rerun: 130/130 agree; duplicate TP/FP/FN 50/0/0, conflict 40/0/0;
  all 40 distinct controls pass, zero false alias/temporal conflicts, zero unresolved
  or incomplete pairs. Runtime 116.171 seconds, GPT-4o plus text-embedding-3-small.
- The rerun is regression evidence, **not an untouched held-out evaluation**: one
  fixture informed the prompt correction. A separate independently labeled set is
  still required before claiming the full held-out acceptance gate.
- Existing STE-28 live suite: 98.84% agreement (427/432 cells), with five case-level
  mismatches. The same five mismatch IDs occur on unchanged main. The CLI correctly
  exits nonzero; these failures were not suppressed or relabeled to get a green run.
- Configured source database refused connection, so no current-library timing or
  cache benchmark was obtained from it. No source database writes were attempted.

User-approved handoff: STE-26 merges first. STE-228 model-change PR #176 then
merges updated main and integrates its overlapping detector/test changes. Its
proposed model change requires fresh semantic accuracy measurements; GPT-4o
results cannot be presented as evidence for another model.

### Retrieval/scope follow-up

A second 130-pair set was frozen before evaluation and cross-checked by a separate
blinded GPT-4o labeling request. The annotator disagreed on two aliases; the labels
were retained because both strings identify the same referent. This is not
independent human annotation. Initial detector agreement was 86.92%, exposing
missed retrieval and outer-question attribute confusion. These cases then became
tuning examples. The retrieval threshold was lowered from 0.70 to 0.55 and the
prompt now distinguishes the outer requested attribute from an embedded question.
The corrected run passed the acceptance metrics at 99.23% agreement; it remains
regression evidence. Failed runs are retained locally under ignored reports/.

### Synthetic cache performance

Final settings, 60 synthetic questions from 30 paraphrase pairs, PostgreSQL 16:
1,770 pair comparisons completed with 30 semantic duplicates, no failures or
uncertain findings. Cold 7.642 seconds; warm 6.177 seconds. All 60 embeddings were
reused on the warm run (zero embedding calls). Cold embedding usage was 689 tokens;
adjudication used 9,737 total tokens per run and remains uncached by design.

At published rates this is a conservative ceiling of US$0.098 per run (all
adjudication tokens priced at the more expensive output rate, plus embeddings),
not a billing-statement measurement. See [GPT-4o pricing](https://developers.openai.com/api/docs/models/gpt-4o)
and [embedding pricing](https://developers.openai.com/api/docs/models/text-embedding-3-small).
This synthetic sample does not establish production-library latency. The configured
database was unavailable; the repository-seed transfer requires separate approval.

### Independent evaluation and readiness

The separate model-authored `semantic-blind-eval.json` contains 170 pairs: 77
labeled duplicates, 40 conflicts and 53 distinct pairs. Initial untouched outcome:
93.53% agreement; duplicate TP/FP/FN 74/7/3 (91.36% precision, 96.10% recall),
conflict 36/1/4 (97.30% precision, 90% recall), one protected-control false conflict.
**This did not meet acceptance.** The annotator supplied several incorrect or
ambiguous labels (including apparent duplicate questions labeled distinct), so
model authorship alone is insufficient gold-standard validation. No labels were
changed to improve reported scores; the initial redacted report is retained.

The output also exposed unsafe assumptions about unknown fictional aliases and
unspecified years. The adjudication prompt now requires affirmative evidence for
aliases and returns uncertain for time-varying facts with unestablished dates.
Once used for these corrections, this set also becomes regression evidence.
A trustworthy independently reviewed, untouched evaluation remains outstanding;
passing any corrected rerun must not be reported as completing that gate.

Synthetic cache measurements above predate this last prompt refinement; they
measure the same embedding implementation and retrieval threshold, not current
production end-to-end performance. The source-database connection and separate
seed-data approval remain unresolved. STE-26 is not ready to merge or mark Done.
