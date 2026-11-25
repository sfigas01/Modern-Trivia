# Modern Trivia: Content Strategy

> **Status:** Draft v2.1 (2026-11-22): draft v2 (2026-11-15) plus the owner's audience amendment (STE-304). Proposed to replace v1. It is not yet approved as a whole; the audience amendment in sections 1 and 4 is the owner's decision.
> **Owner:** Product owner. Changes need owner approval because they steer generation, the quality checks and question selection.
> **Read with:** `docs/guides/trivia_quality_rubric.md` (how questions are rated) and `docs/guides/question_eval.md` (how generation is evaluated against this strategy).
> **Code that reads this file:** `server/lib/guardian.ts` (`STRATEGY_PILLAR_TARGETS`) and `server/lib/coverage-benchmark.ts`. If you change a pillar name or a target share, change the code in the same PR.

---

## 1. What we are trying to make

**Promise:** the best trivia night a mixed group of friends can have, without leaving the couch.

**Brand:** "Freshly Squeezed & Globally Smart." Global pop culture and general knowledge, with a Canadian flavour.

**Audience:** Canadian adults aged 18 to 50, usually in a mixed group: friends, family or co-workers of different ages, playing as 2 to 6 teams in one room. They live in a world shaped by global and American pop culture, so that is most of what they know and enjoy.

### Canadian content is a flavour, not the default

About **20% of the default mix** is Canadian: Canadian people, places, food, shows, music and moments. The rest is global. Canadian content is never forced into a question that doesn't need it. Player-chosen themes (such as Harry Potter) follow the theme, not this share.

### The US content test

Ask: **would someone who grew up in Canada, or anywhere else, know this?**

| Include (known worldwide)                                              | Leave out (you'd need to have grown up in the US)                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| US film, TV, music, celebrities and sports stars                       | US history beyond world-famous moments (Civil War battles, most presidents, founding details) |
| US brands, products and internet culture                               | US geography (states, state capitals, rivers, counties)                                       |
| US events that mattered worldwide (the Moon landing, 9/11)             | US politics, government and civics (the Electoral College, amendments, Congress procedure)    |
| US places famous worldwide (Hollywood, the Grand Canyon, Times Square) | Anything taught mainly in US schools                                                          |

A US topic is fine when people outside the US would know it. The test is what the audience knows, not where the topic comes from.

### How we know we are failing

| Symptom                                           | What it means                                           |
| ------------------------------------------------- | ------------------------------------------------------- |
| Players pass often, or guess at random            | The question is unknowable for this room. It is broken. |
| Everyone gets it, every time                      | No tension and nothing learned. It is filler.           |
| "That's not fair" or "that's wrong" at the reveal | The answer, premise or wording can be disputed.         |
| A shrug at the reveal                             | The fact was correct but dull.                          |
| One age group carries every round                 | The mix left the rest of the room out.                  |

### What success looks like

A good question makes the room **lean in**. Someone thinks they know it, a teammate argues, they work it out from the clue, and the reveal gets a "huh!" or an "I knew it!". People should enjoy the reveal even when they got it wrong.

---

## 2. Design principles

These rank in this order. When two conflict, the higher one wins.

1. **Correct beats everything.** One answer that can be defended, backed by a quotable source (section 7). We never ship a question we can't defend at the reveal.
2. **Knowable, not obscure.** Difficulty comes from facts people half-know, not from facts nobody knows. A question nobody gets isn't hard, it's broken.
3. **Workable.** At Medium and Hard, the question carries at least one hint that lets a player who doesn't know the fact reason toward the answer. Players should feel they could have got it.
4. **Not giveaway.** The hint helps someone reason, but it must not hand over the answer. A player who knows nothing about the topic should not be able to work it out from the words alone. (This is the existing Guardian obviousness check.)
5. **Interesting.** Every question has a hook: a surprise, a story, a link between two things, or a bit of national pride. The explanation shown at the reveal is part of the question, not an afterthought.
6. **Everyone gets their moment.** Each round gives every age group and every kind of player something they own.
7. **Measured, not assumed.** A difficulty label is a guess until players have answered the question. Real play results override what writers and AI checkers expect.

---

## 3. Difficulty is a target correct rate

Difficulty is defined by **how many people in our audience get the question right**, not by how obscure the fact feels to the writer.

| Label  | Target correct rate | Points | Intent                                         |
| ------ | ------------------- | ------ | ---------------------------------------------- |
| Easy   | 75–95%              | 1      | Confidence builder. Most of the room knows it. |
| Medium | 45–75%              | 2      | The core of the game. Debate, then recall.     |
| Hard   | 20–45%              | 3      | Reachable with real knowledge or a good clue.  |

**Whole-game target:** 60–70% correct overall, and **under 15% passed** for any one question.

**Outside every band (needs action):**

- **Under 15% correct** or **over 30% passed:** broken. Pull it from play and rewrite it or retire it.
- **Over 95% correct:** too easy, even for Easy. Make it harder, or keep it only as a warm-up.

The bands are a starting hypothesis, borrowed from what established trivia makers report (Water Cooler Trivia aims for about 70% correct). Retune them once we have real data (section 8).

### Calibration rule

Before launch, the writer and the playability check **predict** a question's correct rate. After about **30 attempts in real games**, the measured correct rate replaces the prediction and the label is reset to match. An AI's guess at difficulty never overrides real play results.

---

## 4. The four content pillars

Each pillar has a **job** in the game, not only an audience. The shares stay at 30/30/25/15 because the generation planner targets them. Within every pillar, about one question in five is Canadian (section 1).

### 🎬 TimeCapsule (30%): shared memories

**Job:** nostalgia from the 80s, 90s and 2000s that **crosses generations**. Things that are still referenced, rerun, sampled or memed.

- ✅ Friends, the Spice Girls, Pokémon, Saturday-morning cartoons, early internet, Y2K, songs that are still played today. Canadian picks such as Degrassi, MuchMusic and Heritage Minutes are part of the mix, not the default.
- ❌ Plot details only a fan of the show at the time would know.
- **Bridge rule:** if someone under 30 would not have lived through it, the question needs a hint they can still use. Examples: it is still quoted, it was remade, or the clue points to something they do know.

### 🌍 GlobalEh (30%): the smart pillar

**Job:** general knowledge from a world view. Geography, science, history, literature, art and international sport.

- **What it is:** world capitals and landmarks, science and nature, history and culture outside the US, Nobel Prizes, the World Cup and the Olympics, and Canada's place in the world.
- **What it avoids:** anything that fails the US content test (section 1): US history, geography and politics that you'd only know from growing up in the US. For example, no Iowa geography and no US Civil War battles. A US topic qualifies when people outside the US know it, such as the Moon landing.
- **Watch for:** textbook facts that are easy to look up but dull to answer, such as bare capital-city recall. Give them a hook or a clue, or leave them out.

### ⚡ FreshPrints (25%): recent culture

**Job:** music, film, TV, internet culture, sport and news from the **last 12–24 months**. It keeps the game feeling current.

- Every FreshPrints question carries an **expiry date** (`asOf` plus a time limit) and drops out of play automatically when it expires. This builds on the source pipeline's `validUntil` and on STE-271.
- There is a small, frequently refreshed **"This Month"** subset for news-of-the-week rounds. It is optional and not required to fill the 25%.
- Ask about things that crossed into the mainstream. A chart-topper is fair. A niche TikTok sound is not.
- No scandal, gossip or questions that mock private people.

### 🏕️ GreatOutdoors (15%): food, travel and lifestyle

**Job:** food, travel, the outdoors and everyday life. Canada first, but not Canada only.

- ✅ Dishes and drinks from around the world, famous road trips and landmarks, the outdoors. Canadian picks: Nanaimo bars, a "double-double", the Cabot Trail, provincial and territorial quirks.
- **Regional balance:** Canadian questions cover every region (BC, the Prairies, Ontario, Quebec, Atlantic Canada and the North), so they are not Toronto-centric.
- Clue in regional facts so players from elsewhere can still work them out.
- Slang works only when it is widely known. Hyper-local slang is too narrow (eval round 2).

### Themes on demand

When a host picks a theme (STE-167), the theme questions sit outside the pillar mix and the Canadian share but follow every other rule here, including difficulty bands, workable hints and sourcing.

The eval rounds showed that the theme itself is a big driver of question quality:

- **Narrow themes** (a single local scene, hyper-local slang) run out of well-known facts fast. That leads to hard, unverifiable and repeated questions.
- **Academic themes** (science topics such as volcanoes) drift into textbook definitions. Steer them toward famous events, places and people.

How generation should handle these (widen the theme, or use more related-category questions) is being tested in eval round 3.

---

## 5. What makes a good question (writing rules)

Each question must pass every rule. They feed the agent pipeline's checks.

### Answer rules (free-text play)

Players type their answers and fuzzy matching marks them, so the answer must suit typing.

1. **One answer that is short to name:** a person, place, thing, title, word or a year/number with no rounding.
2. **No approximations:** no "roughly how fast" or "about how many".
3. **No contested facts:** no disputed "firsts", no "largest" when the measure is unclear, and no counts that change over time unless the question states the date.
4. **List accepted alternatives** (`acceptableAnswers`) whenever a fair player could type something else: surnames, common short forms and translations.
5. **No trick or "not a…" answers** unless the question openly sets up a trick.

### Question rules

1. **Clear premise:** the question's premise must be true, and the answer must be the kind of thing the question asks for. (This is the existing Guardian coherence check.)
2. **Hint path at Medium and Hard:** include at least one hint a reasonable player can use. Examples: an era, a place, a link, or a pun or play on a name.
3. **Not giveaway:** someone who knows nothing about the topic must not be able to work the answer out from the words alone.
4. **Hook:** say why the fact is interesting, in the question or in the explanation.
5. **Length:** usually 12–30 words. Short enough to read aloud in one breath, long enough to carry a hint.
6. **Neutral wording:** no "best" or "greatest" opinions. Write gender-neutral and inclusive, and don't punch down.
7. **Canadian spelling and units first:** colour, centre, metric. Give imperial units in brackets if helpful.

### Explanation (the reveal)

1–3 sentences. Confirm the answer, then give the **"huh!"**: one extra fact that makes even a wrong answer worth hearing. It must not introduce a new claim the sources don't support.

### Before and after (illustrative only, do not add to the library)

| Before (bare recall)                 | After (workable, with a hook)                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "What ship is on the Canadian dime?" | "Canada's dime shows a Nova Scotia fishing schooner that went undefeated in the International Fishermen's Trophy races. Its name nods to an old nickname for Nova Scotians. Name it." |

The "after" version gives three ways in: the coin itself, the Nova Scotia link, and the nickname. A player who doesn't know the fact can still get there by reasoning, and a player who does know it is rewarded.

---

## 6. How a game is built (selection rules)

How we pick and order questions matters as much as the questions themselves.

1. **Each 4-question turn per team has a fixed shape:** 1 Easy, 2 Medium, 1 Hard. Every team gets the same shape, so luck doesn't decide the winner.
2. **Mix the pillars within a round** so each age group and interest gets at least one question it owns.
3. **Order within a round:** an Easy opener and a Hard closer where possible.
4. **Repeat protection** (STE-138) stays. Never show a player a question they have already seen, unless the pool is exhausted.
5. **Don't use questions that are expired, outside the bands, or under review.**

> **Not built yet.** Today `/api/questions` shuffles at random with no difficulty or pillar shaping. This section is the target behaviour and needs owner approval before it is built.

### Game-design dependency: passing

Right now a wrong answer loses points (−1 to −3) and a pass costs nothing. That teaches teams to pass instead of having a go, and it works against principle 3. Options to consider: a smaller penalty for a wrong answer, a "bold" opt-in for the full risk, or letting the other team steal a passed question. **This is the owner's decision. It is listed here because content quality alone won't solve passing.**

---

## 7. Sources and accuracy

1. **Stable facts:** one approved Wikipedia article is enough proof, per the owner's decision in STE-303. The proof must be a passage quoted word for word, which the eval's evidence check confirms (`docs/guides/question_eval.md`, round 2: it passed 0 of 7 wrong answers). A question with no quotable support is held for review, never passed.
2. **Time-sensitive, disputed or "current" claims** (records, officeholders, "largest", recent events) need a first-party or specialist source as well. If none is available, leave the question out.
3. A fact that depends on time stores its `asOf` date and an expiry.
4. Any conflict between sources holds the question back. Rewrite it with the date stated, or leave it out.
5. `sourceUrl` and `sourceName` are shown at the reveal, so they must be a page a player can check.

---

## 8. Measuring and maintaining the library

### Data we need (not yet collected)

For every answer: question ID, result (correct, wrong or passed), difficulty when shown, game size, and time to answer. Nothing personal is needed.

> **Prerequisite.** Today the room state holds these results only for the length of a game, so nothing is stored per question. Storing them needs a schema migration and owner approval.

### Health metrics

| Metric                                     | Target                        | Review                |
| ------------------------------------------ | ----------------------------- | --------------------- |
| Overall correct rate                       | 60–70%                        | Monthly               |
| Pass rate (overall / per question)         | < 10% / < 15%                 | Monthly               |
| Questions inside their band                | ≥ 80%                         | Monthly               |
| Disputes per 100 questions played          | < 1                           | Monthly               |
| Pillar share vs. target                    | Within ±10%                   | Each generation batch |
| Expired FreshPrints in play                | 0                             | Automatic, daily      |
| Approved questions per pillar × difficulty | ≥ 3 games of repeat-free play | Quarterly             |

### Lifecycle

```
draft → pending → approved → (in play: being calibrated) → calibrated
                                     ↓ outside its band, disputed or expired
                                needs rewrite → re-reviewed → approved
                                     ↓ can't be fixed
                                  retired (never deleted)
```

Retired questions keep their history so the same fact isn't regenerated.

### Spoiler-free rule

The owner plays the game too. Reports, dashboards and admin screens never show answers unless someone deliberately reveals them (STE-248). Pipeline agents must follow the same rule in anything a human reads.

---

## 9. What changed from v1

| Area           | v1                         | v2                                                             |
| -------------- | -------------------------- | -------------------------------------------------------------- |
| Difficulty     | Label set by the writer    | Target correct rate, recalibrated from play                    |
| Question craft | Topics only                | Answer rules, hint path, hook, length                          |
| Pillars        | Defined by age group       | Defined by their job in the game; TimeCapsule must bridge ages |
| FreshPrints    | "Last 3 months"            | 12–24 months with an expiry, plus an optional "This Month" set |
| GlobalEh       | Defined by what it avoids  | Defined by what it is                                          |
| Selection      | (Not covered)              | Set turn shape, pillar mix per round                           |
| Measurement    | (Not covered)              | Results per answer, health metrics, lifecycle                  |
| Library size   | "50-question starter bank" | Removed. Sized by repeat-free play per pillar and difficulty   |

**v2.1 amendment (owner decision, 2026-11-22, STE-304):**

| Area           | v2                                                           | v2.1                                                                                               |
| -------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Audience       | "A mixed group of Canadians", Canadiana-led                  | Canadian groups; global and American pop culture is most of the mix                                |
| Canadian share | About 45% (GreatOutdoors plus Canadian picks across pillars) | About 20% of the default mix                                                                       |
| US content     | Only when it matters worldwide                               | The US content test: in if people outside the US know it; out if it's US school or civic knowledge |
| GreatOutdoors  | The Canadian way of life                                     | Food, travel and lifestyle: Canada first, not Canada only                                          |
| Sources        | Two independent sources; Wikipedia counts as one at most     | One approved Wikipedia article with a quoted passage for stable facts (STE-303)                    |
| Themes         | Outside the pillar mix                                       | Also outside the Canadian share; narrow and academic themes flagged                                |

## 10. Open decisions for the owner

1. Approve or retune the difficulty bands in section 3.
2. Approve storing per-answer results (needs a migration).
3. Approve the turn shape (1 Easy, 2 Medium, 1 Hard) for question selection.
4. Decide how passing should work (section 6).
5. Confirm the FreshPrints window (12–24 months).
6. Approve draft v2.1 as a whole. The audience amendment is decided; the rest of v2 is still a proposal.
7. After eval round 3: decide how generation handles narrow and academic player themes.
