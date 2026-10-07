import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;

describe('S10 approval migration', () => {
  it('declares immutable exact provenance and library-revision bindings', async () => {
    const sql = await readFile(
      new URL('../../migrations/0016_theme_question_approvals.sql', import.meta.url),
      'utf8'
    );
    for (const name of [
      'fk_theme_question_approval_candidate',
      'fk_theme_question_approval_generation',
      'fk_theme_question_approval_evidence',
      'fk_theme_question_approval_library_revision',
      'theme_question_approvals_immutable',
    ])
      expect(sql).toContain(name);
    expect(sql).toContain('question_content_hash varchar(64) NOT NULL');
    expect(sql).toContain('corpus_hash varchar(64) NOT NULL');
  });
});

describe.runIf(Boolean(databaseUrl))('S10 approval PostgreSQL migration', () => {
  it('reruns safely and installs exact FKs, uniqueness and immutable trigger', async () => {
    const db = new pg.Client({ connectionString: databaseUrl });
    const schema = `theme_approval_${randomUUID().replaceAll('-', '')}`;
    let connected = false;
    let created = false;
    try {
      await db.connect();
      connected = true;
      await db.query(`CREATE SCHEMA ${schema}`);
      created = true;
      await db.query(`SET search_path TO ${schema}`);
      await db.query('CREATE TABLE users (id varchar PRIMARY KEY)');
      await db.query('CREATE TABLE questions (id varchar PRIMARY KEY)');
      for (const file of [
        '0009_theme_reliability_foundation.sql',
        '0010_theme_source_registry.sql',
      ])
        await db.query(
          await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8')
        );
      await db.query(
        'CREATE UNIQUE INDEX uq_theme_fact_revisions_id_hash ON theme_fact_revisions (id, content_hash)'
      );
      await db.query(
        await readFile(
          new URL('../../migrations/0011_theme_fact_derivation_provenance.sql', import.meta.url),
          'utf8'
        )
      );
      await db.query(
        'CREATE UNIQUE INDEX uq_theme_fact_derivation_outcome_review_binding ON theme_fact_derivation_outcomes (attempt_id, fact_revision_id, fact_content_hash)'
      );
      for (const file of [
        '0012_theme_fact_reviews.sql',
        '0013_theme_question_candidates.sql',
        '0014_theme_question_evidence_reviews.sql',
        '0015_theme_question_repairs.sql',
      ])
        await db.query(
          await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8')
        );
      const approval = await readFile(
        new URL('../../migrations/0016_theme_question_approvals.sql', import.meta.url),
        'utf8'
      );
      await db.query(approval);
      await db.query(approval);
      const constraints = await db.query(
        `SELECT conname FROM pg_constraint
         WHERE connamespace = $1::regnamespace AND conrelid = 'theme_question_approvals'::regclass`,
        [schema]
      );
      expect(constraints.rows.map((row: { conname: string }) => row.conname)).toEqual(
        expect.arrayContaining([
          'fk_theme_question_approval_candidate',
          'fk_theme_question_approval_generation',
          'fk_theme_question_approval_evidence',
          'fk_theme_question_approval_library_revision',
          'theme_question_approval_required_text',
        ])
      );
      const trigger = await db.query(
        `SELECT tgname FROM pg_trigger WHERE tgrelid = 'theme_question_approvals'::regclass AND NOT tgisinternal`
      );
      expect(trigger.rows).toEqual(
        expect.arrayContaining([{ tgname: 'theme_question_approvals_immutable' }])
      );
    } finally {
      if (connected) {
        if (created) await db.query(`DROP SCHEMA ${schema} CASCADE`);
        await db.end();
      }
    }
  });
});
