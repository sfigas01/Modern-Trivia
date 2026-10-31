import { describe, expect, it, vi } from 'vitest';

import {
  buildThemeRuntimeEvaluationReport,
  createPostgresThemeRuntimeEvaluationRepository,
  type ThemeRuntimeEvaluationRows,
} from './theme-runtime-evaluation';

const jobOne = '00000000-0000-4000-8000-000000000001';
const jobTwo = '00000000-0000-4000-8000-000000000002';

function rows(): ThemeRuntimeEvaluationRows {
  return {
    jobs: [
      {
        jobId: jobTwo,
        status: 'failed',
        candidateCeiling: 50,
        candidatesUsed: 2,
        readyCount: 0,
        themedReadyCount: 0,
        relatedReadyCount: 0,
      },
      {
        jobId: jobOne,
        status: 'ready',
        candidateCeiling: 50,
        candidatesUsed: 3,
        readyCount: 40,
        themedReadyCount: 30,
        relatedReadyCount: 10,
      },
    ],
    attempts: [
      {
        jobId: jobOne,
        operation: 'generate',
        status: 'succeeded',
        reservedCostMicros: 100,
        actualCostMicros: 70,
        inputTokens: 10,
        outputTokens: 5,
        latencyMs: 20,
        metadataPresent: true,
      },
      {
        jobId: jobTwo,
        operation: 'semantic_check',
        status: 'unknown',
        reservedCostMicros: 120,
        actualCostMicros: 0,
        inputTokens: null,
        outputTokens: null,
        latencyMs: null,
        metadataPresent: false,
      },
    ],
    candidates: [
      { jobId: jobOne, status: 'accepted', count: 1 },
      { jobId: jobOne, status: 'rejected', count: 2 },
      { jobId: jobTwo, status: 'pending', count: 2 },
    ],
    approvals: [{ jobId: jobOne, count: 1 }],
    exposures: [{ jobId: jobTwo, unresolvedReservedMicros: 120 }],
  };
}

describe('theme runtime evaluation', () => {
  it('reports complete denominators, cost exposure and latency without content', () => {
    const report = buildThemeRuntimeEvaluationReport(rows());
    expect(report).toMatchObject({
      answerRedacted: true,
      factualAccuracyClaimed: false,
      denominators: { jobs: 2, candidates: 5, attempts: 2, approvals: 1 },
      actualCostMicros: 70,
      unresolvedReservedMicros: 120,
      missingMetadata: 1,
      latencyMs: { samples: 1, p50: 20, p95: 20, max: 20 },
    });
    expect(report.jobs.map((job) => job.jobId)).toEqual([jobOne, jobTwo]);
    expect(report.jobs[0].candidateOutcomes).toEqual({ accepted: 1, rejected: 2 });
  });

  it('cannot serialize answer, theme, prompt, provider payload or failure sentinels', () => {
    const report = buildThemeRuntimeEvaluationReport(rows());
    const serialized = JSON.stringify(report);
    for (const secret of [
      'SECRET_ANSWER',
      'SECRET_ALIAS',
      'SECRET_THEME',
      'SECRET_PROMPT',
      'SECRET_PROVIDER_RESPONSE',
      'SECRET_FAILURE_TEXT',
    ])
      expect(serialized).not.toContain(secret);
  });

  it('rejects malformed enum and accounting rows', () => {
    expect(() =>
      buildThemeRuntimeEvaluationReport({
        ...rows(),
        attempts: [{ ...rows().attempts[0], status: 'invented' as 'failed' }],
      })
    ).toThrow();
    expect(() =>
      buildThemeRuntimeEvaluationReport({
        ...rows(),
        exposures: [{ jobId: jobOne, unresolvedReservedMicros: -1 }],
      })
    ).toThrow();
  });

  it('uses allowlisted SQL projections and requires every requested job', async () => {
    const query = vi.fn(async (statement: string) =>
      statement.startsWith('SELECT id AS job_id') ? { rows: [] } : { rows: [] }
    );
    const release = vi.fn();
    const connect = vi.fn(async () => ({ query, release }));
    const repository = createPostgresThemeRuntimeEvaluationRepository({ connect } as never);
    await expect(repository.load([jobOne])).rejects.toThrow(/do not exist/);
    expect(query).toHaveBeenCalledWith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .filter((statement) => statement.includes('SELECT'))
      .join('\n');
    expect(sql).not.toMatch(
      /\banswer\b|acceptable_answers|\bcontent\b|plan_json|passage_text|\bfailure\b|provider_request_id|game\.theme/i
    );
  });

  it('reads all projections from one repeatable-read snapshot and commits it', async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('FROM theme_preparation_jobs'))
        return {
          rows: [
            {
              job_id: jobOne,
              status: 'ready',
              candidate_ceiling: 50,
              candidates_used: 1,
              ready_count: 1,
              themed_ready_count: 1,
              related_ready_count: 0,
            },
          ],
        };
      return { rows: [] };
    });
    const release = vi.fn();
    const repository = createPostgresThemeRuntimeEvaluationRepository({
      connect: async () => ({ query, release }),
    } as never);
    await expect(repository.load([jobOne])).resolves.toMatchObject({
      jobs: [{ jobId: jobOne, status: 'ready' }],
    });
    expect(query.mock.calls[0][0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rejects empty, duplicate and malformed job selections before querying', async () => {
    const connect = vi.fn();
    const repository = createPostgresThemeRuntimeEvaluationRepository({ connect } as never);
    await expect(repository.load([])).rejects.toThrow();
    await expect(repository.load([jobOne, jobOne])).rejects.toThrow();
    await expect(repository.load(['not-a-uuid'])).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });
});
