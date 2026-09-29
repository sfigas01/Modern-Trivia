import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import type { ThemeSourceRegistry } from '@shared/models/theme-source-registry';

import { createPostgresThemeEvidencePersistenceRepository } from './theme-evidence-persistence';
import { extractThemeSource } from './theme-source-extraction';
import {
  createPostgresThemeSourceRegistryRepository,
  hashThemeSourceRegistry,
} from './theme-source-registry';
import type { RetrievedThemeSource } from './theme-source-retrieval';

// Explicit opt-in: this creates and drops a schema in a disposable database.
const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;

const manifest: ThemeSourceRegistry = {
  contractVersion: 'theme-source-registry-v1',
  sourcePolicyVersion: 'persistence-test-policy-1',
  entries: [
    {
      id: 'fictional-source',
      publisherId: 'fictional-publisher',
      publisherName: 'Fictional Publisher',
      originGroup: 'fictional-group',
      sourceClass: 'primary_record',
      scope: { topics: [], languages: ['en'], geographies: [], temporal: null },
      origins: [
        { origin: 'https://fictional.example.test', paths: [{ kind: 'subtree', path: '/' }] },
      ],
    },
  ],
};

function capture(documentId = randomUUID()) {
  const body = Buffer.from('A fictional event was recorded in the imaginary archive.');
  const url = 'https://fictional.example.test/page';
  const source: RetrievedThemeSource = {
    requestedUrl: url,
    finalUrl: url,
    hops: [url],
    sourcePolicyVersion: manifest.sourcePolicyVersion,
    registryHash: hashThemeSourceRegistry(manifest),
    entryId: 'fictional-source',
    publisherId: 'fictional-publisher',
    publisher: 'Fictional Publisher',
    originGroup: 'fictional-group',
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
  return {
    documentId,
    source,
    extraction,
    metadata: { title: 'Fictional record', language: 'und' },
  };
}

describe.runIf(Boolean(databaseUrl))('theme evidence PostgreSQL capture', () => {
  it('commits atomically, rolls back on provenance failure, and replays concurrent UUIDs', async () => {
    const admin = new pg.Client({ connectionString: databaseUrl });
    const schema = `theme_capture_${randomUUID().replaceAll('-', '')}`;
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
      ]) {
        await admin.query(
          await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8')
        );
      }
      pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
      await createPostgresThemeSourceRegistryRepository(pool).append(manifest);
      const repository = createPostgresThemeEvidencePersistenceRepository(pool);

      const failed = capture();
      failed.source.registryHash = 'f'.repeat(64);
      await expect(repository.persistCapture(failed)).rejects.toMatchObject({
        code: 'provenance_mismatch',
      });
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM theme_evidence_documents')).rows[0]
          .count
      ).toBe(0);

      const input = capture();
      const [first, second] = await Promise.all([
        repository.persistCapture(input),
        repository.persistCapture(input),
      ]);
      expect([first.created, second.created].sort()).toEqual([false, true]);
      expect(second.passageIds).toEqual(first.passageIds);
      expect((await repository.persistCapture(input)).passageIds).toEqual(first.passageIds);
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM theme_evidence_documents')).rows[0]
          .count
      ).toBe(1);
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM theme_evidence_document_sources'))
          .rows[0].count
      ).toBe(1);
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM theme_evidence_passages')).rows[0]
          .count
      ).toBe(1);

      const differentId = capture();
      const secondCapture = await repository.persistCapture(differentId);
      expect(secondCapture.created).toBe(true);
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM theme_evidence_documents')).rows[0]
          .count
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
