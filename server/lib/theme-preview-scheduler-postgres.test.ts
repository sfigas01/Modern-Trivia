import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { createPostgresThemePreviewRecoveryRepository } from './theme-preview-scheduler';

const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;

describe.runIf(Boolean(databaseUrl))('S12B-3 preview recovery PostgreSQL scan', () => {
  it('returns unplanned and policy-compatible planned jobs without stale plans', async () => {
    const admin = new pg.Client({ connectionString: databaseUrl });
    const schema = `theme_recovery_${randomUUID().replaceAll('-', '')}`;
    let pool: pg.Pool | null = null;
    let connected = false;
    let created = false;
    try {
      await admin.connect();
      connected = true;
      await admin.query(`CREATE SCHEMA ${schema}`);
      created = true;
      await admin.query(`SET search_path TO ${schema}`);
      await admin.query(`CREATE TABLE theme_game_sessions (
        id uuid PRIMARY KEY,
        status varchar NOT NULL,
        expires_at timestamptz NOT NULL
      )`);
      await admin.query(`CREATE TABLE theme_preparation_jobs (
        id uuid PRIMARY KEY,
        game_id uuid NOT NULL REFERENCES theme_game_sessions(id),
        status varchar NOT NULL,
        plan_json jsonb,
        last_failure jsonb,
        lease_owner varchar,
        lease_expires_at timestamptz,
        created_at timestamptz NOT NULL
      )`);
      pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
      const activeGame = randomUUID();
      const terminalGame = randomUUID();
      await pool.query(
        `INSERT INTO theme_game_sessions(id,status,expires_at)
         VALUES ($1,'preparing',clock_timestamp()+interval '1 hour'),
                ($2,'completed',clock_timestamp()+interval '1 hour')`,
        [activeGame, terminalGame]
      );
      const recoverable = randomUUID();
      const retryable = randomUUID();
      const activeLease = randomUUID();
      const terminal = randomUUID();
      const unplanned = randomUUID();
      const incompatiblePlan = randomUUID();
      const budgetPolicyFingerprint = 'a'.repeat(64);
      const incompatibleBudgetPolicyFingerprint = 'b'.repeat(64);
      await pool.query(
        `INSERT INTO theme_preparation_jobs
          (id,game_id,status,plan_json,last_failure,lease_owner,lease_expires_at,created_at)
         VALUES
          ($1,$7,'waiting',$9::jsonb,NULL,'old',clock_timestamp()-interval '1 second',clock_timestamp()-interval '5 minutes'),
          ($2,$7,'writing',$9::jsonb,'{"retryable":true}',NULL,NULL,clock_timestamp()-interval '4 minutes'),
          ($3,$7,'waiting',$9::jsonb,NULL,'active',clock_timestamp()+interval '1 hour',clock_timestamp()-interval '3 minutes'),
          ($4,$8,'waiting',$9::jsonb,NULL,NULL,NULL,clock_timestamp()-interval '2 minutes'),
          ($5,$7,'queued',NULL,NULL,NULL,NULL,clock_timestamp()-interval '1 minute'),
          ($6,$7,'waiting',$10::jsonb,NULL,NULL,NULL,clock_timestamp()-interval '6 minutes')`,
        [
          recoverable,
          retryable,
          activeLease,
          terminal,
          unplanned,
          incompatiblePlan,
          activeGame,
          terminalGame,
          JSON.stringify({ budgetPolicyFingerprint }),
          JSON.stringify({ budgetPolicyFingerprint: incompatibleBudgetPolicyFingerprint }),
        ]
      );

      const repository = createPostgresThemePreviewRecoveryRepository(pool);
      await expect(
        repository.scanRecoverableJobIds({ limit: 10, budgetPolicyFingerprint })
      ).resolves.toEqual([recoverable, retryable, unplanned]);
    } finally {
      if (pool) await pool.end().catch(() => undefined);
      if (connected) {
        if (created) {
          await admin.query('SET search_path TO public').catch(() => undefined);
          await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
        }
        await admin.end().catch(() => undefined);
      }
    }
  });
});
