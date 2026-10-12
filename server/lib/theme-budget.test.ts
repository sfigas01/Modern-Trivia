import { describe, expect, it, vi } from 'vitest';

import {
  createThemeBudgetGateway,
  ThemeBudgetError,
  type ThemeBudgetDispatch,
} from './theme-budget';

const input: ThemeBudgetDispatch = {
  jobId: '00000000-0000-4000-8000-000000000001',
  dispatchKey: 'theme-job:1:generate:1',
  requestFingerprint: 'a'.repeat(64),
  policyFingerprint: 'b'.repeat(64),
  claimToken: 'worker-claim',
  operation: 'generate',
  provider: 'test-provider',
  model: 'test-model',
  reservedCostMicros: 100,
  candidateSlots: 1,
  limits: {
    globalDailyMicros: 1_000,
    accountDailyMicros: 500,
    accountRolling168hMicros: 800,
  },
  holdExpiresAt: new Date('2026-10-12T00:00:00.000Z'),
};

type Attempt = Record<string, unknown>;

function harness(options: { usage?: number; failCommit?: boolean } = {}) {
  let attempt: Attempt | undefined;
  let allocationStatus = 'reserved';
  let allocationSettled = 0;
  let candidatesUsed = 0;
  let committed = false;
  let released = false;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql === 'BEGIN' || sql.startsWith('SELECT pg_advisory')) return { rows: [], rowCount: 0 };
    if (sql === 'COMMIT') {
      if (options.failCommit) throw new Error('connection lost');
      committed = true;
      return { rows: [], rowCount: 0 };
    }
    if (sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (sql.includes('WHERE a.provider_request_key=$1'))
      return {
        rows: attempt ? [{ ...attempt, status: attempt.status }] : [],
        rowCount: attempt ? 1 : 0,
      };
    if (sql.includes('FROM theme_preparation_jobs job'))
      return {
        rows: [
          { owner_user_id: 'account-1', candidates_used: candidatesUsed, candidate_ceiling: 50 },
        ],
        rowCount: 1,
      };
    if (sql === 'SELECT clock_timestamp() AS now')
      return { rows: [{ now: new Date('2026-10-11T16:00:00.000Z') }], rowCount: 1 };
    if (sql.startsWith('INSERT INTO theme_daily_budgets')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('SELECT * FROM theme_daily_budgets'))
      return {
        rows: [
          {
            currency: 'USD',
            limit_micros: 1_000,
            account_daily_limit_micros: 500,
            account_rolling_limit_micros: 800,
          },
        ],
        rowCount: 1,
      };
    if (sql.includes('AS global_day')) {
      const usage = String(options.usage ?? 0);
      return {
        rows: [{ global_day: usage, account_day: usage, account_rolling: usage, overrun: false }],
        rowCount: 1,
      };
    }
    if (sql.startsWith('UPDATE theme_preparation_jobs SET candidates_used')) {
      candidatesUsed += Number(params[1]);
      return { rows: [{ id: input.jobId }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO theme_budget_allocations'))
      return { rows: [{ id: '00000000-0000-4000-8000-000000000010' }], rowCount: 1 };
    if (sql.startsWith('INSERT INTO theme_job_attempts')) {
      attempt = {
        id: '00000000-0000-4000-8000-000000000020',
        allocation_id: '00000000-0000-4000-8000-000000000010',
        job_id: input.jobId,
        provider_request_key: input.dispatchKey,
        request_fingerprint: input.requestFingerprint,
        policy_fingerprint: input.policyFingerprint,
        operation: input.operation,
        provider: input.provider,
        model: input.model,
        candidate_slots_consumed: input.candidateSlots,
        reserved_cost_micros: input.reservedCostMicros,
        actual_cost_micros: 0,
        input_tokens: null,
        output_tokens: null,
        failure: null,
        status: 'dispatched',
        owner_user_id: 'account-1',
        expires_at: input.holdExpiresAt,
      };
      return { rows: [{ id: attempt.id }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE theme_job_attempts SET status=$2')) {
      Object.assign(attempt!, {
        status: params[1],
        actual_cost_micros: params[2],
        input_tokens: params[3],
        output_tokens: params[4],
        failure: params[5],
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE theme_budget_allocations SET status=$2')) {
      allocationStatus = String(params[1]);
      allocationSettled = Number(params[2]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SET status='unknown'")) {
      if (sql.startsWith('UPDATE theme_job_attempts')) attempt!.status = 'unknown';
      else allocationStatus = 'unknown';
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unhandled SQL: ${sql}`);
  });
  const client = { query, release: vi.fn(() => (released = true)) };
  const pool = { connect: vi.fn(async () => client) };
  return {
    gateway: createThemeBudgetGateway(pool as never),
    query,
    state: () => ({
      attempt,
      allocationStatus,
      allocationSettled,
      candidatesUsed,
      committed,
      released,
    }),
  };
}

describe('theme budget gateway', () => {
  it('commits a reservation and consumes a slot before invoking the provider', async () => {
    const h = harness();
    const provider = vi.fn(async () => {
      expect(h.state()).toMatchObject({ committed: true, released: true, candidatesUsed: 1 });
      return {
        outcome: {
          status: 'succeeded' as const,
          actualCostMicros: 75,
          inputTokens: 10,
          outputTokens: 5,
        },
        value: { ok: true },
      };
    });
    const result = await h.gateway.dispatch(input, provider);
    expect(result.value).toEqual({ ok: true });
    expect(result.record).toMatchObject({
      status: 'succeeded',
      actualCostMicros: 75,
      replay: false,
    });
    expect(h.state()).toMatchObject({ allocationStatus: 'settled', allocationSettled: 75 });
  });

  it('replays the durable dispatch key without a second provider call or candidate slot', async () => {
    const h = harness();
    const provider = vi.fn(async () => ({
      outcome: { status: 'succeeded' as const, actualCostMicros: 75 },
      value: 'first',
    }));
    await h.gateway.dispatch(input, provider);
    const replay = await h.gateway.dispatch(input, provider);
    expect(replay.record.replay).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(h.state().candidatesUsed).toBe(1);
  });

  it('retains the full reservation and consumed slot when provider outcome is unknown', async () => {
    const h = harness();
    await expect(
      h.gateway.dispatch(input, async () => {
        throw new Error('timeout after dispatch');
      })
    ).rejects.toMatchObject({ code: 'provider_outcome_unknown' });
    expect(h.state()).toMatchObject({
      allocationStatus: 'unknown',
      allocationSettled: 0,
      candidatesUsed: 1,
    });
  });

  it('denies before dispatch when any cap would be exceeded', async () => {
    const h = harness({ usage: 450 });
    const provider = vi.fn();
    await expect(h.gateway.dispatch(input, provider)).rejects.toMatchObject({
      code: 'budget_exhausted',
    });
    expect(provider).not.toHaveBeenCalled();
    expect(h.state().candidatesUsed).toBe(0);
  });

  it('does not call the provider after an ambiguous reservation commit', async () => {
    const h = harness({ failCommit: true });
    const provider = vi.fn();
    await expect(h.gateway.dispatch(input, provider)).rejects.toEqual(
      expect.objectContaining<Partial<ThemeBudgetError>>({ code: 'commit_unknown' })
    );
    expect(provider).not.toHaveBeenCalled();
  });

  it('requires the active lifecycle lease in the reservation query', async () => {
    const h = harness();
    await h.gateway.reserve(input);
    const jobQuery = h.query.mock.calls.find(([sql]) =>
      String(sql).includes('FROM theme_preparation_jobs job')
    );
    expect(jobQuery?.[0]).toContain('job.lease_owner=$2');
    expect(jobQuery?.[0]).toContain('game.expires_at > clock_timestamp()');
    expect(jobQuery?.[1]).toEqual([input.jobId, input.claimToken]);
  });

  it('blocks only overruns without an append-only reconciliation decision', async () => {
    const h = harness();
    await h.gateway.reserve(input);
    const usageQuery = h.query.mock.calls.find(([sql]) => String(sql).includes('AS global_day'));
    expect(usageQuery?.[0]).toContain('LEFT JOIN theme_budget_reconciliations reconciliation');
    expect(usageQuery?.[0]).toContain('allocation.created_at');
    expect(usageQuery?.[0]).toContain('reconciliation.allocation_id IS NULL');
  });
});
