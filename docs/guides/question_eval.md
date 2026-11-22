# Offline question eval (STE-304)

A small, offline experiment that compares question generators against the owner's blind ratings, and checks whether an LLM judge can stand in for those ratings during development.

It exists to answer one question before more is added to the themed-generation pipeline (STE-167 / STE-303): **which parts of the pipeline actually improve the questions players see?**

The eval runs **offline**. It uses no database, Railway, scheduler or feature flag, and it changes no production code path. It only calls existing generation and QA functions.

## What it compares

| Group                                | What it is                                                                                                                                           | Why it's included                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **A: Guardian as is**                | `generateQuestions()`, the existing staging generator: coverage plan → one generation call → static audit → LLM fact check → one repair pass         | The simple baseline that already exists                            |
| **B: Guardian + Wikipedia passages** | Wikipedia search → 3 articles → one generation call using only those articles → the same static audit and LLM fact check, with hard failures dropped | Tests E1's core idea (source grounding) without its infrastructure |
| **Library anchors**                  | 8 approved questions from `server/seed-data.json`                                                                                                    | Shows the bar the current library sets                             |
| **Planted bad**                      | 8 known-bad questions from `test/fixtures/benchmark/cases.json`                                                                                      | Checks that both the owner and the judge catch obvious defects     |

Six themes are covered: 2 standard, 2 Canadian, 1 niche and 1 Fresh Prints. Each arm generates 4 questions per theme. The themes and anchors live in `test/fixtures/question-eval/config.json`.

### Known differences between the arms

These are deliberate, and should be kept in mind when reading results:

- Arm A has a repair pass and arm B does not, so A's yield is helped by repair.
- Arm A plans subtopics before generating; arm B gets its variety from the articles.
- Arm B uses a direct MediaWiki fetch, not the theme pipeline's retrieval stack (which pins IP addresses and needs registry hashes). It approximates E1's grounding, not its exact retrieval.
- Arm A's internal drops are not visible, so "dropped by QA gate" is reported for arm B only.

## How to run

```sh
npm run eval:questions -- generate --dry-run   # plan and spend cap; no calls
npm run eval:questions -- generate             # both arms + blind review sheet (cap $3)
npm run eval:questions -- judge                # LLM judge on the same sheet (cap $2)
npm run eval:questions -- score                # owner ratings (+ judge) -> report
```

Use `--run reports/question-eval/<runId>` to pick a run (the default is the latest), `--max-usd <n>` to change a spend cap, and `--model <id>` to change the judge model.

**Key:** set `AI_INTEGRATIONS_OPENAI_API_KEY` to a **separately capped** OpenAI project key. Do not use the production key or the E1 preview key.
In a Claude Code cloud session where the key is saved as a network secret, set the variable to any placeholder and add `NODE_USE_ENV_PROXY=1`:

```sh
AI_INTEGRATIONS_OPENAI_API_KEY=proxy-injected NODE_USE_ENV_PROXY=1 npm run eval:questions -- generate
```

**Spend:** every OpenAI call, including Guardian's internal ones, is counted. No new request is sent once the cap is reached. Costs are upper bounds from the price table in `server/lib/question-eval.ts`; recheck it against current OpenAI pricing. Expect well under $1 per full run.

## Output

Everything goes to `reports/question-eval/<runId>/` (gitignored, files are mode 0600):

| File                        | Contents                                                       | Contains answers?                                          |
| --------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| `candidates.json`           | Every question, its group, Guardian's verdict, cost and timing | Yes                                                        |
| `key.json`                  | Blind item ID → group                                          | No, but it unblinds the sheet: don't open it before rating |
| `review-sheet.csv`          | The blind sheet to rate                                        | Yes                                                        |
| `judge.json`                | Judge ratings and cost                                         | Yes, in the reasons                                        |
| `report.md` / `report.json` | Results                                                        | Judge reasons may mention answers                          |

**Do not commit these files or paste them into Linear, GitHub or chat.** The owner is also a player, so rating a sheet spoils those questions for the owner.

## Rating the sheet

1. Copy `review-sheet.csv` to `ratings.csv` in the same folder.
2. Open it in Google Sheets or Excel. Fill in the seven rating columns using [trivia_quality_rubric.md](trivia_quality_rubric.md).
3. Export it back to CSV and run `score`.

| Column       | Values                                               |
| ------------ | ---------------------------------------------------- |
| `correct`    | `y` / `n` / `u` (unsure)                             |
| `one_answer` | `y` / `n`                                            |
| `fun`        | `1`–`5`                                              |
| `difficulty` | `E` / `M` / `H` (how hard it really is)              |
| `fits`       | `y` / `n`                                            |
| `verdict`    | `keep` / `fix` / `drop`                              |
| `why`        | one short line (optional, but the most useful input) |

Leave a whole row blank to skip it; it is reported as unrated. Invalid cells are reported, never guessed. Rate the questions in sheet order and don't open `key.json` until scoring is done.

## Decision rules (fixed before any results)

These rules were written before the first run so the results can't be read to fit a preferred answer. The thresholds are judgement calls, and they are stated as such. With about 20–25 rated items per arm, only large differences are meaningful, so check the confidence intervals in the report.

1. **Grounding (B vs A).** Grounding earns its place if arm B's keep rate is at least **15 points** higher than A's, **or** its factual-error rate is at least **10 points** lower, **and** its mean fun score is no more than **0.5** lower.
   - If neither holds, prefer A: it is simpler and already exists.
   - If B wins only on the niche or Fresh Prints themes, use grounding only for those kinds of theme.
2. **Accuracy vs fun.** If B is more accurate but at least 0.5 less fun, the next experiment should improve B's prompt. Adding verification stages is not the answer to that problem.
3. **Guardian's own fact check.** If the owner marks **2 or more** questions incorrect that Guardian's fact check had passed, the factual gate is the weak point. Test a stronger fact check before adding new stages.
4. **The judge.** The judge can stand in for owner ratings during development if it agrees with the owner's keep-vs-reject decision on at least **80%** of items, with Cohen's kappa of at least **0.6**, **and** it rejects at least **7 of 8** planted bad questions.
   - Otherwise, owner ratings stay in the loop. Use the disagreements to revise the judge prompt and rerun `judge` on the same sheet, which is cheap.
5. **E1's extra stages** (separate fact review, evidence review, quality review, repair). Each is justified only if the failure it targets shows up in at least **10%** of the rated A/B questions.
6. **The library bar.** If A's keep rate is at or above the library anchors' keep rate, A already matches the current library's quality.

Record the outcome of each rule in STE-304 when the run is complete.

## Code

| File                                                 | Purpose                                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `server/lib/question-eval.ts`                        | Pure logic: spend tracking, prompts, blind sheet, CSV, rating parsing, judge parsing, statistics, report |
| `server/lib/question-eval.test.ts`                   | Unit tests and a full stand-in run with fake generators (no network)                                     |
| `script/question-eval.ts`                            | CLI: OpenAI, Wikipedia and file I/O                                                                      |
| `test/fixtures/question-eval/config.json`            | Themes, anchors, models                                                                                  |
| [trivia_quality_rubric.md](trivia_quality_rubric.md) | The definition of a good question                                                                        |
