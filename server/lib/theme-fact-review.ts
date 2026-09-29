import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import {
  THEME_FACT_REVIEW_CONTRACT_VERSION,
  themeFactReviewInputSchema,
  themeFactReviewPolicySchema,
  validateThemeFactReviewOutput,
  type ThemeFactReviewInput,
  type ThemeFactReviewOutput,
  type ThemeFactReviewPolicy,
} from '@shared/models/theme-fact-review';
import { themeSourceRegistrySchema } from '@shared/models/theme-source-registry';
import { hashThemeFactSnapshot } from './theme-fact-derivation';
import { hashThemeSourceRegistry } from './theme-source-registry';

// PostgreSQL jsonb rows are runtime-validated against the shared contracts below.
/* eslint-disable @typescript-eslint/no-explicit-any */
const MAX_PASSAGES = 12;
const MAX_PASSAGE_CHARACTERS = 32_000;
type FailureCode = 'invalid_output' | 'reviewer_failure' | 'evidence_changed' | 'storage_failure';
const requestSchema = z
  .object({
    attemptId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    derivationAttemptId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    factRevisionId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
  })
  .strict();
const reviewerSchema = z
  .object({
    kind: z.enum(['model', 'human']),
    id: z.string().trim().min(1).max(255),
    provider: z.string().trim().min(1).max(255).nullable(),
    model: z.string().trim().min(1).max(255).nullable(),
  })
  .strict();

export type ThemeFactReviewer = (input: ThemeFactReviewInput) => Promise<unknown> | unknown;
export type ThemeFactReviewResult =
  | {
      status: 'reviewed';
      attemptId: string;
      verdict: 'pass' | 'flag' | 'fail';
      output: ThemeFactReviewOutput;
      validUntil: string;
    }
  | { status: 'invalid_output' | 'failed'; attemptId: string; failureCode: string };

export class ThemeFactReviewError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'ThemeFactReviewError';
  }
}

type ReviewConfig = {
  executionId: string;
  reviewPolicyVersion: string;
  policy: ThemeFactReviewPolicy;
  promptVersion: string;
  promptText: string;
  reviewer: z.input<typeof reviewerSchema>;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function iso(value: unknown): string {
  const date = new Date(value as string | Date);
  if (!Number.isFinite(date.valueOf())) throw new ThemeFactReviewError('invalid_evidence');
  return date.toISOString();
}

function eq(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

async function storageSafe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ThemeFactReviewError) throw error;
    throw new ThemeFactReviewError('storage_failure');
  }
}

type EvidenceRow = {
  passage: Record<string, unknown>;
  document: Record<string, unknown>;
  binding: Record<string, unknown> | null;
  registry: Record<string, unknown> | null;
};

type Loaded = {
  attempt: Record<string, any>;
  fact: Record<string, any>;
  input: ThemeFactReviewInput;
  evidenceFingerprint: string;
  freshUntil: number;
  header: Record<string, unknown>;
};

async function loadReviewEvidence(
  pool: Pool,
  request: z.infer<typeof requestSchema>,
  config: ReviewConfig,
  reviewer: z.infer<typeof reviewerSchema>,
  evaluatedAt: Date,
  allowExpired = false
): Promise<Loaded> {
  const attemptResult = await pool.query(
    `SELECT a.*, o.outcome AS derivation_outcome, o.proposal_snapshot, o.output_hash,
       o.fact_revision_id AS outcome_revision_id, o.fact_content_hash AS outcome_fact_hash,
       o.bindings_fingerprint, r.fact_id, r.revision, r.contract_version AS revision_contract,
       r.statement, r.scope, r.canonical_answer, r.supported_aliases, r.content_hash,
       r.time_sensitive, r.valid_until AS fact_valid_until
     FROM theme_fact_derivation_attempts a
     JOIN theme_fact_derivation_outcomes o ON o.attempt_id = a.id
     JOIN theme_fact_revisions r ON r.id = o.fact_revision_id
     WHERE a.id = $1 AND o.fact_revision_id = $2`,
    [request.derivationAttemptId, request.factRevisionId]
  );
  const row = attemptResult.rows[0] as Record<string, any> | undefined;
  if (!row || row.derivation_outcome !== 'persisted' || row.outcome_fact_hash !== row.content_hash)
    throw new ThemeFactReviewError('provenance_mismatch');
  if (hash(row.proposal_snapshot) !== row.output_hash)
    throw new ThemeFactReviewError('provenance_mismatch');
  const snapshot = {
    statement: row.statement,
    scope: row.scope,
    canonicalAnswer: row.canonical_answer,
    supportedAliases: row.supported_aliases,
    timeSensitive: row.time_sensitive,
    validUntil: row.fact_valid_until === null ? null : iso(row.fact_valid_until),
  };
  if (hashThemeFactSnapshot(snapshot as never) !== row.content_hash)
    throw new ThemeFactReviewError('provenance_mismatch');
  if (reviewer.id === row.producer_id || reviewer.id.trim() === '')
    throw new ThemeFactReviewError('reviewer_not_independent');
  if (config.executionId.toLowerCase() === row.execution_id)
    throw new ThemeFactReviewError('reviewer_not_independent');
  if (
    reviewer.kind === 'model' &&
    row.producer_kind === 'model' &&
    reviewer.provider === row.provider &&
    reviewer.model === row.model
  )
    throw new ThemeFactReviewError('reviewer_not_independent');

  const manifest = row.input_manifest as Record<string, any>;
  if (
    !manifest ||
    !Array.isArray(manifest.passageIds) ||
    manifest.passageIds.length < 1 ||
    manifest.passageIds.length > MAX_PASSAGES ||
    !manifest.evidence ||
    !Array.isArray(manifest.evidence.passages) ||
    hash(manifest) !== row.input_fingerprint
  )
    throw new ThemeFactReviewError('provenance_mismatch');
  const passageIds = manifest.passageIds.map((id: unknown) => String(id).toLowerCase());
  if (new Set(passageIds).size !== passageIds.length)
    throw new ThemeFactReviewError('provenance_mismatch');
  const evidenceResult = await pool.query<EvidenceRow>(
    `SELECT to_jsonb(p) AS passage, to_jsonb(d) AS document,
       to_jsonb(s) AS binding, to_jsonb(r) AS registry
     FROM theme_evidence_passages p
     JOIN theme_evidence_documents d ON d.id = p.document_id
     LEFT JOIN theme_evidence_document_sources s ON s.document_id = d.id
     LEFT JOIN theme_source_registry_versions r
       ON r.source_policy_version = s.source_policy_version AND r.manifest_hash = s.registry_hash
     WHERE p.id = ANY($1::uuid[])`,
    [passageIds]
  );
  if (evidenceResult.rows.length !== passageIds.length)
    throw new ThemeFactReviewError('evidence_changed');
  const byId = new Map(
    evidenceResult.rows.map((item) => [String(item.passage.id).toLowerCase(), item])
  );
  let totalChars = 0;
  const evidence: ThemeFactReviewInput['evidence'] = [];
  const expectedEvidence = new Map<string, unknown>(
    manifest.evidence.passages.map((item: Record<string, any>) => [
      String(item.passageId).toLowerCase(),
      item,
    ])
  );
  if (expectedEvidence.size !== passageIds.length)
    throw new ThemeFactReviewError('provenance_mismatch');
  const bindings = await pool.query<{ passage_id: string; support_kind: string }>(
    'SELECT passage_id, support_kind FROM theme_fact_evidence_passages WHERE fact_revision_id = $1 ORDER BY passage_id',
    [request.factRevisionId]
  );
  const bound = bindings.rows.map((item) => ({
    passageId: item.passage_id.toLowerCase(),
    supportKind: item.support_kind,
  }));
  const proposed = (row.proposal_snapshot as Record<string, any>)?.citations;
  if (
    !Array.isArray(proposed) ||
    hash(proposed) !== row.bindings_fingerprint ||
    !eq(
      bound,
      proposed.map((c: any) => ({ passageId: c.passageId, supportKind: c.supportKind }))
    )
  )
    throw new ThemeFactReviewError('evidence_changed');
  const citationById = new Map(
    proposed.map((item: any) => [String(item.passageId).toLowerCase(), item])
  );
  const sourceFreshnessLimits: number[] = [];
  for (const passageId of passageIds) {
    const item = byId.get(passageId);
    const expected = expectedEvidence.get(passageId) as Record<string, any> | undefined;
    if (!item || !expected || !item.binding || !item.registry)
      throw new ThemeFactReviewError('evidence_changed');
    const text = String(item.passage.passage_text);
    const contentHash = String(item.passage.content_hash);
    const retrievedAt = Date.parse(iso(item.document.retrieved_at));
    const sourcePolicy = row.policy_snapshot as Record<string, any>;
    const expectedBinding = expected.registryBinding as Record<string, unknown> | undefined;
    const expectedRegistry = expected.registry as Record<string, unknown> | undefined;
    const registryResult = themeSourceRegistrySchema.safeParse(item.registry.manifest);
    if (!registryResult.success) throw new ThemeFactReviewError('evidence_changed');
    const actualBinding = {
      sourcePolicyVersion: item.binding.source_policy_version,
      registryHash: item.binding.registry_hash,
      entryId: item.binding.entry_id,
    };
    const actualRegistry = {
      contractVersion: item.registry.contract_version,
      sourcePolicyVersion: item.registry.source_policy_version,
      manifestHash: item.registry.manifest_hash,
    };
    totalChars += text.length;
    if (
      contentHash !== hashText(text) ||
      expected.passageContentHash !== contentHash ||
      expected.passageId?.toLowerCase() !== passageId ||
      expected.ordinal !== item.passage.ordinal ||
      expected.locator !== item.passage.locator ||
      !eq(expectedBinding, actualBinding) ||
      !eq(expectedRegistry, actualRegistry) ||
      hashThemeSourceRegistry(registryResult.data) !== item.registry.manifest_hash ||
      item.binding.source_policy_version !== sourcePolicy.sourcePolicyVersion ||
      item.document.source_policy_version !== sourcePolicy.sourcePolicyVersion ||
      item.document.extractor_version !== sourcePolicy.extractorVersion ||
      !sourcePolicy.allowedSourceClasses?.includes(item.document.source_class) ||
      item.document.source_policy_version !== config.policy.sourcePolicyVersion ||
      item.document.extractor_version !== config.policy.extractorVersion ||
      !config.policy.allowedSourceClasses.includes(item.document.source_class as never) ||
      !Number.isFinite(sourcePolicy.maxSourceAgeMs) ||
      (!allowExpired && retrievedAt > evaluatedAt.valueOf()) ||
      (!allowExpired &&
        evaluatedAt.valueOf() - retrievedAt >
          Math.min(sourcePolicy.maxSourceAgeMs, config.policy.maxSourceAgeMs)) ||
      !eq(expected.document, {
        id: item.document.id,
        contractVersion: item.document.contract_version,
        requestedUrl: item.document.requested_url,
        finalUrl: item.document.final_url,
        canonicalUrl: item.document.canonical_url,
        publisherId: item.document.publisher_id,
        sourceClass: item.document.source_class,
        publisher: item.document.publisher,
        originGroup: item.document.origin_group,
        sourcePolicyVersion: item.document.source_policy_version,
        extractorVersion: item.document.extractor_version,
        title: item.document.title,
        language: item.document.language,
        status: item.document.status,
        contentHash: item.document.content_hash,
        retrievedAt: iso(item.document.retrieved_at),
        publishedAt: item.document.published_at === null ? null : iso(item.document.published_at),
        sourceUpdatedAt:
          item.document.source_updated_at === null ? null : iso(item.document.source_updated_at),
        validUntil: item.document.valid_until === null ? null : iso(item.document.valid_until),
        httpStatus: item.document.http_status,
        mediaType: item.document.media_type,
      }) ||
      item.document.status !== 'retrieved' ||
      item.document.http_status !== 200 ||
      (!allowExpired && retrievedAt > evaluatedAt.valueOf()) ||
      (!allowExpired &&
        item.document.valid_until &&
        Date.parse(iso(item.document.valid_until)) <= evaluatedAt.valueOf())
    )
      throw new ThemeFactReviewError('evidence_changed');
    const citation = citationById.get(passageId) as { supportKind: string } | undefined;
    sourceFreshnessLimits.push(
      retrievedAt + Math.min(sourcePolicy.maxSourceAgeMs, config.policy.maxSourceAgeMs),
      item.document.valid_until
        ? Date.parse(iso(item.document.valid_until))
        : Number.MAX_SAFE_INTEGER
    );
    evidence.push({
      passageId,
      passageContentHash: contentHash,
      text,
      originGroup: String(item.document.origin_group),
      supportKind:
        citation?.supportKind === 'supports' ||
        citation?.supportKind === 'conflicts' ||
        citation?.supportKind === 'context'
          ? citation.supportKind
          : 'uncited',
    });
  }
  if (totalChars > MAX_PASSAGE_CHARACTERS) throw new ThemeFactReviewError('evidence_changed');
  const supportOrigins = new Set(
    evidence.filter((item) => item.supportKind === 'supports').map((item) => item.originGroup)
  );
  if (supportOrigins.size < config.policy.minimumOriginGroups)
    throw new ThemeFactReviewError('insufficient_support');
  const rawInput = {
    contractVersion: THEME_FACT_REVIEW_CONTRACT_VERSION,
    statement: snapshot.statement,
    scope: snapshot.scope,
    canonicalAnswer: snapshot.canonicalAnswer,
    supportedAliases: snapshot.supportedAliases,
    evidence,
  };
  const parsedInput = themeFactReviewInputSchema.safeParse(rawInput);
  if (!parsedInput.success) throw new ThemeFactReviewError('evidence_changed');
  const freshUntil = Math.min(
    ...sourceFreshnessLimits,
    snapshot.validUntil === null ? Number.MAX_SAFE_INTEGER : Date.parse(snapshot.validUntil)
  );
  if (!allowExpired && freshUntil <= evaluatedAt.valueOf())
    throw new ThemeFactReviewError('evidence_changed');
  const evidenceFingerprint = hash({
    inputFingerprint: row.input_fingerprint,
    fact: snapshot,
    edges: bound,
  });
  const header = {
    id: request.attemptId,
    contract_version: THEME_FACT_REVIEW_CONTRACT_VERSION,
    derivation_attempt_id: request.derivationAttemptId,
    fact_revision_id: request.factRevisionId,
    fact_content_hash: row.content_hash,
    review_policy_version: config.reviewPolicyVersion,
    policy_hash: hash(config.policy),
    policy_snapshot: config.policy,
    prompt_version: config.promptVersion,
    prompt_hash: hashText(config.promptText),
    input_manifest: {
      inputFingerprint: row.input_fingerprint,
      fact: snapshot,
      evidenceFingerprint,
    },
    input_fingerprint: hash(parsedInput.data),
    reviewer_kind: reviewer.kind,
    reviewer_id: reviewer.id,
    provider: reviewer.provider,
    model: reviewer.model,
    execution_id: config.executionId.toLowerCase(),
    evaluated_at: evaluatedAt.toISOString(),
  };
  return {
    attempt: row,
    fact: snapshot,
    input: parsedInput.data,
    evidenceFingerprint,
    freshUntil,
    header,
  };
}

function sameHeader(actual: Record<string, any>, expected: Record<string, any>): boolean {
  const keys = Object.keys(expected);
  return keys.every((key) =>
    key === 'input_manifest'
      ? eq(actual[key], expected[key])
      : key === 'evaluated_at' || key === 'created_at'
        ? true
        : String(actual[key]) === String(expected[key])
  );
}

async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch {
    throw new ThemeFactReviewError('storage_failure');
  }
  let released = false;
  try {
    try {
      await client.query('BEGIN');
    } catch (error) {
      client.release(error instanceof Error ? error : new Error('database begin failure'));
      released = true;
      throw new ThemeFactReviewError('storage_failure');
    }
    let result: T;
    try {
      result = await operation(client);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        client.release(
          rollbackError instanceof Error ? rollbackError : new Error('database rollback failure')
        );
        released = true;
        throw new ThemeFactReviewError('storage_failure');
      }
      if (error instanceof ThemeFactReviewError) throw error;
      throw new ThemeFactReviewError('storage_failure');
    }
    try {
      await client.query('COMMIT');
    } catch (error) {
      client.release(error instanceof Error ? error : new Error('database commit failure'));
      released = true;
      throw new ThemeFactReviewError('storage_unknown_outcome');
    }
    return result;
  } finally {
    if (!released) client.release();
  }
}

async function readOutcome(db: Pool | PoolClient, attemptId: string) {
  const result = await db.query('SELECT * FROM theme_fact_review_outcomes WHERE attempt_id = $1', [
    attemptId,
  ]);
  return result.rows[0] as Record<string, any> | undefined;
}

function replay(outcome: Record<string, any>, attemptId: string): ThemeFactReviewResult {
  if (outcome.status !== 'reviewed')
    return {
      status: outcome.status === 'invalid_output' ? 'invalid_output' : 'failed',
      attemptId,
      failureCode: outcome.failure_code,
    };
  const dimensions = outcome.dimensions as ThemeFactReviewOutput['dimensions'];
  if (hash({ dimensions }) !== outcome.output_hash)
    throw new ThemeFactReviewError('storage_failure');
  return {
    status: 'reviewed',
    attemptId,
    verdict: outcome.aggregate_verdict,
    output: { dimensions },
    validUntil: iso(outcome.valid_until),
  };
}

export function createPostgresThemeFactReviewRepository(
  pool: Pool,
  rawConfig: ReviewConfig,
  now: () => Date = () => new Date()
) {
  const parsedReviewer = reviewerSchema.safeParse(rawConfig.reviewer);
  const parsedPolicy = themeFactReviewPolicySchema.safeParse(rawConfig.policy);
  if (
    !parsedReviewer.success ||
    !parsedPolicy.success ||
    !z.string().uuid().safeParse(rawConfig.executionId).success ||
    !rawConfig.reviewPolicyVersion ||
    !rawConfig.promptVersion ||
    !rawConfig.promptText.trim() ||
    (parsedReviewer.data?.kind === 'model' &&
      (!parsedReviewer.data.provider || !parsedReviewer.data.model)) ||
    (parsedReviewer.data?.kind === 'human' &&
      (parsedReviewer.data.provider !== null || parsedReviewer.data.model !== null))
  )
    throw new ThemeFactReviewError('invalid_configuration');
  if (
    new Set(parsedPolicy.data.allowedSourceClasses).size !==
    parsedPolicy.data.allowedSourceClasses.length
  )
    throw new ThemeFactReviewError('invalid_configuration');
  const config: ReviewConfig = { ...rawConfig, policy: parsedPolicy.data };
  const reviewer = parsedReviewer.data;
  return {
    async review(
      rawRequest: z.input<typeof requestSchema>,
      review: ThemeFactReviewer
    ): Promise<ThemeFactReviewResult> {
      const parsedRequest = requestSchema.safeParse(rawRequest);
      if (!parsedRequest.success || typeof review !== 'function')
        throw new ThemeFactReviewError('invalid_request');
      const request = parsedRequest.data;
      const evaluatedAt = now();
      if (!(evaluatedAt instanceof Date) || !Number.isFinite(evaluatedAt.valueOf()))
        throw new ThemeFactReviewError('invalid_request');
      const loaded = await storageSafe(() =>
        loadReviewEvidence(pool, request, config, reviewer, evaluatedAt, true)
      );
      const priorAttempt = await storageSafe(() =>
        pool.query('SELECT * FROM theme_fact_review_attempts WHERE id = $1', [request.attemptId])
      );
      if (priorAttempt.rows[0]) {
        if (!sameHeader(priorAttempt.rows[0] as Record<string, any>, loaded.header))
          throw new ThemeFactReviewError('attempt_conflict');
        const priorOutcome = await storageSafe(() => readOutcome(pool, request.attemptId));
        if (!priorOutcome) throw new ThemeFactReviewError('attempt_unresolved');
        return replay(priorOutcome, request.attemptId);
      }
      if (loaded.freshUntil <= evaluatedAt.valueOf())
        throw new ThemeFactReviewError('evidence_changed');
      const registered = await transaction(pool, async (client) => {
        const existing = await client.query(
          'SELECT * FROM theme_fact_review_attempts WHERE id = $1 FOR UPDATE',
          [request.attemptId]
        );
        if (existing.rows[0]) {
          const expected = {
            ...loaded.header,
            review_sequence: (existing.rows[0] as Record<string, any>).review_sequence,
          };
          if (!sameHeader(existing.rows[0] as Record<string, any>, expected))
            throw new ThemeFactReviewError('attempt_conflict');
          const existingOutcome = await readOutcome(client, request.attemptId);
          if (!existingOutcome) throw new ThemeFactReviewError('attempt_unresolved');
          return existingOutcome;
        }
        await client.query('SELECT id FROM theme_fact_revisions WHERE id = $1 FOR UPDATE', [
          request.factRevisionId,
        ]);
        // Another identical request may have registered this UUID while we waited
        // for the revision lock. Re-read its persisted sequence before allocating one.
        const racedAttempt = await client.query(
          'SELECT * FROM theme_fact_review_attempts WHERE id = $1 FOR UPDATE',
          [request.attemptId]
        );
        if (racedAttempt.rows[0]) {
          const expected = {
            ...loaded.header,
            review_sequence: (racedAttempt.rows[0] as Record<string, any>).review_sequence,
          };
          if (!sameHeader(racedAttempt.rows[0] as Record<string, any>, expected))
            throw new ThemeFactReviewError('attempt_conflict');
          const racedOutcome = await readOutcome(client, request.attemptId);
          if (!racedOutcome) throw new ThemeFactReviewError('attempt_unresolved');
          return racedOutcome;
        }
        const sequenceResult = await client.query<{ next_sequence: number }>(
          'SELECT COALESCE(MAX(review_sequence), 0) + 1 AS next_sequence FROM theme_fact_review_attempts WHERE fact_revision_id = $1',
          [request.factRevisionId]
        );
        const values: Record<string, any> = {
          ...loaded.header,
          review_sequence: sequenceResult.rows[0].next_sequence,
        };
        await client.query(
          `INSERT INTO theme_fact_review_attempts
           (id, contract_version, derivation_attempt_id, fact_revision_id, fact_content_hash,
            review_sequence, review_policy_version, policy_snapshot, policy_hash, prompt_version, prompt_hash,
            input_manifest, input_fingerprint, reviewer_kind, reviewer_id, provider, model,
            execution_id, evaluated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19)
           ON CONFLICT DO NOTHING`,
          [
            values.id,
            values.contract_version,
            values.derivation_attempt_id,
            values.fact_revision_id,
            values.fact_content_hash,
            values.review_sequence,
            values.review_policy_version,
            JSON.stringify(values.policy_snapshot),
            values.policy_hash,
            values.prompt_version,
            values.prompt_hash,
            JSON.stringify(values.input_manifest),
            values.input_fingerprint,
            values.reviewer_kind,
            values.reviewer_id,
            values.provider,
            values.model,
            values.execution_id,
            values.evaluated_at,
          ]
        );
        const selected = await client.query(
          'SELECT * FROM theme_fact_review_attempts WHERE id = $1 FOR UPDATE',
          [request.attemptId]
        );
        if (!selected.rows[0] || !sameHeader(selected.rows[0] as Record<string, any>, values))
          throw new ThemeFactReviewError('attempt_conflict');
        const storedOutcome = await readOutcome(client, request.attemptId);
        if (storedOutcome) return storedOutcome;
        if (!selected.rows[0] || !sameHeader(selected.rows[0] as Record<string, any>, values))
          throw new ThemeFactReviewError('attempt_conflict');
        return null;
      });
      if (registered) return replay(registered, request.attemptId);
      if (loaded.freshUntil <= evaluatedAt.valueOf())
        throw new ThemeFactReviewError('evidence_changed');

      let status: 'reviewed' | 'invalid_output' | 'failed' = 'reviewed';
      let dimensions: ThemeFactReviewOutput['dimensions'] | null = null;
      let aggregateVerdict: string | null = null;
      let failureCode: FailureCode | null = null;
      try {
        const validationSnapshot = deepFreeze(structuredClone(loaded.input));
        const dispatchInput = structuredClone(validationSnapshot);
        const raw = await review(dispatchInput);
        const allowed = new Map(
          validationSnapshot.evidence.map((item) => [item.passageId, item.passageContentHash])
        );
        const validated = validateThemeFactReviewOutput(
          raw,
          validationSnapshot.supportedAliases,
          allowed
        );
        if (!validated) {
          status = 'invalid_output';
          failureCode = 'invalid_output';
        } else {
          dimensions = validated.dimensions;
          const verdicts = Object.values(dimensions).map(({ verdict }) => verdict);
          aggregateVerdict = verdicts.includes('fail')
            ? 'fail'
            : verdicts.includes('flag')
              ? 'flag'
              : 'pass';
        }
      } catch {
        status = 'failed';
        failureCode = 'reviewer_failure';
      }
      const completedAt = now();
      if (!(completedAt instanceof Date) || !Number.isFinite(completedAt.valueOf()))
        throw new ThemeFactReviewError('storage_failure');
      const validUntil =
        status === 'reviewed'
          ? new Date(Math.min(evaluatedAt.valueOf() + config.policy.validForMs, loaded.freshUntil))
          : null;
      try {
        const latest = await storageSafe(() =>
          loadReviewEvidence(pool, request, config, reviewer, completedAt)
        );
        const latestHeader = { ...latest.header };
        const initialHeader = { ...loaded.header };
        delete latestHeader.evaluated_at;
        delete initialHeader.evaluated_at;
        if (
          !eq(latestHeader, initialHeader) ||
          latest.evidenceFingerprint !== loaded.evidenceFingerprint
        )
          throw new ThemeFactReviewError('evidence_changed');
      } catch (error) {
        if (error instanceof ThemeFactReviewError && error.code === 'storage_failure') throw error;
        status = 'failed';
        dimensions = null;
        aggregateVerdict = null;
        failureCode = 'evidence_changed';
      }
      const outcome = {
        status,
        aggregateVerdict,
        dimensions,
        outputHash: dimensions ? hash({ dimensions }) : null,
        validUntil: status === 'reviewed' ? (validUntil?.toISOString() ?? null) : null,
        failureCode,
      };
      await transaction(pool, async (client) => {
        await client.query('SELECT id FROM theme_fact_review_attempts WHERE id = $1 FOR UPDATE', [
          request.attemptId,
        ]);
        await client.query(
          `INSERT INTO theme_fact_review_outcomes
             (attempt_id, status, aggregate_verdict, dimensions, output_hash, valid_until, failure_code)
             VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
          [
            request.attemptId,
            outcome.status,
            outcome.aggregateVerdict,
            outcome.dimensions ? JSON.stringify(outcome.dimensions) : null,
            outcome.outputHash,
            outcome.validUntil,
            outcome.failureCode,
          ]
        );
      });
      const stored = await storageSafe(() => readOutcome(pool, request.attemptId));
      if (!stored) throw new ThemeFactReviewError('storage_unknown_outcome');
      return replay(stored, request.attemptId);
    },
  };
}
