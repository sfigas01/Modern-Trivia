# What makes a good Modern Trivia question

This rubric is the shared definition of a good question used by the offline question eval (STE-304, [question_eval.md](question_eval.md)). The owner rates questions with it, and the LLM judge's prompt (`JUDGE_RUBRIC` in `server/lib/question-eval.ts`) is a condensed version of it. **If you change one, change the other.**

It starts from [CONTENT_STRATEGY.md](../../CONTENT_STRATEGY.md) but is meant to be revised by evidence: when owner ratings and this rubric disagree, the ratings win and the rubric is updated.

## Two kinds of criteria

Correctness and entertainment are kept separate on purpose. A question can be perfectly correct and still not worth playing, and verifying facts tells you nothing about fun.

| Kind                  | Criteria                       | How it is used                                       |
| --------------------- | ------------------------------ | ---------------------------------------------------- |
| **Gates** (pass/fail) | Correct, one defensible answer | Any failure means the question cannot be kept as is. |
| **Scores**            | Fun (1–5), difficulty, fit     | Used to rank and compare. No single threshold.       |

## Gates

**correct** — `y` the answer is right as stated · `n` it is wrong or rests on a false premise · `u` you can't tell.
Use `u` honestly rather than guessing. A high `u` rate is itself a finding: it means the reviewer cannot check the question without a source.

**one_answer** — `y` there is one defensible answer, and the accepted alternatives cover reasonable variants · `n` several answers are equally right, the wording is vague, or it depends on opinion.

## Fun (1–5)

How good is it as **party** trivia, read aloud to a mixed group of Canadian adults?

| Score | Meaning                                                                                     |
| ----- | ------------------------------------------------------------------------------------------- |
| 1     | A dry textbook restatement, an arbitrary number or date, or list recall. Nobody would care. |
| 2     | Correct but flat. Feels like an exam.                                                       |
| 3     | Fine and fair, but forgettable.                                                             |
| 4     | A good party question: people can reason toward it, and the reveal is satisfying.           |
| 5     | People would talk about it after the game: surprising, nostalgic, or sparks debate.         |

**What raises fun**

1. **Gettable.** The room can reason toward the answer, and partial knowledge helps. Recalling an arbitrary date or number is the opposite.
2. **Reveal payoff.** The answer lands with "of course!" or "no way!".
3. **Recognition.** This audience knows the subject, or would enjoy learning about it.
4. **Talkability.** It sparks nostalgia, a story, or friendly debate.
5. **Reads well aloud.** Short and plain, with no trick wording.

**What lowers fun**

- Trick wording, or obscurity for its own sake.
- A giveaway: the answer is obvious from the question.
- A Wikipedia first sentence turned into a question ("X is a Y located in Z. What is X?").

Fun depends on the audience. A Time Capsule question can be a 5 for people in their 40s and a 2 for people in their 20s. Rate it for the audience the theme is aimed at.

## Difficulty

`E` / `M` / `H`: how hard it **really** is for a typical adult in this audience, not the label it was given.

- **Easy:** most players get it.
- **Medium:** about half do.
- **Hard:** few do, but it is still fair. Hard should come from weaker clues, not from obscure facts.

The eval compares this with the stated label. Later, real per-question correct rates from games would replace this guess; gameplay does not record them yet.

## Fit

`y` / `n`: does it fit Modern Trivia? That means Canadian-friendly or globally relevant, not US-default, suitable for a mixed adult group, and on the stated theme.

For a player-chosen theme, the pillar split doesn't apply. Fit means the framing works for this audience.

## Verdict

- **keep:** use as is.
- **fix:** a good fact, but the wording, the accepted answers or the difficulty label needs work.
- **drop:** wrong, ambiguous, dull or off-brand.

An `n` on either gate means the verdict cannot be `keep`.

**why:** one short line. These lines are the most useful input for improving prompts, so a few words are better than none.

## Known tensions in the content strategy

These came up while writing the rubric. They are worth resolving with evidence rather than by assertion:

- **Fresh Prints vs. verifiable sourcing.** The pillar targets the last three months, while the themed pipeline only accepts stable, Wikipedia-backed facts. The eval includes a Fresh Prints theme to see how each generator copes.
- **Pillar percentages vs. themes.** The 30/30/25/15 split describes the default mix. It says little about a single user-chosen theme.
- **One age band, two audiences.** 18–50 covers very different nostalgia. Fun is rated for the theme's intended audience.
