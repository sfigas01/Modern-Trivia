import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import type { ThemeSourceRegistry } from '@shared/models/theme-source-registry';

import { createPostgresThemeSourceRegistryRepository } from './theme-source-registry';

// Explicit opt-in: supply only a disposable PostgreSQL database.
const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;
if (!databaseUrl)
  console.info(
    'Skipping theme source registry PostgreSQL test: THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL is unset'
  );

const fictionalRegistry: ThemeSourceRegistry = {
  contractVersion: 'theme-source-registry-v1',
  sourcePolicyVersion: 'fictional-policy-1',
  entries: [
    {
      id: 'fictional-archive',
      publisherId: 'fictional-publisher',
      publisherName: 'Fictional Archive',
      originGroup: 'fictional-archive-group',
      sourceClass: 'primary_record',
      scope: {
        topics: ['Imaginary history'],
        languages: ['en'],
        geographies: ['Fictional Island'],
        temporal: { from: '1900-01-01', through: '2100-12-31' },
      },
      origins: [
        {
          origin: 'https://archive.example.test',
          paths: [{ kind: 'exact', path: '/index' }],
        },
      ],
    },
  ],
};

describe('theme source registry migration', () => {
  it('declares immutable registry versions and document provenance bindings', async () => {
    const migration = await readFile(
      new URL('../../migrations/0010_theme_source_registry.sql', import.meta.url),
      'utf8'
    );
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS theme_source_registry_versions');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS theme_evidence_document_sources');
    expect(migration).toContain('theme_source_registry_versions_immutable');
    expect(migration).toContain('theme_evidence_document_sources_validate');
  });
});

describe.runIf(Boolean(databaseUrl))('theme source registry PostgreSQL persistence', () => {
  it('stores immutable versions and binds exact document provenance', async () => {
    const admin = new pg.Client({ connectionString: databaseUrl });
    const schema = `theme_source_${randomUUID().replaceAll('-', '')}`;
    const foundation = await readFile(
      new URL('../../migrations/0009_theme_reliability_foundation.sql', import.meta.url),
      'utf8'
    );
    const migration = await readFile(
      new URL('../../migrations/0010_theme_source_registry.sql', import.meta.url),
      'utf8'
    );
    let connected = false;
    let created = false;
    let pool: pg.Pool | null = null;
    try {
      await admin.connect();
      connected = true;
      await admin.query(`CREATE SCHEMA ${schema}`);
      created = true;
      await admin.query(`SET search_path TO ${schema}`);
      await admin.query('CREATE TABLE users (id varchar PRIMARY KEY)');
      await admin.query('CREATE TABLE questions (id varchar PRIMARY KEY)');
      await admin.query(foundation);
      await admin.query(migration);
      await admin.query(migration);
      pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
      await expect(
        pool.query(
          `INSERT INTO theme_source_registry_versions
             (source_policy_version, contract_version, manifest, manifest_hash)
           VALUES ('invalid-policy', 'theme-source-registry-v1', '{}'::jsonb, $1)`,
          ['f'.repeat(64)]
        )
      ).rejects.toMatchObject({ code: '23514' });
      const repository = createPostgresThemeSourceRegistryRepository(pool);
      const first = await repository.append(fictionalRegistry);
      expect(first.created).toBe(true);
      expect((await repository.append(fictionalRegistry)).created).toBe(false);
      await expect(
        repository.append({
          ...fictionalRegistry,
          entries: [{ ...fictionalRegistry.entries[0], publisherName: 'Changed Archive' }],
        })
      ).rejects.toMatchObject({ code: 'version_collision' });
      expect(
        await repository.resolve(
          fictionalRegistry.sourcePolicyVersion,
          'https://archive.example.test/index'
        )
      ).toMatchObject({ status: 'matched', entry: { id: 'fictional-archive' } });

      const documentId = randomUUID();
      await pool.query(
        `INSERT INTO theme_evidence_documents
          (id, contract_version, requested_url, final_url, canonical_url, publisher_id, source_class,
           publisher, origin_group, source_policy_version, extractor_version, title, language,
           status, content_hash, retrieved_at, http_status, media_type)
         VALUES ($1, 'theme-reliability-v1', $2, $2, $2, 'fictional-publisher', 'primary_record',
                 'Fictional Archive', 'fictional-archive-group', 'fictional-policy-1',
                 'extractor-1', 'Imaginary record', 'en', 'retrieved', $3, now(), 200, 'text/html')`,
        [documentId, 'https://archive.example.test/index', 'a'.repeat(64)]
      );
      expect(
        (await repository.bindDocument(documentId, 'fictional-policy-1', 'fictional-archive'))
          .created
      ).toBe(true);
      expect(
        (await repository.bindDocument(documentId, 'fictional-policy-1', 'fictional-archive'))
          .created
      ).toBe(false);
      await expect(
        repository.bindDocument(documentId, 'fictional-policy-1', 'other')
      ).rejects.toMatchObject({ code: 'provenance_mismatch' });
      await expect(
        pool.query(
          `UPDATE theme_source_registry_versions SET manifest_hash = $1 WHERE source_policy_version = $2`,
          ['b'.repeat(64), 'fictional-policy-1']
        )
      ).rejects.toMatchObject({ code: '55000' });
      await expect(
        pool.query(`DELETE FROM theme_evidence_document_sources WHERE document_id = $1`, [
          documentId,
        ])
      ).rejects.toMatchObject({ code: '55000' });
      await pool.query(
        `INSERT INTO theme_evidence_documents
        (contract_version, requested_url, final_url, canonical_url, publisher_id, source_class,
         publisher, origin_group, source_policy_version, extractor_version, title, language,
         status, content_hash, retrieved_at, http_status, media_type)
        VALUES ('theme-reliability-v1', 'https://archive.example.test/index', 'https://archive.example.test/index',
        'https://archive.example.test/index', 'fictional-publisher', 'primary_record', 'Fictional Archive',
        'fictional-archive-group', 'fictional-policy-1', 'extractor-1', 'Unbound record', 'en',
        'retrieved', $1, now(), 200, 'text/html')`,
        ['b'.repeat(64)]
      );
      const unbound = await pool.query(
        `SELECT count(*)::int AS count FROM theme_evidence_documents d LEFT JOIN theme_evidence_document_sources s ON s.document_id = d.id WHERE s.document_id IS NULL`
      );
      expect(unbound.rows[0].count).toBe(1);
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
