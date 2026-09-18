import { readFileSync } from 'fs';

import { describe, expect, it } from 'vitest';

import {
  LABEL_REGISTRY,
  runBenchmark,
  validateCases,
  type BenchmarkCase,
} from './quality-benchmark';

const cases = JSON.parse(
  readFileSync(new URL('../../test/fixtures/benchmark/cases.json', import.meta.url), 'utf8')
) as BenchmarkCase[];

/**
 * The benchmark is the regression gate for the Guardian quality engine (STE-28):
 * if a heuristic change stops catching a known failure mode, or starts flagging a
 * clean question, this test fails. Live (LLM) checks are exercised by the CLI
 * (`npm run benchmark -- --live`), not here, so the gate stays hermetic.
 */
describe('quality-engine accuracy benchmark', () => {
  it('has well-formed fixtures', () => {
    expect(validateCases(cases)).toEqual([]);
  });

  it('includes the canonical real-world failure cases', () => {
    const ids = new Set(cases.map((c) => c.id));
    expect(ids.has('coherence-immigrant-song')).toBe(true);
    expect(ids.has('obviousness-maple-leafs')).toBe(true);
  });

  it('carries clean pass-controls so false positives are caught', () => {
    const cleanCases = cases.filter((c) => c.expects.length === 0);
    expect(cleanCases.length).toBeGreaterThanOrEqual(3);
  });

  it('agrees with expected labels on at least 95% of active cells (static)', async () => {
    const report = await runBenchmark(cases, { runLive: false });
    expect(report.overallAccuracy).toBeGreaterThanOrEqual(0.95);
  });

  it('produces zero false positives on clean control questions', async () => {
    const report = await runBenchmark(cases, { runLive: false });
    for (const result of report.cases) {
      if (result.expected.length === 0) {
        expect(result.detected, `clean case ${result.id} was flagged`).toEqual([]);
      }
    }
  });

  it('catches every static failure mode it has a case for (recall = 1)', async () => {
    const report = await runBenchmark(cases, { runLive: false });
    for (const metric of report.labels) {
      if (metric.tier === 'static' && metric.support > 0) {
        expect(metric.recall, `recall for ${metric.label}`).toBe(1);
      }
    }
  });

  it('reports coherence and obviousness as coverage gaps with owner tickets', async () => {
    const report = await runBenchmark(cases, { runLive: false });
    const gapLabels = new Set(report.pendingCoverage.map((g) => g.label));
    expect(gapLabels.has('coherence')).toBe(true);
    expect(gapLabels.has('obviousness')).toBe(true);
    expect(LABEL_REGISTRY.coherence.ownerTicket).toBe('STE-246');
    expect(LABEL_REGISTRY.obviousness.ownerTicket).toBe('STE-247');
  });
});

import {
  scoreSemanticPairs,
  validateSemanticPairs,
  type SemanticPairCase,
} from './quality-benchmark';
const semanticPairs = JSON.parse(
  readFileSync(
    new URL('../../test/fixtures/benchmark/semantic-pairs.json', import.meta.url),
    'utf8'
  )
) as SemanticPairCase[];
describe('pair-level semantic benchmark', () => {
  it('rejects malformed labels and duplicate IDs before paid evaluation', () => {
    expect(() => validateSemanticPairs([{ ...semanticPairs[0], expected: 'unknown' }])).toThrow();
    expect(() => validateSemanticPairs([semanticPairs[0], semanticPairs[0]])).toThrow();
    expect(validateSemanticPairs(semanticPairs)).toHaveLength(130);
  });
  it('has unique regression cases covering both detectors and hard controls', () => {
    expect(new Set(semanticPairs.map((p) => p.id)).size).toBe(semanticPairs.length);
    for (const label of ['semantic_duplicate', 'answer_conflict', 'distinct']) {
      expect(semanticPairs.filter((p) => p.expected === label).length).toBeGreaterThanOrEqual(40);
    }
    expect(semanticPairs.some((p) => p.control === 'alias')).toBe(true);
    expect(semanticPairs.some((p) => p.control === 'temporal')).toBe(true);
  });
  it('validates the separate evaluation sets and minimum per-class support', () => {
    for (const name of ['semantic-holdout', 'semantic-blind-eval']) {
      const cases = validateSemanticPairs(
        JSON.parse(
          readFileSync(
            new URL(`../../test/fixtures/benchmark/${name}.json`, import.meta.url),
            'utf8'
          )
        )
      );
      for (const label of ['semantic_duplicate', 'answer_conflict', 'distinct']) {
        expect(cases.filter((c) => c.expected === label).length).toBeGreaterThanOrEqual(40);
      }
    }
  });
  it('fails missing detector coverage and counts unresolved positives as false negatives', () => {
    const r = scoreSemanticPairs(
      semanticPairs,
      semanticPairs.map(() => 'review_required')
    );
    expect(r.passed).toBe(false);
    expect(r.metrics.every((m) => m.fn === m.support && m.recall === 0)).toBe(true);
  });
  it('fails on any false conflict in protected controls, even with otherwise high accuracy', () => {
    const outcomes = semanticPairs.map((p) =>
      p.control === 'alias' ? ('answer_conflict' as const) : p.expected
    );
    const r = scoreSemanticPairs(semanticPairs, outcomes);
    expect(r.falseControlConflicts).toBe(10);
    expect(r.passed).toBe(false);
  });
  it('never passes incomplete evaluation', () => {
    const outcomes = semanticPairs.map(
      (p) => p.expected as import('./quality-benchmark').SemanticPairOutcome
    );
    outcomes[0] = 'incomplete';
    expect(scoreSemanticPairs(semanticPairs, outcomes).passed).toBe(false);
  });
});
