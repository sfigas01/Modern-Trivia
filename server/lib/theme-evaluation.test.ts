import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adapterResultSchema,
  parseFixture,
  runThemeEvaluation,
  themeEvaluationFixtureSchema,
  validateFixture,
  type DecisionInput,
} from './theme-evaluation';
import { evidenceReviewSchema } from '@shared/models/theme-evidence';

const fixture = JSON.parse(
  await readFile(
    new URL('../../test/fixtures/theme-evaluation/contract-v1.json', import.meta.url),
    'utf8'
  )
) as unknown;

describe('theme evaluation fixture contract', () => {
  it('loads the versioned synthetic fixture and preserves provenance', () => {
    const parsed = themeEvaluationFixtureSchema.parse(fixture);
    expect(parsed.schemaVersion).toBe('theme-evaluation-v1');
    expect(parsed.cases.every((item) => item.provenance === 'synthetic_contract')).toBe(true);
  });

  it('rejects duplicate IDs and mixed partitions', () => {
    const parsed = themeEvaluationFixtureSchema.parse(fixture);
    expect(validateFixture({ ...parsed, cases: [parsed.cases[0], parsed.cases[0]] })).toContain(
      'duplicate case id: valid-control'
    );
    const mixed = {
      ...parsed,
      cases: parsed.cases.map((item, index) => ({
        ...item,
        partition: index === 0 ? ('tuning' as const) : ('holdout' as const),
      })),
    };
    expect(() => parseFixture(mixed)).toThrow(/mixed tuning-holdout/);
  });

  it('rejects malformed versioned fixtures and adapter results', () => {
    expect(() =>
      parseFixture({ ...(fixture as Record<string, unknown>), schemaVersion: 'old' })
    ).toThrow();
    expect(() => adapterResultSchema.parse({ executionStatus: 'completed' })).toThrow();
    expect(() =>
      adapterResultSchema.parse({ executionStatus: 'failed', outcome: 'pass' })
    ).toThrow();
  });

  it('proves adverse schema cases through structural mutations of the valid review', () => {
    const parsed = themeEvaluationFixtureSchema.parse(fixture);
    const valid = evidenceReviewSchema.parse(parsed.cases[0].review);
    expect(
      evidenceReviewSchema.safeParse({
        ...valid,
        dimensionResults: valid.dimensionResults.slice(1),
      }).success
    ).toBe(false);
    expect(
      evidenceReviewSchema.safeParse({
        ...valid,
        verdict: 'pass',
        dimensionResults: valid.dimensionResults.map((item, index) =>
          index === 0 ? { ...item, verdict: 'fail', reasons: ['claim_conflicted'] } : item
        ),
      }).success
    ).toBe(false);
    expect(
      evidenceReviewSchema.safeParse({ ...valid, reviewerKind: 'model', reviewerModel: null })
        .success
    ).toBe(false);
  });
});

describe('runThemeEvaluation', () => {
  it('separates schema validation and reports policy coverage gaps', async () => {
    const parsed = themeEvaluationFixtureSchema.parse(fixture);
    const report = await runThemeEvaluation(parseFixture(parsed, 'holdout'));
    expect(report.schemaValidation.denominator).toBe(6);
    expect(report.schemaValidation.passed).toBe(6);
    expect(report.schemaValidation.policyCoverageGaps).toEqual([
      { id: 'policy-freshness-unavailable', reason: 'freshness' },
      { id: 'policy-hash-unavailable', reason: 'hash' },
      { id: 'policy-source-independence-unavailable', reason: 'source_independence' },
    ]);
    expect(report.detector.accuracyClaimed).toBe(false);
    expect(report.detector.labelAgreement).toBeNull();
    expect(report.byTheme['Synthetic science']?.labelAgreement).toBeNull();
    expect(report.coverageGaps).toHaveLength(6);
  });

  it('passes full question content but no expected labels, metadata or sequence to the adapter', async () => {
    const seen: DecisionInput[] = [];
    await runThemeEvaluation(parseFixture(fixture, 'holdout'), async (input) => {
      seen.push(input);
      expect(input.question.answer).toBeTruthy();
      expect(input.question.acceptableAnswers).toBeDefined();
      expect(input).not.toHaveProperty('expected');
      expect(input).not.toHaveProperty('id');
      expect(input).not.toHaveProperty('partition');
      expect(input).not.toHaveProperty('provenance');
      return { executionStatus: 'completed', outcome: 'pass', reasonCodes: [] };
    });
    expect(seen).toHaveLength(6);
  });

  it('catches malformed and throwing adapters without emitting sentinel text', async () => {
    let calls = 0;
    const report = await runThemeEvaluation(parseFixture(fixture, 'holdout'), async () => {
      calls++;
      if (calls === 1) throw new Error('SENTINEL_SECRET');
      return {
        executionStatus: 'completed',
        outcome: 'pass',
        reasonCodes: ['unsupported-not-allowed'],
      };
    });
    expect(report.detector.failed).toBe(6);
    expect(JSON.stringify(report)).not.toContain('SENTINEL_SECRET');
    expect(JSON.stringify(report)).not.toContain('unsupported-not-allowed');
  });

  it('keeps incomplete and failed execution separate from domain outcomes', async () => {
    let calls = 0;
    const report = await runThemeEvaluation(parseFixture(fixture, 'holdout'), async () => {
      calls++;
      return calls === 1
        ? { executionStatus: 'incomplete', reasonCodes: ['review_incomplete'] }
        : calls === 2
          ? { executionStatus: 'failed', reasonCodes: [] }
          : {
              executionStatus: 'completed',
              outcome: 'withhold',
              reasonCodes: ['review_incomplete'],
            };
    });
    expect(report.detector.completed).toBe(4);
    expect(report.detector.incomplete).toBe(1);
    expect(report.detector.failed).toBe(1);
    expect(report.detector.accuracyClaimed).toBe(false);
  });

  it('requires exact normalized reason sets for label agreement', async () => {
    const parsed = themeEvaluationFixtureSchema.parse(fixture);
    const reasonFixture = {
      ...parsed,
      cases: parsed.cases.map((item) =>
        item.id === 'valid-control'
          ? { ...item, expected: { ...item.expected, reasonCodes: ['review_incomplete' as const] } }
          : item
      ),
    };
    const report = await runThemeEvaluation(parseFixture(reasonFixture, 'holdout'), async () => ({
      executionStatus: 'completed',
      outcome: 'pass',
      reasonCodes: [],
    }));
    expect(report.detector.cases.find((item) => item.id === 'valid-control')?.status).toBe(
      'disagreement'
    );
  });

  it('is permutation-stable and safely groups constructor-like themes', async () => {
    const parsed = themeEvaluationFixtureSchema.parse(fixture);
    const constructorCase = { ...parsed.cases[0], id: 'constructor-theme', theme: 'constructor' };
    const historyCase = { ...parsed.cases[0], id: 'history-second', theme: 'Synthetic history' };
    const protoCase = { ...parsed.cases[0], id: 'proto-theme', theme: '__proto__' };
    const reversed = {
      ...parsed,
      cases: [...parsed.cases, constructorCase, historyCase, protoCase].reverse(),
    };
    const report = await runThemeEvaluation(parseFixture(reversed, 'holdout'), async () => ({
      executionStatus: 'completed',
      outcome: 'pass',
      reasonCodes: [],
    }));
    expect(report.byTheme.constructor?.denominator).toBe(1);
    expect(report.byTheme['__proto__']?.denominator).toBe(1);
    expect(report.byTheme['Synthetic history']?.agreements).toBe(2);
    expect(report.byTheme['Synthetic history']?.labelAgreement).toBe(1);
    expect(JSON.stringify(report)).not.toContain('Northport');
  });

  it('prints schemaValidation and exits nonzero for a schema regression', () => {
    const input = `/tmp/theme-evaluation-regression-${Date.now()}.json`;
    const output = `/tmp/theme-evaluation-cli-${Date.now()}.json`;
    const invalid = {
      ...themeEvaluationFixtureSchema.parse(fixture),
      cases: themeEvaluationFixtureSchema
        .parse(fixture)
        .cases.map((item, index) =>
          index === 0
            ? { ...item, expected: { ...item.expected, contract: 'invalid' as const } }
            : item
        ),
    };
    writeFileSync(input, JSON.stringify(invalid));
    try {
      let failed = false;
      try {
        execFileSync(
          process.execPath,
          [
            '--import',
            'tsx',
            path.resolve('script/theme-evaluation.ts'),
            '--input',
            input,
            '--partition',
            'holdout',
            '--json',
            output,
          ],
          { cwd: process.cwd(), env: { ...process.env, TMPDIR: '/tmp' }, encoding: 'utf8' }
        );
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      const report = JSON.parse(String(readFileSync(output)));
      expect(report.schemaValidation).toBeDefined();
      expect(report.contractRegression).toBeUndefined();
    } finally {
      unlinkSync(input);
      try {
        unlinkSync(output);
      } catch {
        /* output may not be created */
      }
    }
  });
});
