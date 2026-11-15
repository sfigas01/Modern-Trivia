# Question Authoring Pipeline (agent design)

> **Status:** Draft design (2026-11-15). Nothing here is built unless the "Exists today" column says so.
> **Implements:** `CONTENT_STRATEGY.md` v2. If the two disagree, the strategy wins. Fix this guide.
> **Builds on:** the source-first pipeline in `docs/guides/theme_source_pipeline.md` and `docs/guides/theme_reliability_contract.md` (STE-25, stages S2–S10), Guardian QA (`server/lib/guardian.ts`, `server/lib/quality-control-prompt.ts`), semantic dedup (`docs/guides/semantic-dedup.md`, STE-26) and coverage planning (STE-249).

This guide describes how to make a factual trivia question that is correct, workable and interesting, as a chain of single-purpose AI agents with plain-code checks in between. It is written so each step can become one agent, one prompt and one strict output schema.

---

## 1. Ground rules for every agent

1. **One job per agent.** An agent that writes never reviews its own work. Each agent returns structured JSON that matches a Zod schema, never free text.
2. **Independent reviewers.** Each reviewer uses a different identity and run from the agent it checks, and a different provider/model pair where possible. This matches the existing S6b and S8a independence rules.
3. **Fail closed.** Missing, malformed, conflicting or uncertain output holds the question back. "Probably fine" is a hold.
4. **Code decides, agents advise.** Agents give verdicts on separate dimensions. Plain code adds them up, applies thresholds and writes to the database. No agent can approve a question.
5. **Facts come from sources, never from memory.** Only the research steps (2–4) may add facts, and only from retrieved passages. Later agents may reword but must not add claims.
6. **Spoiler-free.** Any output a human might read (logs, reports, admin screens) hides answers unless someone deliberately reveals them (STE-248).
7. **Record everything.** Every agent run records its prompt version, policy hash, model and input fingerprint, so results can be replayed and audited. This is already the pattern for S5–S10.
8. **Bounded repair.** A question gets at most one rewrite, and the rewrite then goes through every review again (S9). We don't loop until something passes.

---

## 2. The pipeline at a glance

```
            ┌──────────────────────────── PLAN ─────────────────────────────┐
 inventory → [A1 Gap Planner] → briefs
 + play data
            ┌──────────────────────────── RESEARCH ─────────────────────────┐
 brief → [A2 Source Scout] → passages → [A3 Fact Miner] → facts
       → [A4 Fact Checker]* → reviewed facts
            ┌──────────────────────────── WRITE ────────────────────────────┐
 reviewed fact + brief → [A5 Question Writer] → candidate
            ┌──────────────────────────── REVIEW (all must pass) ───────────┐
 candidate → [A6 Evidence Reviewer]*      (is every claim supported?)
           → [A7 Playability Panel]*      (workable? fair? predicted correct rate?)
           → [A8 Editor & Strategy QA]*   (Guardian rules + strategy rules)
           → [C1 Static audit + C2 Novelty] (code + embeddings)
                 │ fails A7/A8/C1 only → [A9 Repairer] (once) → back to A6
            ┌──────────────────────────── SHIP ─────────────────────────────┐
 → [C3 Approval] (atomic, code) → library (status=approved, calibrating)
            ┌──────────────────────────── LEARN (after launch) ─────────────┐
 play results → [A10 Calibration Analyst] → relabel / rewrite / retire
 clock        → [A11 Freshness Warden]    → expire / refresh
 disputes     → [A12 Dispute Adjudicator] (EPIC-01) → fix / reject

 * = independent reviewer (never the same identity or run as the agent it checks)
 A = AI agent   C = plain code
```

| #   | Step                 | Kind         | Exists today?                                                               | New work needed                                        |
| --- | -------------------- | ------------ | --------------------------------------------------------------------------- | ------------------------------------------------------ |
| A1  | Gap Planner          | Agent        | Partly: pillar quotas (`computeStrategyQuotas` in `server/lib/guardian.ts`), STE-249 coverage plan        | Difficulty × pillar × audience gaps, use of play data  |
| A2  | Source Scout         | Code + agent | Yes: S2 registry, S2b retrieval, S12B-1 Wikipedia discovery, S3 passages    | Search aimed at a brief                                |
| A3  | Fact Miner           | Agent        | Yes: S5 `theme-fact-derivation.ts`                                          | Prompt for "interestingness" and hint material         |
| A4  | Fact Checker         | Agent        | Yes: S6b `theme-fact-review.ts`                                             | —                                                      |
| A5  | Question Writer      | Agent        | Yes: S7 `theme-question-generation.ts`                                      | Craft rules, hint path, predicted difficulty in output |
| A6  | Evidence Reviewer    | Agent        | Yes: S8a `theme-question-evidence-review.ts`                                | —                                                      |
| A7  | Playability Panel    | Agent        | **No** (obviousness check covers half of it)                                | **New agent**                                          |
| A8  | Editor & Strategy QA | Agent        | Yes: Guardian QC prompt (coherence, obviousness, calibration, pillar rules) | Add answer-format and hook rules from strategy §5      |
| C1  | Static audit         | Code         | Yes: `question-quality-audit.ts`                                            | Length and approximation-answer rules                  |
| C2  | Novelty              | Code + agent | Yes: STE-26 `novelty-filter.ts`, embeddings                                 | —                                                      |
| A9  | Repairer             | Agent        | Yes: S9 `theme-question-repair.ts`                                          | Accept A7 failures as repairable                       |
| C3  | Approval             | Code         | Yes: S10 `theme-question-approval.ts`                                       | Store predicted correct rate and hint path             |
| A10 | Calibration Analyst  | Agent + code | **No**                                                                      | **Needs per-answer result storage (migration)**        |
| A11 | Freshness Warden     | Code + agent | Partly: `validUntil` on facts; STE-271                                      | Remove expired questions from play                     |
| A12 | Dispute Adjudicator  | Agent        | Partly: EPIC-01 (paused)                                                    | —                                                      |

So most of the pipeline already exists for correctness. The new agents are aimed at the player experience: **A7 Playability Panel** before launch and **A10 Calibration Analyst** after launch, plus stricter craft rules in A5 and A8.

---

## 3. Agent specs

Each spec gives: the agent's **job**, its **inputs**, its **outputs**, the **rules** its prompt must carry, and the **gate** that plain code applies.

### A1 — Gap Planner

**Job:** decide what to write next. Produce briefs that fill the library's real gaps. Don't simply generate more of whatever is easy.

**Inputs:** a summary of the approved library, counted by pillar × category × difficulty × region × era (answers hidden). Measured play results per cell, once A10 exists. Retired facts and near-duplicate clusters to avoid. Batch size.

**Output (one per brief):**

```json
{
  "briefId": "uuid",
  "pillar": "GreatOutdoors",
  "category": "Food & Culture",
  "targetDifficulty": "Medium",
  "targetCorrectRate": [0.45, 0.75],
  "subtopic": "Atlantic Canada maritime history",
  "audienceOwner": "all | under30 | over30 | regional:<region>",
  "answerType": "person | place | thing | title | year | number | word",
  "avoid": ["<subtopics already well covered>"],
  "rationale": "GreatOutdoors Medium has the fewest repeat-free games left; Atlantic Canada is under-covered"
}
```

**Rules:** fill the scarcest cells first, measured as repeat-free games left. Keep pillar shares within ±10% of target. Avoid mean-reversion, meaning the same famous facts every time (STE-249). Spread regions and eras. Never plan a topic that only works as obscure recall.

**Gate (code):** brief counts per cell match the quota, and no brief duplicates the subtopic of another in the same batch.

### A2 — Source Scout

**Job:** find and capture passages that may support facts for a brief.

**Inputs:** the brief, the source registry and the retrieval policy.

**Output:** registry-bound documents and passages with hashes (S2–S4 contracts).

**Rules:** only allowed sources. Prefer at least two independent origin groups. Never paraphrase: capture the source text.

**Gate:** today's S2–S4 checks (registry match, HTTPS, freshness, size limits).

### A3 — Fact Miner

**Job:** pull from the passages **scoped facts that would make good trivia**. They should be surprising, have one crisp answer, and come with material for hints.

**Inputs:** up to 12 passages (S5 limit) and the brief.

**Output:** the S5 proposal (statement, scope, canonical answer, aliases, time sensitivity, citations), **plus**:

```json
{
  "hookCandidates": ["undefeated for 17 years", "pictured on the coin since 1937"],
  "hintMaterial": ["Nova Scotia", "nickname for Nova Scotians"],
  "answerTypeFit": "thing",
  "contestedRisk": "none | dated | disputed"
}
```

**Rules:** one fact per proposal. The answer must be short to name (strategy §5 answer rules). Mark "firsts", "largests" and counts as `dated` or `disputed`. Return `insufficient_evidence` rather than stretch. Hooks and hints must come from the passages too.

**Gate:** S5 policy (at least one supporting passage, origin count, no conflict edge). Drop a fact when `contestedRisk = disputed`.

### A4 — Fact Checker (independent)

**Job:** independently confirm that the passages fully support the fact, its scope, answer and aliases, and that no offered passage contradicts it.

**This is S6b as it stands:** six dimensions (entailment, scope, canonical answer, aliases, conflict, source independence). It sees every offered passage, including any the miner didn't cite.

**Gate:** S6b eligibility. A newer non-pass blocks an older pass.

### A5 — Question Writer

**Job:** turn one reviewed fact into a question that is **correct, workable, not a giveaway, and interesting**, aimed at the brief's difficulty.

**Inputs:** the reviewed fact (with answer and aliases, as trusted state), its passages, the brief, and the hook and hint material.

**Output:** the S7 candidate (question and explanation only; answer, aliases, category, pillar and tags come from trusted state), **plus**:

```json
{
  "hintPath": [
    "coin context narrows to Canadian icons",
    "Nova Scotia + nickname points to the name"
  ],
  "hook": "undefeated racing record",
  "predictedCorrectRate": 0.55,
  "predictedDifficulty": "Medium",
  "suggestedAcceptableAnswers": ["the Bluenose"]
}
```

**Prompt rules** (copy strategy §5 into the prompt):

1. The answer must be the kind of thing the question asks for, and the premise must be true.
2. At Medium and Hard, give at least one hint from `hintMaterial` that a non-expert can reason with.
3. The hint narrows the answer down but never states it. Without topic knowledge, the answer can't be derived.
4. 12–30 words, readable aloud, Canadian spelling, neutral wording, no "best" or "greatest".
5. Explanation: confirm the answer, then one supported "huh!" fact. No new unsupported claims.
6. Decline when the fact can't become a fair question at any difficulty.
7. To make a question easier or harder, **adjust the hints**, not how obscure the fact is.

**Gate:** S7 schema and hash, length limit, and the answer string must not appear in the question (static leakage).

### A6 — Evidence Reviewer (independent)

**Job:** check every claim in the question **and the explanation** against the passages.

**This is S8a as it stands:** seven dimensions (premise, answer, scope, aliases, explanation, freshness, source independence).

**Gate:** S8a eligibility, and the reviewer must be independent of A3, A4 and A5.

### A7 — Playability Panel (new, independent)

**Job:** predict how real players in the room will experience the question **before** it ships. This is the agent that targets "players skip or guess" and "too easy".

**How it works:** one model run, or several, role-play a **panel of player personas** who answer **without seeing the answer**, then a separate judge step compares their attempts with the answer. Default panel:

| Persona        | Profile                                                               |
| -------------- | --------------------------------------------------------------------- |
| Casual 22      | Gen Z, online, little 80s/90s knowledge, not a trivia regular         |
| Casual 45      | Gen X, nostalgic, average general knowledge                           |
| Trivia regular | Plays pub trivia weekly, broad knowledge                              |
| Newcomer       | Lived in Canada for 3 years, strong world knowledge, weak Canadiana   |
| Cold reader    | No knowledge of the topic at all. Uses only the words in the question |

**Step 1 — attempts (answer hidden):** each persona returns `{ attempt, confidence: 0-1, wouldPass: bool, reasoning: "which part of the clue I used" }`.

**Step 2 — judge (sees the answer):**

```json
{
  "predictedCorrectRate": 0.5,
  "predictedPassRate": 0.1,
  "personaResults": [{ "persona": "Casual 22", "correct": false, "usedHint": true }],
  "workable": "pass | fail",
  "giveaway": "pass | fail",
  "answerFormat": "pass | fail",
  "fairness": "pass | fail",
  "reasons": ["<allowlisted reason codes>"]
}
```

**Rules:**

- `giveaway = fail` if the **Cold reader** gets it right. This matches the existing obviousness rule.
- `workable = fail` if, at Medium or Hard, no persona that missed it could name a usable hint, or if most personas would pass.
- `answerFormat = fail` if fair attempts would be marked wrong. For example, the right answer in a different form that the fuzzy matcher and `acceptableAnswers` wouldn't accept. Run the real `verifyAttempt` from `shared/lib/answers.ts` over the persona attempts.
- `fairness = fail` if only one persona could ever get it, unless `audienceOwner` targets exactly that group.

**Gate (code):** every dimension passes, and `predictedCorrectRate` falls within (or ±0.1 of) the brief's band. When the band is missed, code relabels the difficulty once if the new band is legal, then sends the question on. Otherwise it goes to A9.

> **Caution.** AI personas are a rough predictor, not real players. Their predictions get checked against real results by A10 and the panel prompts get retuned. Don't treat a persona score as ground truth.

### A8 — Editor & Strategy QA (independent)

**Job:** final editorial review against Guardian rules and the content strategy.

**Today's prompt** (`quality-control-prompt.ts`) covers fact verdict, coherence, obviousness, difficulty calibration, leakage, clarity, tags, GlobalEh not being US-centric, and FreshPrints freshness.

**Add:**

- Answer rules (strategy §5): no approximations, no contested facts, accepted alternatives present.
- Hook check: does the question or explanation give a reason to care? A bare textbook fact gets a flag.
- TimeCapsule bridge rule: is there a hint for players under 30?
- GreatOutdoors regional fairness.
- Tone: inclusive, no punching down, no gossip about private people.

**Gate:** `pass` on every dimension. `flag` holds for a human (spoiler-free) review; `fail` goes to A9 when it can be repaired.

### C1 — Static audit (code)

The 12 existing rules in `question-quality-audit.ts`, plus proposed rules for: question length (12–30 words), answer patterns that signal approximation ("approximately", "about", "around" in the question with a number answer), and a missing `acceptableAnswers` for person answers.

### C2 — Novelty (code + agent)

STE-26 semantic near-duplicate and conflicting-answer detection against the whole approved and pending library, including retired facts.

### A9 — Repairer

**Job:** one rewrite of question wording and explanation only, to fix a named A7, A8 or C1 failure. **This is S9**, extended so A7 failures can be repaired.

**Rules:** the answer and the facts are fixed. Fix only the named failure. An unchanged result counts as a failure. The repaired candidate goes back through A6 → A7 → A8 → C1 → C2 in full.

### C3 — Approval (code)

**S10 as it stands:** atomic recheck and insertion as `approved`. Also stores, in `ai_analysis`, the `predictedCorrectRate`, `hintPath`, `hook` and panel results, so A10 can later compare predictions with reality.

### A10 — Calibration Analyst (new; needs data)

**Job:** after launch, compare real results with the targets and recommend actions.

**Prerequisite:** store the result of every answer per question: result, difficulty when shown, game size, time to answer. This needs a migration and owner approval.

**Inputs:** per-question totals (with at least 30 attempts) and the stored predictions. No answers are passed to anything a human reads.

**Outputs per question:** `keep | relabel:<difficulty> | rewrite:<reason> | retire`, plus prediction error for retuning A7.

**Rules (mostly plain code; the agent writes the reason and the rewrite brief):**

| Measured                         | Action                                                             |
| -------------------------------- | ------------------------------------------------------------------ |
| In band                          | keep (mark `calibrated`)                                           |
| Out of band, inside another band | relabel                                                            |
| < 15% correct or > 30% passed    | pull from play → rewrite brief to A5/A9 → retire if it fails again |
| > 95% correct                    | rewrite harder, or keep as a warm-up Easy                          |
| Dispute rate > 2%                | send to A12                                                        |

Monthly, A10 also reports how far A7's predictions were off for each persona and pillar, so the panel prompts can be retuned.

### A11 — Freshness Warden

**Job:** keep time-sensitive content current.

Daily code job: questions past `validUntil` leave play. For expired facts that are still worth asking, the agent writes a refresh brief that A1 queues. It also runs the STE-271 staleness rules for FreshPrints.

### A12 — Dispute Adjudicator

**EPIC-01** (paused). Takes player disputes, checks them against the question's stored evidence, and recommends fix or reject. Fixes go through A9 → full review.

---

## 4. The good-question checklist (shared by A5, A7, A8 and human reviewers)

A question is ready only if every box is ticked.

- [ ] **Correct:** supported by at least two independent sources; dated if it depends on time.
- [ ] **One answer:** short to name, not approximate, not contested; alternatives listed.
- [ ] **True premise:** the answer is the kind of thing the question asks for.
- [ ] **Not a giveaway:** the Cold reader can't derive it.
- [ ] **Workable:** a player who doesn't know it has a hint to use (Medium and Hard).
- [ ] **On target:** predicted correct rate is inside the difficulty band.
- [ ] **Interesting:** has a hook; the explanation adds a "huh!".
- [ ] **On strategy:** right pillar job, not US-centric, regionally fair, fresh if FreshPrints.
- [ ] **Clean:** 12–30 words, Canadian spelling, neutral, inclusive.
- [ ] **New:** not a near-duplicate of a live or retired question.

---

## 5. Suggested build order

Each step can stand alone and pays off on its own.

1. **Per-answer result storage** (migration). This unlocks A10 and lets us measure everything else. _Owner approval needed._
2. **A8 prompt update and C1 rules** for the answer rules and hook check. Small change, applies to the existing library through the content sweep (STE-238).
3. **A5 prompt update** with the craft rules, hint path and predicted difficulty.
4. **A7 Playability Panel.** Run it first over the current library in read-only mode to find questions likely to be passed, before using it as a gate.
5. **A10 Calibration Analyst**, once about 30 attempts per question exist for a useful share of the library.
6. **A1 Gap Planner upgrade** to plan by difficulty, audience and play data.
7. **A11 expiry job**, together with STE-271.

## 6. Open questions

1. Persona panel cost: one call per question with all personas, or one call per persona for more independence? Start with one call and compare results on a benchmark set.
2. How many attempts before recalibrating: 30 is a starting point. Small rooms may need a confidence interval rather than a fixed count.
3. Should A7 also run on host-chosen themed games (STE-167), where a quick start matters? The suggestion is yes, but with a cheaper panel of two personas.
