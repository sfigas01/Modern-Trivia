import { createHash, randomUUID } from 'node:crypto';

import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import type { ThemeSourceRegistry } from '@shared/models/theme-source-registry';

import {
  createPostgresThemeEvidencePersistenceRepository,
  type ThemeEvidenceCaptureInput,
} from './theme-evidence-persistence';
import { extractThemeSource } from './theme-source-extraction';
import { hashThemeSourceRegistry } from './theme-source-registry';
import type { RetrievedThemeSource } from './theme-source-retrieval';

const manifest: ThemeSourceRegistry = {
  contractVersion: 'theme-source-registry-v1',
  sourcePolicyVersion: 'test-policy-1',
  entries: [
    {
      id: 'test-entry',
      publisherId: 'test-publisher',
      publisherName: 'Test Publisher',
      originGroup: 'test-group',
      sourceClass: 'primary_record',
      scope: { topics: [], languages: ['en'], geographies: [], temporal: null },
      origins: [{ origin: 'https://source.example.test', paths: [{ kind: 'subtree', path: '/' }] }],
    },
  ],
};

function capture(): ThemeEvidenceCaptureInput {
  const body = Buffer.from('An imaginary record describes a fictional event.');
  const url = 'https://source.example.test/page';
  const source: RetrievedThemeSource = {
    requestedUrl: url,
    finalUrl: url,
    hops: [url],
    sourcePolicyVersion: manifest.sourcePolicyVersion,
    registryHash: hashThemeSourceRegistry(manifest),
    entryId: 'test-entry',
    publisherId: 'test-publisher',
    publisher: 'Test Publisher',
    originGroup: 'test-group',
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
    documentId: randomUUID(),
    source,
    extraction,
    metadata: { title: 'Test record', language: 'und' },
  };
}

type State = {
  documents: Map<string, Record<string, unknown>>;
  bindings: Map<string, Record<string, unknown>>;
  passages: Map<string, Record<string, unknown>[]>;
};

function fakePool() {
  let state: State = { documents: new Map(), bindings: new Map(), passages: new Map() };
  let transaction: State | null = null;
  let connects = 0;
  let rollbacks = 0;
  let failOn: string | null = null;
  let clientSerial = 0;
  const releases: { id: number; discard: boolean }[] = [];
  const leases: number[] = [];
  let currentClient: ReturnType<typeof makeClient>;
  function makeClient() {
    const id = ++clientSerial;
    return {
      id,
      async query(sql: string, values: unknown[] = []) {
        if (sql === 'BEGIN') {
          transaction = {
            documents: new Map(state.documents),
            bindings: new Map(state.bindings),
            passages: new Map(state.passages),
          };
          return { rows: [], rowCount: null };
        }
        if (sql === 'COMMIT') {
          if (failOn === 'COMMIT') throw new Error('connection lost');
          state = transaction!;
          transaction = null;
          return { rows: [], rowCount: null };
        }
        if (sql === 'ROLLBACK') {
          rollbacks++;
          if (failOn === 'ROLLBACK') throw new Error('rollback failed');
          transaction = null;
          return { rows: [], rowCount: null };
        }
        if (failOn && sql.includes(failOn))
          throw new Error('database rejected query with sensitive payload');
        const working = transaction!;
        if (sql.includes('FROM theme_source_registry_versions'))
          return {
            rows: [
              {
                source_policy_version: manifest.sourcePolicyVersion,
                contract_version: manifest.contractVersion,
                manifest,
                manifest_hash: hashThemeSourceRegistry(manifest),
                created_at: new Date(),
              },
            ],
            rowCount: 1,
          };
        if (sql.includes('INSERT INTO theme_evidence_documents')) {
          const id = values[0] as string;
          if (working.documents.has(id)) return { rows: [], rowCount: 0 };
          const columns = [
            'contract_version',
            'requested_url',
            'final_url',
            'canonical_url',
            'publisher_id',
            'source_class',
            'publisher',
            'origin_group',
            'source_policy_version',
            'extractor_version',
            'title',
            'language',
            'status',
            'content_hash',
            'retrieved_at',
            'published_at',
            'source_updated_at',
            'valid_until',
            'http_status',
            'media_type',
          ];
          const row = Object.fromEntries(
            columns.map((column, index) => [
              column,
              column === 'retrieved_at' ? new Date(values[index + 1] as string) : values[index + 1],
            ])
          );
          working.documents.set(id, row);
          return { rows: [{ id }], rowCount: 1 };
        }
        if (sql.includes('FROM theme_evidence_documents')) {
          const row = working.documents.get(values[0] as string);
          return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }
        if (sql.includes('INSERT INTO theme_evidence_document_sources')) {
          const id = values[0] as string;
          if (working.bindings.has(id)) return { rows: [], rowCount: 0 };
          working.bindings.set(id, {
            source_policy_version: values[1],
            registry_hash: values[2],
            entry_id: values[3],
          });
          return { rows: [{ document_id: id }], rowCount: 1 };
        }
        if (sql.includes('FROM theme_evidence_document_sources')) {
          const row = working.bindings.get(values[0] as string);
          return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }
        if (sql.includes('INSERT INTO theme_evidence_passages')) {
          const id = values[2] as string;
          const rows = working.passages.get(id) ?? [];
          rows.push({
            id: values[0],
            contract_version: values[1],
            ordinal: values[3],
            locator: values[4],
            passage_text: values[5],
            content_hash: values[6],
          });
          working.passages.set(id, rows);
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('FROM theme_evidence_passages')) {
          const rows = working.passages.get(values[0] as string) ?? [];
          return {
            rows: rows.sort((a, b) => (a.ordinal as number) - (b.ordinal as number)),
            rowCount: rows.length,
          };
        }
        throw new Error('unexpected query');
      },
      release(discard = false) {
        releases.push({ id, discard });
        if (discard) {
          transaction = null;
          currentClient = makeClient();
        }
      },
    };
  }
  currentClient = makeClient();
  const pool = {
    async connect() {
      connects++;
      leases.push(currentClient.id);
      return currentClient;
    },
  } as unknown as Pool;
  return {
    pool,
    get connects() {
      return connects;
    },
    get rollbacks() {
      return rollbacks;
    },
    get releases() {
      return releases;
    },
    get leases() {
      return leases;
    },
    get state() {
      return state;
    },
    failOn(value: string | null) {
      failOn = value;
    },
  };
}

describe('theme evidence capture persistence', () => {
  it('rejects changed extraction and unsafe strings before connecting', async () => {
    const db = fakePool();
    const repo = createPostgresThemeEvidencePersistenceRepository(db.pool);
    const changed = capture();
    changed.extraction.passages[0].text = 'different sensitive text';
    await expect(repo.persistCapture(changed)).rejects.toMatchObject({
      code: 'extraction_mismatch',
    });
    const unsafe = capture();
    unsafe.metadata.title = 'unsafe\0title';
    await expect(repo.persistCapture(unsafe)).rejects.toMatchObject({ code: 'invalid_capture' });
    expect(db.connects).toBe(0);
  });

  it('commits an exact capture, replays IDs, and rejects changed or incomplete captures', async () => {
    const db = fakePool();
    const repo = createPostgresThemeEvidencePersistenceRepository(db.pool);
    const input = capture();
    const first = await repo.persistCapture(input);
    expect(first).toMatchObject({ documentId: input.documentId, created: true });
    expect(first.passageIds).toHaveLength(1);
    const replay = await repo.persistCapture(input);
    expect(replay).toEqual({ ...first, created: false });
    const changed = { ...input, metadata: { ...input.metadata, title: 'Changed' } };
    await expect(repo.persistCapture(changed)).rejects.toMatchObject({ code: 'capture_conflict' });
    db.state.passages.set(input.documentId, []);
    await expect(repo.persistCapture(input)).rejects.toMatchObject({ code: 'capture_conflict' });
  });

  it('snapshots input before connecting and accepts normalized retrieval hops', async () => {
    const db = fakePool();
    const repo = createPostgresThemeEvidencePersistenceRepository(db.pool);
    const input = capture();
    input.source.requestedUrl = 'https://SOURCE.example.test:443/page';
    const expectedText = input.extraction.passages[0].text;
    const pending = repo.persistCapture(input);
    input.source.body.fill(0);
    input.extraction.passages[0].text = 'changed after call';
    const result = await pending;
    expect(result.created).toBe(true);
    expect(db.state.passages.get(input.documentId)?.[0].passage_text).toBe(expectedText);
  });

  it('rolls back a failed write and keeps errors free of source text', async () => {
    const db = fakePool();
    db.failOn('INSERT INTO theme_evidence_passages');
    const repo = createPostgresThemeEvidencePersistenceRepository(db.pool);
    const input = capture();
    const error = await repo.persistCapture(input).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'storage_failure' });
    expect(String(error)).not.toContain('fictional event');
    expect(db.rollbacks).toBe(1);
    expect(db.releases).toEqual([{ id: db.leases[0], discard: false }]);
    expect(db.state.documents.size).toBe(0);
    expect(db.state.bindings.size).toBe(0);
    db.failOn(null);
    expect((await repo.persistCapture(input)).created).toBe(true);
    expect(db.leases[1]).toBe(db.leases[0]);
  });

  it('reports uncertain commit outcome under the same retryable UUID', async () => {
    const db = fakePool();
    db.failOn('COMMIT');
    const input = capture();
    const repo = createPostgresThemeEvidencePersistenceRepository(db.pool);
    await expect(repo.persistCapture(input)).rejects.toMatchObject({
      code: 'storage_unknown_outcome',
    });
    expect(db.rollbacks).toBe(0);
    expect(db.releases).toEqual([{ id: db.leases[0], discard: true }]);
    db.failOn(null);
    expect((await repo.persistCapture(input)).created).toBe(true);
    expect(db.leases[1]).not.toBe(db.leases[0]);
  });

  it('discards a connection when rollback fails', async () => {
    const db = fakePool();
    db.failOn('ROLLBACK');
    const repo = createPostgresThemeEvidencePersistenceRepository(db.pool);
    const input = capture();
    input.source.registryHash = 'f'.repeat(64);
    await expect(repo.persistCapture(input)).rejects.toMatchObject({
      code: 'provenance_mismatch',
    });
    expect(db.rollbacks).toBe(1);
    expect(db.releases).toEqual([{ id: db.leases[0], discard: true }]);
    db.failOn(null);
    input.source.registryHash = hashThemeSourceRegistry(manifest);
    expect((await repo.persistCapture(input)).created).toBe(true);
    expect(db.leases[1]).not.toBe(db.leases[0]);
  });

  it('requires the exact registry hash and every redirect hop to match the entry', async () => {
    const db = fakePool();
    const repo = createPostgresThemeEvidencePersistenceRepository(db.pool);
    const wrongHash = capture();
    wrongHash.source.registryHash = 'f'.repeat(64);
    await expect(repo.persistCapture(wrongHash)).rejects.toMatchObject({
      code: 'provenance_mismatch',
    });
    const wrongHop = capture();
    wrongHop.source.finalUrl = 'https://source.example.test/final';
    wrongHop.source.hops = [
      wrongHop.source.requestedUrl,
      'https://elsewhere.example.test/page',
      wrongHop.source.finalUrl,
    ];
    await expect(repo.persistCapture(wrongHop)).rejects.toMatchObject({
      code: 'provenance_mismatch',
    });
    expect(db.state.documents.size).toBe(0);
  });
});
