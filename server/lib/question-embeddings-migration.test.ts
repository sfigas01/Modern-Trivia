import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

// Explicit opt-in prevents the regular suite from touching an application database.
// Supply only a disposable PostgreSQL database via this test-specific variable.
const databaseUrl = process.env.STE26_MIGRATION_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))('embedding migration on PostgreSQL', () => {
  it.each(['fresh', 'precreated'] as const)(
    'enforces checks on %s tables and reruns safely',
    async (mode) => {
      const client = new pg.Client({ connectionString: databaseUrl });
      const schema = `ste26_${randomUUID().replaceAll('-', '')}`;
      await client.connect();
      try {
        await client.query(`CREATE SCHEMA ${schema}`);
        await client.query(`SET search_path TO ${schema}`);
        await client.query('CREATE TABLE questions (id varchar PRIMARY KEY)');
        if (mode === 'precreated') {
          // Drizzle db:push creates the declared columns/FK before SQL migrations,
          // without the raw-SQL CHECK constraints that this migration must install.
          await client.query(`CREATE TABLE question_embeddings (
          question_id varchar PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
          content_hash text NOT NULL, model text NOT NULL, dimensions integer NOT NULL,
          purpose text NOT NULL, vector jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
        )`);
          await client.query("INSERT INTO questions VALUES ('existing')");
          await client.query(
            "INSERT INTO question_embeddings VALUES ('existing','hash','model',2,'question','[1,0]')"
          );
        }
        const sql = await readFile(
          new URL('../../migrations/0007_question_embeddings.sql', import.meta.url),
          'utf8'
        );
        await client.query(sql);
        await client.query(sql);
        const checks = await client.query(
          "SELECT conname FROM pg_constraint WHERE conrelid = 'question_embeddings'::regclass AND contype = 'c'"
        );
        expect(checks.rowCount).toBe(3);
        await client.query("INSERT INTO questions VALUES ('test')");
        for (const [dimensions, vector] of [
          [0, '[]'],
          [1, '{}'],
          [2, '[1]'],
        ] as const) {
          await expect(
            client.query(
              "INSERT INTO question_embeddings VALUES ('test','hash','model',$1,'question',$2::jsonb)",
              [dimensions, vector]
            )
          ).rejects.toMatchObject({ code: '23514' });
        }
        await client.query(
          "INSERT INTO question_embeddings VALUES ('test','hash','model',2,'question','[1,0]')"
        );
        const count = await client.query('SELECT count(*)::int AS n FROM question_embeddings');
        expect(count.rows[0].n).toBe(mode === 'precreated' ? 2 : 1);
      } finally {
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.end();
      }
    }
  );
});
