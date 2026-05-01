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
- Answer leakage: the answer or a distinctive answer keyword must not appear in the question text.
- Circular wording: do not ask who/what something is while naming the answer in the question.
- Clarity and typos: flag misspellings, awkward wording, unclear references, and prompts without one best answer.
- Category and tags: tags should include a correct region tag (CA, US, or Global), category tag, and pillar tag.
- Difficulty: Easy should be broadly accessible, Medium should require some knowledge, and Hard should require specialized knowledge.
- GlobalEh: this pillar must be globally relevant and not US-centric unless the US topic has clear worldwide significance.
- FreshPrints: this pillar should reflect recent culture, news, or trends from roughly the last 3 months. Flag stale items older than the cutoff.
- Sources: use sourceUrl/sourceName when present; flag missing, vague, or irrelevant sources if they weaken verification.

Return valid JSON:
{
  "results": [
    {
      "id": "<question id>",
      "verdict": "pass" | "flag" | "fail",
      "confidence": 0-100,
      "reason": "one sentence naming the main factual or editorial reason"
    }
  ]
}

Questions to review:
${JSON.stringify(questions.map(toQualityControlPayload), null, 2)}`;
}
