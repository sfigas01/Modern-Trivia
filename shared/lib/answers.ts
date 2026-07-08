import stringSimilarity from 'string-similarity';

/**
 * Damerau–Levenshtein distance (optimal string alignment variant).
 * Handles insertions, deletions, substitutions, and adjacent transpositions.
 * Inline to avoid adding an npm dependency.
 */
export const damerauLevenshtein = (a: string, b: string): number => {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  const d: number[][] = Array.from({ length: la + 1 }, () =>
    new Array<number>(lb + 1).fill(0)
  );

  for (let i = 0; i <= la; i++) d[i][0] = i;
  for (let j = 0; j <= lb; j++) d[0][j] = j;

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,       // deletion
        d[i][j - 1] + 1,       // insertion
        d[i - 1][j - 1] + cost // substitution
      );
      // transposition
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  return d[la][lb];
};

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

  // Numeric guardrail: if the correct answer is purely digits, require exact match only.
  // Years (1997), counts, etc. must not fuzzy-match neighbouring numbers.
  const isNumericAnswer = /^\d+$/.test(normCorrect);

  // Fuzzy match if not exact and not a numeric answer
  if (!isCorrect && normInput.length > 2 && !isNumericAnswer) {
    // --- Dice coefficient check (existing) ---
    const similarity = stringSimilarity.compareTwoStrings(normInput, normCorrect);
    // 0.8 is a good threshold for typos but enough to prevent wild guesses
    if (similarity > 0.8) isCorrect = true;

    // Check acceptable variants with Dice too
    if (!isCorrect) {
      for (const variant of acceptable) {
        if (stringSimilarity.compareTwoStrings(normInput, variant) > 0.8) {
          isCorrect = true;
          break;
        }
      }
    }

    // --- Damerau–Levenshtein edit-distance check (new) ---
    // Covers single-typo / transposition cases that Dice misses on short strings.
    // Length 3–4: skip (edit distance 1 on very short words is too permissive).
    // Length 5–8: accept distance ≤ 1.  Length ≥ 9: accept distance ≤ 2.
    if (!isCorrect) {
      const allTargets = [normCorrect, ...acceptable];
      const maxDist = (len: number): number | null => {
        if (len <= 4) return null; // skip — Dice handles 3–4
        if (len <= 8) return 1;
        return 2;
      };

      for (const target of allTargets) {
        const refLen = target.length;
        const threshold = maxDist(refLen);
        if (threshold === null) continue;
        if (damerauLevenshtein(normInput, target) <= threshold) {
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
