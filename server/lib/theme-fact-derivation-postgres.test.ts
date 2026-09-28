import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import type { ThemeSourceRegistry } from '@shared/models/theme-source-registry';

import { createPostgresThemeEvidencePersistenceRepository } from './theme-evidence-persistence';
import { createPostgresThemeFactDerivationRepository } from './theme-fact-derivation';
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
      const request = {
        canonicalKey: 'fictional-event-year',
        revisionId: randomUUID().toUpperCase(),
        expectedLatestRevision: 0,
        passageIds: [passageId.toUpperCase()],
        policy: {
          sourcePolicyVersion: manifest.sourcePolicyVersion,
          extractorVersion: extraction.extractorVersion,
          allowedSourceClasses: ['primary_record' as const],
          maxSourceAgeMs: 10 * 24 * 60 * 60 * 1000,
          minimumOriginGroups: 1,
          timeSensitiveTtlMs: 3 * 24 * 60 * 60 * 1000,
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
      const [first, second] = await Promise.all([
        repository.deriveAndPersist(request, proposer),
        repository.deriveAndPersist(request, proposer),
      ]);
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

      await admin.query(`CREATE FUNCTION ${schema}.reject_test_binding() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'test rejection'; END; $$ LANGUAGE plpgsql`);
      await admin.query(`CREATE TRIGGER reject_test_binding BEFORE INSERT ON theme_fact_evidence_passages
        FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_test_binding()`);
      const failed = {
        ...request,
        canonicalKey: 'second-fictional-fact',
        revisionId: randomUUID(),
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
      ).toBe(1);
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
