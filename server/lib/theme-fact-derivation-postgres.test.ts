import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import type { ThemeSourceRegistry } from '@shared/models/theme-source-registry';

import { createPostgresThemeEvidencePersistenceRepository } from './theme-evidence-persistence';
import { createPostgresThemeFactDerivationRepository } from './theme-fact-derivation';
import { createPostgresThemeFactReviewRepository } from './theme-fact-review';
import { extractThemeSource } from './theme-source-extraction';
import {
  createPostgresThemeSourceRegistryRepository,
  hashThemeSourceRegistry,
} from './theme-source-registry';
import type { RetrievedThemeSource } from './theme-source-retrieval';

// Explicit opt-in: supply only a disposable PostgreSQL database.
const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;
const manifest: ThemeSourceRegistry = {
  contractVersion: 'theme-source-registry-v1',
  sourcePolicyVersion: 'fact-test-policy-1',
  entries: [
    {
      id: 'archive',
      publisherId: 'archive',
      publisherName: 'Imaginary Archive',
      originGroup: 'archive',
      sourceClass: 'primary_record',
      scope: { topics: [], languages: ['en'], geographies: [], temporal: null },
      origins: [
        { origin: 'https://archive.example.test', paths: [{ kind: 'subtree', path: '/' }] },
      ],
    },
  ],
};

describe.runIf(Boolean(databaseUrl))('theme fact proposal PostgreSQL transaction', () => {
  it('stores an exact revision once under concurrent replay and rolls back failed bindings', async () => {
    const admin = new pg.Client({ connectionString: databaseUrl });
    const schema = `theme_fact_${randomUUID().replaceAll('-', '')}`;
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
      // db:push may have already created the Drizzle unique index before SQL migrations run.
      await admin.query(`CREATE UNIQUE INDEX uq_theme_fact_revisions_id_hash
        ON theme_fact_revisions (id, content_hash)`);
      const provenanceMigration = await readFile(
        new URL('../../migrations/0011_theme_fact_derivation_provenance.sql', import.meta.url),
        'utf8'
      );
      await admin.query(provenanceMigration);
      await admin.query(provenanceMigration);
      const reviewMigration = await readFile(
        new URL('../../migrations/0012_theme_fact_reviews.sql', import.meta.url),
        'utf8'
      );
      await admin.query(reviewMigration);
      pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
      await createPostgresThemeSourceRegistryRepository(pool).append(manifest);
      const body = Buffer.from('The fictional event occurred in 1901.');
      const url = 'https://archive.example.test/record';
      const source: RetrievedThemeSource = {
        requestedUrl: url,
        finalUrl: url,
        hops: [url],
        sourcePolicyVersion: manifest.sourcePolicyVersion,
        registryHash: hashThemeSourceRegistry(manifest),
        entryId: 'archive',
        publisherId: 'archive',
        publisher: 'Imaginary Archive',
        originGroup: 'archive',
        sourceClass: 'primary_record',
        retrievalPolicyVersion: 'theme-source-retrieval-v1',
        retrievedAt: '2026-09-27T12:00:00.000Z',
        httpStatus: 200,
        mediaType: 'text/plain',
        charset: null,
        contentHash: createHash('sha256').update(body).digest('hex'),
        body,
      };
      const extraction = extractThemeSource(source);
      if (!extraction.ok) throw new Error('fixture extraction failed');
      const captured = await createPostgresThemeEvidencePersistenceRepository(pool).persistCapture({
        documentId: randomUUID(),
        source,
        extraction,
        metadata: { title: 'Imaginary record', language: 'en' },
      });
      const passageId = captured.passageIds[0];
      const contradictoryText = 'The fictional event occurred in 1902.';
      const contradictoryHash = createHash('sha256')
        .update(contradictoryText, 'utf8')
        .digest('hex');
      const contradictoryPassageId = randomUUID();
      await pool.query(
        `INSERT INTO theme_evidence_passages
         (id, contract_version, document_id, ordinal, locator, passage_text, content_hash)
         SELECT $1, 'theme-reliability-v1', id, 1, 'manual contradictory record', $2, $3
         FROM theme_evidence_documents WHERE content_hash = $4`,
        [contradictoryPassageId, contradictoryText, contradictoryHash, source.contentHash]
      );
      const request = {
        canonicalKey: 'fictional-event-year',
        revisionId: randomUUID().toUpperCase(),
        expectedLatestRevision: 0,
        passageIds: [passageId.toUpperCase(), contradictoryPassageId.toUpperCase()],
        policy: {
          sourcePolicyVersion: manifest.sourcePolicyVersion,
          extractorVersion: extraction.extractorVersion,
          allowedSourceClasses: ['primary_record' as const],
          maxSourceAgeMs: 10 * 24 * 60 * 60 * 1000,
          minimumOriginGroups: 1,
          timeSensitiveTtlMs: 3 * 24 * 60 * 60 * 1000,
        },
        provenance: {
          attemptId: randomUUID(),
          derivationPolicyVersion: 'fact-test-policy-v1',
          promptVersion: 'test-prompt-v1',
          promptText: 'Derive one bounded fact.',
          producerKind: 'human' as const,
          producerId: 'test-proposer',
          provider: null,
          model: null,
          executionId: randomUUID(),
        },
      };
      const proposer = () => ({
        status: 'proposed' as const,
        statement: 'The fictional event occurred in 1901.',
        scope: {
          entity: 'fictional event',
          relation: 'year',
          time: '1901',
          geography: null,
          competitionOrDomain: null,
          qualifiers: [],
          asOf: null,
        },
        canonicalAnswer: '1901',
        supportedAliases: ['1901 CE'],
        timeSensitive: false,
        citations: [
          {
            passageId: passageId.toUpperCase(),
            passageContentHash: extraction.passages[0].contentHash,
            supportKind: 'supports' as const,
          },
        ],
      });
      const repository = createPostgresThemeFactDerivationRepository(
        pool,
        () => new Date('2026-09-28T12:00:00.000Z')
      );
      let dispatchStarted!: () => void;
      let releaseDispatch!: () => void;
      const started = new Promise<void>((resolve) => {
        dispatchStarted = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseDispatch = resolve;
      });
      let dispatches = 0;
      const firstPromise = repository.deriveAndPersist(request, async () => {
        dispatches++;
        dispatchStarted();
        await release;
        return proposer();
      });
      await started;
      await expect(
        repository.deriveAndPersist(request, () => {
          dispatches++;
          return proposer();
        })
      ).rejects.toMatchObject({ code: 'attempt_unresolved' });
      releaseDispatch();
      const first = await firstPromise;
      const second = await repository.deriveAndPersist(request, () => {
        dispatches++;
        return proposer();
      });
      expect(dispatches).toBe(1);
      expect(first.status).toBe('proposed');
      expect(second.status).toBe('proposed');
      if (first.status !== 'proposed' || second.status !== 'proposed')
        throw new Error('unexpected result');
      expect([first.persistence?.created, second.persistence?.created].sort()).toEqual([
        false,
        true,
      ]);
      expect(first.persistence?.factId).toBe(second.persistence?.factId);
      expect(first.persistence?.revisionId).toBe(request.revisionId.toLowerCase());
      expect(first.citations[0].passageId).toBe(passageId);
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM theme_fact_revisions')).rows[0].count
      ).toBe(1);
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM theme_fact_evidence_passages'))
          .rows[0].count
      ).toBe(1);
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM theme_fact_derivation_attempts'))
          .rows[0].count
      ).toBe(1);
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM theme_fact_derivation_outcomes'))
          .rows[0].count
      ).toBe(1);
      // The review policy is a strict, separately hashed contract; derivation-only
      // fields such as timeSensitiveTtlMs must not leak into it.
      const { timeSensitiveTtlMs: _derivationOnly, ...sharedPolicy } = request.policy;
      const reviewPolicy = { ...sharedPolicy, validForMs: 60_000 };
      const reviewRepository = createPostgresThemeFactReviewRepository(
        pool,
        {
          executionId: randomUUID(),
          reviewPolicyVersion: 'test-review-policy-v1',
          policy: reviewPolicy,
          promptVersion: 'test-review-prompt-v1',
          promptText: 'Review the exact fact and every offered passage.',
          reviewer: {
            kind: 'model',
            id: 'independent-reviewer',
            provider: 'test-provider',
            model: 'review-model',
          },
        },
        () => new Date('2026-09-28T12:00:00.000Z')
      );
      const sameIdentityRepository = createPostgresThemeFactReviewRepository(
        pool,
        {
          executionId: randomUUID(),
          reviewPolicyVersion: 'test-review-policy-v1',
          policy: reviewPolicy,
          promptVersion: 'test-review-prompt-v1',
          promptText: 'Review the exact fact and every offered passage.',
          reviewer: {
            kind: 'human',
            id: 'test-proposer',
            provider: null,
            model: null,
          },
        },
        () => new Date('2026-09-28T12:00:00.000Z')
      );
      let rejectedDispatches = 0;
      await expect(
        sameIdentityRepository.review(
          {
            attemptId: randomUUID(),
            derivationAttemptId: request.provenance.attemptId,
            factRevisionId: request.revisionId,
          },
          () => {
            rejectedDispatches++;
            return {};
          }
        )
      ).rejects.toMatchObject({ code: 'reviewer_not_independent' });
      expect(rejectedDispatches).toBe(0);
      const reviewAttemptId = randomUUID();
      const reviewResult = await reviewRepository.review(
        {
          attemptId: reviewAttemptId,
          derivationAttemptId: request.provenance.attemptId,
          factRevisionId: request.revisionId,
        },
        (reviewInput) => {
          dispatches++;
          expect(reviewInput.evidence).toHaveLength(2);
          expect(reviewInput.evidence.map((item) => item.supportKind)).toContain('uncited');
          expect(reviewInput.evidence.map((item) => item.text)).toContain(contradictoryText);
          const ref = (item: (typeof reviewInput.evidence)[number]) => ({
            passageId: item.passageId,
            passageContentHash: item.passageContentHash,
          });
          const cited = ref(reviewInput.evidence[0]);
          return {
            dimensions: {
              entailment: { verdict: 'pass', reasons: ['supported'], passageRefs: [cited] },
              scope: { verdict: 'pass', reasons: ['scope_match'], passageRefs: [cited] },
              canonical_answer: {
                verdict: 'pass',
                reasons: ['answer_supported'],
                passageRefs: [cited],
              },
              aliases: { verdict: 'pass', reasons: ['aliases_supported'], passageRefs: [cited] },
              conflict: {
                verdict: 'flag',
                reasons: ['conflict_unresolved'],
                passageRefs: [ref(reviewInput.evidence[1])],
              },
              source_independence: {
                verdict: 'pass',
                reasons: ['independent_origins'],
                passageRefs: [cited],
              },
            },
          };
        }
      );
      expect(reviewResult).toMatchObject({
        status: 'reviewed',
        verdict: 'flag',
        attemptId: reviewAttemptId,
      });
      const replayedReview = await reviewRepository.review(
        {
          attemptId: reviewAttemptId,
          derivationAttemptId: request.provenance.attemptId,
          factRevisionId: request.revisionId,
        },
        () => {
          throw new Error('completed review must not be redispatched');
        }
      );
      expect(replayedReview).toEqual(reviewResult);
      expect(dispatches).toBe(2);
      const legacyFactId = randomUUID();
      const legacyRevisionId = randomUUID();
      await pool.query('INSERT INTO theme_facts (id, canonical_key) VALUES ($1, $2)', [
        legacyFactId,
        'legacy-unbound-fact',
      ]);
      await pool.query(
        `INSERT INTO theme_fact_revisions
         (id, fact_id, contract_version, revision, statement, scope, canonical_answer,
          supported_aliases, content_hash, time_sensitive)
         VALUES ($1, $2, 'theme-reliability-v1', 1, 'Legacy statement',
                 '{}'::jsonb, 'legacy', '[]'::jsonb, $3, false)`,
        [legacyRevisionId, legacyFactId, 'd'.repeat(64)]
      );
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS count FROM theme_fact_derivation_outcomes WHERE fact_revision_id = $1',
            [legacyRevisionId]
          )
        ).rows[0].count
      ).toBe(0);
      await expect(
        pool.query('UPDATE theme_fact_derivation_attempts SET producer_id = producer_id')
      ).rejects.toMatchObject({ code: '55000' });
      await expect(pool.query('DELETE FROM theme_fact_derivation_outcomes')).rejects.toMatchObject({
        code: '55000',
      });
      async function cloneAttempt(id: string, requestedRevisionId: string) {
        await pool!.query(
          `INSERT INTO theme_fact_derivation_attempts
         (id, contract_version, canonical_key, requested_revision_id, expected_latest_revision,
          derivation_policy_version, policy_snapshot, policy_hash, prompt_version, prompt_hash,
          input_manifest, input_fingerprint, producer_kind, producer_id, provider, model, execution_id)
         SELECT $1, contract_version, canonical_key, $2,
          expected_latest_revision, derivation_policy_version, policy_snapshot, policy_hash,
          prompt_version, prompt_hash, input_manifest, input_fingerprint, producer_kind,
          producer_id, provider, model, $3
         FROM theme_fact_derivation_attempts WHERE id = $4`,
          [id, requestedRevisionId, randomUUID(), request.provenance.attemptId]
        );
      }
      const persistedOutcomeSql = `INSERT INTO theme_fact_derivation_outcomes
         (attempt_id, outcome, proposal_snapshot, output_hash, fact_revision_id,
          fact_content_hash, bindings_fingerprint)
         VALUES ($1, 'persisted', '{}'::jsonb, $2, $3, $4, $5)`;
      const invalidAttemptId = randomUUID();
      await cloneAttempt(invalidAttemptId, legacyRevisionId);
      await expect(
        pool.query(persistedOutcomeSql, [
          invalidAttemptId,
          'a'.repeat(64),
          legacyRevisionId,
          'b'.repeat(64),
          'c'.repeat(64),
        ])
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'fk_theme_fact_derivation_outcome_revision',
      });
      const mismatchedAttemptId = randomUUID();
      await cloneAttempt(mismatchedAttemptId, randomUUID());
      await expect(
        pool.query(persistedOutcomeSql, [
          mismatchedAttemptId,
          'a'.repeat(64),
          legacyRevisionId,
          'd'.repeat(64),
          'c'.repeat(64),
        ])
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'fk_theme_fact_derivation_outcome_attempt_revision',
      });
      const duplicateAttemptId = randomUUID();
      await cloneAttempt(duplicateAttemptId, request.revisionId);
      await expect(
        pool.query(persistedOutcomeSql, [
          duplicateAttemptId,
          'a'.repeat(64),
          request.revisionId,
          first.contentHash,
          'c'.repeat(64),
        ])
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'uq_theme_fact_derivation_outcome_revision',
      });

      await admin.query(`CREATE FUNCTION ${schema}.reject_test_binding() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'test rejection'; END; $$ LANGUAGE plpgsql`);
      await admin.query(`CREATE TRIGGER reject_test_binding BEFORE INSERT ON theme_fact_evidence_passages
        FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_test_binding()`);
      const failed = {
        ...request,
        canonicalKey: 'second-fictional-fact',
        revisionId: randomUUID(),
        provenance: {
          ...request.provenance,
          attemptId: randomUUID(),
          executionId: randomUUID(),
        },
      };
      await expect(repository.deriveAndPersist(failed, proposer)).rejects.toMatchObject({
        code: 'storage_failure',
      });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM theme_facts WHERE canonical_key = 'second-fictional-fact'"
          )
        ).rows[0].count
      ).toBe(0);
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM theme_fact_revisions')).rows[0].count
      ).toBe(2);
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
