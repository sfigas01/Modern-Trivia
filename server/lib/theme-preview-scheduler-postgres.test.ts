import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { createPostgresThemePreviewRecoveryRepository } from './theme-preview-scheduler';

const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;

describe.runIf(Boolean(databaseUrl))('S12B-3 preview recovery PostgreSQL scan', () => {
  it('returns only planned runnable jobs with absent or expired leases', async () => {
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
      await pool.query(
        `INSERT INTO theme_preparation_jobs
          (id,game_id,status,plan_json,last_failure,lease_owner,lease_expires_at,created_at)
         VALUES
          ($1,$6,'waiting','{}',NULL,'old',clock_timestamp()-interval '1 second',clock_timestamp()-interval '5 minutes'),
          ($2,$6,'writing','{}','{"retryable":true}',NULL,NULL,clock_timestamp()-interval '4 minutes'),
          ($3,$6,'waiting','{}',NULL,'active',clock_timestamp()+interval '1 hour',clock_timestamp()-interval '3 minutes'),
          ($4,$7,'waiting','{}',NULL,NULL,NULL,clock_timestamp()-interval '2 minutes'),
          ($5,$6,'queued',NULL,NULL,NULL,NULL,clock_timestamp()-interval '1 minute')`,
        [recoverable, retryable, activeLease, terminal, unplanned, activeGame, terminalGame]
      );

      const repository = createPostgresThemePreviewRecoveryRepository(pool);
      await expect(repository.scanRecoverableJobIds({ limit: 10 })).resolves.toEqual([
        recoverable,
        retryable,
      ]);
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
