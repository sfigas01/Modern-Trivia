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
