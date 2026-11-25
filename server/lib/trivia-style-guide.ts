/**
 * Modern Trivia style guide (STE-304).
 *
 * The written-down version of "what a good Modern Trivia question is", in two forms:
 *  - WRITER guidance, appended to Guardian's generation and repair prompts when enabled;
 *  - JUDGE calibration, appended to the eval judge's rubric.
 *
 * Version 2 comes from the owner's notes in the first eval round (run 2026-11-22). Each rule
 * names the round 1 pattern it answers. Round 2 tests it on fresh questions, so the rules are
 * judged on questions they were not written from.
 *
 * Human-readable rubric: docs/guides/trivia_quality_rubric.md. Keep the two in step.
 */

export const STYLE_GUIDE_VERSION = 'style-guide-v2' as const;

export const WRITER_STYLE_GUIDE_V2 = `Modern Trivia style guide (follow every point):
- Short answers. The answer is 1-5 words a player can type or say: a name, place, number, title or term. Never a sentence or an explanation. Do not ask "What is X?" or "How does X work?" when the answer would be a definition.
- One defensible answer. Before writing, think of every other answer a knowledgeable player could give: another person, a second place with the same name, another show from the same era. Add a qualifier that rules them out, or list them in acceptableAnswers if they are equally right.
- Party trivia, not a study aid. Avoid textbook definitions, academic jargon, university-level detail and named theories. Prefer facts people remember, recognize, feel nostalgic about, or would enjoy learning.
- Give hard questions a path. A Medium or Hard question includes a clue a player can reason from: a year, a place, a nickname, a related fact. Make questions harder by weakening the clue, never by choosing an obscure fact.
- Calibrate difficulty for a mixed room of Canadian adults aged 18-50. Easy: most of the room gets it. Medium: about half. Hard: a few, but it is fair. When unsure, label it one level harder.
- Respect the chosen theme. If the theme is niche, questions may reward its fans, but keep at least one clue a non-fan could use. Stay on the theme itself, not a loosely related subject.
- Recent events and pop culture: only use events, names and dates you are certain of. Keep within the theme's time window (for "the past year", nothing older). If you are not sure a moment really happened, choose a different fact. Never invent a viral moment, quote or record.
- Never refer to a source, article, study or document in the question.
- Every question in the set tests a different fact and has a different answer.
- Canadian-friendly framing, not US-default. Use correct grammar: "Who" for people, "Which" for things.`;

/** Appended to the eval judge's rubric for judge v2. Calibrated on the owner's round 1 ratings. */
export const JUDGE_CALIBRATION_V2 = `Calibration from the game owner's own ratings (apply these over your own instincts):
- Plain but fair questions are "keep". If it is correct, has one answer, is on theme and most players could guess or reason toward it, keep it even if it is not exciting. The owner keeps easy general-knowledge questions that a room can guess.
- A wrong difficulty label alone is not a reason to "fix". Record the real difficulty in the difficulty field and judge the verdict on everything else.
- Rate fit and fun relative to the theme the players chose. For a niche theme, a question fans of that theme would enjoy is a good question even if it is hard for everyone else.
- Answers that are a sentence or an explanation are "drop": nobody can answer them in a game.
- If there is another plausible answer (another person, another place with the same name, another show), set one_answer to "n" and use "fix" when the underlying fact is good.
- "Too academic" lowers both fun and fit: textbook definitions, study-aid detail, university-level content, named theories. These are 1-2 for fun.
- Clues that let a player reason toward the answer raise fun. Nostalgia for this audience raises fun.
- A question that refers to "the article" or a source the players have not seen is "drop".
- Recent-event questions must match the theme's time window; an invented or misattributed viral moment is incorrect.`;

/**
 * The owner's audience decision (2026-11-22, CONTENT_STRATEGY.md v2.1 section 1): Canadian
 * groups with about 20% Canadian content, and the US content test.
 */
export const AUDIENCE_RULE_V3 = `Audience and fit rule (this replaces the "fits" definition above):
- Players are Canadian adults aged 18-50 in mixed groups. They know global and American pop culture well.
- fits = "y" when this audience would know or enjoy it. US film, TV, music, celebrities, sports stars, brands, internet culture and US events that mattered worldwide all fit.
- fits = "n" for US school or civic knowledge that you would only know from growing up in the US: US history beyond world-famous moments, US geography (states, capitals, rivers), US politics and government.
- A question does not need a Canadian angle to fit. Canadian content is welcome but never required. Forcing Canada into a question that does not need it lowers fun.
- For a player-chosen theme, fit also means it is on that theme.`;

/** Judge v3 = the round 1 calibration plus the audience rule. */
export const JUDGE_CALIBRATION_V3 = `${JUDGE_CALIBRATION_V2}

${AUDIENCE_RULE_V3}`;
