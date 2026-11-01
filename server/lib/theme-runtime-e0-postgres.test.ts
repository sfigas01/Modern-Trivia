import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { createThemeBudgetGateway } from './theme-budget';
import {
  createBudgetedThemeProvider,
  type ThemeBudgetedProviderRequest,
} from './theme-runtime-composition';
import {
  loadThemeProviderResult,
  recordThemeProviderMetadata,
  recordThemeProviderResult,
} from './theme-provider-persistence';
import { createThemeRuntimeControl } from './theme-runtime-control';

const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;

const BASE_SCHEMA = `
CREATE TABLE users (id varchar PRIMARY KEY);
CREATE TABLE theme_game_sessions (
  id uuid PRIMARY KEY,
  generation_owner_user_id varchar REFERENCES users(id),
  status varchar NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE theme_preparation_jobs (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES theme_game_sessions(id),
  status varchar NOT NULL,
  candidates_used integer NOT NULL DEFAULT 0,
  candidate_ceiling integer NOT NULL,
  lease_owner varchar,
  lease_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE theme_daily_budgets (
  budget_date date PRIMARY KEY,
  currency varchar(3) NOT NULL,
  limit_micros integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE theme_budget_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_date date NOT NULL REFERENCES theme_daily_budgets(budget_date),
  job_id uuid NOT NULL REFERENCES theme_preparation_jobs(id),
  status varchar NOT NULL,
  reserved_micros integer NOT NULL,
  settled_micros integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_budget_allocations_id_job UNIQUE (id, job_id)
);
CREATE TABLE theme_job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES theme_preparation_jobs(id),
  allocation_id uuid,
  sequence integer NOT NULL,
  operation varchar NOT NULL,
  status varchar NOT NULL,
  provider varchar,
  model varchar,
  provider_request_key varchar UNIQUE,
  candidate_slots_consumed integer NOT NULL DEFAULT 0,
  reserved_cost_micros integer NOT NULL DEFAULT 0,
  actual_cost_micros integer NOT NULL DEFAULT 0,
  input_tokens integer,
  output_tokens integer,
  failure jsonb,
  dispatched_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_job_attempts_sequence UNIQUE (job_id, sequence),
  CONSTRAINT fk_theme_job_attempts_allocation_job
    FOREIGN KEY (allocation_id, job_id)
    REFERENCES theme_budget_allocations(id, job_id)
);
CREATE TABLE theme_candidates (
  id uuid PRIMARY KEY,
  content_hash varchar(64) NOT NULL,
  UNIQUE (id, content_hash)
);
`;

describe.runIf(Boolean(databaseUrl))('S12B-4 deterministic PostgreSQL E0 budget path', () => {
  it('proves settlement/result replay, denial, unknown outcome and disable-before-invoke', async () => {
    const admin = new pg.Client({ connectionString: databaseUrl });
    const schema = `theme_e0_${randomUUID().replaceAll('-', '')}`;
    let pool: pg.Pool | null = null;
    try {
      await admin.connect();
      await admin.query(`CREATE SCHEMA ${schema}`);
      await admin.query(`SET search_path TO ${schema}`);
      await admin.query(BASE_SCHEMA);
      for (const name of [
        '0018_theme_runtime_budget.sql',
        '0019_theme_preview_runtime_control.sql',
        '0020_theme_provider_runtime_persistence.sql',
        '0021_theme_provider_result_replay.sql',
      ])
        await admin.query(
          await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8')
        );

      pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
      const owner = `owner-${randomUUID()}`;
      const gameId = randomUUID();
      const jobId = randomUUID();
      const claimToken = 'e0-claim';
      await pool.query('INSERT INTO users(id) VALUES($1)', [owner]);
      await pool.query(
        `INSERT INTO theme_game_sessions(id,generation_owner_user_id,status,expires_at)
         VALUES($1,$2,'preparing',clock_timestamp()+interval '1 hour')`,
        [gameId, owner]
      );
      await pool.query(
        `INSERT INTO theme_preparation_jobs
          (id,game_id,status,candidate_ceiling,lease_owner,lease_expires_at)
         VALUES($1,$2,'writing',50,$3,clock_timestamp()+interval '30 minutes')`,
        [jobId, gameId, claimToken]
      );
      const control = createThemeRuntimeControl(pool);
      await control.set(true);
      const budget = {
        currency: 'USD' as const,
        policyVersion: 'e0-v1',
        accountDailyMicros: 1_000,
        accountRollingSevenDayMicros: 1_000,
        globalDailyMicros: 1_000,
      };
      const results = {
        record: (db: pg.PoolClient, record: { attemptId: string }, value: unknown) =>
          recordThemeProviderResult(db, record.attemptId, value),
        load: (record: { attemptId: string }) => loadThemeProviderResult(pool!, record.attemptId),
      };
      const metadata = (db: pg.PoolClient, record: { attemptId: string }, value: never) =>
        recordThemeProviderMetadata(db, record.attemptId, value);
      const holdExpiresAt = new Date(Date.now() + 30 * 60_000);
      const physical = vi.fn(async () => ({
        value: { verdict: 'pass' },
        outcome: {
          status: 'succeeded' as const,
          actualCostMicros: 40,
          inputTokens: 8,
          outputTokens: 2,
        },
        metadata: { providerRequestId: 'e0-response', returnedModel: 'fixture-v1', latencyMs: 3 },
      }));
      const request = (stableKey: string, invoke = physical, reservedCostMicros = 100) =>
        ({
          jobId,
          claimToken,
          stableKey,
          operation: 'review',
          provider: 'fixture',
          model: 'fixture-v1',
          request: { stableKey },
          reservedCostMicros,
          candidateSlots: 0,
          holdExpiresAt,
          invoke,
        }) satisfies ThemeBudgetedProviderRequest<{ verdict: string }>;

      const provider = createBudgetedThemeProvider(
        createThemeBudgetGateway(pool),
        budget,
        metadata,
        results
      );
      await expect(provider(request('settled'))).resolves.toEqual({ verdict: 'pass' });
      const restartedProvider = createBudgetedThemeProvider(
        createThemeBudgetGateway(pool),
        budget,
        metadata,
        results
      );
      await expect(restartedProvider(request('settled'))).resolves.toEqual({ verdict: 'pass' });
      expect(physical).toHaveBeenCalledOnce();
      expect(
        (
          await pool.query(
            `SELECT a.status,a.actual_cost_micros,a.input_tokens,a.output_tokens,
                    m.provider_request_id,r.result_json
               FROM theme_job_attempts a
               JOIN theme_job_attempt_provider_metadata m ON m.attempt_id=a.id
               JOIN theme_job_attempt_provider_results r ON r.attempt_id=a.id
              WHERE a.provider_request_key LIKE '%review%' AND a.status='succeeded'`
          )
        ).rows[0]
      ).toMatchObject({
        status: 'succeeded',
        actual_cost_micros: 40,
        input_tokens: 8,
        output_tokens: 2,
        provider_request_id: 'e0-response',
        result_json: { verdict: 'pass' },
      });

      const denied = vi.fn();
      await expect(provider(request('denied', denied, 1_001))).rejects.toMatchObject({
        code: 'budget_exhausted',
      });
      expect(denied).not.toHaveBeenCalled();

      const unknown = vi.fn(async () => {
        throw new Error('ambiguous fixture transport');
      });
      await expect(provider(request('unknown', unknown))).rejects.toMatchObject({
        code: 'provider_outcome_unknown',
      });
      await expect(provider(request('unknown', unknown))).rejects.toMatchObject({
        code: 'provider_outcome_unknown',
      });
      expect(unknown).toHaveBeenCalledOnce();
      const unknownRow = (
        await pool.query(
          `SELECT a.status,b.status AS allocation_status,b.reserved_micros,b.settled_micros
             FROM theme_job_attempts a JOIN theme_budget_allocations b ON b.id=a.allocation_id
            WHERE a.status='unknown'`
        )
      ).rows[0];
      expect(unknownRow).toMatchObject({
        status: 'unknown',
        allocation_status: 'unknown',
        reserved_micros: 100,
        settled_micros: 0,
      });

      const settlementPhysical = vi.fn(async () => ({
        value: { verdict: 'pass' },
        outcome: { status: 'succeeded' as const, actualCostMicros: 30 },
        metadata: { providerRequestId: 'e0-rollback', returnedModel: 'fixture-v1', latencyMs: 2 },
      }));
      const brokenSettlement = createBudgetedThemeProvider(
        createThemeBudgetGateway(pool),
        budget,
        vi.fn(async () => {
          throw new Error('fixture metadata persistence failure');
        }),
        results
      );
      await expect(
        brokenSettlement(request('settlement-rollback', settlementPhysical))
      ).rejects.toMatchObject({ code: 'provider_outcome_unknown' });
      expect(settlementPhysical).toHaveBeenCalledOnce();
      expect(
        (
          await pool.query(
            `SELECT a.status,b.status AS allocation_status,r.attempt_id AS result_attempt_id
               FROM theme_job_attempts a
               JOIN theme_budget_allocations b ON b.id=a.allocation_id
               LEFT JOIN theme_job_attempt_provider_results r ON r.attempt_id=a.id
              WHERE a.provider_request_key LIKE '%review%' AND a.status='unknown'
              ORDER BY a.sequence DESC LIMIT 1`
          )
        ).rows[0]
      ).toMatchObject({
        status: 'unknown',
        allocation_status: 'unknown',
        result_attempt_id: null,
      });

      const disabledPhysical = vi.fn();
      const disablingProvider = createBudgetedThemeProvider(
        createThemeBudgetGateway(pool, {
          afterReservationCommitted: async () => control.set(false),
        }),
        budget,
        metadata,
        results
      );
      await expect(
        disablingProvider({
          ...request('disabled', disabledPhysical, 50),
          operation: 'generate',
          candidateSlots: 1,
        })
      ).rejects.toMatchObject({ code: 'runtime_unavailable' });
      expect(disabledPhysical).not.toHaveBeenCalled();
      expect(
        (
          await pool.query(
            `SELECT a.status,a.actual_cost_micros,b.status AS allocation_status,j.candidates_used
               FROM theme_job_attempts a
               JOIN theme_budget_allocations b ON b.id=a.allocation_id
               JOIN theme_preparation_jobs j ON j.id=a.job_id
              WHERE a.operation='generate'`
          )
        ).rows[0]
      ).toMatchObject({
        status: 'failed',
        actual_cost_micros: 0,
        allocation_status: 'released',
        candidates_used: 1,
      });
    } finally {
      if (pool) await pool.end().catch(() => undefined);
      await admin.query('SET search_path TO public').catch(() => undefined);
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });
});
