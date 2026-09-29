import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { THEME_RELIABILITY_CONTRACT_VERSION } from '@shared/models/theme-evidence';

import {
  createPostgresThemeLifecycleRepository,
  createThemeLifecycleService,
  type CreateThemeLifecycleInput,
} from './theme-lifecycle';

const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;
const migrationUrl = new URL(
  '../../migrations/0009_theme_reliability_foundation.sql',
  import.meta.url
);
const { Client, Pool } = pg;

describe.runIf(Boolean(databaseUrl))('theme lifecycle PostgreSQL concurrency', () => {
  it('enforces idempotency, rollback, database-time leases, parent state, and CAS', async () => {
    const admin = new Client({ connectionString: databaseUrl });
    const schema = `theme_lifecycle_${randomUUID().replaceAll('-', '')}`;
    const migrationSql = await readFile(migrationUrl, 'utf8');
    const identities = [
      '31000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000002',
    ];
    const serviceNow = new Date('2026-09-26T12:00:00.000Z');
    let connected = false;
    let schemaCreated = false;
    let pool: pg.Pool | null = null;

    try {
      await admin.connect();
      connected = true;
      await admin.query(`CREATE SCHEMA ${schema}`);
      schemaCreated = true;
      await admin.query(`SET search_path TO ${schema}`);
      await admin.query('CREATE TABLE users (id varchar PRIMARY KEY)');
      await admin.query('CREATE TABLE questions (id varchar PRIMARY KEY)');
      await admin.query(migrationSql);
      for (const [index, identityId] of identities.entries()) {
        await admin.query(
          `INSERT INTO theme_participant_identities
             (id, kind, stable_key_hash, account_user_id)
           VALUES ($1, 'guest_browser', $2, NULL)`,
          [identityId, String(index + 1).repeat(64)]
        );
      }

      pool = new Pool({
        connectionString: databaseUrl,
        max: 6,
        options: `-c search_path=${schema}`,
      });
      const repository = createPostgresThemeLifecycleRepository(pool);
      const input: CreateThemeLifecycleInput = {
        request: {
          contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
          idempotencyKey: 'postgres-theme-game-0001',
          mode: 'multiplayer',
          theme: 'Baseball history',
          themeSlug: 'baseball-history',
          relatedCategories: ['Sports'],
          playerCount: 2,
        },
        ownerKey: 'postgres-owner-1',
        roster: identities.map((identityId) => ({ identityId })),
        expiresAt: new Date(Date.now() + 86_400_000),
      };

      const creatorA = createThemeLifecycleService({ repository, now: () => serviceNow });
      const creatorB = createThemeLifecycleService({ repository, now: () => serviceNow });
      const creations = await Promise.all([creatorA.createGame(input), creatorB.createGame(input)]);
      expect(new Set(creations.map(({ game }) => game.id)).size).toBe(1);
      expect(new Set(creations.map(({ job }) => job.id)).size).toBe(1);
      expect(creations.filter(({ created }) => created)).toHaveLength(1);

      await expect(
        creatorA.createGame({ ...input, ownerKey: 'different-owner' })
      ).rejects.toMatchObject({ code: 'idempotency_conflict' });
      const idempotentCounts = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM theme_game_sessions WHERE idempotency_key = $1) AS games,
           (SELECT count(*)::int FROM theme_preparation_jobs) AS jobs,
           (SELECT count(*)::int FROM theme_game_participants) AS participants`,
        [input.request.idempotencyKey]
      );
      expect(idempotentCounts.rows[0]).toEqual({ games: 1, jobs: 1, participants: 2 });

      const rollbackInput: CreateThemeLifecycleInput = {
        ...input,
        request: { ...input.request, idempotencyKey: 'postgres-theme-game-rollback' },
        roster: [input.roster[0], { identityId: randomUUID() }],
      };
      await expect(creatorA.createGame(rollbackInput)).rejects.toMatchObject({ code: '23503' });
      const rollbackCounts = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM theme_game_sessions WHERE idempotency_key = $1) AS games,
           (SELECT count(*)::int FROM theme_preparation_jobs AS job
             JOIN theme_game_sessions AS game ON game.id = job.game_id
            WHERE game.idempotency_key = $1) AS jobs`,
        [rollbackInput.request.idempotencyKey]
      );
      expect(rollbackCounts.rows[0]).toEqual({ games: 0, jobs: 0 });

      const jobId = creations[0].job.id;
      const workerA = createThemeLifecycleService({
        repository,
        now: () => new Date('2100-01-01T00:00:00.000Z'),
        claimToken: () => 'postgres-claim-a',
      });
      const workerB = createThemeLifecycleService({
        repository,
        now: () => new Date('2000-01-01T00:00:00.000Z'),
        claimToken: () => 'postgres-claim-b',
      });
      const claims = await Promise.allSettled([
        workerA.acquireLease(jobId, 10_000),
        workerB.acquireLease(jobId, 10_000),
      ]);
      expect(claims.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(claims.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      const winningClaim = claims.find(
        (
          claim
        ): claim is PromiseFulfilledResult<Awaited<ReturnType<typeof workerA.acquireLease>>> =>
          claim.status === 'fulfilled'
      )!;
      expect(winningClaim.value.job.leaseExpiresAt!.getUTCFullYear()).toBeLessThan(2100);

      const token = winningClaim.value.claimToken;
      const casResults = await Promise.all([
        repository.transitionJob({
          jobId,
          claimToken: token,
          expectedStatus: 'queued',
          status: 'researching',
          publicStage: 'researching',
          now: serviceNow,
        }),
        repository.transitionJob({
          jobId,
          claimToken: token,
          expectedStatus: 'queued',
          status: 'waiting',
          publicStage: 'paused',
          now: serviceNow,
        }),
      ]);
      expect(casResults.filter(Boolean)).toHaveLength(1);

      await pool.query(
        `UPDATE theme_preparation_jobs
            SET lease_owner = NULL, lease_expires_at = NULL, status = 'queued', public_stage = 'waiting'
          WHERE id = $1`,
        [jobId]
      );
      const lockClient = await pool.connect();
      try {
        await lockClient.query('BEGIN');
        await lockClient.query('SELECT id FROM theme_preparation_jobs WHERE id = $1 FOR UPDATE', [
          jobId,
        ]);
        const acquiredAt = Date.now();
        const delayedClaimPromise = workerA.acquireLease(jobId, 1_000);
        await new Promise((resolve) => setTimeout(resolve, 150));
        await lockClient.query('COMMIT');
        const delayedClaim = await delayedClaimPromise;
        expect(delayedClaim.job.leaseExpiresAt!.getTime() - acquiredAt).toBeGreaterThan(800);
      } finally {
        await lockClient.query('ROLLBACK').catch(() => undefined);
        lockClient.release();
      }

      await pool.query(
        `UPDATE theme_preparation_jobs
            SET lease_expires_at = clock_timestamp() - interval '1 second'
          WHERE id = $1`,
        [jobId]
      );
      const recovery = createThemeLifecycleService({
        repository,
        now: () => new Date('1900-01-01T00:00:00.000Z'),
        claimToken: () => 'postgres-claim-recovered',
      });
      const reclaimed = await recovery.acquireLease(jobId, 10_000);
      expect(reclaimed.claimToken).toBe('postgres-claim-recovered');
      await expect(workerA.renewLease(jobId, 'postgres-claim-a', 1_000)).rejects.toMatchObject({
        code: 'stale_lease',
      });

      await pool.query("UPDATE theme_game_sessions SET status = 'expired' WHERE id = $1", [
        creations[0].game.id,
      ]);
      await expect(
        recovery.renewLease(jobId, 'postgres-claim-recovered', 1_000)
      ).rejects.toMatchObject({ code: 'stale_lease' });
      expect(
        await repository.transitionJob({
          jobId,
          claimToken: 'postgres-claim-recovered',
          expectedStatus: 'queued',
          status: 'researching',
          publicStage: 'researching',
          now: serviceNow,
        })
      ).toBeNull();
      expect((await recovery.terminalizeJob(jobId, 'expired')).status).toBe('expired');
      await expect(recovery.acquireLease(jobId, 1_000)).rejects.toMatchObject({
        code: 'terminal_job',
      });
    } finally {
      if (pool) await pool.end().catch(() => undefined);
      if (connected) {
        if (schemaCreated) {
          await admin.query('SET search_path TO public').catch(() => undefined);
          await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
        }
        await admin.end().catch(() => undefined);
      }
    }
  });
});
