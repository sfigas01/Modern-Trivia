import stringSimilarity from 'string-similarity';

import { STRATEGY_PILLAR_TARGETS, type StrategyPillar } from './guardian';

/**
 * Standalone coverage-diversity benchmark for coverage-planned generation (STE-249).
 *
 * This is deliberately separate from the shared Guardian quality-engine benchmark
 * (`server/lib/quality-benchmark.ts`, owned by Lane A / STE-26) so this lane can validate and
 * merge independently: it measures a different thing (subtopic diversity of a generated batch)
 * using a cheap, deterministic heuristic (no LLM calls, no shared fixtures/CLI).
 *
 * Diversity is approximated by clustering a batch's questions on textual similarity: two
 * questions that are near-paraphrases of each other land in the same cluster, which is exactly
 * the mean-reversion failure mode coverage planning is meant to prevent. The number of distinct
 * clusters relative to the batch size is the diversity ratio.
 */

const SIMILARITY_THRESHOLD = 0.5;

/** A batch is classified "diverse" when its diversity ratio meets or exceeds this. */
export const DIVERSITY_THRESHOLD = 0.7;

/** How far a pillar's actual share may drift from its CONTENT_STRATEGY.md target and still count as on-strategy. */
const PILLAR_SHARE_TOLERANCE = 0.1;

export interface CoverageBenchmarkQuestion {
  id: string;
  question: string;
  pillar: string;
}

export interface CoverageBenchmarkCase {
  /** Stable case id. */
  id: string;
  topic: string;
  /** Whether this batch is expected to be judged diverse (positive control) or mean-reverted (negative control). */
  expectDiverse: boolean;
  questions: CoverageBenchmarkQuestion[];
  /** Human note explaining what the case demonstrates. */
  note?: string;
}

export interface SubtopicCluster {
  /** Question ids grouped into the same apparent subtopic. */
  members: string[];
}

export interface DiversityResult {
  totalQuestions: number;
  clusters: SubtopicCluster[];
  distinctSubtopicCount: number;
  /** distinctSubtopicCount / totalQuestions — 1.0 means every question is its own subtopic. */
  diversityRatio: number;
  duplicatePairs: Array<{ a: string; b: string; similarity: number }>;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clusters a batch of questions by textual similarity as a proxy for "same subtopic + angle".
 * Two questions land in the same cluster once their normalized-text similarity meets
 * SIMILARITY_THRESHOLD — the same kind of overlap coverage planning is meant to avoid producing.
 */
export function scoreSubtopicDiversity(questions: CoverageBenchmarkQuestion[]): DiversityResult {
  const normalized = questions.map((q) => normalize(q.question));

  const parent = questions.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  const duplicatePairs: DiversityResult['duplicatePairs'] = [];
  for (let i = 0; i < questions.length; i++) {
    for (let j = i + 1; j < questions.length; j++) {
      const similarity = stringSimilarity.compareTwoStrings(normalized[i], normalized[j]);
      if (similarity >= SIMILARITY_THRESHOLD) {
        union(i, j);
        duplicatePairs.push({ a: questions[i].id, b: questions[j].id, similarity });
      }
    }
  }

  const clusterMap = new Map<number, string[]>();
  questions.forEach((q, i) => {
    const root = find(i);
    const members = clusterMap.get(root) ?? [];
    members.push(q.id);
    clusterMap.set(root, members);
  });

  const clusters: SubtopicCluster[] = Array.from(clusterMap.values()).map((members) => ({
    members,
  }));
  const distinctSubtopicCount = clusters.length;
  const diversityRatio = questions.length === 0 ? 1 : distinctSubtopicCount / questions.length;

  return {
    totalQuestions: questions.length,
    clusters,
    distinctSubtopicCount,
    diversityRatio,
    duplicatePairs,
  };
}

export interface PillarDistributionEntry {
  pillar: StrategyPillar;
  actualCount: number;
  actualShare: number;
  targetShare: number;
  withinTolerance: boolean;
}

/**
 * Compares a batch's pillar breakdown against CONTENT_STRATEGY.md's target distribution.
 * Diagnostic only (reported alongside diversity, not part of the pass/fail gate) — a single
 * small batch can land off-target by chance even when the overall pool is on-strategy.
 */
export function scorePillarDistribution(
  questions: CoverageBenchmarkQuestion[]
): PillarDistributionEntry[] {
  const total = questions.length;
  const pillars = Object.keys(STRATEGY_PILLAR_TARGETS) as StrategyPillar[];
  const counts = new Map<StrategyPillar, number>();
  for (const q of questions) {
    const pillar = q.pillar as StrategyPillar;
    counts.set(pillar, (counts.get(pillar) ?? 0) + 1);
  }

  return pillars.map((pillar) => {
    const actualCount = counts.get(pillar) ?? 0;
    const targetShare = STRATEGY_PILLAR_TARGETS[pillar];
    const actualShare = total > 0 ? actualCount / total : 0;
    return {
      pillar,
      actualCount,
      actualShare,
      targetShare,
      withinTolerance: Math.abs(actualShare - targetShare) <= PILLAR_SHARE_TOLERANCE,
    };
  });
}

export interface CoverageBenchmarkCaseResult {
  id: string;
  note?: string;
  topic: string;
  diversity: DiversityResult;
  pillarDistribution: PillarDistributionEntry[];
  expectedDiverse: boolean;
  detectedDiverse: boolean;
  agrees: boolean;
}

export interface CoverageBenchmarkReport {
  generatedAt: string;
  totalCases: number;
  agreementCount: number;
  overallAccuracy: number;
  cases: CoverageBenchmarkCaseResult[];
}

/**
 * Runs the coverage-diversity benchmark over a set of golden cases (positive controls that
 * should be judged diverse, negative controls that are deliberately mean-reverted) and reports
 * how often the diversity classifier agrees with the expected label.
 */
export function runCoverageBenchmark(cases: CoverageBenchmarkCase[]): CoverageBenchmarkReport {
  const results: CoverageBenchmarkCaseResult[] = cases.map((testCase) => {
    const diversity = scoreSubtopicDiversity(testCase.questions);
    const detectedDiverse = diversity.diversityRatio >= DIVERSITY_THRESHOLD;
    return {
      id: testCase.id,
      note: testCase.note,
      topic: testCase.topic,
      diversity,
      pillarDistribution: scorePillarDistribution(testCase.questions),
      expectedDiverse: testCase.expectDiverse,
      detectedDiverse,
      agrees: detectedDiverse === testCase.expectDiverse,
    };
  });

  const agreementCount = results.filter((r) => r.agrees).length;

  return {
    generatedAt: new Date().toISOString(),
    totalCases: cases.length,
    agreementCount,
    overallAccuracy: cases.length === 0 ? 1 : agreementCount / cases.length,
    cases: results,
  };
}

/** Validate that fixture cases are well-formed. Returns a list of human-readable problems. */
export function validateCoverageCases(cases: CoverageBenchmarkCase[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const testCase of cases) {
    if (!testCase.id) problems.push('A case is missing an id.');
    if (seen.has(testCase.id)) problems.push(`Duplicate case id: ${testCase.id}`);
    seen.add(testCase.id);
    if (!Array.isArray(testCase.questions) || testCase.questions.length === 0) {
      problems.push(`Case ${testCase.id}: must include at least one question.`);
    }
  }
  return problems;
}
