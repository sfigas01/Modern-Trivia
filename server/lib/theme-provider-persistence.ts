import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import type { ThemeProviderMetadata } from './theme-provider-adapters';

export type ThemeSemanticBatchPair = Readonly<{ pairKey: string; input: unknown }>;

export type ThemeSemanticBatchPersistenceRequest = Readonly<{
  candidateId: string;
  candidateContentHash: string;
  semanticPolicyFingerprint: string;
  pairs: readonly ThemeSemanticBatchPair[];
}>;

export interface ThemeSemanticBatchPersistence {
  persistSemanticBatch(request: ThemeSemanticBatchPersistenceRequest): Promise<void>;
}

export class ThemeProviderPersistenceConflictError extends Error {
  constructor() {
    super('theme_provider_persistence_conflict');
    this.name = 'ThemeProviderPersistenceConflictError';
  }
}

const MAX_PROVIDER_RESULT_BYTES = 4 * 1024 * 1024;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('invalid_theme_semantic_batch');
  return encoded;
}

function snapshotProviderResult(value: unknown): unknown {
  const snapshot = cloneJson(value);
  if (Buffer.byteLength(canonical(snapshot), 'utf8') > MAX_PROVIDER_RESULT_BYTES)
    throw new TypeError('invalid_theme_provider_result');
  return snapshot;
}

/**
 * Stores only the already-validated parsed provider value. The budget attempt's
 * immutable request fingerprint is the replay identity; raw payloads, prompts
 * and provider errors never enter this table.
 */
export async function recordThemeProviderResult(
  client: Pick<PoolClient, 'query'>,
  attemptId: string,
  value: unknown
): Promise<void> {
  if (!attemptId.trim()) throw new TypeError('invalid_theme_provider_result');
  const result = snapshotProviderResult(value);
  const resultHash = hash(canonical(result));
  await client.query(
    `INSERT INTO theme_job_attempt_provider_results (attempt_id, result_json, result_hash)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (attempt_id) DO NOTHING`,
    [attemptId, JSON.stringify(result), resultHash]
  );
  const existing = await client.query<{ result_json: unknown; result_hash: string }>(
    `SELECT result_json, result_hash
       FROM theme_job_attempt_provider_results WHERE attempt_id = $1`,
    [attemptId]
  );
  const row = existing.rows[0];
  if (!row || row.result_hash !== resultHash || canonical(row.result_json) !== canonical(result))
    throw new ThemeProviderPersistenceConflictError();
}

export async function loadThemeProviderResult(
  pool: Pick<Pool, 'query'>,
  attemptId: string
): Promise<unknown | null> {
  if (!attemptId.trim()) throw new TypeError('invalid_theme_provider_result');
  const existing = await pool.query<{ result_json: unknown; result_hash: string }>(
    `SELECT result_json, result_hash
       FROM theme_job_attempt_provider_results WHERE attempt_id = $1`,
    [attemptId]
  );
  const row = existing.rows[0];
  if (!row) return null;
  const snapshot = snapshotProviderResult(row.result_json);
  if (hash(canonical(snapshot)) !== row.result_hash)
    throw new ThemeProviderPersistenceConflictError();
  return snapshot;
}

type MetadataRow = {
  provider_request_id: string | null;
  returned_model: string | null;
  latency_ms: number;
};

function validOptionalProviderValue(value: string | null): boolean {
  return value === null || (value.trim().length > 0 && value.length <= 255);
}

/** Insert-once provider response metadata using the caller's transaction client. */
export async function recordThemeProviderMetadata(
  client: Pick<PoolClient, 'query'>,
  attemptId: string,
  metadata: ThemeProviderMetadata
): Promise<void> {
  if (
    !attemptId.trim() ||
    !Number.isInteger(metadata.latencyMs) ||
    metadata.latencyMs < 0 ||
    (metadata.providerRequestId !== null && typeof metadata.providerRequestId !== 'string') ||
    (metadata.returnedModel !== null && typeof metadata.returnedModel !== 'string') ||
    !validOptionalProviderValue(metadata.providerRequestId) ||
    !validOptionalProviderValue(metadata.returnedModel)
  )
    throw new TypeError('invalid_theme_provider_metadata');

  await client.query(
    `INSERT INTO theme_job_attempt_provider_metadata
       (attempt_id, provider_request_id, returned_model, latency_ms)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (attempt_id) DO NOTHING`,
    [attemptId, metadata.providerRequestId, metadata.returnedModel, metadata.latencyMs]
  );
  const existing = await client.query<MetadataRow>(
    `SELECT provider_request_id, returned_model, latency_ms
       FROM theme_job_attempt_provider_metadata WHERE attempt_id = $1`,
    [attemptId]
  );
  const row = existing.rows[0];
  if (
    !row ||
    row.provider_request_id !== metadata.providerRequestId ||
    row.returned_model !== metadata.returnedModel ||
    Number(row.latency_ms) !== metadata.latencyMs
  )
    throw new ThemeProviderPersistenceConflictError();
}

type SemanticBatchRow = {
  candidate_content_hash: string;
  semantic_policy_fingerprint: string;
  pair_snapshot: readonly ThemeSemanticBatchPair[];
  pair_fingerprint: string;
};

const MAX_SEMANTIC_BATCH_SNAPSHOT_BYTES = 262_144;

function cloneJson(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(cloneJson);
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError('invalid_theme_semantic_batch');
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        cloneJson(child),
      ])
    );
  }
  throw new TypeError('invalid_theme_semantic_batch');
}

function snapshotPairs(pairs: readonly ThemeSemanticBatchPair[]) {
  if (
    pairs.length > 4 ||
    pairs.some(({ pairKey }) => typeof pairKey !== 'string' || !pairKey.trim()) ||
    new Set(pairs.map(({ pairKey }) => pairKey)).size !== pairs.length
  )
    throw new TypeError('invalid_theme_semantic_batch');
  const snapshot = cloneJson(pairs) as ThemeSemanticBatchPair[];
  if (Buffer.byteLength(canonical(snapshot), 'utf8') > MAX_SEMANTIC_BATCH_SNAPSHOT_BYTES)
    throw new TypeError('invalid_theme_semantic_batch');
  return snapshot;
}

/** Persist or compare the candidate's ordered semantic batch on the supplied transaction. */
export async function persistThemeSemanticBatch(
  client: Pick<PoolClient, 'query'>,
  request: ThemeSemanticBatchPersistenceRequest
): Promise<void> {
  if (
    !request.candidateId.trim() ||
    !/^[a-f0-9]{64}$/.test(request.candidateContentHash) ||
    !/^[a-f0-9]{64}$/.test(request.semanticPolicyFingerprint)
  )
    throw new TypeError('invalid_theme_semantic_batch');

  const pairSnapshot = snapshotPairs(request.pairs);
  const pairFingerprint = hash(canonical(pairSnapshot));
  await client.query(
    `INSERT INTO theme_semantic_adjudication_batches
       (candidate_id, candidate_content_hash, semantic_policy_fingerprint, pair_snapshot, pair_fingerprint)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (candidate_id) DO NOTHING`,
    [
      request.candidateId,
      request.candidateContentHash,
      request.semanticPolicyFingerprint,
      JSON.stringify(pairSnapshot),
      pairFingerprint,
    ]
  );
  const existing = await client.query<SemanticBatchRow>(
    `SELECT candidate_content_hash, semantic_policy_fingerprint, pair_snapshot, pair_fingerprint
       FROM theme_semantic_adjudication_batches WHERE candidate_id = $1`,
    [request.candidateId]
  );
  const row = existing.rows[0];
  if (
    !row ||
    row.candidate_content_hash !== request.candidateContentHash ||
    row.semantic_policy_fingerprint !== request.semanticPolicyFingerprint ||
    row.pair_fingerprint !== pairFingerprint ||
    canonical(row.pair_snapshot) !== canonical(pairSnapshot)
  )
    throw new ThemeProviderPersistenceConflictError();
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** A durable seam suitable for injection into the QA provider adapters. */
export function createThemeProviderPersistence(pool: Pool): ThemeSemanticBatchPersistence {
  if (!pool || typeof pool.connect !== 'function')
    throw new TypeError('invalid_theme_provider_pool');
  return Object.freeze({
    persistSemanticBatch: (request: ThemeSemanticBatchPersistenceRequest) =>
      inTransaction(pool, (client) => persistThemeSemanticBatch(client, request)),
  });
}
