import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg, { type Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runtimeRun: vi.fn(async () => ({ status: 'ready' })),
  createRuntime: vi.fn(),
  context: { repositories: {}, dispatchProvider: vi.fn() },
}));

vi.mock('./theme-runtime-composition', async (importOriginal) => {
  const original = await importOriginal<typeof import('./theme-runtime-composition')>();
  return {
    ...original,
    createPostgresThemePreparationRuntime: mocks.createRuntime.mockImplementation((options) => {
      options.buildPipeline(mocks.context as never);
      return { run: mocks.runtimeRun };
    }),
  };
});

import { hashThemeRuntimePlan, type ThemePreviewRuntimePlan } from './theme-runtime-plan';
import { bootstrapPostgresThemePreviewRuntime } from './theme-preview-runtime';

const jobId = '00000000-0000-4000-8000-000000000001';
const holdUntil = new Date('2026-11-08T18:00:00.000Z');
const plan: ThemePreviewRuntimePlan = {
  contractVersion: 'theme-preview-runtime-plan-v1',
  mode: 'offline_fixture',
  fixtureVersion: 'e0-v1',
  sourcePolicyVersion: 'sources-v1',
  budgetPolicyFingerprint: 'a'.repeat(64),
  items: [
    {
      key: 'item-1',
      ordinal: 1,
      requestedUrl: 'https://en.wikipedia.org/wiki/Ottawa',
      title: 'Ottawa',
      language: 'en',
      canonicalFactKey: 'fact-1',
      expectedLatestFactRevision: 0,
    },
  ],
};
const planVersion = 'plan-v1';
const planHash = hashThemeRuntimePlan({ planVersion, plan, holdUntil });

const previewEnv = {
  NODE_ENV: 'production',
  RAILWAY_ENVIRONMENT_NAME: 'preview',
  THEME_PREVIEW_SCHEDULER_ENABLED: 'true',
  THEME_PREVIEW_SCHEDULER_INTERVAL_MS: '1000',
  THEME_PREVIEW_SCHEDULER_QUEUE_LIMIT: '4',
  THEME_PREVIEW_SCHEDULER_SCAN_LIMIT: '4',
  THEME_PREVIEW_WORKER_LEASE_MS: '180000',
  THEME_PREVIEW_MAX_CALLBACK_MS: '120000',
  VITE_THEME_ROUNDS: 'true',
  THEME_LIVE_GENERATION: 'true',
  THEME_BUDGET_CURRENCY: 'USD',
  THEME_BUDGET_POLICY_VERSION: 'e0-v1',
  THEME_ACCOUNT_DAILY_BUDGET_MICROS: '1000000',
  THEME_ACCOUNT_ROLLING_7D_BUDGET_MICROS: '2000000',
  THEME_GLOBAL_DAILY_BUDGET_MICROS: '3000000',
};

function pool(options: { enabled?: boolean; recover?: boolean } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM theme_runtime_control'))
      return { rows: [{ enabled: options.enabled ?? true }], rowCount: 1 };
    if (sql.includes('SELECT job.id') && sql.includes('FROM theme_preparation_jobs'))
      return {
        rows: options.recover === false ? [] : [{ id: jobId }],
        rowCount: options.recover === false ? 0 : 1,
      };
    if (sql.includes('SELECT plan_version,plan_hash,plan_json,plan_hold_until'))
      return {
        rows: [
          {
            plan_version: planVersion,
            plan_hash: planHash,
            plan_json: plan,
            plan_hold_until: holdUntil,
          },
        ],
        rowCount: 1,
      };
    throw new Error(`unexpected query: ${sql}`);
  });
  return { value: { query } as unknown as Pool, query };
}

beforeEach(() => vi.clearAllMocks());

describe('PostgreSQL theme preview runtime composition', () => {
  it('stays inert outside the explicitly enabled Railway preview environment', async () => {
    const database = pool();
    const buildPipeline = vi.fn();
    const result = await bootstrapPostgresThemePreviewRuntime({
      pool: database.value,
      env: { ...previewEnv, RAILWAY_ENVIRONMENT_NAME: 'production' },
      repositories: {} as never,
      buildPipeline,
    });

    expect(result).toEqual({ started: false, code: 'scheduler_disabled' });
    expect(database.query).not.toHaveBeenCalled();
    expect(buildPipeline).not.toHaveBeenCalled();
    expect(mocks.createRuntime).not.toHaveBeenCalled();
  });

  it('loads each durable plan before composing and running its worker', async () => {
    const database = pool();
    const buildPipeline = vi.fn(() => ({}) as never);
    const result = await bootstrapPostgresThemePreviewRuntime({
      pool: database.value,
      env: previewEnv,
      repositories: {} as never,
      buildPipeline,
      setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
      clearInterval: vi.fn(),
    });

    expect(result.started).toBe(true);
    if (!result.started) return;
    await result.stop();

    expect(buildPipeline).toHaveBeenCalledWith({
      jobId,
      loadedPlan: { planVersion, planHash, plan, holdUntil },
      context: mocks.context,
    });
    expect(mocks.createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        pool: database.value,
        budget: {
          currency: 'USD',
          policyVersion: 'e0-v1',
          accountDailyMicros: 1_000_000,
          accountRollingSevenDayMicros: 2_000_000,
          globalDailyMicros: 3_000_000,
        },
        leaseDurationMs: 180_000,
      })
    );
    expect(mocks.runtimeRun).toHaveBeenCalledWith(jobId);
  });
});

const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;

describe.runIf(Boolean(databaseUrl))('PostgreSQL theme preview runtime recovery', () => {
  it('recovers a stored plan through the real control, scan and plan repositories', async () => {
    const admin = new pg.Client({ connectionString: databaseUrl });
    const schema = `theme_preview_runtime_${randomUUID().replaceAll('-', '')}`;
    let runtimePool: pg.Pool | null = null;
    let connected = false;
    let created = false;
    try {
      await admin.connect();
      connected = true;
      await admin.query(`CREATE SCHEMA ${schema}`);
      created = true;
      await admin.query(`SET search_path TO ${schema}`);
      await admin.query('CREATE TABLE users (id varchar PRIMARY KEY)');
      await admin.query('CREATE TABLE questions (id varchar PRIMARY KEY)');
      for (const file of [
        '0009_theme_reliability_foundation.sql',
        '0019_theme_preview_runtime_control.sql',
      ])
        await admin.query(
          await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8')
        );

      runtimePool = new pg.Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schema}`,
      });
      const recoveredJobId = randomUUID();
      const gameId = randomUUID();
      const futureHold = new Date(Date.now() + 60 * 60 * 1000);
      const recoveredHash = hashThemeRuntimePlan({
        planVersion,
        plan,
        holdUntil: futureHold,
      });
      await runtimePool.query(
        `INSERT INTO theme_game_sessions
           (id,contract_version,idempotency_key,idempotency_owner_hash,request_fingerprint,
            mode,status,theme,theme_slug,related_categories,player_count,question_count,
            themed_question_target,related_question_target,candidate_ceiling,
            opening_question_target,opening_themed_target,opening_related_target,expires_at)
         VALUES ($1,'theme-reliability-v1',$2,$3,$3,'multiplayer','preparing','Fixture',
                 'fixture','[]'::jsonb,2,40,30,10,50,16,12,4,
                 clock_timestamp() + interval '1 hour')`,
        [gameId, `preview-runtime-${recoveredJobId}`, 'b'.repeat(64)]
      );
      await runtimePool.query(
        `INSERT INTO theme_preparation_jobs
           (id,contract_version,game_id,stable_key,status,public_stage,candidate_ceiling,
            plan_version,plan_hash,plan_json,plan_hold_until)
         VALUES ($1,'theme-reliability-v1',$2,$3,'queued','waiting',50,$4,$5,$6,$7)`,
        [
          recoveredJobId,
          gameId,
          `preview-runtime-${recoveredJobId}`,
          planVersion,
          recoveredHash,
          plan,
          futureHold,
        ]
      );
      await runtimePool.query('UPDATE theme_runtime_control SET enabled=true WHERE singleton_id=1');

      const buildPipeline = vi.fn(() => ({}) as never);
      const result = await bootstrapPostgresThemePreviewRuntime({
        pool: runtimePool,
        env: previewEnv,
        repositories: {} as never,
        buildPipeline,
        setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
        clearInterval: vi.fn(),
      });

      expect(result.started).toBe(true);
      if (!result.started) return;
      await vi.waitFor(
        () => {
          expect(buildPipeline).toHaveBeenCalledWith({
            jobId: recoveredJobId,
            loadedPlan: {
              planVersion,
              planHash: recoveredHash,
              plan,
              holdUntil: futureHold,
            },
            context: mocks.context,
          });
          expect(mocks.runtimeRun).toHaveBeenCalledWith(recoveredJobId);
        },
        { timeout: 2_000 }
      );
      await result.stop();
    } finally {
      await runtimePool?.end();
      if (connected && created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      if (connected) await admin.end();
    }
  });
});
