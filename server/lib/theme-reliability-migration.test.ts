import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

// Explicit opt-in: this test must only receive a disposable PostgreSQL database.
const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;
const migrationUrl = new URL(
  '../../migrations/0009_theme_reliability_foundation.sql',
  import.meta.url
);

describe('theme reliability migration contract', () => {
  it('contains the exact binding and append-only invariants required by the foundation', async () => {
    const sql = await readFile(migrationUrl, 'utf8');

    expect(sql).toContain('fk_theme_question_reservations_question_revision');
    expect(sql).toContain('fk_theme_preparation_jobs_game_ceiling');
    expect(sql).toContain('fk_theme_question_reservations_fact_revision');
    expect(sql).toContain('fk_theme_reservation_participants_reservation_fact');
    expect(sql).toContain('theme_fact_revisions_immutable');
    expect(sql).toContain('theme_evidence_passages_immutable');
    expect(sql).toContain('candidate_slots_consumed BETWEEN 0 AND 100');
    expect(sql).not.toContain('uq_theme_evidence_reviews_revision_contract');
    expect(sql).not.toContain('uq_theme_evidence_documents_url_hash');
  });
});

describe('fact derivation provenance migration contract', () => {
  it('adds exact revision hash binding and append-only attempt and outcome rows', async () => {
    const sql = await readFile(
      new URL('../../migrations/0011_theme_fact_derivation_provenance.sql', import.meta.url),
      'utf8'
    );
    expect(sql).toContain('uq_theme_fact_revisions_id_hash UNIQUE (id, content_hash)');
    expect(sql).toContain('REFERENCES theme_fact_revisions(id, content_hash)');
    expect(sql).toContain(
      'uq_theme_fact_derivation_attempt_revision UNIQUE (id, requested_revision_id)'
    );
    expect(sql).toContain('FOREIGN KEY (attempt_id, fact_revision_id)');
    expect(sql).toContain('REFERENCES theme_fact_derivation_attempts(id, requested_revision_id)');
    expect(sql).toContain('uq_theme_fact_derivation_outcome_revision UNIQUE (fact_revision_id)');
    expect(sql).toContain('theme_fact_derivation_attempts_immutable');
    expect(sql).toContain('theme_fact_derivation_outcomes_immutable');
    expect(sql).toContain("outcome = 'persisted'");
    expect(sql).toContain("outcome IN ('invalid_output', 'failed')");
  });
});

describe.runIf(Boolean(databaseUrl))('theme reliability foundation migration on PostgreSQL', () => {
  it('reruns safely and enforces exact-review, history, reservation, and budget invariants', async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    const schema = `theme_reliability_${randomUUID().replaceAll('-', '')}`;
    const migrationSql = await readFile(migrationUrl, 'utf8');
    const hash = (character: string) => character.repeat(64);

    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query('CREATE TABLE users (id varchar PRIMARY KEY)');
      await client.query('CREATE TABLE questions (id varchar PRIMARY KEY)');

      await client.query(migrationSql);
      await client.query(migrationSql);

      await client.query("INSERT INTO users (id) VALUES ('user-1')");
      await client.query("INSERT INTO questions (id) VALUES ('q-1'), ('q-2')");
      const gameOne = randomUUID();
      const gameTwo = randomUUID();
      const gameValues = [
        'theme-reliability-v1',
        'multiplayer',
        'baseball history',
        'baseball-history',
        JSON.stringify(['Sports']),
        2,
        40,
        30,
        10,
        50,
        16,
        12,
        4,
      ];
      for (const [gameId, key] of [
        [gameOne, 'game-key-one-0001'],
        [gameTwo, 'game-key-two-0002'],
      ]) {
        await client.query(
          `INSERT INTO theme_game_sessions
           (id, contract_version, idempotency_key, mode, theme, theme_slug, related_categories,
            player_count, question_count, themed_question_target, related_question_target,
            candidate_ceiling, opening_question_target, opening_themed_target,
            opening_related_target, idempotency_owner_hash, request_fingerprint, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now() + interval '1 day')`,
          [gameId, gameValues[0], key, ...gameValues.slice(1), hash('8'), hash('9')]
        );
      }
      await expect(
        client.query(
          `INSERT INTO theme_game_sessions
           (contract_version, idempotency_key, idempotency_owner_hash, request_fingerprint,
            mode, status, theme, theme_slug, related_categories, player_count, question_count,
            themed_question_target, related_question_target, candidate_ceiling,
            opening_question_target, opening_themed_target, opening_related_target,
            mix_consent_status, mix_decision_by_hash, mix_decided_at, expires_at)
           VALUES ('theme-reliability-v1', 'invalid-consent-0001', $1, $2, 'multiplayer',
                   'awaiting_mix_consent', 'baseball history', 'baseball-history',
                   '["Sports"]'::jsonb, 2, 40, 30, 10, 50, 16, 12, 4, 'accepted', $3,
                   now(), now() + interval '1 day')`,
          [hash('2'), hash('3'), hash('4')]
        )
      ).rejects.toMatchObject({ code: '23514' });

      const identityId = randomUUID();
      await client.query(
        `INSERT INTO theme_participant_identities (id, kind, stable_key_hash, account_user_id)
         VALUES ($1, 'account', $2, 'user-1')`,
        [identityId, hash('a')]
      );
      const factId = randomUUID();
      const factRevisionId = randomUUID();
      const secondFactRevisionId = randomUUID();
      await client.query(
        `INSERT INTO theme_facts (id, canonical_key)
         VALUES ($1, 'event:first-final:location')`,
        [factId]
      );
      await client.query(
        `INSERT INTO theme_fact_revisions
         (id, fact_id, contract_version, revision, statement, scope, canonical_answer,
          supported_aliases, content_hash, time_sensitive)
         VALUES ($1, $2, 'theme-reliability-v1', 1, 'Scoped fact',
                 '{}'::jsonb, 'San Diego', '[]'::jsonb, $3, false)`,
        [factRevisionId, factId, hash('b')]
      );
      await client.query(
        `INSERT INTO theme_fact_revisions
         (id, fact_id, contract_version, revision, statement, scope, canonical_answer,
          supported_aliases, content_hash, time_sensitive)
         VALUES ($1, $2, 'theme-reliability-v1', 2, 'Scoped fact, refreshed',
                 '{}'::jsonb, 'San Diego', '[]'::jsonb, $3, false)`,
        [secondFactRevisionId, factId, hash('1')]
      );

      const documentId = randomUUID();
      const passageId = randomUUID();
      await client.query(
        `INSERT INTO theme_evidence_documents
         (id, contract_version, requested_url, final_url, canonical_url, publisher_id,
          source_class, publisher, origin_group, source_policy_version, extractor_version,
          title, language, status, content_hash, retrieved_at, http_status, media_type)
         VALUES ($1, 'theme-reliability-v1', 'https://example.org/source',
                 'https://example.org/source', 'https://example.org/source', 'example',
                 'primary_official', 'Example', 'example', 'source-policy-v1',
                 'extractor-v1', 'Source', 'en', 'retrieved', $2, now(), 200, 'text/html')`,
        [documentId, hash('f')]
      );
      await client.query(
        `INSERT INTO theme_evidence_documents
         (contract_version, requested_url, final_url, canonical_url, publisher_id,
          source_class, publisher, origin_group, source_policy_version, extractor_version,
          title, language, status, content_hash, retrieved_at, http_status, media_type)
         VALUES ('theme-reliability-v1', 'https://example.org/source',
                 'https://example.org/source', 'https://example.org/source', 'example',
                 'primary_official', 'Example', 'example', 'source-policy-v2',
                 'extractor-v2', 'Source', 'en', 'retrieved', $1,
                 now() + interval '1 hour', 200, 'text/html')`,
        [hash('f')]
      );
      await client.query(
        `INSERT INTO theme_evidence_passages
         (id, contract_version, document_id, ordinal, locator, passage_text, content_hash)
         VALUES ($1, 'theme-reliability-v1', $2, 0, 'paragraph-1', 'Evidence text', $3)`,
        [passageId, documentId, hash('0')]
      );
      await client.query(
        `INSERT INTO theme_fact_evidence_passages (fact_revision_id, passage_id, support_kind)
         VALUES ($1, $2, 'supports')`,
        [factRevisionId, passageId]
      );
      const dimensionResults = [
        'premise',
        'answer',
        'scope',
        'aliases',
        'explanation',
        'freshness',
        'source_independence',
      ].map((dimension) => ({
        dimension,
        verdict: 'pass',
        reasons: ['supported'],
        passageIds: [passageId],
      }));
      await expect(
        client.query('UPDATE theme_evidence_passages SET passage_text = $1 WHERE id = $2', [
          'Changed evidence',
          passageId,
        ])
      ).rejects.toMatchObject({ code: '55000' });
      await expect(
        client.query('UPDATE theme_fact_revisions SET canonical_answer = $1 WHERE id = $2', [
          'Tokyo',
          factRevisionId,
        ])
      ).rejects.toMatchObject({ code: '55000' });

      const revisionOne = randomUUID();
      const revisionTwo = randomUUID();
      await client.query(
        `INSERT INTO theme_question_revisions
         (id, contract_version, question_id, revision, content_hash, content)
         VALUES ($1, 'theme-reliability-v1', 'q-1', 1, $2, '{}'::jsonb),
                ($3, 'theme-reliability-v1', 'q-2', 1, $4, '{}'::jsonb)`,
        [revisionOne, hash('c'), revisionTwo, hash('d')]
      );

      await expect(
        client.query(
          `INSERT INTO theme_evidence_reviews
           (contract_version, question_revision_id, question_content_hash, verdict,
            review_policy_version, reviewer_prompt_version, dimension_results,
            reviewer_kind, reviewer_model, reviewed_at)
           VALUES ('theme-reliability-v1', $1, $2, 'pass', 'policy-v1', 'prompt-v1',
                   $3::jsonb, 'model', 'reviewer', now())`,
          [revisionOne, hash('e'), JSON.stringify(dimensionResults)]
        )
      ).rejects.toMatchObject({ code: '23503' });

      const review = await client.query<{ id: string }>(
        `INSERT INTO theme_evidence_reviews
         (contract_version, question_revision_id, question_content_hash, verdict,
          review_policy_version, reviewer_prompt_version, dimension_results,
          reviewer_kind, reviewer_model, reviewed_at)
         VALUES ('theme-reliability-v1', $1, $2, 'pass', 'policy-v1', 'prompt-v1',
                 $3::jsonb, 'model', 'reviewer', now())
         RETURNING id`,
        [revisionOne, hash('c'), JSON.stringify(dimensionResults)]
      );
      await client.query(
        `INSERT INTO theme_evidence_reviews
         (contract_version, question_revision_id, question_content_hash, verdict,
          review_policy_version, reviewer_prompt_version, dimension_results,
          reviewer_kind, reviewer_model, reviewed_at)
         VALUES ('theme-reliability-v1', $1, $2, 'fail', 'policy-v2', 'prompt-v2',
                 $3::jsonb, 'model', 'reviewer-v2', now())`,
        [revisionOne, hash('c'), JSON.stringify(dimensionResults)]
      );
      await expect(
        client.query("UPDATE theme_evidence_reviews SET verdict = 'fail' WHERE id = $1", [
          review.rows[0].id,
        ])
      ).rejects.toMatchObject({ code: '55000' });

      const reservations: string[] = [];
      await expect(
        client.query(
          `INSERT INTO theme_question_reservations
           (game_id, question_id, question_revision_id, fact_id, fact_revision_id, role,
            corpus_revision, history_revision, expires_at)
           VALUES ($1, 'q-1', $2, $3, $4, 'related_backup', 1, 1,
                   now() + interval '1 hour')`,
          [gameOne, revisionTwo, factId, factRevisionId]
        )
      ).rejects.toMatchObject({ code: '23503' });
      for (const [gameId, questionId, revisionId, reservedFactRevisionId] of [
        [gameOne, 'q-1', revisionOne, factRevisionId],
        [gameTwo, 'q-2', revisionTwo, secondFactRevisionId],
      ]) {
        const reservation = await client.query<{ id: string }>(
          `INSERT INTO theme_question_reservations
           (game_id, question_id, question_revision_id, fact_id, role, corpus_revision,
            fact_revision_id, history_revision, expires_at)
           VALUES ($1, $2, $3, $4, 'related_backup', 1, $5, 1, now() + interval '1 hour')
           RETURNING id`,
          [gameId, questionId, revisionId, factId, reservedFactRevisionId]
        );
        reservations.push(reservation.rows[0].id);
      }
      await client.query(
        `INSERT INTO theme_reservation_participants (reservation_id, identity_id, fact_id)
         VALUES ($1, $2, $3)`,
        [reservations[0], identityId, factId]
      );
      await expect(
        client.query(
          `INSERT INTO theme_reservation_participants (reservation_id, identity_id, fact_id)
           VALUES ($1, $2, $3)`,
          [reservations[1], identityId, factId]
        )
      ).rejects.toMatchObject({ code: '23505' });

      const otherFactId = randomUUID();
      await client.query(
        "INSERT INTO theme_facts (id, canonical_key) VALUES ($1, 'different:fact')",
        [otherFactId]
      );
      await expect(
        client.query(
          `INSERT INTO theme_reservation_participants (reservation_id, identity_id, fact_id)
           VALUES ($1, $2, $3)`,
          [reservations[1], identityId, otherFactId]
        )
      ).rejects.toMatchObject({ code: '23503' });

      await client.query(
        `INSERT INTO theme_question_exposures
         (game_id, identity_id, question_id, fact_id, fact_revision_id, display_key)
         VALUES ($1, $2, 'q-1', $3, $4, 'round-1-question-1')`,
        [gameOne, identityId, factId, factRevisionId]
      );
      await expect(
        client.query(
          `INSERT INTO theme_question_exposures
           (game_id, identity_id, question_id, fact_id, fact_revision_id, display_key)
           VALUES ($1, $2, 'q-1', $3, $4, 'round-1-question-1')`,
          [gameOne, identityId, factId, factRevisionId]
        )
      ).rejects.toMatchObject({ code: '23505' });

      await client.query(
        'INSERT INTO theme_daily_budgets (budget_date, limit_micros) VALUES (CURRENT_DATE, 1000000)'
      );
      await expect(
        client.query(
          `INSERT INTO theme_preparation_jobs
           (contract_version, game_id, stable_key, candidate_ceiling)
           VALUES ('theme-reliability-v1', $1, 'job-key-invalid-ceiling', 100)`,
          [gameOne]
        )
      ).rejects.toMatchObject({ code: '23503' });
      const job = await client.query<{ id: string }>(
        `INSERT INTO theme_preparation_jobs
         (contract_version, game_id, stable_key, candidate_ceiling)
         VALUES ('theme-reliability-v1', $1, 'job-key-one-000001', 50)
         RETURNING id`,
        [gameOne]
      );
      await expect(
        client.query(
          `INSERT INTO theme_budget_allocations
           (budget_date, job_id, reserved_micros, settled_micros, expires_at)
           VALUES (CURRENT_DATE, $1, 10, 11, now() + interval '1 hour')`,
          [job.rows[0].id]
        )
      ).rejects.toMatchObject({ code: '23514' });

      const allocation = await client.query<{ id: string }>(
        `INSERT INTO theme_budget_allocations
         (budget_date, job_id, reserved_micros, settled_micros, expires_at)
         VALUES (CURRENT_DATE, $1, 100, 100, now() + interval '1 hour') RETURNING id`,
        [job.rows[0].id]
      );
      await client.query(
        `INSERT INTO theme_job_attempts
         (job_id, allocation_id, sequence, operation, status, candidate_slots_consumed,
          reserved_cost_micros, actual_cost_micros)
         VALUES ($1, $2, 1, 'generate', 'unknown', 10, 100, 100)`,
        [job.rows[0].id, allocation.rows[0].id]
      );
      await expect(
        client.query(
          `INSERT INTO theme_job_attempts
           (job_id, allocation_id, sequence, operation, status, candidate_slots_consumed,
            reserved_cost_micros, actual_cost_micros)
           VALUES ($1, $2, 2, 'generate', 'unknown', 101, 100, 100)`,
          [job.rows[0].id, allocation.rows[0].id]
        )
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
});
