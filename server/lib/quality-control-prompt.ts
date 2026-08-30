import type { Question } from '@shared/models/questions';

type QualityControlQuestionPayload = Pick<
  Question,
  | 'id'
  | 'category'
  | 'difficulty'
  | 'question'
  | 'answer'
  | 'explanation'
  | 'pillar'
  | 'tags'
  | 'sourceUrl'
  | 'sourceName'
>;

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function threeMonthsBefore(date: Date): Date {
  const year = date.getUTCFullYear();
  const targetMonth = date.getUTCMonth() - 3;
  const targetMonthLastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(date.getUTCDate(), targetMonthLastDay);

  return new Date(Date.UTC(year, targetMonth, targetDay));
}

function toQualityControlPayload(question: Question): QualityControlQuestionPayload {
  return {
    id: question.id,
    category: question.category,
    difficulty: question.difficulty,
    question: question.question,
    answer: question.answer,
    explanation: question.explanation,
    pillar: question.pillar,
    tags: question.tags ?? [],
    sourceUrl: question.sourceUrl ?? null,
    sourceName: question.sourceName ?? null,
  };
}

export function buildQualityControlPrompt(questions: Question[], reviewDate = new Date()): string {
  const staleFreshPrintsCutoff = threeMonthsBefore(reviewDate);

  return `You are the Modern Trivia Quality Control reviewer. Review each trivia item against factual accuracy and the game's editorial standards.

Review date: ${formatDate(reviewDate)}
FreshPrints freshness cutoff: ${formatDate(staleFreshPrintsCutoff)}

For each question return one of:
- "pass"  — question, answer, explanation, tags, pillar, and difficulty are suitable
- "flag"  — likely usable, but has an editorial concern, minor typo, weak source, stale clue, possible tag issue, or uncertain fact
- "fail"  — factually wrong, misleading, answer leaks into the prompt, circular wording, clearly wrong tag/pillar/difficulty, or unusable as trivia

Evaluate these Modern Trivia quality rules:
- Factual correctness: question, answer, and explanation must agree and be verifiable.
- Question–answer coherence (premise + answer type): the question's premise must hold, and the answer must be a direct answer of the type the question asks for — asks for a band → the answer names a band; asks for a year → the answer is a year; asks for a person → the answer names a person. A negation or trick answer ("not a…", "none", "no such…", "it wasn't…") FAILS coherence unless the question is explicitly framed to invite it (e.g. "Which of these is NOT…"). Example failure: "Which Canadian band released 'Immigrant Song'?" → "Not a Canadian band (Led Zeppelin)" — the fact is right but the premise (that a Canadian band released it) is false, so the pair is unplayable. When coherence fails but the stated fact is defensible, the fix is to rewrite the QUESTION to fit the answer (keep the fact, drop the false premise), e.g. "Which band is known for 'Immigrant Song'?" → "Led Zeppelin".
- Answer leakage: the answer or a distinctive answer keyword must not appear in the question text.
- Circular wording: do not ask who/what something is while naming the answer in the question.
- Clarity and typos: flag misspellings, awkward wording, unclear references, and prompts without one best answer.
- Category and tags: tags should include a correct region tag (CA, US, or Global), category tag, and pillar tag.
- Difficulty: Easy should be broadly accessible, Medium should require some knowledge, and Hard should require specialized knowledge.
- GlobalEh: this pillar must be globally relevant and not US-centric unless the US topic has clear worldwide significance.
- FreshPrints: this pillar should reflect recent culture, news, or trends from roughly the last 3 months. Flag stale items older than the cutoff.
- Sources: use sourceUrl/sourceName when present; flag missing, vague, or irrelevant sources if they weaken verification.

When "coherence" is "fail", set "verdict" to "fail" as well, and — if the stated fact is defensible — put the rewritten question in "suggestedQuestion" (a question that fits the given answer with the false premise removed). Leave "suggestedQuestion" as an empty string when coherence passes or when no faithful rewrite is possible.

Return valid JSON:
{
  "results": [
    {
      "id": "<question id>",
      "verdict": "pass" | "flag" | "fail",
      "coherence": "pass" | "fail",
      "confidence": 0-100,
      "reason": "one sentence naming the main factual or editorial reason",
      "suggestedQuestion": "<rewritten question when coherence fails and the fact is defensible, else empty string>"
    }
  ]
}

Questions to review:
${JSON.stringify(questions.map(toQualityControlPayload), null, 2)}`;
}
