import { createHash } from 'node:crypto';
import stringSimilarity from 'string-similarity';

import type { Question } from '@shared/models/questions';
import {
  duplicatePairKey,
  emptyDuplicateCounts,
  type DuplicateDetectionReport,
  type DuplicateMatch,
} from '@shared/models/quality-sweep';

export const THEME_QA_SEMANTIC_THRESHOLD = 0.55;
export const THEME_QA_MAX_SEMANTIC_PAIRS = 4;

export type ThemeQaSemanticVerdict = Readonly<{
  assessment: string;
  verdict: 'equivalent' | 'conflict' | 'distinct' | 'uncertain';
}>;

export type ThemeQaDuplicateDetectorOptions = Readonly<{
  /** Returns one vector for each question, in the same order as the input. */
  embed: (questions: readonly Question[]) => Promise<readonly (readonly number[])[]>;
  /** The caller persists the immutable batch before dispatching its budgeted calls. */
  adjudicateBatch: (
    candidateId: string,
    candidateContentHash: string,
    pairs: readonly Readonly<{
      pairKey: string;
      input: Readonly<{
        a: Readonly<{ question: string; answer: string }>;
        b: Readonly<{ question: string; answer: string }>;
      }>;
    }>[]
  ) => Promise<readonly ThemeQaSemanticVerdict[]>;
  /** IDs on the left side of candidate-vs-corpus comparison. */
  scopeIds?: ReadonlySet<string>;
  candidateId: string;
  candidateContentHash: string;
}>;

type PairCandidate = Readonly<{
  a: Question;
  b: Question;
  score: number;
  matchType: DuplicateMatch['matchType'];
  pairKey: string;
}>;

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function validVectors(vectors: readonly (readonly number[])[], expectedCount: number): boolean {
  if (vectors.length !== expectedCount || expectedCount === 0) return false;
  const dimensions = vectors[0]?.length ?? 0;
  return (
    dimensions > 0 &&
    vectors.every(
      (vector) =>
        vector.length === dimensions &&
        vector.every((value) => Number.isFinite(value)) &&
        vector.some((value) => value !== 0)
    )
  );
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] ** 2;
    normB += b[index] ** 2;
  }
  return Math.max(0, Math.min(1, dot / Math.sqrt(normA * normB)));
}

function contentFindingKey(a: Question, b: Question, type: DuplicateMatch['matchType']): string {
  const ordered = [a, b].sort((left, right) => left.id.localeCompare(right.id));
  const hash = createHash('sha256')
    .update(JSON.stringify(ordered.map(({ id, question, answer }) => [id, question, answer])))
    .digest('hex');
  return `${duplicatePairKey(a.id, b.id)}::${type}::${hash}`;
}

function finding(
  pair: PairCandidate,
  type: DuplicateMatch['matchType'],
  reasoning?: string
): DuplicateMatch {
  return {
    questionIdA: pair.a.id,
    questionIdB: pair.b.id,
    matchType: type,
    similarityScore: pair.score,
    questionTextA: pair.a.question,
    questionTextB: pair.b.question,
    answerA: pair.a.answer,
    answerB: pair.b.answer,
    aiReasoning: reasoning,
    findingKey: contentFindingKey(pair.a, pair.b, type),
  };
}

function reportFailure(report: DuplicateDetectionReport, failedPairs: number): void {
  report.status = 'incomplete';
  report.failedPairs = (report.failedPairs ?? 0) + failedPairs;
  report.failureReason = 'Semantic checking was incomplete. Retry before accepting this result.';
}

/**
 * Deterministic screening for themed QA. All provider work is injected so this
 * module cannot create a client or bypass the runtime's budget/persistence seam.
 */
export async function detectThemeQaDuplicates(
  questions: readonly Question[],
  options: ThemeQaDuplicateDetectorOptions
): Promise<DuplicateDetectionReport> {
  const n = questions.length;
  if (new Set(questions.map(({ id }) => id)).size !== n)
    throw new Error('Question IDs must be unique');

  const selected = options.scopeIds
    ? questions.filter(({ id }) => options.scopeIds!.has(id)).length
    : n;
  const totalPairsChecked = (n * (n - 1)) / 2 - ((n - selected) * (n - selected - 1)) / 2;
  const report: DuplicateDetectionReport = {
    totalPairsChecked,
    duplicatesFound: [],
    duplicatesByType: emptyDuplicateCounts(),
    status: 'complete',
    failedPairs: 0,
  };
  if (totalPairsChecked === 0) return report;

  try {
    const vectors = await options.embed(questions);
    if (!validVectors(vectors, questions.length)) throw new Error('Invalid embedding vectors');

    const candidates: PairCandidate[] = [];
    const immediate: PairCandidate[] = [];
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const a = questions[i];
        const b = questions[j];
        if (options.scopeIds && !options.scopeIds.has(a.id) && !options.scopeIds.has(b.id))
          continue;

        const questionA = normalize(a.question);
        const questionB = normalize(b.question);
        const exact = questionA === questionB;
        const textScore = stringSimilarity.compareTwoStrings(questionA, questionB);
        const semanticScore = cosine(vectors[i], vectors[j]);
        const similarAnswers =
          stringSimilarity.compareTwoStrings(normalize(a.answer), normalize(b.answer)) >= 0.7;
        if (
          exact &&
          normalize(a.answer).length > 0 &&
          normalize(a.answer) === normalize(b.answer)
        ) {
          immediate.push({
            a,
            b,
            score: 1,
            matchType: 'exact',
            pairKey: duplicatePairKey(a.id, b.id),
          });
          continue;
        }

        const near = textScore >= 0.8;
        if (!exact && !near && semanticScore < THEME_QA_SEMANTIC_THRESHOLD && !similarAnswers)
          continue;
        candidates.push({
          a,
          b,
          score: exact ? 1 : near ? textScore : semanticScore,
          matchType: exact
            ? 'exact'
            : near
              ? 'near_duplicate'
              : semanticScore >= THEME_QA_SEMANTIC_THRESHOLD
                ? 'semantic_duplicate'
                : 'conceptual',
          pairKey: duplicatePairKey(a.id, b.id),
        });
      }
    }

    report.duplicatesFound.push(...immediate.map((pair) => finding(pair, 'exact')));
    if (candidates.length > THEME_QA_MAX_SEMANTIC_PAIRS) {
      reportFailure(report, candidates.length);
    } else if (candidates.length > 0) {
      const batch = candidates.map((pair) => ({
        pairKey: pair.pairKey,
        input: {
          a: { question: pair.a.question, answer: pair.a.answer },
          b: { question: pair.b.question, answer: pair.b.answer },
        },
      }));
      const results = await options.adjudicateBatch(
        options.candidateId,
        options.candidateContentHash,
        batch
      );
      if (results.length !== candidates.length) throw new Error('Incomplete semantic result batch');
      for (let index = 0; index < candidates.length; index += 1) {
        const pair = candidates[index];
        const result = results[index];
        if (
          !result ||
          !['equivalent', 'conflict', 'distinct', 'uncertain'].includes(result.verdict) ||
          typeof result.assessment !== 'string' ||
          !result.assessment.trim()
        )
          throw new Error('Invalid semantic result');
        if (result.verdict === 'distinct') continue;
        const matchType =
          result.verdict === 'conflict'
            ? 'answer_conflict'
            : result.verdict === 'uncertain'
              ? 'review_required'
              : pair.matchType;
        report.duplicatesFound.push(finding(pair, matchType, result.assessment));
      }
    }
  } catch {
    report.duplicatesFound = [];
    reportFailure(report, totalPairsChecked);
  }

  for (const match of report.duplicatesFound) report.duplicatesByType[match.matchType] += 1;
  return report;
}
