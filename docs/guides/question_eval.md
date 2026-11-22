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
npm run eval:questions -- generate --dry-run        # plan and spend cap; no calls
npm run eval:questions -- generate                  # every arm + blind review sheet (cap $3)
npm run eval:questions -- generate --retry-failed   # rerun only arm/theme pairs that failed
npm run eval:questions -- judge [--rubric v2]       # LLM judge on the same sheet (cap $2)
npm run eval:questions -- verify                    # Wikipedia evidence check per item (cap $2)
npm run eval:questions -- repeats                   # repeats across simulated games (cap $1)
npm run eval:questions -- rating-page --title "…"   # owner rating page HTML for the run
npm run eval:questions -- import-ratings --from <dir>  # rating page export -> ratings.csv
npm run eval:questions -- score                     # ratings (+ judges, facts) -> report
```

Every command takes `--config <file>` (default `test/fixtures/question-eval/config.json`, round 1; round 2 is `round-2.json`) and `--run reports/question-eval/<runId>` (default: the latest run). `--max-usd <n>` changes a spend cap and `--model <id>` changes the judge or verifier model.

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
| `judge-v2.json`             | Judge ratings with the round 1 owner calibration               | Yes, in the reasons                                        |
| `verify.json`               | Evidence check: verdict, quote, source and gate decision       | Yes                                                        |
| `facts.csv`                 | Hand-verified truth labels: `item,truth,note`                  | Yes, in the notes                                          |
| `rating-page.html`          | The owner rating page for this run                             | Yes                                                        |
| `report.md` / `report.json` | Results                                                        | Judge reasons may mention answers                          |

**Do not commit these files or paste them into Linear, GitHub or chat.** The owner is also a player, so rating a sheet spoils those questions for the owner.

## Rating the sheet

**Rating page (preferred).** `rating-page` writes `rating-page.html` from the committed template `script/question-eval-rating-page.html`. Publish it as a private artifact whose database allows owner-only reads and writes (`db` rules `[{path: "", read: "owner", write: "owner"}]`). Ratings save to `ratings/<item>` as the owner goes. Export that collection to a folder of JSON files and run `import-ratings --from <folder>`.

**Spreadsheet (alternative).**

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

## Round 1 decision rules (fixed before any results)

Round 1 compared A with B (Wikipedia grounding). Its outcome is recorded in STE-304.

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

## Round 2: style guide, correctness check and taste check

Round 1 found that most bad questions were playability problems (ambiguity, wrong difficulty labels, explanation-style answers, too academic), and that Guardian's model-memory fact check passed both confirmed wrong answers. Round 2 (`--config test/fixtures/question-eval/round-2.json`) tests three candidate fixes on the same six themes, with 3 questions per theme per arm:

| Piece                              | What it is                                                                                                                                                                    | Question it answers                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **A2**                             | Guardian with `WRITER_STYLE_GUIDE_V2` (`server/lib/trivia-style-guide.ts`), written from the owner's round 1 notes                                                            | Do prompt rules fix the playability problems?   |
| **Evidence check** (`verify`)      | A cheap model picks Wikipedia searches; the script fetches the articles and keeps related passages; a strong model gives a verdict that must quote the passages word for word | Can an always-on check catch wrong answers?     |
| **Judge v2** (`judge --rubric v2`) | The round 1 judge plus `JUDGE_CALIBRATION_V2`, written from where it disagreed with the owner                                                                                 | Can an automated check apply the owner's taste? |

Three planted questions with known false answers are included to test the correctness checks.

**Truth labels.** Correctness is not measured from owner ratings, since a quick read is not a fact check. Every item gets a hand-verified label in `facts.csv` (`correct`, `incorrect` or `unverifiable`), checked against Wikipedia or another reliable source. Labels are written **before** reading `verify.json`, so the evidence check's verdicts cannot anchor them. Planted questions are labelled `incorrect`.

Order of steps: `generate` → owner rates (blind) → write `facts.csv` → `verify` → `judge` (v1 and v2) → `score`.

### Round 2 decision rules (fixed before any results)

1. **Style guide (A2 vs A).** A2 replaces the default prompt if its owner keep rate is at least **15 points** higher than A's, **or** its ambiguity rate is at most half of A's with no explanation-style answers, provided its mean fun is no more than **0.3** lower and it has no more wrong answers (by truth label) than A. Otherwise, revise the guide from the new notes and rerun.
2. **Difficulty labels.** If A2's labels match the owner's rating for at least **60%** of questions (round 1: 38%), prompt calibration is enough. If not, difficulty needs another mechanism, such as the judge's estimate or real player correct rates.
3. **Correctness check.** The evidence check becomes the always-on correctness gate if it passes **zero** wrong answers (truth `incorrect`, planted ones included) and holds or rejects at most **25%** of correct ones. If it passes any wrong answer, find out why before adopting it. Compare it with Guardian's fact check on the same items.
4. **Taste check (judge v2).** Judge v2 can act as an automated content-strategy filter that sends questions for review (not one that makes final decisions) if it matches the owner's keep-vs-reject decision on at least **75%** of items with kappa of at least **0.4**. Otherwise the owner, or real player signals, stay the taste check.
5. **Cost.** Report the cost per kept question with the evidence check included. The gate must not raise it by more than **3x** for an on-demand round to stay cheap.

Record the outcome of each rule in STE-304.

## Round 3: theme handling and repeats

Round 2 showed that the theme drives quality. Narrow themes (a local scene, hyper-local slang) produced unverifiable, hard and repeated questions, and academic themes drifted into textbook questions. Both generators also converged on the same obvious facts, which would repeat across games. Round 3 (`--config test/fixtures/question-eval/round-3.json`) uses eight themes chosen with the owner to resemble real player requests: 90s cartoons, Hockey, Harry Potter, Taylor Swift, Space, Food around the world, Movies of 2026, and Canadian road trip.

| Arm   | What it is                                                                                                                                                                                                                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | Guardian as is, with no history.                                                                                                                                                                                                                                        |
| **T** | A theme brief first (breadth, academic risk, a widened theme only when the theme is narrow, and 6–10 well-known subtopics), then Guardian with the brief and the theme's earlier questions as history, then a filter that drops any question reusing an earlier answer. |

Each arm generates **3 simulated games** per theme, with 2 questions per game. Only **game 1** goes on the owner's sheet (32 questions, plus 3 planted false questions). `repeats` asks the strong model which game 2 and game 3 questions repeat a fact from an earlier game of the same arm and theme. The evidence check (round 2's correctness gate) and **judge v3** (round 2 calibration plus the owner's US content test, `JUDGE_CALIBRATION_V3`) run on the rated items. Truth labels are written before reading `verify.json`, as in round 2.

The owner rates **fit** under the new audience rule (US pop culture fits; US school knowledge does not). The rating page also says that two sources may write the same fact and to rate each on its own merits, since repeats are measured separately.

Order: `generate` → owner rates → `facts.csv` → `verify` → `repeats` → `judge --rubric v3` (and v2 for comparison) → `score`.

### Round 3 decision rules (fixed before any results)

1. **Theme brief.** T replaces A as the generation path if its owner keep rate is at least **10 points** higher than A's, and it has no more wrong or unverifiable answers (by truth label) than A. If T wins only on the narrow or academic themes (Harry Potter, Taylor Swift, Space), use the brief only when it rates a theme narrow or academic.
2. **Repeats.** The history-plus-same-answer filter is adopted if T's repeat rate in games 2 and 3 is at most **half** of A's, and at most **15%** of later-game questions.
3. **Audience rule.** Under the new fit rule, T's off-brand rate is at most **20%**.
4. **Taste check (judge v3).** Judge v3 becomes the automated taste filter (sending questions for review, never making final decisions) if it matches the owner's keep-vs-reject decision on at least **75%** of items with kappa of at least **0.4**: the same bar as round 2. If it misses again, test jev (TypeSafe AI) as the taste check before trying a judge v4.
5. **Correctness check (confirmation).** The evidence check passes **zero** wrong answers again. If it passes any, the gate goes back to review before it ships.

Record the outcome of each rule in STE-304.

## Code

| File                                                 | Purpose                                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `server/lib/question-eval.ts`                        | Pure logic: spend tracking, prompts, blind sheet, CSV, rating parsing, judge parsing, statistics, report |
| `server/lib/question-eval.test.ts`                   | Unit tests and a full stand-in run with fake generators (no network)                                     |
| `script/question-eval.ts`                            | CLI: OpenAI, Wikipedia and file I/O                                                                      |
| `test/fixtures/question-eval/config.json`            | Round 1: themes, arms, anchors, models                                                                   |
| `test/fixtures/question-eval/round-2.json`           | Round 2: arms A and A2, planted false questions, verifier model                                          |
| `test/fixtures/question-eval/round-3.json`           | Round 3: arms A and T (theme brief + repeat filter), 8 owner-chosen themes, 3 games per theme            |
| `server/lib/trivia-style-guide.ts`                   | Writer style guide v2 and judge calibration v2, written from round 1 owner notes                         |
| `script/question-eval-rating-page.html`              | Owner rating page template (no data; `rating-page` fills it per run)                                     |
| [trivia_quality_rubric.md](trivia_quality_rubric.md) | The definition of a good question                                                                        |
