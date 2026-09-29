# Guardian quality-engine benchmark (STE-28)

A golden set of known good/bad trivia questions used to **measure** whether the
Guardian quality engine catches the failure modes that actually appear in the
library — instead of hoping it does. It is the regression gate for any Guardian
prompt, heuristic, or model change.

## Run it

```bash
npm run benchmark              # static (deterministic) checks only — no API key needed
npm run benchmark -- --live    # also run the LLM checks (fact-check, conceptual dedup)
```

The static run is also enforced by Vitest (`server/lib/quality-benchmark.test.ts`),
so `npm test` fails if agreement drops below 95% or a clean control gets flagged.
Human-readable reports are written to `reports/quality-benchmark.{json,md}`
(gitignored).

## How a case is scored

Each case in `cases.json` is a real question payload plus:

- `expects`: the failure-mode labels the engine _should_ flag it for. `[]` means a
  clean question — a **false-positive control**.
- `note`: why the case is good/bad.

`question.id` must equal the case `id` so live checks map back to the case.

The runner ([`server/lib/quality-benchmark.ts`](../../../server/lib/quality-benchmark.ts))
runs the engine over every case, maps findings to labels, and reports
precision/recall/accuracy per failure mode plus a per-case expected-vs-detected diff.

## Failure-mode labels and their detectors

| Tier     | Meaning                                                                        | Labels                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `static` | Deterministic heuristics (`question-quality-audit`), always run                | `answer_leakage`, `missing_source`, `invalid_difficulty`, `tagging`, `subjective`, `ambiguous_format`, `type_mismatch`, `multi_answer`, `missing_field`, `unverifiable` |
| `live`   | LLM-backed, run only with `--live` (requires `AI_INTEGRATIONS_OPENAI_API_KEY`) | `coherence` (STE-246), `obviousness` (STE-247), `semantic_duplicate` / `string_duplicate` / `answer_conflict` / `review_required` (STE-26)                              |
| `none`   | No detector yet — fixtures ready, waiting on the owner ticket                  | `factual_error` (STE-25), `us_centric` (STE-249)                                                                                                                        |

Labels in the `none` tier (and `live` labels in a static run) are reported as
**coverage gaps**, never counted against the score. As each sibling ticket ships
its detector, flip the label's `tier` in `LABEL_REGISTRY` and its cases start being
measured automatically.

## Growing the suite

**Every escaped defect becomes a case.** When a bad question is found in
production, add it here with the label(s) it should have been caught for, and a
clean sibling if useful as a control. If the failure mode has no detector yet,
add it under the right `none`/`live` tier — the benchmark will track it as a gap
until the detector lands.

## Semantic pair evaluation (STE-26)

`semantic-pairs.json` is the initial pair-level regression set: 40 paraphrases,
40 incompatible-answer pairs, 40 same-topic negatives (including 20 different-year
controls), and 10 alias/unit-equivalence controls. Most entities are explicitly
fictional: the labels assert equivalence or contradiction, never real-world
answer correctness. The repeated fixture families are a controlled regression
set, not evidence of representative production accuracy. This set and the second
set informed implementation corrections; use the separate blind evaluation below
for untouched outcomes.

Run the opt-in paid evaluation using the existing OpenAI integration variables:

```bash
npm run benchmark -- --semantic-pairs --live
```

The runner scores pairs independently, preserving question-pair identity instead
of allowing one unrelated match to label an entire fixture corpus. The report at
`reports/semantic-pair-benchmark.json` includes only IDs, classifications, raw
TP/FP/FN, precision/recall, unresolved/incomplete counts, and elapsed time. Gates:

At least 95% precision and 90% recall for each detector, greater than 95% overall
pair agreement, and zero false conflicts on protected controls. Unresolved
positives count as false negatives. Provider failures stop remaining calls and
fail the gate.

The ordinary `npm run benchmark -- --live` still runs the existing STE-28 suite;
both evaluations are required. Static/mocked passes are not live accuracy results.

### Separate frozen evaluation

`semantic-holdout.json` contains 130 additional pairs whose labels were fixed after
freezing the detector prompt and before observing their detector outcomes. Run it
separately:

```sh
npm run benchmark -- --semantic-pairs --live --input test/fixtures/benchmark/semantic-holdout.json --json reports/semantic-holdout-benchmark.json
```

Labels describe relationships, not the factual correctness of the answers.
The implementation agent authored the labels; a separate blinded GPT-4o pass
cross-checked them. This is model-assisted annotation, not independent human
review. The set includes 40 paraphrases, 40 conflicts, 20 attribute-scope negatives,
20 temporal negatives and 10 aliases. Repeated control templates limit diversity.
The original `semantic-pairs.json` is now a regression set because an alias case
informed a prompt correction. Never describe a corrected rerun as untouched evidence.

The second set also became a regression set after its first evaluation exposed
retrieval and scope errors. `semantic-blind-eval.json` is the subsequent independent
model-authored set: 170 cases, with no detector implementation, tuning examples or
outputs provided to its author. Original labels were retained; only metadata spellings
were normalized (`"null"` to null, attribute/geographic to scope). Forty additional
blinded negatives were added before evaluation to meet minimum class support.
This dataset is independently model-labeled, not independently human-reviewed.
Run using the command above with `semantic-blind-eval.json` as the input.

The first blind-set run failed the detector gates and exposed model annotation
errors. It is retained without score-improving relabeling, and subsequent fixes
make reruns regression evidence. See `docs/guides/semantic-dedup.md` for the full
record; none of these corrected reruns is a substitute for independent gold-label
review and a new untouched evaluation.

`semantic-reviewed-eval.json` is the subsequent pre-reviewed set (140 pairs).
Forty independently authored relation records were checked for inverted questions,
ambiguous scope and duplicate subjects BEFORE detector execution, then expanded
into 40 duplicate/conflict/distinct triples. Ten alias and ten temporal controls
were added before evaluation. See the guide for provenance and limitations.
