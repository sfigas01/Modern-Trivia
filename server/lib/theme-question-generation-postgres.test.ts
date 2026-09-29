import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;

describe.runIf(Boolean(databaseUrl))('theme question generation PostgreSQL migration', () => {
  it('reruns after db:push-style unique indexes and enforces append-only exact bindings', async () => {
    const admin = new pg.Client({ connectionString: databaseUrl });
    const schema = `theme_question_${randomUUID().replaceAll('-', '')}`;
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

      const migration = await readFile(
        new URL('../../migrations/0013_theme_question_candidates.sql', import.meta.url),
        'utf8'
      );
      // db:push commonly materializes these unique indexes before migrations run.
      await admin.query(
        'CREATE UNIQUE INDEX uq_theme_fact_review_outcome_attempt_verdict_hash ON theme_fact_review_outcomes (attempt_id, aggregate_verdict, output_hash)'
      );
      await admin.query(
        'CREATE UNIQUE INDEX uq_theme_candidates_exact_binding ON theme_candidates (id, job_id, ordinal, fact_id, fact_revision_id, content_hash)'
      );
      await admin.query(
        'CREATE UNIQUE INDEX uq_theme_question_revisions_candidate_binding ON theme_question_revisions (id, candidate_id, content_hash)'
      );
      await admin.query(migration);
      await admin.query(migration);

      const columns = await admin.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name IN
           ('theme_question_generation_attempts', 'theme_question_generation_outcomes')`,
        [schema]
      );
      expect(columns.rows).toEqual(
        expect.arrayContaining([
          { table_name: 'theme_question_generation_attempts', column_name: 'input_manifest' },
          {
            table_name: 'theme_question_generation_attempts',
            column_name: 'eligibility_fingerprint',
          },
          {
            table_name: 'theme_question_generation_outcomes',
            column_name: 'question_content_hash',
          },
        ])
      );
      const triggers = await admin.query(
        `SELECT tgname FROM pg_trigger WHERE tgrelid IN (
           'theme_question_generation_attempts'::regclass,
           'theme_question_generation_outcomes'::regclass) AND NOT tgisinternal`
      );
      expect(triggers.rows.map((row) => row.tgname)).toEqual(
        expect.arrayContaining([
          'theme_question_generation_attempts_immutable',
          'theme_question_generation_outcomes_immutable',
        ])
      );
      const targetReservationIndexes = await admin.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = $1 AND tablename = 'theme_question_generation_attempts'`,
        [schema]
      );
      expect(targetReservationIndexes.rows.map((row) => row.indexname)).toEqual(
        expect.arrayContaining([
          'uq_theme_question_generation_candidate_id',
          'uq_theme_question_generation_question_revision_id',
        ])
      );
      const outcomeConstraint = await admin.query(
        `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
         WHERE connamespace = $1::regnamespace AND conname = 'theme_question_generation_outcome_fields'`,
        [schema]
      );
      expect(outcomeConstraint.rows[0]?.definition).toContain('failure_code');
    } finally {
      if (connected && created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      if (connected) await admin.end();
    }
  });
});
