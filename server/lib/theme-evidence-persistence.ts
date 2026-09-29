import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import {
  evidencePassageSchema,
  sourceDocumentSchema,
  THEME_RELIABILITY_CONTRACT_VERSION,
  type SourceDocument,
} from '@shared/models/theme-evidence';

import { extractThemeSource, type ThemeSourceExtractionResult } from './theme-source-extraction';
import {
  bindThemeSourceDocumentInTransaction,
  ThemeSourceRegistryError,
} from './theme-source-registry';
import {
  THEME_SOURCE_RETRIEVAL_POLICY_VERSION,
  type RetrievedThemeSource,
} from './theme-source-retrieval';

export type ThemeEvidencePersistenceCode =
  | 'invalid_capture'
  | 'extraction_mismatch'
  | 'provenance_mismatch'
  | 'capture_conflict'
  | 'storage_failure'
  | 'storage_unknown_outcome';

export class ThemeEvidencePersistenceError extends Error {
  constructor(public readonly code: ThemeEvidencePersistenceCode) {
    super(code);
    this.name = 'ThemeEvidencePersistenceError';
  }
}

export interface ThemeEvidenceCaptureInput {
  documentId: string;
  source: RetrievedThemeSource;
  extraction: Extract<ThemeSourceExtractionResult, { ok: true }>;
  metadata: { title: string; language: string };
}

export interface PersistedThemeEvidenceCapture {
  documentId: string;
  passageIds: string[];
  created: boolean;
}

type Passage = Extract<ThemeSourceExtractionResult, { ok: true }>['passages'][number];

function pgSafe(value: unknown): value is string {
  if (typeof value !== 'string' || value.includes('\0')) return false;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (++index >= value.length) return false;
      const low = value.charCodeAt(index);
      if (low < 0xdc00 || low > 0xdfff) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function equalPassage(a: Passage, b: Passage): boolean {
  return (
    a.contractVersion === b.contractVersion &&
    a.ordinal === b.ordinal &&
    a.locator === b.locator &&
    a.text === b.text &&
    a.contentHash === b.contentHash
  );
}

function prepare(input: ThemeEvidenceCaptureInput): {
  document: SourceDocument;
  source: RetrievedThemeSource;
  passages: Passage[];
} {
  const raw = input.source;
  if (
    !raw ||
    !Array.isArray(raw.hops) ||
    !Buffer.isBuffer(raw.body) ||
    !input.metadata ||
    !input.extraction ||
    input.extraction.ok !== true ||
    !Array.isArray(input.extraction.passages) ||
    input.extraction.passages.some((passage) => !passage || typeof passage !== 'object')
  )
    throw new ThemeEvidencePersistenceError('invalid_capture');
  const source: RetrievedThemeSource = {
    ...raw,
    hops: [...raw.hops],
    body: Buffer.from(raw.body),
  };
  const extraction = {
    extractorVersion: input.extraction.extractorVersion,
    passages: input.extraction.passages.map((passage) => ({ ...passage })),
  };
  let normalizedRequestedUrl: string;
  try {
    normalizedRequestedUrl = new URL(source.requestedUrl).href;
  } catch {
    throw new ThemeEvidencePersistenceError('invalid_capture');
  }
  if (
    source.retrievalPolicyVersion !== THEME_SOURCE_RETRIEVAL_POLICY_VERSION ||
    source.httpStatus !== 200 ||
    !['text/html', 'text/plain'].includes(source.mediaType) ||
    (source.charset !== null && source.charset !== 'utf-8') ||
    !/^[a-f0-9]{64}$/.test(source.registryHash) ||
    source.hops.length < 1 ||
    source.hops.length > 4 ||
    source.hops[0] !== normalizedRequestedUrl ||
    source.hops[source.hops.length - 1] !== source.finalUrl ||
    new Set(source.hops).size !== source.hops.length ||
    typeof source.retrievedAt !== 'string' ||
    Number.isNaN(Date.parse(source.retrievedAt)) ||
    new Date(source.retrievedAt).toISOString() !== source.retrievedAt ||
    ![
      input.documentId,
      input.metadata.title,
      input.metadata.language,
      source.requestedUrl,
      source.finalUrl,
      source.sourcePolicyVersion,
      source.registryHash,
      source.entryId,
      source.publisherId,
      source.publisher,
      source.originGroup,
      source.retrievedAt,
      source.contentHash,
      ...source.hops,
      extraction.extractorVersion,
      ...extraction.passages.flatMap((passage) => [
        passage.locator,
        passage.text,
        passage.contentHash,
      ]),
    ].every(pgSafe)
  )
    throw new ThemeEvidencePersistenceError('invalid_capture');

  const repeated = extractThemeSource(source);
  if (
    !repeated.ok ||
    repeated.extractorVersion !== extraction.extractorVersion ||
    repeated.passages.length !== extraction.passages.length ||
    !repeated.passages.every((passage, index) => equalPassage(passage, extraction.passages[index]))
  )
    throw new ThemeEvidencePersistenceError('extraction_mismatch');

  const document = sourceDocumentSchema.safeParse({
    contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
    id: input.documentId,
    requestedUrl: source.requestedUrl,
    finalUrl: source.finalUrl,
    canonicalUrl: source.finalUrl,
    publisherId: source.publisherId,
    sourceClass: source.sourceClass,
    publisher: source.publisher,
    originGroup: source.originGroup,
    sourcePolicyVersion: source.sourcePolicyVersion,
    extractorVersion: extraction.extractorVersion,
    title: input.metadata.title,
    language: input.metadata.language,
    status: 'retrieved',
    contentHash: source.contentHash,
    retrievedAt: source.retrievedAt,
    publishedAt: null,
    sourceUpdatedAt: null,
    validUntil: null,
    httpStatus: source.httpStatus,
    mediaType: source.mediaType,
  });
  if (
    !document.success ||
    !extraction.passages.length ||
    extraction.passages.some(
      (passage) =>
        !evidencePassageSchema.safeParse({
          ...passage,
          id: input.documentId,
          documentId: input.documentId,
        }).success
    )
  )
    throw new ThemeEvidencePersistenceError('invalid_capture');
  return { document: document.data, source, passages: extraction.passages };
}

const DOCUMENT_COLUMNS = [
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
] as const;

function documentValues(document: SourceDocument): unknown[] {
  return [
    document.contractVersion,
    document.requestedUrl,
    document.finalUrl,
    document.canonicalUrl,
    document.publisherId,
    document.sourceClass,
    document.publisher,
    document.originGroup,
    document.sourcePolicyVersion,
    document.extractorVersion,
    document.title,
    document.language,
    document.status,
    document.contentHash,
    document.retrievedAt,
    document.publishedAt,
    document.sourceUpdatedAt,
    document.validUntil,
    document.httpStatus,
    document.mediaType,
  ];
}

function sameDocument(row: Record<string, unknown>, document: SourceDocument): boolean {
  const values = documentValues(document);
  return DOCUMENT_COLUMNS.every((column, index) => {
    const expected = values[index];
    if (column.endsWith('_at') || column === 'valid_until') {
      return (
        (row[column] === null && expected === null) ||
        (row[column] instanceof Date &&
          typeof expected === 'string' &&
          row[column].getTime() === Date.parse(expected))
      );
    }
    return row[column] === expected;
  });
}

/** Persist one exact retrieval/extraction capture under the caller's stable UUID. */
export function createPostgresThemeEvidencePersistenceRepository(pool: Pool) {
  return {
    async persistCapture(input: ThemeEvidenceCaptureInput): Promise<PersistedThemeEvidenceCapture> {
      const { document, source, passages } = prepare(input);
      let client;
      try {
        client = await pool.connect();
      } catch {
        throw new ThemeEvidencePersistenceError('storage_failure');
      }
      let committing = false;
      let discardClient = false;
      try {
        await client.query('BEGIN');
        const values = documentValues(document);
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO theme_evidence_documents (id, ${DOCUMENT_COLUMNS.join(', ')})
           VALUES (${Array.from({ length: 21 }, (_, index) => `$${index + 1}`).join(', ')})
           ON CONFLICT (id) DO NOTHING RETURNING id`,
          [document.id, ...values]
        );
        const created = Boolean(inserted.rowCount);
        if (!created) {
          const existing = await client.query<Record<string, unknown>>(
            `SELECT ${DOCUMENT_COLUMNS.join(', ')} FROM theme_evidence_documents WHERE id = $1 FOR UPDATE`,
            [document.id]
          );
          if (!existing.rows[0] || !sameDocument(existing.rows[0], document))
            throw new ThemeEvidencePersistenceError('capture_conflict');
        }
        try {
          await bindThemeSourceDocumentInTransaction(
            client,
            document.id,
            source.sourcePolicyVersion,
            source.entryId,
            { registryHash: source.registryHash, hops: source.hops, requireExisting: !created }
          );
        } catch (error) {
          if (!created && error instanceof ThemeSourceRegistryError)
            throw new ThemeEvidencePersistenceError('capture_conflict');
          throw error;
        }
        let passageIds: string[];
        if (created) {
          passageIds = [];
          for (const passage of passages) {
            const id = randomUUID();
            await client.query(
              `INSERT INTO theme_evidence_passages
                 (id, contract_version, document_id, ordinal, locator, passage_text, content_hash)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                id,
                passage.contractVersion,
                document.id,
                passage.ordinal,
                passage.locator,
                passage.text,
                passage.contentHash,
              ]
            );
            passageIds.push(id);
          }
        } else {
          const existing = await client.query<{
            id: string;
            contract_version: string;
            ordinal: number;
            locator: string;
            passage_text: string;
            content_hash: string;
          }>(
            `SELECT id, contract_version, ordinal, locator, passage_text, content_hash
               FROM theme_evidence_passages WHERE document_id = $1 ORDER BY ordinal`,
            [document.id]
          );
          if (
            existing.rows.length !== passages.length ||
            !existing.rows.every((row, index) => {
              const passage = passages[index];
              return (
                row.contract_version === passage.contractVersion &&
                row.ordinal === passage.ordinal &&
                row.locator === passage.locator &&
                row.passage_text === passage.text &&
                row.content_hash === passage.contentHash
              );
            })
          )
            throw new ThemeEvidencePersistenceError('capture_conflict');
          passageIds = existing.rows.map((row) => row.id);
        }
        committing = true;
        await client.query('COMMIT');
        return { documentId: document.id, passageIds, created };
      } catch (error) {
        if (committing) {
          discardClient = true;
          throw new ThemeEvidencePersistenceError('storage_unknown_outcome');
        }
        try {
          await client.query('ROLLBACK');
        } catch {
          discardClient = true;
        }
        if (error instanceof ThemeEvidencePersistenceError) throw error;
        if (error instanceof ThemeSourceRegistryError)
          throw new ThemeEvidencePersistenceError('provenance_mismatch');
        throw new ThemeEvidencePersistenceError('storage_failure');
      } finally {
        if (discardClient) client.release(true);
        else client.release();
      }
    },
  };
}
