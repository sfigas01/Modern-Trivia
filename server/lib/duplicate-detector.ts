import stringSimilarity from 'string-similarity';
import OpenAI from 'openai';

import { batchProcess } from '../replit_integrations/batch';
import type { Question } from '@shared/models/questions';

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export interface DuplicateMatch {
  questionIdA: string;
  questionIdB: string;
  matchType: 'exact' | 'near_duplicate' | 'conceptual';
  similarityScore: number; // 0–1
  questionTextA: string;
  questionTextB: string;
  answerA: string;
  answerB: string;
  aiReasoning?: string; // only for conceptual duplicates
}

export interface DuplicateDetectionReport {
  totalPairsChecked: number;
  duplicatesFound: DuplicateMatch[];
  duplicatesByType: Record<DuplicateMatch['matchType'], number>;
}

export interface DetectDuplicatesOptions {
  /**
   * If provided, only evaluate pairs where at least one question's id is in this set.
   * Pairs where neither id is in scope are skipped entirely — no Sørensen-Dice,
   * no answer comparison, no GPT-4o conceptual check. Useful for "batch vs. corpus"
   * checks where existing-vs-existing pair work is wasted.
   */
  scopeIds?: Set<string>;
}

const NEAR_DUPLICATE_THRESHOLD = 0.8;
const ANSWER_SIMILARITY_THRESHOLD = 0.7;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

interface ConceptualPair {
  a: Question;
  b: Question;
  answerSimilarity: number;
}

interface RawConceptualResult {
  isDuplicate?: boolean;
  reasoning?: string;
}

async function checkConceptualDuplicate(pair: ConceptualPair): Promise<DuplicateMatch | null> {
  const prompt = `Are these two trivia questions asking the same thing, despite different wording?

Question A: "${pair.a.question}"
Answer A: "${pair.a.answer}"

Question B: "${pair.b.question}"
Answer B: "${pair.b.answer}"

Respond with JSON:
{
  "isDuplicate": true | false,
  "reasoning": "short explanation"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a trivia content reviewer. Always respond with valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 256,
    });

    const content = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content) as RawConceptualResult;

    if (!parsed.isDuplicate) return null;

    return {
      questionIdA: pair.a.id,
      questionIdB: pair.b.id,
      matchType: 'conceptual',
      similarityScore: pair.answerSimilarity,
      questionTextA: pair.a.question,
      questionTextB: pair.b.question,
      answerA: pair.a.answer,
      answerB: pair.b.answer,
      aiReasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
    };
  } catch {
    return null;
  }
}

export async function detectDuplicates(
  questions: Question[],
  options: DetectDuplicatesOptions = {}
): Promise<DuplicateDetectionReport> {
  const { scopeIds } = options;
  const duplicatesFound: DuplicateMatch[] = [];
  const seenPairs = new Set<string>();
  const conceptualCandidates: ConceptualPair[] = [];

  let totalPairsChecked = 0;

  for (let i = 0; i < questions.length; i++) {
    for (let j = i + 1; j < questions.length; j++) {
      const a = questions[i];
      const b = questions[j];

      if (scopeIds && !scopeIds.has(a.id) && !scopeIds.has(b.id)) {
        continue;
      }

      totalPairsChecked++;

      const pairKey = `${a.id}::${b.id}`;

      const normA = normalize(a.question);
      const normB = normalize(b.question);

      // Phase 1: Exact duplicate
      if (normA === normB) {
        seenPairs.add(pairKey);
        duplicatesFound.push({
          questionIdA: a.id,
          questionIdB: b.id,
          matchType: 'exact',
          similarityScore: 1,
          questionTextA: a.question,
          questionTextB: b.question,
          answerA: a.answer,
          answerB: b.answer,
        });
        continue;
      }

      // Phase 2: Near-duplicate on question text
      const questionSimilarity = stringSimilarity.compareTwoStrings(normA, normB);
      if (questionSimilarity >= NEAR_DUPLICATE_THRESHOLD) {
        seenPairs.add(pairKey);
        duplicatesFound.push({
          questionIdA: a.id,
          questionIdB: b.id,
          matchType: 'near_duplicate',
          similarityScore: questionSimilarity,
          questionTextA: a.question,
          questionTextB: b.question,
          answerA: a.answer,
          answerB: b.answer,
        });
        continue;
      }

      // Phase 3: Collect candidates for conceptual duplicate check
      // Only check pairs where answers are similar — avoids sending all pairs to GPT-4o
      if (!seenPairs.has(pairKey)) {
        const answerSimilarity = stringSimilarity.compareTwoStrings(
          normalize(a.answer),
          normalize(b.answer)
        );
        if (answerSimilarity >= ANSWER_SIMILARITY_THRESHOLD) {
          conceptualCandidates.push({ a, b, answerSimilarity });
        }
      }
    }
  }

  // Phase 3: Batch GPT-4o conceptual duplicate check
  if (conceptualCandidates.length > 0) {
    const conceptualResults = await batchProcess(
      conceptualCandidates,
      (pair) => checkConceptualDuplicate(pair),
      { concurrency: 3 }
    );

    for (const result of conceptualResults) {
      if (result !== null) {
        duplicatesFound.push(result);
      }
    }
  }

  const duplicatesByType: Record<DuplicateMatch['matchType'], number> = {
    exact: 0,
    near_duplicate: 0,
    conceptual: 0,
  };
  for (const match of duplicatesFound) {
    duplicatesByType[match.matchType]++;
  }

  return {
    totalPairsChecked,
    duplicatesFound,
    duplicatesByType,
  };
}
