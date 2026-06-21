import stringSimilarity from 'string-similarity';

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export interface Question {
  id: string;
  category: string;
  difficulty: Difficulty;
  question: string;
  answer: string;
  acceptableAnswers?: string[];
  explanation: string;
  pillar: string;
  tags: string[];
  sourceUrl?: string;
  sourceName?: string;
}

export const QUESTIONS_PER_TEAM_ROTATION = 4;

export const normalize = (str: string): string => {
  return str
    .toLowerCase()
    .trim()
    .replace(/[.,!?'"]/g, '') // Remove punctuation
    .replace(/\b(a|an|the)\b/g, '') // Remove articles (simple regex)
    .replace(/\b(zero|0)\b/g, '0')
    .replace(/\b(one|1)\b/g, '1')
    .replace(/\b(two|2)\b/g, '2')
    .replace(/\b(three|3)\b/g, '3')
    .replace(/\b(four|4)\b/g, '4')
    .replace(/\b(five|5)\b/g, '5')
    .replace(/\b(six|6)\b/g, '6')
    .replace(/\b(seven|7)\b/g, '7')
    .replace(/\b(eight|8)\b/g, '8')
    .replace(/\b(nine|9)\b/g, '9')
    .replace(/\s+/g, ' ') // Collapse whitespace
    .trim(); // Final trim after article removal may leave leading/trailing space
};

export const verifyAttempt = (
  input: string,
  q: Question
): { verdict: 'CORRECT' | 'INCORRECT'; points: number } => {
  const normInput = normalize(input);
  const normCorrect = normalize(q.answer);
  const acceptable = (q.acceptableAnswers || []).map(normalize);

  // Exact match first
  let isCorrect = normInput === normCorrect || acceptable.includes(normInput);

  // Fuzzy match if not exact
  if (!isCorrect && normInput.length > 2) {
    const similarity = stringSimilarity.compareTwoStrings(normInput, normCorrect);
    // 0.8 is a good threshold for typos but enough to prevent wild guesses
    if (similarity > 0.8) isCorrect = true;

    // Check acceptable variants with fuzzy logic too
    if (!isCorrect) {
      for (const variant of acceptable) {
        if (stringSimilarity.compareTwoStrings(normInput, variant) > 0.8) {
          isCorrect = true;
          break;
        }
      }
    }
  }

  if (isCorrect) {
    const p = q.difficulty === 'Easy' ? 1 : q.difficulty === 'Medium' ? 2 : 3;
    return { verdict: 'CORRECT', points: p };
  } else {
    const p = q.difficulty === 'Easy' ? -1 : q.difficulty === 'Medium' ? -2 : -3;
    return { verdict: 'INCORRECT', points: p };
  }
};

export const pointsFor = (difficulty: Difficulty): number =>
  difficulty === 'Easy' ? 1 : difficulty === 'Medium' ? 2 : 3;
