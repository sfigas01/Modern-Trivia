import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import {
  persistThemeSemanticBatch,
  recordThemeProviderMetadata,
} from './theme-provider-persistence';

const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;

describe('S12B-3 provider persistence migration', () => {
  it('declares exact candidate bindings, bounded snapshots, and append-only triggers', async () => {
    const sql = await readFile(
      new URL('../../migrations/0020_theme_provider_runtime_persistence.sql', import.meta.url),
      'utf8'
    );
    expect(sql).toContain('fk_theme_semantic_batch_candidate_content');
    expect(sql).toContain('REFERENCES theme_candidates(id, content_hash)');
    expect(sql).toContain('octet_length(pair_snapshot::text) <= 262144');
    expect(sql).toContain('theme_job_attempt_provider_metadata_immutable');
    expect(sql).toContain('theme_semantic_adjudication_batches_immutable');
  });
});

describe.runIf(Boolean(databaseUrl))('S12B-3 provider PostgreSQL persistence', () => {
  it('reruns safely and enforces exact replay, content binding, and immutability', async () => {
    const admin = new pg.Client({ connectionString: databaseUrl });
    const schema = `theme_provider_${randomUUID().replaceAll('-', '')}`;
    let pool: pg.Pool | null = null;
    let connected = false;
    let created = false;
    try {
      await admin.connect();
      connected = true;
      await admin.query(`CREATE SCHEMA ${schema}`);
      created = true;
      await admin.query(`SET search_path TO ${schema}`);
      await admin.query('CREATE TABLE theme_job_attempts (id uuid PRIMARY KEY)');
      await admin.query(`CREATE TABLE theme_candidates (
        id uuid PRIMARY KEY,
        content_hash varchar(64) NOT NULL,
        UNIQUE (id, content_hash)
      )`);
      const migration = await readFile(
        new URL('../../migrations/0020_theme_provider_runtime_persistence.sql', import.meta.url),
        'utf8'
      );
      await admin.query(migration);
      await admin.query(migration);

      pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
      const attemptId = randomUUID();
      const candidateId = randomUUID();
      const contentHash = 'a'.repeat(64);
      await pool.query('INSERT INTO theme_job_attempts(id) VALUES ($1)', [attemptId]);
      await pool.query('INSERT INTO theme_candidates(id, content_hash) VALUES ($1, $2)', [
        candidateId,
        contentHash,
      ]);

      const metadataClient = await pool.connect();
      try {
        const metadata = {
          providerRequestId: 'request-1',
          returnedModel: 'model-1',
          latencyMs: 12,
        };
        await recordThemeProviderMetadata(metadataClient, attemptId, metadata);
        await recordThemeProviderMetadata(metadataClient, attemptId, metadata);
      } finally {
        metadataClient.release();
      }
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM theme_job_attempt_provider_metadata'))
          .rows[0].count
      ).toBe(1);

      const request = {
        candidateId,
        candidateContentHash: contentHash,
        semanticPolicyFingerprint: 'b'.repeat(64),
        pairs: [{ pairKey: 'pair-1', input: { claim: 'bounded fixture' } }],
      };
      const first = await pool.connect();
      try {
        await persistThemeSemanticBatch(first, request);
        await persistThemeSemanticBatch(first, structuredClone(request));
      } finally {
        first.release();
      }
      expect(
        (await pool.query('SELECT pair_snapshot FROM theme_semantic_adjudication_batches')).rows[0]
          .pair_snapshot
      ).toEqual(request.pairs);

      const conflict = await pool.connect();
      try {
        await expect(
          persistThemeSemanticBatch(conflict, {
            ...request,
            pairs: [{ pairKey: 'pair-1', input: { claim: 'changed fixture' } }],
          })
        ).rejects.toMatchObject({ name: 'ThemeProviderPersistenceConflictError' });
      } finally {
        conflict.release();
      }
      await expect(
        pool.query(
          `INSERT INTO theme_semantic_adjudication_batches
           (candidate_id, candidate_content_hash, semantic_policy_fingerprint, pair_snapshot, pair_fingerprint)
           VALUES ($1, $2, $3, '[]'::jsonb, $4)`,
          [randomUUID(), 'c'.repeat(64), 'd'.repeat(64), 'e'.repeat(64)]
        )
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        pool.query('UPDATE theme_job_attempt_provider_metadata SET latency_ms = 13')
      ).rejects.toMatchObject({ code: '55000' });
      await expect(
        pool.query('DELETE FROM theme_semantic_adjudication_batches')
      ).rejects.toMatchObject({ code: '55000' });
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
