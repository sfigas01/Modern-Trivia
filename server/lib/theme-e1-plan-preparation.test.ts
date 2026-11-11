import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  THEME_E1_CLAIM_EVIDENCE_POLICY,
  THEME_E1_DISCOVERY_POLICY,
  THEME_E1_SLOTS_PER_JOB,
  assertThemeE1PlanPolicy,
} from './theme-e1-plan-policy';
import {
  ThemeE1PlanPreparationError,
  createPostgresThemeE1PlanPreparationRepository,
  prepareThemeE1Plans,
  type ThemeE1PlanPreparationRepository,
  type ThemeE1PreparationJob,
} from './theme-e1-plan-preparation';
import { createThemeLiveRuntimePlanWithProposalSlots } from './theme-runtime-plan';
import { buildWikipediaDiscoveryRequestUrl } from './theme-wikipedia-discovery';

const jobIds = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
] as const;
const now = new Date('2026-11-11T02:00:00.000Z');
const expiresAt = new Date('2026-11-11T04:00:00.000Z');
const budget = {
  currency: 'USD' as const,
  policyVersion: 'e1-preview-usd-2-2026-11-10-v1',
  accountDailyMicros: 2_000_000,
  accountRollingSevenDayMicros: 2_000_000,
  globalDailyMicros: 2_000_000,
};

function job(jobId: string, index: number): ThemeE1PreparationJob {
  return {
    jobId,
    status: 'waiting',
    gameStatus: 'waiting',
    theme: `SECRET_THEME_${index}`,
    generationOwnerUserId: `account-${index}`,
    candidateCeiling: 50,
    candidatesUsed: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    expiresAt,
    planVersion: null,
  };
}

function repository() {
  const jobs = jobIds.map(job);
  const load = vi.fn(async () => ({
    jobs,
    queue: { recoverablePlannedJobs: 0, eligibleUnplannedJobs: 3 },
  }));
  const apply = vi.fn(async () => [false, false, false]);
  return { value: { load, apply } satisfies ThemeE1PlanPreparationRepository, load, apply };
}

const discover = vi.fn(async ({ theme }: { theme: string }) => ({
  ok: true as const,
  value: {
    contractVersion: 'theme-wikipedia-discovery-v1' as const,
    normalizedTheme: theme,
    requestUrl: buildWikipediaDiscoveryRequestUrl(theme, THEME_E1_DISCOVERY_POLICY).href,
    discoveryPolicy: THEME_E1_DISCOVERY_POLICY,
    sources: [
      {
        pageId: 100 + Number(theme.at(-1)),
        rank: 1,
        title: `Source ${theme.at(-1)}`,
        language: 'en' as const,
        canonicalUrl: `https://en.wikipedia.org/wiki/Source_${theme.at(-1)}`,
      },
    ],
  },
}));

beforeEach(() => vi.clearAllMocks());

describe('E1 frozen plan policy', () => {
  it('accepts the exact four-slot policy and rejects an outer version with changed policy', () => {
    const discovery = {
      contractVersion: 'theme-wikipedia-discovery-v1' as const,
      normalizedTheme: 'Baseball history',
      requestUrl: buildWikipediaDiscoveryRequestUrl('Baseball history', THEME_E1_DISCOVERY_POLICY)
        .href,
      discoveryPolicy: THEME_E1_DISCOVERY_POLICY,
      sources: [
        {
          pageId: 10,
          rank: 1,
          title: 'Baseball history',
          language: 'en' as const,
          canonicalUrl: 'https://en.wikipedia.org/wiki/History_of_baseball',
        },
      ],
    };
    const plan = createThemeLiveRuntimePlanWithProposalSlots({
      discovery,
      claimEvidencePolicy: THEME_E1_CLAIM_EVIDENCE_POLICY,
      budgetPolicyFingerprint: 'a'.repeat(64),
      totalSlots: THEME_E1_SLOTS_PER_JOB,
      maximumSlotsPerSource: THEME_E1_SLOTS_PER_JOB,
    });

    expect(assertThemeE1PlanPolicy(plan)).toEqual(plan);
    expect(() =>
      assertThemeE1PlanPolicy({
        ...plan,
        discoveryPolicy: { ...plan.discoveryPolicy, discoveryPolicyVersion: 'changed-v1' },
      })
    ).toThrow('theme_e1_plan_policy_mismatch');
  });
});

describe('E1 plan preparation', () => {
  it('builds an answer-redacted 3x4 dry run without persistence or provider authorization', async () => {
    const repo = repository();
    const report = await prepareThemeE1Plans({
      repository: repo.value,
      jobIds,
      budget,
      now,
      discover: discover as never,
    });

    expect(report).toMatchObject({
      answerRedacted: true,
      providerCallsAuthorized: false,
      mode: 'dry_run',
      totalJobs: 3,
      totalProposalSlots: 12,
      queueBefore: { recoverablePlannedJobs: 0, eligibleUnplannedJobs: 3 },
    });
    expect(report.jobs).toHaveLength(3);
    expect(report.jobs.every((entry) => entry.proposalSlots === 4)).toBe(true);
    expect(repo.apply).not.toHaveBeenCalled();
    expect(discover).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(report)).not.toContain('SECRET_THEME');
  });

  it('reads control, selected jobs and queue state in one read-only snapshot', async () => {
    const rows = jobIds.map((jobId, index) => ({
      job_id: jobId,
      status: 'waiting',
      game_status: 'waiting',
      theme: `SECRET_THEME_${index}`,
      generation_owner_user_id: `account-${index}`,
      candidate_ceiling: 50,
      candidates_used: 0,
      lease_owner: null,
      lease_expires_at: null,
      expires_at: expiresAt,
      plan_version: null,
    }));
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM theme_runtime_control')) return { rows: [{ enabled: false }] };
      if (sql.includes('SELECT job.id AS job_id')) return { rows };
      if (sql.includes('count(*) FILTER'))
        return { rows: [{ recoverable_planned_jobs: '0', eligible_unplanned_jobs: '3' }] };
      return { rows: [] };
    });
    const release = vi.fn();
    const postgres = createPostgresThemeE1PlanPreparationRepository({
      connect: async () => ({ query, release }),
    } as never);

    await expect(postgres.load(jobIds, now)).resolves.toMatchObject({
      jobs: [{ jobId: jobIds[0] }, { jobId: jobIds[1] }, { jobId: jobIds[2] }],
      queue: { recoverablePlannedJobs: 0, eligibleUnplannedJobs: 3 },
    });
    expect(query.mock.calls[0][0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(
      /INSERT|UPDATE|DELETE|THEME_E1_OPENAI_API_KEY/i
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects an admitted job whose durable candidate ceiling cannot hold four slots', async () => {
    const rows = jobIds.map((jobId, index) => ({
      job_id: jobId,
      status: 'waiting',
      game_status: 'waiting',
      theme: `SECRET_THEME_${index}`,
      generation_owner_user_id: `account-${index}`,
      candidate_ceiling: index === 1 ? 3 : 50,
      candidates_used: 0,
      lease_owner: null,
      lease_expires_at: null,
      expires_at: expiresAt,
      plan_version: null,
    }));
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM theme_runtime_control')) return { rows: [{ enabled: false }] };
      if (sql.includes('SELECT job.id AS job_id')) return { rows };
      return { rows: [] };
    });
    const release = vi.fn();
    const postgres = createPostgresThemeE1PlanPreparationRepository({
      connect: async () => ({ query, release }),
    } as never);

    await expect(postgres.load(jobIds, now)).rejects.toMatchObject({ code: 'job_ineligible' });
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('refuses database inspection before reading jobs when runtime control is enabled', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes('FROM theme_runtime_control') ? { rows: [{ enabled: true }] } : { rows: [] }
    );
    const release = vi.fn();
    const postgres = createPostgresThemeE1PlanPreparationRepository({
      connect: async () => ({ query, release }),
    } as never);

    await expect(postgres.load(jobIds, now)).rejects.toMatchObject({
      code: 'runtime_control_enabled',
    });
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('SELECT job.id AS job_id'), [
      jobIds,
    ]);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('persists all three prepared plans in one repository call only with apply', async () => {
    const repo = repository();
    repo.apply.mockResolvedValueOnce([false, true, false]);
    const report = await prepareThemeE1Plans({
      repository: repo.value,
      jobIds,
      budget,
      now,
      apply: true,
      discover: discover as never,
    });

    expect(report.mode).toBe('applied');
    expect(report.jobs.map((entry) => entry.replay)).toEqual([false, true, false]);
    expect(repo.apply).toHaveBeenCalledOnce();
    expect(repo.apply.mock.calls[0][0]).toHaveLength(3);
  });

  it('rejects anything other than three distinct explicit job IDs before database access', async () => {
    const repo = repository();
    for (const selection of [[], [jobIds[0]], [jobIds[0], jobIds[1], jobIds[1]], ['bad']])
      await expect(
        prepareThemeE1Plans({ repository: repo.value, jobIds: selection, budget, now })
      ).rejects.toMatchObject({ code: 'invalid_job_selection' });
    expect(repo.load).not.toHaveBeenCalled();
  });

  it('fails closed with a sanitized code when Wikipedia discovery cannot prepare a plan', async () => {
    const repo = repository();
    await expect(
      prepareThemeE1Plans({
        repository: repo.value,
        jobIds,
        budget,
        now,
        discover: vi.fn(async () => ({
          ok: false,
          failure: {
            contractVersion: 'theme-wikipedia-discovery-v1',
            code: 'provider_unavailable',
            retryable: true,
            provider: 'wikipedia-en',
            httpStatus: 503,
          },
        })) as never,
      })
    ).rejects.toEqual(new ThemeE1PlanPreparationError('discovery_failed'));
    expect(repo.apply).not.toHaveBeenCalled();
  });
});
