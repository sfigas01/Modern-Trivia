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
| `live`   | LLM-backed, run only with `--live` (requires `AI_INTEGRATIONS_OPENAI_API_KEY`) | `semantic_duplicate` / `string_duplicate` (STE-26)                                                                                                                      |
| `none`   | No detector yet — fixtures ready, waiting on the owner ticket                  | `coherence` (STE-246), `obviousness` (STE-247), `factual_error` (STE-25), `us_centric` (STE-249)                                                                        |

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
