import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { evidenceReviewSchema } from '@shared/models/theme-evidence';

export const THEME_EVALUATION_SCHEMA_VERSION = 'theme-evaluation-v1' as const;
export const THEME_REASON_CODES = [
  'supported',
  'review_incomplete',
  'claim_conflicted',
  'source_stale',
  'source_not_independent',
  'alias_unsupported',
  'explanation_unsupported',
  'revision_hash_mismatch',
] as const;
const reasonSchema = z.enum(THEME_REASON_CODES);
const partitionSchema = z.enum(['tuning', 'holdout']);
const provenanceSchema = z.enum(['human_gold', 'model_assisted', 'synthetic_contract']);
const outcomeSchema = z.enum(['pass', 'flag', 'fail', 'withhold']);
const executionSchema = z.enum(['completed', 'incomplete', 'failed']);
const policyGapReasonSchema = z.enum(['freshness', 'hash', 'source_independence']);
const questionSchema = z
  .object({
    id: z.string().min(1),
    prompt: z.string().min(1),
    answer: z.string().min(1),
    acceptableAnswers: z.array(z.string()),
    explanation: z.string(),
  })
  .strict();
const evaluationCaseSchema = z
  .object({
    id: z.string().min(1),
    theme: z.string().min(1),
    partition: partitionSchema,
    provenance: provenanceSchema,
    question: questionSchema,
    review: z.unknown(),
    expected: z
      .object({
        contract: z.enum(['valid', 'invalid']),
        outcome: outcomeSchema,
        reasonCodes: z.array(reasonSchema),
      })
      .strict(),
  })
  .strict();
export const themeEvaluationFixtureSchema = z
  .object({
    schemaVersion: z.literal(THEME_EVALUATION_SCHEMA_VERSION),
    fixtureId: z.string().min(1),
    policyCoverageGaps: z.array(
      z.object({ id: z.string().min(1), reason: policyGapReasonSchema }).strict()
    ),
    cases: z.array(evaluationCaseSchema).min(1),
  })
  .strict();
export type ThemeEvaluationFixture = z.infer<typeof themeEvaluationFixtureSchema>;
export type ThemeEvaluationCase = ThemeEvaluationFixture['cases'][number];
export type DecisionInput = { question: ThemeEvaluationCase['question']; review: unknown };
export const adapterResultSchema = z
  .object({
    executionStatus: executionSchema,
    outcome: outcomeSchema.optional(),
    reasonCodes: z.array(reasonSchema).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.executionStatus === 'completed' && value.outcome === undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outcome'],
        message: 'completed results require outcome',
      });
    if (value.executionStatus !== 'completed' && value.outcome !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outcome'],
        message: 'non-completed results cannot include outcome',
      });
  });
export type DecisionAdapter = (input: DecisionInput) => Promise<unknown>;
export interface ThemeEvaluationReport {
  schemaVersion: typeof THEME_EVALUATION_SCHEMA_VERSION;
  fixtureId: string;
  partition: 'tuning' | 'holdout';
  provenance: Record<string, number>;
  schemaValidation: {
    denominator: number;
    passed: number;
    failed: number;
    policyCoverageGaps: Array<{ id: string; reason: 'freshness' | 'hash' | 'source_independence' }>;
  };
  detector: {
    denominator: number;
    completed: number;
    incomplete: number;
    failed: number;
    agreements: number;
    labelAgreement: number | null;
    accuracyClaimed: false;
    cases: Array<{
      id: string;
      theme: string;
      executionStatus: string;
      expected: string;
      detected: string | null;
      reasonCodes: string[];
      status: string;
    }>;
  };
  coverageGaps: Array<{ id: string; theme: string; reason: string }>;
  byTheme: Record<
    string,
    {
      denominator: number;
      completed: number;
      incomplete: number;
      failed: number;
      agreements: number;
      labelAgreement: number | null;
    }
  >;
}
export function validateFixture(value: unknown): string[] {
  const parsed = themeEvaluationFixtureSchema.safeParse(value);
  if (!parsed.success)
    return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const ids = new Set<string>();
  const errors: string[] = [];
  for (const item of parsed.data.cases) {
    if (ids.has(item.id)) errors.push(`duplicate case id: ${item.id}`);
    ids.add(item.id);
  }
  if (new Set(parsed.data.cases.map((item) => item.partition)).size > 1)
    errors.push('mixed tuning-holdout fixture requires explicit partition selection');
  const gapIds = new Set<string>();
  for (const gap of parsed.data.policyCoverageGaps) {
    if (gapIds.has(gap.id)) errors.push(`duplicate policy gap id: ${gap.id}`);
    gapIds.add(gap.id);
  }
  return errors;
}
export function parseFixture(
  value: unknown,
  partition?: 'tuning' | 'holdout'
): ThemeEvaluationFixture {
  const fixture = themeEvaluationFixtureSchema.parse(value);
  const ids = new Set<string>();
  for (const item of fixture.cases) {
    if (ids.has(item.id)) throw new Error(`duplicate case id: ${item.id}`);
    ids.add(item.id);
  }
  const partitions = new Set(fixture.cases.map((item) => item.partition));
  if (partitions.size > 1 && !partition)
    throw new Error('mixed tuning-holdout input rejected; choose a partition');
  const cases = partition
    ? fixture.cases.filter((item) => item.partition === partition)
    : fixture.cases;
  if (!cases.length) throw new Error(`no cases found for partition ${partition}`);
  return { ...fixture, cases };
}
function redact(item: ThemeEvaluationCase): DecisionInput {
  return { question: item.question, review: item.review };
}
export async function runThemeEvaluation(
  fixture: ThemeEvaluationFixture,
  adapter?: DecisionAdapter
): Promise<ThemeEvaluationReport> {
  const sorted = [...fixture.cases].sort(
    (a, b) => a.theme.localeCompare(b.theme) || a.id.localeCompare(b.id)
  );
  const schemaCases = sorted.map((item) => ({
    id: item.id,
    valid: evidenceReviewSchema.safeParse(item.review).success,
    expected: item.expected.contract,
  }));
  const schemaFailed = schemaCases.filter((item) => item.valid !== (item.expected === 'valid'));
  const policyCoverageGaps = [...fixture.policyCoverageGaps].sort((a, b) =>
    a.id.localeCompare(b.id)
  );
  const cases: ThemeEvaluationReport['detector']['cases'] = [];
  const gaps: ThemeEvaluationReport['coverageGaps'] = [];
  const byTheme = new Map<string, ThemeEvaluationReport['byTheme'][string]>();
  for (const item of sorted) {
    const theme = byTheme.get(item.theme) ?? {
      denominator: 0,
      completed: 0,
      incomplete: 0,
      failed: 0,
      agreements: 0,
      labelAgreement: null,
    };
    theme.denominator++;
    byTheme.set(item.theme, theme);
    if (!adapter) {
      theme.incomplete++;
      gaps.push({ id: item.id, theme: item.theme, reason: 'missing_adapter' });
      cases.push({
        id: item.id,
        theme: item.theme,
        executionStatus: 'incomplete',
        expected: item.expected.outcome,
        detected: null,
        reasonCodes: [],
        status: 'coverage_gap',
      });
      continue;
    }
    let result: z.infer<typeof adapterResultSchema>;
    try {
      result = adapterResultSchema.parse(await adapter(redact(item)));
    } catch {
      theme.failed++;
      gaps.push({ id: item.id, theme: item.theme, reason: 'adapter_failed_or_malformed' });
      cases.push({
        id: item.id,
        theme: item.theme,
        executionStatus: 'failed',
        expected: item.expected.outcome,
        detected: null,
        reasonCodes: [],
        status: 'execution_failure',
      });
      continue;
    }
    if (result.executionStatus !== 'completed') {
      theme[result.executionStatus]++;
      gaps.push({ id: item.id, theme: item.theme, reason: result.executionStatus });
      cases.push({
        id: item.id,
        theme: item.theme,
        executionStatus: result.executionStatus,
        expected: item.expected.outcome,
        detected: null,
        reasonCodes: result.reasonCodes,
        status: 'coverage_gap',
      });
      continue;
    }
    theme.completed++;
    const actualReasons = Array.from(new Set(result.reasonCodes)).sort();
    const expectedReasons = Array.from(new Set(item.expected.reasonCodes)).sort();
    const agreement =
      result.outcome === item.expected.outcome &&
      actualReasons.length === expectedReasons.length &&
      actualReasons.every((reason, index) => reason === expectedReasons[index]);
    if (agreement) theme.agreements++;
    cases.push({
      id: item.id,
      theme: item.theme,
      executionStatus: 'completed',
      expected: item.expected.outcome,
      detected: result.outcome ?? null,
      reasonCodes: actualReasons,
      status: agreement ? 'agreement' : 'disagreement',
    });
  }
  byTheme.forEach((theme) => {
    theme.labelAgreement = theme.completed ? theme.agreements / theme.completed : null;
  });
  const reportByTheme = Object.create(null) as ThemeEvaluationReport['byTheme'];
  byTheme.forEach((value, theme) => {
    reportByTheme[theme] = value;
  });
  const completed = cases.filter((item) => item.executionStatus === 'completed');
  const agreements = completed.filter((item) => item.status === 'agreement').length;
  const provenance: Record<string, number> = {};
  for (const item of sorted) provenance[item.provenance] = (provenance[item.provenance] ?? 0) + 1;
  return {
    schemaVersion: THEME_EVALUATION_SCHEMA_VERSION,
    fixtureId: fixture.fixtureId,
    partition: sorted[0].partition,
    provenance,
    schemaValidation: {
      denominator: sorted.length,
      passed: sorted.length - schemaFailed.length,
      failed: schemaFailed.length,
      policyCoverageGaps,
    },
    detector: {
      denominator: sorted.length,
      completed: completed.length,
      incomplete: cases.filter((item) => item.executionStatus === 'incomplete').length,
      failed: cases.filter((item) => item.executionStatus === 'failed').length,
      agreements,
      labelAgreement: completed.length ? agreements / completed.length : null,
      accuracyClaimed: false,
      cases,
    },
    coverageGaps: gaps,
    byTheme: reportByTheme,
  };
}
export async function loadThemeEvaluationFixture(
  filePath: string,
  partition?: 'tuning' | 'holdout'
): Promise<ThemeEvaluationFixture> {
  return parseFixture(JSON.parse(await readFile(filePath, 'utf8')), partition);
}
