import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { createPostgresThemeRuntimeCheckpoints } from './theme-runtime-pipeline';

const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;

describe.runIf(Boolean(databaseUrl))('theme runtime checkpoints PostgreSQL reads', () => {
  it('loads passage_text in the requested passage order', async () => {
    const admin = new pg.Client({ connectionString: databaseUrl });
    const schema = `theme_checkpoints_${randomUUID().replaceAll('-', '')}`;
    let pool: pg.Pool | null = null;
    let connected = false;
    let created = false;
    try {
      await admin.connect();
      connected = true;
      await admin.query(`CREATE SCHEMA ${schema}`);
      created = true;
      await admin.query(`SET search_path TO ${schema}`);
      await admin.query(`CREATE TABLE theme_evidence_passages (
        id uuid PRIMARY KEY,
        passage_text text NOT NULL,
        content_hash varchar(64) NOT NULL
      )`);

      pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
      const firstId = randomUUID();
      const secondId = randomUUID();
      await pool.query(
        `INSERT INTO theme_evidence_passages (id,passage_text,content_hash)
         VALUES ($1,'First passage',$2),($3,'Second passage',$4)`,
        [firstId, 'a'.repeat(64), secondId, 'b'.repeat(64)]
      );

      const checkpoints = createPostgresThemeRuntimeCheckpoints(pool);
      await expect(checkpoints.passages([secondId, firstId])).resolves.toEqual([
        { passageId: secondId, text: 'Second passage', contentHash: 'b'.repeat(64) },
        { passageId: firstId, text: 'First passage', contentHash: 'a'.repeat(64) },
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
