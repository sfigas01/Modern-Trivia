import type { Question } from '@shared/models/questions';

import { auditQuestionQuality, type QuestionQualityRule } from './question-quality-audit';

/**
 * Accuracy benchmark for the Guardian quality engine (STE-28).
 *
 * A golden set of known good/bad questions (see `test/fixtures/benchmark/`) is run
 * through the engine and the detected failure modes are compared against each case's
 * expected labels. This turns "we hope the engine works" into a measured
 * precision/recall report per failure mode, and a regression gate for any prompt or
 * heuristic change.
 *
 * Failure modes fall into three detector tiers:
 *  - `static`: deterministic heuristics (`auditQuestionQuality`) — always run, no API key.
 *  - `live`:   LLM-backed checks (conceptual/string dedup) — run only when `runLive` is set
 *              and an OpenAI key is present.
 *  - `none`:   no detector implemented yet — the fixtures carry the cases so the sibling
 *              tickets (coherence STE-246, obviousness STE-247, fact verification STE-25, …)
 *              have a target to build against; reported as a coverage gap, never scored.
 */

export type BenchmarkLabel =
  | 'answer_leakage'
  | 'missing_source'
  | 'invalid_difficulty'
  | 'tagging'
  | 'subjective'
  | 'ambiguous_format'
  | 'type_mismatch'
  | 'multi_answer'
  | 'missing_field'
  | 'unverifiable'
  | 'coherence'
  | 'obviousness'
  | 'factual_error'
  | 'semantic_duplicate'
  | 'string_duplicate'
  | 'us_centric';

export type DetectorTier = 'static' | 'live' | 'none';

export interface LabelSpec {
  tier: DetectorTier;
  detector: string;
  description: string;
  /** Linear issue that owns building (or wiring up) this detector, when not yet available. */
  ownerTicket?: string;
}

/** What each failure-mode label means and which detector is responsible for catching it. */
export const LABEL_REGISTRY: Record<BenchmarkLabel, LabelSpec> = {
  answer_leakage: {
    tier: 'static',
    detector: 'question-quality-audit',
    description: 'The answer (or a keyword from it) appears in the question text.',
  },
  missing_source: {
    tier: 'static',
    detector: 'question-quality-audit',
    description: 'Question is missing a verifiable source URL and/or source name.',
  },
  invalid_difficulty: {
    tier: 'static',
    detector: 'question-quality-audit',
    description: 'Difficulty is not one of Easy, Medium, Hard.',
  },
  tagging: {
    tier: 'static',
    detector: 'question-quality-audit',
    description: 'Missing region/pillar tags or the category is absent from the tag set.',
  },
  subjective: {
    tier: 'static',
    detector: 'question-quality-audit',
    description: 'Question uses subjective wording (best/greatest/…) with no single answer.',
  },
  ambiguous_format: {
    tier: 'static',
    detector: 'question-quality-audit',
    description: 'Question implies multiple-choice/true-false without visible options.',
  },
  type_mismatch: {
    tier: 'static',
    detector: 'question-quality-audit',
    description: 'Answer type does not match what the question asks for (numeric/person/place).',
  },
  multi_answer: {
    tier: 'static',
    detector: 'question-quality-audit',
    description: 'Question asks for multiple answers but the stored answer is single-valued.',
  },
  missing_field: {
    tier: 'static',
    detector: 'question-quality-audit',
    description: 'A required field (id/category/difficulty/question/answer/explanation) is empty.',
  },
  unverifiable: {
    tier: 'static',
    detector: 'question-quality-audit',
    description: 'Explanation does not reference the answer and there is no source to verify it.',
  },
  coherence: {
    tier: 'none',
    detector: '(not implemented)',
    ownerTicket: 'STE-246',
    description: 'Answer is defensible but does not match the question premise (mis-premised Q&A).',
  },
  obviousness: {
    tier: 'none',
    detector: '(not implemented)',
    ownerTicket: 'STE-247',
    description: 'Answer is derivable from the question text alone, or difficulty is mislabelled.',
  },
  factual_error: {
    tier: 'none',
    detector: '(not implemented)',
    ownerTicket: 'STE-25',
    description:
      'Answer is factually incorrect. The current verifier also flags editorial issues (missing source, tagging, leakage), so a fact-specific detector is required before scoring this (STE-25).',
  },
  semantic_duplicate: {
    tier: 'live',
    detector: 'duplicate-detector (conceptual)',
    ownerTicket: 'STE-26',
    description: 'A paraphrase of another question that string matching would miss.',
  },
  string_duplicate: {
    tier: 'live',
    detector: 'duplicate-detector (string)',
    ownerTicket: 'STE-26',
    description: 'A near-identical duplicate detectable by string similarity.',
  },
  us_centric: {
    tier: 'none',
    detector: '(not implemented)',
    ownerTicket: 'STE-249',
    description: 'US-default content mislabelled as on-strategy (e.g. GlobalEh).',
  },
};

const ALL_LABELS = Object.keys(LABEL_REGISTRY) as BenchmarkLabel[];

/** Maps each raw audit rule onto the benchmark failure-mode label it evidences. */
const RULE_TO_LABEL: Record<QuestionQualityRule, BenchmarkLabel> = {
  answer_leakage: 'answer_leakage',
  missing_source_metadata: 'missing_source',
  invalid_difficulty: 'invalid_difficulty',
  missing_required_tags: 'tagging',
  category_tag_mismatch: 'tagging',
  subjective_prompt: 'subjective',
  ambiguous_prompt_format: 'ambiguous_format',
  answer_type_mismatch: 'type_mismatch',
  multi_answer_mismatch: 'multi_answer',
  missing_required_field: 'missing_field',
  duplicate_question_id: 'missing_field',
  potentially_incorrect_or_unverifiable: 'unverifiable',
};

/** The question payload of a benchmark case (loose shape — mirrors a library question row). */
export type BenchmarkQuestion = Record<string, unknown> & { id: string };

export interface BenchmarkCase {
  /** Stable case id; must equal `question.id` so live checks map back to the case. */
  id: string;
  /** Failure modes this case is expected to be flagged for. Empty = clean (false-positive control). */
  expects: BenchmarkLabel[];
  /** Human note explaining why the case is good/bad. */
  note?: string;
  question: BenchmarkQuestion;
}

export interface LabelMetrics {
  label: BenchmarkLabel;
  tier: DetectorTier;
  /** Whether this label's detector actually ran in this benchmark run. */
  active: boolean;
  ownerTicket?: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  /** Cases expecting this label. */
  support: number;
  precision: number | null;
  recall: number | null;
  accuracy: number | null;
}

export interface CaseResult {
  id: string;
  note?: string;
  expected: BenchmarkLabel[];
  /** Active-tier labels the engine actually flagged. */
  detected: BenchmarkLabel[];
  /** Expected labels whose detector did not run (coverage gaps, not failures). */
  pendingExpected: BenchmarkLabel[];
  /** Active labels where expected and detected disagree (the real misses / false alarms). */
  mismatches: BenchmarkLabel[];
  passed: boolean;
}

export interface PendingCoverage {
  label: BenchmarkLabel;
  tier: DetectorTier;
  ownerTicket?: string;
  casesAwaiting: number;
}

export interface BenchmarkReport {
  generatedAt: string;
  totalCases: number;
  ranLive: boolean;
  /** Cells (case × active-label) that agreed, over the total number of such cells. */
  overallAccuracy: number;
  activeCellsAgreed: number;
  activeCellsTotal: number;
  labels: LabelMetrics[];
  cases: CaseResult[];
  pendingCoverage: PendingCoverage[];
}

export interface RunBenchmarkOptions {
  /** Also run the LLM-backed checks (fact verification, conceptual dedup). Requires an OpenAI key. */
  runLive?: boolean;
}

/** Run the deterministic heuristic engine over a single question and return the labels it flags. */
export function detectStaticLabels(question: BenchmarkQuestion): Set<BenchmarkLabel> {
  const report = auditQuestionQuality([question]);
  const labels = new Set<BenchmarkLabel>();
  for (const finding of report.findings) {
    labels.add(RULE_TO_LABEL[finding.rule]);
  }
  return labels;
}

function toQuestion(question: BenchmarkQuestion): Question {
  // The live checks read only a handful of fields; cast through the loose fixture shape.
  return question as unknown as Question;
}

function isActive(tier: DetectorTier, runLive: boolean): boolean {
  if (tier === 'static') return true;
  if (tier === 'live') return runLive;
  return false;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * Run the benchmark over a set of golden cases and produce a per-label accuracy report.
 * Static checks run in-process; live checks run only when `runLive` is set (they call OpenAI).
 */
export async function runBenchmark(
  cases: BenchmarkCase[],
  options: RunBenchmarkOptions = {}
): Promise<BenchmarkReport> {
  const runLive = options.runLive ?? false;
  const detectedByCase = new Map<string, Set<BenchmarkLabel>>();
  for (const testCase of cases) {
    detectedByCase.set(testCase.id, detectStaticLabels(testCase.question));
  }

  if (runLive) {
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      throw new Error(
        'Live benchmark checks require AI_INTEGRATIONS_OPENAI_API_KEY. Set it, or run without --live.'
      );
    }

    const questions = cases.map((testCase) => toQuestion(testCase.question));

    // Conceptual + string duplicate detection (STE-26). Fact verification is intentionally
    // NOT run here: the current verifier returns flag/fail for editorial issues too, not only
    // factual errors, so mapping its verdicts to `factual_error` would mislabel fixtures that
    // exercise other defects. `factual_error` stays a coverage gap until STE-25 lands a
    // fact-specific detector.
    const { detectDuplicates } = await import('./duplicate-detector');
    const dupReport = await detectDuplicates(questions);
    for (const match of dupReport.duplicatesFound) {
      const label: BenchmarkLabel =
        match.matchType === 'conceptual' ? 'semantic_duplicate' : 'string_duplicate';
      detectedByCase.get(match.questionIdA)?.add(label);
      detectedByCase.get(match.questionIdB)?.add(label);
    }
  }

  const activeLabels = ALL_LABELS.filter((label) => isActive(LABEL_REGISTRY[label].tier, runLive));

  const labelMetrics: LabelMetrics[] = ALL_LABELS.map((label) => {
    const spec = LABEL_REGISTRY[label];
    const active = isActive(spec.tier, runLive);
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;
    let support = 0;

    for (const testCase of cases) {
      const expected = testCase.expects.includes(label);
      if (expected) support += 1;
      if (!active) continue;
      const detected = detectedByCase.get(testCase.id)?.has(label) ?? false;
      if (expected && detected) tp += 1;
      else if (!expected && detected) fp += 1;
      else if (expected && !detected) fn += 1;
      else tn += 1;
    }

    return {
      label,
      tier: spec.tier,
      active,
      ownerTicket: spec.ownerTicket,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      trueNegatives: tn,
      support,
      precision: active ? ratio(tp, tp + fp) : null,
      recall: active ? ratio(tp, tp + fn) : null,
      accuracy: active ? ratio(tp + tn, tp + fp + fn + tn) : null,
    };
  });

  let activeCellsAgreed = 0;
  let activeCellsTotal = 0;
  const caseResults: CaseResult[] = cases.map((testCase) => {
    const detectedSet = detectedByCase.get(testCase.id) ?? new Set<BenchmarkLabel>();
    const expected = [...testCase.expects].sort();
    const detected = activeLabels.filter((label) => detectedSet.has(label)).sort();
    const pendingExpected = testCase.expects
      .filter((label) => !isActive(LABEL_REGISTRY[label].tier, runLive))
      .sort();

    const mismatches: BenchmarkLabel[] = [];
    for (const label of activeLabels) {
      const expectedHere = testCase.expects.includes(label);
      const detectedHere = detectedSet.has(label);
      activeCellsTotal += 1;
      if (expectedHere === detectedHere) {
        activeCellsAgreed += 1;
      } else {
        mismatches.push(label);
      }
    }

    return {
      id: testCase.id,
      note: testCase.note,
      expected,
      detected,
      pendingExpected,
      mismatches,
      passed: mismatches.length === 0,
    };
  });

  const pendingCoverage: PendingCoverage[] = ALL_LABELS.filter(
    (label) => !isActive(LABEL_REGISTRY[label].tier, runLive)
  )
    .map((label) => ({
      label,
      tier: LABEL_REGISTRY[label].tier,
      ownerTicket: LABEL_REGISTRY[label].ownerTicket,
      casesAwaiting: cases.filter((testCase) => testCase.expects.includes(label)).length,
    }))
    .filter((entry) => entry.casesAwaiting > 0);

  return {
    generatedAt: new Date().toISOString(),
    totalCases: cases.length,
    ranLive: runLive,
    overallAccuracy: activeCellsTotal === 0 ? 1 : activeCellsAgreed / activeCellsTotal,
    activeCellsAgreed,
    activeCellsTotal,
    labels: labelMetrics,
    cases: caseResults,
    pendingCoverage,
  };
}

/** Validate that fixture cases are well-formed. Returns a list of human-readable problems. */
export function validateCases(cases: BenchmarkCase[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const testCase of cases) {
    if (!testCase.id) problems.push('A case is missing an id.');
    if (seen.has(testCase.id)) problems.push(`Duplicate case id: ${testCase.id}`);
    seen.add(testCase.id);
    if (testCase.question?.id !== testCase.id) {
      problems.push(`Case ${testCase.id}: question.id must equal the case id.`);
    }
    for (const label of testCase.expects) {
      if (!ALL_LABELS.includes(label)) {
        problems.push(`Case ${testCase.id}: unknown expected label "${label}".`);
      }
    }
  }
  return problems;
}
