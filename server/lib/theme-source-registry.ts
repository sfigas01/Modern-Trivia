import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  canonicalizeThemeSourceRegistry,
  resolveThemeSourceUrl,
  themeSourceRegistrySchema,
  type ThemeSourceRegistry,
  type ThemeSourceResolution,
} from '@shared/models/theme-source-registry';

export class ThemeSourceRegistryError extends Error {
  constructor(
    public readonly code:
      | 'version_collision'
      | 'corrupt_registry'
      | 'missing_registry'
      | 'missing_document'
      | 'binding_collision'
      | 'provenance_mismatch',
    message: string
  ) {
    super(message);
    this.name = 'ThemeSourceRegistryError';
  }
}

export function hashThemeSourceRegistry(manifest: ThemeSourceRegistry): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalizeThemeSourceRegistry(manifest)))
    .digest('hex');
}

export interface StoredThemeSourceRegistry {
  manifest: ThemeSourceRegistry;
  hash: string;
  createdAt: Date;
}

export interface ThemeSourceDocumentBinding {
  documentId: string;
  sourcePolicyVersion: string;
  registryHash: string;
  entryId: string;
  created: boolean;
}

export interface ThemeSourceBindingOptions {
  registryHash?: string;
  hops?: readonly string[];
  requireExisting?: boolean;
}

interface RegistryRow {
  source_policy_version: string;
  contract_version: string;
  manifest: unknown;
  manifest_hash: string;
  created_at: Date;
}

function parseStored(row: RegistryRow): StoredThemeSourceRegistry {
  const parsed = themeSourceRegistrySchema.safeParse(row.manifest);
  if (
    !parsed.success ||
    parsed.data.sourcePolicyVersion !== row.source_policy_version ||
    parsed.data.contractVersion !== row.contract_version
  )
    throw new ThemeSourceRegistryError(
      'corrupt_registry',
      'stored source registry manifest is invalid'
    );
  const hash = hashThemeSourceRegistry(parsed.data);
  if (hash !== row.manifest_hash)
    throw new ThemeSourceRegistryError(
      'corrupt_registry',
      'stored source registry hash does not match its manifest'
    );
  return {
    manifest: canonicalizeThemeSourceRegistry(parsed.data),
    hash,
    createdAt: row.created_at,
  };
}

async function selectRegistry(
  client: Pool | PoolClient,
  version: string
): Promise<StoredThemeSourceRegistry | null> {
  const result = await client.query<RegistryRow>(
    `SELECT source_policy_version, contract_version, manifest, manifest_hash, created_at
       FROM theme_source_registry_versions WHERE source_policy_version = $1`,
    [version]
  );
  return result.rows[0] ? parseStored(result.rows[0]) : null;
}

/** Validate and bind against the caller's transaction; the caller owns commit and rollback. */
export async function bindThemeSourceDocumentInTransaction(
  client: PoolClient,
  documentId: string,
  version: string,
  entryId: string,
  options: ThemeSourceBindingOptions = {}
): Promise<ThemeSourceDocumentBinding> {
  const stored = await selectRegistry(client, version);
  if (!stored)
    throw new ThemeSourceRegistryError('missing_registry', 'source policy version does not exist');
  if (options.registryHash !== undefined && stored.hash !== options.registryHash)
    throw new ThemeSourceRegistryError(
      'provenance_mismatch',
      'registry hash does not match retrieval'
    );
  const entry = stored.manifest.entries.find((candidate) => candidate.id === entryId);
  if (!entry)
    throw new ThemeSourceRegistryError(
      'provenance_mismatch',
      'entry does not belong to source policy version'
    );
  const result = await client.query<{
    source_policy_version: string;
    publisher_id: string;
    publisher: string;
    origin_group: string;
    source_class: string;
    requested_url: string;
    final_url: string;
    canonical_url: string;
  }>(
    `SELECT source_policy_version, publisher_id, publisher, origin_group, source_class,
            requested_url, final_url, canonical_url
       FROM theme_evidence_documents WHERE id = $1 FOR UPDATE`,
    [documentId]
  );
  const document = result.rows[0];
  if (!document)
    throw new ThemeSourceRegistryError('missing_document', 'evidence document does not exist');
  if (
    document.source_policy_version !== version ||
    document.publisher_id !== entry.publisherId ||
    document.publisher !== entry.publisherName ||
    document.origin_group !== entry.originGroup ||
    document.source_class !== entry.sourceClass
  )
    throw new ThemeSourceRegistryError(
      'provenance_mismatch',
      'document metadata does not match registry entry'
    );
  for (const url of [
    document.requested_url,
    document.final_url,
    document.canonical_url,
    ...(options.hops ?? []),
  ]) {
    const resolution = resolveThemeSourceUrl(stored.manifest, url);
    if (resolution.status !== 'matched' || resolution.entry.id !== entryId)
      throw new ThemeSourceRegistryError(
        'provenance_mismatch',
        'document URL does not match registry entry'
      );
  }
  const inserted = options.requireExisting
    ? null
    : await client.query(
        `INSERT INTO theme_evidence_document_sources (document_id, source_policy_version, registry_hash, entry_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT (document_id) DO NOTHING RETURNING document_id`,
        [documentId, version, stored.hash, entryId]
      );
  if (!inserted?.rowCount) {
    const existing = await client.query<{
      source_policy_version: string;
      registry_hash: string;
      entry_id: string;
    }>(
      `SELECT source_policy_version, registry_hash, entry_id FROM theme_evidence_document_sources WHERE document_id = $1`,
      [documentId]
    );
    const binding = existing.rows[0];
    if (
      !binding ||
      binding.source_policy_version !== version ||
      binding.registry_hash !== stored.hash ||
      binding.entry_id !== entryId
    )
      throw new ThemeSourceRegistryError(
        'binding_collision',
        'document already has another source binding'
      );
  }
  return {
    documentId,
    sourcePolicyVersion: version,
    registryHash: stored.hash,
    entryId,
    created: Boolean(inserted?.rowCount),
  };
}

export function createPostgresThemeSourceRegistryRepository(pool: Pool) {
  return {
    async append(
      input: ThemeSourceRegistry
    ): Promise<StoredThemeSourceRegistry & { created: boolean }> {
      const manifest = canonicalizeThemeSourceRegistry(input);
      const hash = hashThemeSourceRegistry(manifest);
      const result = await pool.query<RegistryRow>(
        `INSERT INTO theme_source_registry_versions (source_policy_version, contract_version, manifest, manifest_hash)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (source_policy_version) DO NOTHING
         RETURNING source_policy_version, contract_version, manifest, manifest_hash, created_at`,
        [manifest.sourcePolicyVersion, manifest.contractVersion, JSON.stringify(manifest), hash]
      );
      if (result.rows[0]) return { ...parseStored(result.rows[0]), created: true };
      const existing = await selectRegistry(pool, manifest.sourcePolicyVersion);
      if (!existing)
        throw new ThemeSourceRegistryError(
          'corrupt_registry',
          'registry disappeared after version conflict'
        );
      if (existing.hash !== hash)
        throw new ThemeSourceRegistryError(
          'version_collision',
          'source policy version already has different content'
        );
      return { ...existing, created: false };
    },

    get(version: string): Promise<StoredThemeSourceRegistry | null> {
      return selectRegistry(pool, version);
    },

    async resolve(version: string, requestedUrl: string): Promise<ThemeSourceResolution> {
      const stored = await selectRegistry(pool, version);
      return resolveThemeSourceUrl(stored?.manifest ?? null, requestedUrl);
    },

    async bindDocument(
      documentId: string,
      version: string,
      entryId: string
    ): Promise<ThemeSourceDocumentBinding> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const binding = await bindThemeSourceDocumentInTransaction(
          client,
          documentId,
          version,
          entryId
        );
        await client.query('COMMIT');
        return binding;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
