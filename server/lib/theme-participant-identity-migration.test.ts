import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;
const migrationUrl = new URL(
  '../../migrations/0023_theme_participant_identity_uniqueness.sql',
  import.meta.url
);

describe('theme participant identity uniqueness migration contract', () => {
  it('adds the conflict arbiter required by identity upserts', async () => {
    const sql = await readFile(migrationUrl, 'utf8');

    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_theme_participant_identities_kind_hash'
    );
    expect(sql).toContain('ON theme_participant_identities (kind, stable_key_hash)');
    expect(sql).not.toMatch(/DELETE\s+FROM\s+theme_participant_identities/i);
  });
});

describe.runIf(Boolean(databaseUrl))(
  'theme participant identity uniqueness repair on PostgreSQL',
  () => {
    it('repairs a pre-existing table and makes identity upserts idempotent', async () => {
      const client = new pg.Client({ connectionString: databaseUrl });
      const schema = `theme_identity_repair_${randomUUID().replaceAll('-', '')}`;
      const migrationSql = await readFile(migrationUrl, 'utf8');
      const stableKeyHash = 'a'.repeat(64);

      await client.connect();
      try {
        await client.query(`CREATE SCHEMA ${schema}`);
        await client.query(`SET search_path TO ${schema}`);
        await client.query(`
          CREATE TABLE theme_participant_identities (
            id uuid PRIMARY KEY,
            kind varchar(20) NOT NULL,
            stable_key_hash varchar(64) NOT NULL,
            account_user_id varchar,
            last_seen_at timestamptz NOT NULL DEFAULT now()
          )
        `);
        const identityId = randomUUID();
        await client.query(
          `INSERT INTO theme_participant_identities
             (id, kind, stable_key_hash, account_user_id)
           VALUES ($1, 'account', $2, 'user-1')`,
          [identityId, stableKeyHash]
        );

        await client.query(migrationSql);
        await client.query(migrationSql);

        const result = await client.query(
          `INSERT INTO theme_participant_identities
             (id, kind, stable_key_hash, account_user_id)
           VALUES ($1, 'account', $2, 'user-1')
           ON CONFLICT (kind, stable_key_hash)
           DO UPDATE SET last_seen_at = clock_timestamp()
           RETURNING id`,
          [randomUUID(), stableKeyHash]
        );

        expect(result.rows).toEqual([{ id: identityId }]);
        const count = await client.query(
          `SELECT count(*)::int AS count FROM theme_participant_identities`
        );
        expect(count.rows).toEqual([{ count: 1 }]);
      } finally {
        await client.query('RESET search_path').catch(() => {});
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
        await client.end();
      }
    });
  }
);
