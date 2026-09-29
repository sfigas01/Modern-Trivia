import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;

describe.runIf(Boolean(databaseUrl))('theme fact review PostgreSQL persistence', () => {
  it('supports migration reruns, precreated indexes, exact bindings, and append-only rows', async () => {
    const admin = new pg.Client({ connectionString: databaseUrl });
    const schema = `theme_review_${randomUUID().replaceAll('-', '')}`;
    let pool: pg.Pool | null = null;
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
      const migration = await readFile(
        new URL('../../migrations/0012_theme_fact_reviews.sql', import.meta.url),
        'utf8'
      );
      // Simulate db:push creating this unique index before the SQL migration runs.
      await admin.query(
        'CREATE UNIQUE INDEX uq_theme_fact_derivation_outcome_review_binding ON theme_fact_derivation_outcomes (attempt_id, fact_revision_id, fact_content_hash)'
      );
      await admin.query(migration);
      await admin.query(migration);
      pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });

      const reviewColumns = await pool.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name IN ('theme_fact_review_attempts', 'theme_fact_review_outcomes')`,
        [schema]
      );
      expect(reviewColumns.rows).toEqual(
        expect.arrayContaining([
          { table_name: 'theme_fact_review_attempts', column_name: 'policy_snapshot' },
          { table_name: 'theme_fact_review_attempts', column_name: 'input_manifest' },
          { table_name: 'theme_fact_review_outcomes', column_name: 'aggregate_verdict' },
          { table_name: 'theme_fact_review_outcomes', column_name: 'failure_code' },
        ])
      );
      const checks = await pool.query(
        `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
         WHERE connamespace = $1::regnamespace AND conname = 'theme_fact_review_outcome_fields'`,
        [schema]
      );
      expect(checks.rows[0]?.definition).toContain('aggregate_verdict IS NOT NULL');
      expect(checks.rows[0]?.definition).toContain('failure_code IS NOT NULL');

      const factId = randomUUID();
      const revisionId = randomUUID();
      const derivationAttemptId = randomUUID();
      const producerExecutionId = randomUUID();
      const reviewAttemptId = randomUUID();
      const reviewExecutionId = randomUUID();
      const factHash = 'a'.repeat(64);
      await pool.query('INSERT INTO theme_facts (id, canonical_key) VALUES ($1, $2)', [
        factId,
        'test-fact',
      ]);
      await pool.query(
        `INSERT INTO theme_fact_revisions
         (id, fact_id, contract_version, revision, statement, scope, canonical_answer,
          supported_aliases, content_hash, time_sensitive)
         VALUES ($1,$2,'theme-reliability-v1',1,'Statement','{}','Answer','[]',$3,false)`,
        [revisionId, factId, factHash]
      );
      await pool.query(
        `INSERT INTO theme_fact_derivation_attempts
         (id, contract_version, canonical_key, requested_revision_id, expected_latest_revision,
          derivation_policy_version, policy_snapshot, policy_hash, prompt_version, prompt_hash,
          input_manifest, input_fingerprint, producer_kind, producer_id, provider, model, execution_id)
         VALUES ($1,'theme-fact-derivation-provenance-v1','test-fact',$2,0,'policy','{}',$3,
          'prompt',$3,'{}',$3,'model','producer','provider-a','model-a',$4)`,
        [derivationAttemptId, revisionId, 'b'.repeat(64), producerExecutionId]
      );
      await pool.query(
        `INSERT INTO theme_fact_derivation_outcomes
         (attempt_id, outcome, proposal_snapshot, output_hash, fact_revision_id,
          fact_content_hash, bindings_fingerprint)
         VALUES ($1,'persisted','{}',$2,$3,$4,$5)`,
        [derivationAttemptId, 'c'.repeat(64), revisionId, factHash, 'd'.repeat(64)]
      );
      const reviewHeader = [
        reviewAttemptId,
        derivationAttemptId,
        revisionId,
        factHash,
        'e'.repeat(64),
        reviewExecutionId,
      ];
      await pool.query(
        `INSERT INTO theme_fact_review_attempts
         (id, contract_version, derivation_attempt_id, fact_revision_id, fact_content_hash,
          review_sequence, review_policy_version, policy_snapshot, policy_hash, prompt_version, prompt_hash,
          input_manifest, input_fingerprint, reviewer_kind, reviewer_id, provider, model,
          execution_id, evaluated_at)
         VALUES ($1,'theme-fact-review-v1',$2,$3,$4,1,'review-policy','{}',$5,'review-prompt',$5,
          '{}',$5,'model','independent-reviewer','provider-b','model-b',$6,now())`,
        reviewHeader
      );
      await pool.query(
        `INSERT INTO theme_fact_review_outcomes
         (attempt_id, status, aggregate_verdict, dimensions, output_hash, valid_until)
         VALUES ($1,'reviewed','pass',$2::jsonb,$3,now() + interval '1 day')`,
        [
          reviewAttemptId,
          JSON.stringify({
            entailment: {},
            scope: {},
            canonical_answer: {},
            aliases: {},
            conflict: {},
            source_independence: {},
          }),
          'f'.repeat(64),
        ]
      );
      await expect(
        pool.query('UPDATE theme_fact_review_attempts SET reviewer_id = reviewer_id')
      ).rejects.toMatchObject({ code: '55000' });
      await expect(
        pool.query('DELETE FROM theme_fact_review_outcomes WHERE attempt_id = $1', [
          reviewAttemptId,
        ])
      ).rejects.toMatchObject({ code: '55000' });
      const secondAttemptId = randomUUID();
      await expect(
        pool.query(
          `INSERT INTO theme_fact_review_attempts
         (id, contract_version, derivation_attempt_id, fact_revision_id, fact_content_hash,
          review_sequence, review_policy_version, policy_snapshot, policy_hash, prompt_version, prompt_hash,
          input_manifest, input_fingerprint, reviewer_kind, reviewer_id, provider, model,
          execution_id, evaluated_at)
         VALUES ($1,'theme-fact-review-v1',$2,$3,$4,2,'review-policy','{}',$5,'review-prompt',$5,
          '{}',$5,'model','reviewer','provider-b','model-b',$6,now())`,
          [secondAttemptId, randomUUID(), revisionId, factHash, 'e'.repeat(64), randomUUID()]
        )
      ).rejects.toMatchObject({ code: '23503' });
      const insertHeader = async (id: string, sequence: number) =>
        pool!.query(
          `INSERT INTO theme_fact_review_attempts
           (id, contract_version, derivation_attempt_id, fact_revision_id, fact_content_hash,
            review_sequence, review_policy_version, policy_snapshot, policy_hash, prompt_version, prompt_hash,
            input_manifest, input_fingerprint, reviewer_kind, reviewer_id, provider, model,
            execution_id, evaluated_at)
           VALUES ($1,'theme-fact-review-v1',$2,$3,$4,$5,'review-policy','{}',$6,'review-prompt',$6,
            '{}',$6,'model','independent-reviewer','provider-b','model-b',$7,now())`,
          [id, derivationAttemptId, revisionId, factHash, sequence, 'e'.repeat(64), randomUUID()]
        );
      const racingAttemptId = randomUUID();
      const firstClient = await pool.connect();
      const secondClient = await pool.connect();
      try {
        await firstClient.query('BEGIN');
        await firstClient.query('SELECT id FROM theme_fact_revisions WHERE id = $1 FOR UPDATE', [
          revisionId,
        ]);
        expect(
          (
            await firstClient.query('SELECT id FROM theme_fact_review_attempts WHERE id = $1', [
              racingAttemptId,
            ])
          ).rowCount
        ).toBe(0);
        await secondClient.query('BEGIN');
        expect(
          (
            await secondClient.query(
              'SELECT id FROM theme_fact_review_attempts WHERE id = $1 FOR UPDATE',
              [racingAttemptId]
            )
          ).rowCount
        ).toBe(0);
        const waitingRevisionLock = secondClient.query(
          'SELECT id FROM theme_fact_revisions WHERE id = $1 FOR UPDATE',
          [revisionId]
        );
        await firstClient.query(
          `INSERT INTO theme_fact_review_attempts
           (id, contract_version, derivation_attempt_id, fact_revision_id, fact_content_hash,
            review_sequence, review_policy_version, policy_snapshot, policy_hash, prompt_version, prompt_hash,
            input_manifest, input_fingerprint, reviewer_kind, reviewer_id, provider, model,
            execution_id, evaluated_at)
           VALUES ($1,'theme-fact-review-v1',$2,$3,$4,2,'review-policy','{}',$5,'review-prompt',$5,
            '{}',$5,'model','independent-reviewer','provider-b','model-b',$6,now())`,
          [racingAttemptId, derivationAttemptId, revisionId, factHash, 'e'.repeat(64), randomUUID()]
        );
        await firstClient.query('COMMIT');
        await waitingRevisionLock;
        const persistedAttempt = await secondClient.query(
          'SELECT id, review_sequence FROM theme_fact_review_attempts WHERE id = $1 FOR UPDATE',
          [racingAttemptId]
        );
        expect(persistedAttempt.rows).toEqual([{ id: racingAttemptId, review_sequence: 2 }]);
        await secondClient.query('COMMIT');
      } finally {
        firstClient.release();
        secondClient.release();
      }
      const nullVerdictAttempt = randomUUID();
      await insertHeader(nullVerdictAttempt, 3);
      await expect(
        pool.query(
          `INSERT INTO theme_fact_review_outcomes
           (attempt_id, status, aggregate_verdict, dimensions, output_hash, valid_until)
           VALUES ($1,'reviewed',NULL,$2::jsonb,$3,now() + interval '1 day')`,
          [
            nullVerdictAttempt,
            JSON.stringify({
              entailment: {},
              scope: {},
              canonical_answer: {},
              aliases: {},
              conflict: {},
              source_independence: {},
            }),
            'f'.repeat(64),
          ]
        )
      ).rejects.toMatchObject({ code: '23514' });
      const nullFailureAttempt = randomUUID();
      await insertHeader(nullFailureAttempt, 4);
      await expect(
        pool.query(
          `INSERT INTO theme_fact_review_outcomes
           (attempt_id, status, failure_code) VALUES ($1,'failed',NULL)`,
          [nullFailureAttempt]
        )
      ).rejects.toMatchObject({ code: '23514' });
      const index = await pool.query(
        "SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = 'uq_theme_fact_derivation_outcome_review_binding'",
        [schema]
      );
      expect(index.rowCount).toBe(1);
    } finally {
      await pool?.end();
      if (connected && created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      if (connected) await admin.end();
    }
  });
});
