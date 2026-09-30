import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;

describe.runIf(Boolean(databaseUrl))('S8a question review PostgreSQL migration', () => {
  it('reruns safely after Drizzle indexes and enforces exact immutable review bindings', async () => {
    const admin = new pg.Client({ connectionString: databaseUrl });
    const schema = `theme_question_review_${randomUUID().replaceAll('-', '')}`;
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
        '0010_theme_source_registry.sql',
      ])
        await admin.query(
          await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8')
        );
      await admin.query(
        'CREATE UNIQUE INDEX uq_theme_fact_revisions_id_hash ON theme_fact_revisions (id, content_hash)'
      );
      await admin.query(
        await readFile(
          new URL('../../migrations/0011_theme_fact_derivation_provenance.sql', import.meta.url),
          'utf8'
        )
      );
      await admin.query(
        'CREATE UNIQUE INDEX uq_theme_fact_derivation_outcome_review_binding ON theme_fact_derivation_outcomes (attempt_id, fact_revision_id, fact_content_hash)'
      );
      await admin.query(
        await readFile(
          new URL('../../migrations/0012_theme_fact_reviews.sql', import.meta.url),
          'utf8'
        )
      );
      await admin.query(
        await readFile(
          new URL('../../migrations/0013_theme_question_candidates.sql', import.meta.url),
          'utf8'
        )
      );
      const migration = await readFile(
        new URL('../../migrations/0014_theme_question_evidence_reviews.sql', import.meta.url),
        'utf8'
      );
      // Drizzle may materialize these indexes before the SQL migration runner.
      await admin.query(
        'CREATE UNIQUE INDEX uq_theme_evidence_reviews_id_revision_hash_verdict ON theme_evidence_reviews (id, question_revision_id, question_content_hash, verdict)'
      );
      await admin.query(
        'CREATE UNIQUE INDEX uq_theme_question_generation_review_binding ON theme_question_generation_attempts (id, candidate_id, question_revision_id, fact_revision_id)'
      );
      await admin.query(
        'CREATE UNIQUE INDEX uq_theme_question_generation_outcome_review_binding ON theme_question_generation_outcomes (attempt_id, candidate_id, question_revision_id, question_content_hash)'
      );
      await admin.query(migration);
      await admin.query(migration);
      const columns = await admin.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name IN ('theme_question_evidence_review_attempts','theme_question_evidence_review_outcomes')`,
        [schema]
      );
      expect(columns.rows).toEqual(
        expect.arrayContaining([
          { table_name: 'theme_question_evidence_review_attempts', column_name: 'review_sequence' },
          {
            table_name: 'theme_question_evidence_review_attempts',
            column_name: 'input_fingerprint',
          },
          { table_name: 'theme_question_evidence_review_outcomes', column_name: 'review_id' },
        ])
      );
      const constraints = await admin.query(
        `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
         WHERE connamespace = $1::regnamespace AND conname LIKE '%question_evidence_review%'`,
        [schema]
      );
      const names = constraints.rows.map((row) => row.conname);
      expect(names).toEqual(
        expect.arrayContaining([
          'fk_theme_question_evidence_review_question',
          'fk_theme_question_evidence_review_generation',
          'fk_theme_question_evidence_review_generation_outcome',
          'fk_theme_question_evidence_review_outcome_attempt',
          'fk_theme_question_evidence_review_outcome_review',
          'theme_question_evidence_review_outcome_fields',
        ])
      );
      expect(
        constraints.rows.find(
          (row) => row.conname === 'theme_question_evidence_review_outcome_fields'
        )?.definition
      ).toContain('review_id IS NOT NULL');
      expect(
        constraints.rows.find(
          (row) => row.conname === 'theme_question_evidence_review_outcome_fields'
        )?.definition
      ).toContain('verdict IS NOT NULL');
      expect(
        constraints.rows.find(
          (row) => row.conname === 'theme_question_evidence_review_outcome_fields'
        )?.definition
      ).toContain('failure_code IS NOT NULL');
      // CHECK constraints reject malformed terminal rows before FK triggers run.
      const missing = randomUUID();
      const candidate = randomUUID();
      const revision = randomUUID();
      const digest = 'a'.repeat(64);
      await expect(
        admin.query(
          `INSERT INTO theme_question_evidence_review_outcomes
         (attempt_id,candidate_id,question_revision_id,question_content_hash,status,failure_code)
         VALUES ($1,$2,$3,$4,'failed',NULL)`,
          [missing, candidate, revision, digest]
        )
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        admin.query(
          `INSERT INTO theme_question_evidence_review_outcomes
         (attempt_id,candidate_id,question_revision_id,question_content_hash,status,verdict,output_hash)
         VALUES ($1,$2,$3,$4,'reviewed','pass',$5)`,
          [missing, candidate, revision, digest, digest]
        )
      ).rejects.toMatchObject({ code: '23514' });
      const triggers = await admin.query(
        `SELECT tgname FROM pg_trigger WHERE tgrelid IN
         ('theme_question_evidence_review_attempts'::regclass,'theme_question_evidence_review_outcomes'::regclass)
         AND NOT tgisinternal`
      );
      expect(triggers.rows.map((row) => row.tgname)).toEqual(
        expect.arrayContaining([
          'theme_question_evidence_review_attempts_immutable',
          'theme_question_evidence_review_outcomes_immutable',
        ])
      );
    } finally {
      if (connected && created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      if (connected) await admin.end();
    }
  });
});
