import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import {
  evidencePassageSchema,
  factScopeSchema,
  scopedFactRevisionSchema,
  sourceClassSchema,
  sourceDocumentSchema,
  THEME_RELIABILITY_CONTRACT_VERSION,
  type FactScope,
  type SourceDocument,
} from '@shared/models/theme-evidence';
import {
  resolveThemeSourceUrl,
  themeSourceRegistrySchema,
} from '@shared/models/theme-source-registry';

import { hashThemeSourceRegistry } from './theme-source-registry';

const sha256 = /^[a-f0-9]{64}$/;
const MAX_PASSAGES = 12;
const MAX_PASSAGE_CHARACTERS = 32_000;
const PROVENANCE_CONTRACT_VERSION = 'theme-fact-derivation-provenance-v1';
const uuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());

export type ThemeFactDerivationCode =
  | 'invalid_request'
  | 'missing_evidence'
  | 'invalid_evidence'
  | 'provenance_mismatch'
  | 'stale_evidence'
  | 'invalid_proposal'
  | 'unknown_citation'
  | 'citation_mismatch'
  | 'fact_conflict'
  | 'evidence_change_conflict'
  | 'storage_failure'
  | 'storage_unknown_outcome'
  | 'proposer_failure'
  | 'attempt_conflict'
  | 'attempt_unresolved';

export class ThemeFactDerivationError extends Error {
  constructor(public readonly code: ThemeFactDerivationCode) {
    super(code);
    this.name = 'ThemeFactDerivationError';
  }
}

const policySchema = z
  .object({
    sourcePolicyVersion: z.string().trim().min(1).max(255),
    extractorVersion: z.string().trim().min(1).max(255),
    allowedSourceClasses: z.array(sourceClassSchema).min(1).max(4),
    maxSourceAgeMs: z
      .number()
      .int()
      .positive()
      .max(10 * 365 * 24 * 60 * 60 * 1000),
    minimumOriginGroups: z.number().int().min(1).max(MAX_PASSAGES),
    timeSensitiveTtlMs: z
      .number()
      .int()
      .positive()
      .max(10 * 365 * 24 * 60 * 60 * 1000),
  })
  .strict();

const versionField = z.string().trim().min(1).max(255);
const provenanceSchema = z
  .object({
    attemptId: uuidSchema,
    derivationPolicyVersion: versionField,
    promptVersion: versionField,
    promptText: z.string().min(1).max(32_000),
    producerKind: z.enum(['model', 'human']),
    producerId: versionField,
    provider: versionField.nullable(),
    model: versionField.nullable(),
    executionId: uuidSchema,
  })
  .strict();

const requestSchema = z
  .object({
    canonicalKey: z.string().trim().min(1).max(255),
    revisionId: uuidSchema,
    expectedLatestRevision: z.number().int().min(0).max(2_147_483_646),
    passageIds: z.array(uuidSchema).min(1).max(MAX_PASSAGES),
    policy: policySchema,
    provenance: provenanceSchema,
  })
  .strict();

const citationSchema = z
  .object({
    passageId: uuidSchema,
    passageContentHash: z.string().regex(sha256),
    supportKind: z.enum(['supports', 'conflicts', 'context']),
  })
  .strict();

const proposerOutputSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('insufficient_evidence') }).strict(),
  z.object({ status: z.literal('conflicted') }).strict(),
  z
    .object({
      status: z.literal('proposed'),
      statement: z.string().trim().min(1).max(4_000),
      scope: factScopeSchema,
      canonicalAnswer: z.string().trim().min(1).max(1_000),
      supportedAliases: z.array(z.string().trim().min(1).max(1_000)).max(50),
      timeSensitive: z.boolean(),
      citations: z.array(citationSchema).min(1).max(MAX_PASSAGES),
    })
    .strict(),
]);

export type ThemeFactProposerOutput = z.input<typeof proposerOutputSchema>;
export interface ThemeFactProposalPassage {
  passageId: string;
  text: string;
  contentHash: string;
}
export type ThemeFactProposer = (
  passages: readonly ThemeFactProposalPassage[]
) => Promise<ThemeFactProposerOutput> | ThemeFactProposerOutput;
export type ThemeFactDerivationRequest = z.input<typeof requestSchema>;

type Citation = z.infer<typeof citationSchema>;
type Proposed = Extract<z.infer<typeof proposerOutputSchema>, { status: 'proposed' }>;
type ValidatedEvidence = {
  passageId: string;
  text: string;
  contentHash: string;
  document: SourceDocument;
};
type EvidenceSet = {
  passages: ValidatedEvidence[];
  manifest: Record<string, unknown>;
  fingerprint: string;
};
type FactSnapshot = {
  statement: string;
  scope: FactScope;
  canonicalAnswer: string;
  supportedAliases: string[];
  timeSensitive: boolean;
  validUntil: string | null;
};

export type ThemeFactDerivationResult =
  | { status: 'insufficient_evidence' | 'conflicted' }
  | {
      status: 'proposed';
      snapshot: FactSnapshot;
      contentHash: string;
      citations: Citation[];
      supportOriginCount: number;
      policySatisfied: boolean;
      persistence: {
        factId: string;
        revisionId: string;
        revision: number;
        created: boolean;
      } | null;
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

export function hashThemeFactSnapshot(snapshot: FactSnapshot): string {
  return hash(snapshot);
}

function safeText(value: unknown): boolean {
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

function allTextSafe(value: unknown): boolean {
  if (typeof value === 'string') return safeText(value);
  if (Array.isArray(value)) return value.every(allTextSafe);
  if (value && typeof value === 'object') return Object.values(value).every(allTextSafe);
  return true;
}

function timestamp(value: unknown): string | null {
  if (value === null) return null;
  const date = new Date(value as string);
  if (Number.isNaN(date.valueOf())) throw new ThemeFactDerivationError('invalid_evidence');
  return date.toISOString();
}

function databaseUuid(value: unknown): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new ThemeFactDerivationError('invalid_evidence');
  return parsed.data;
}

function instant(now: () => Date): number {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf()))
    throw new ThemeFactDerivationError('invalid_request');
  return value.valueOf();
}

type EvidenceRow = {
  passage: Record<string, unknown>;
  document: Record<string, unknown>;
  binding: Record<string, unknown> | null;
  registry: Record<string, unknown> | null;
};

const EVIDENCE_SQL = `SELECT to_jsonb(p) AS passage, to_jsonb(d) AS document,
  to_jsonb(s) AS binding, to_jsonb(r) AS registry
  FROM theme_evidence_passages p
  JOIN theme_evidence_documents d ON d.id = p.document_id
  LEFT JOIN theme_evidence_document_sources s ON s.document_id = d.id
  LEFT JOIN theme_source_registry_versions r
    ON r.source_policy_version = s.source_policy_version AND r.manifest_hash = s.registry_hash
  WHERE p.id = ANY($1::uuid[])`;

async function loadEvidence(
  db: Pool | PoolClient,
  ids: readonly string[],
  policy: z.infer<typeof policySchema>,
  nowMs: number,
  allowStale = false
): Promise<EvidenceSet> {
  const result = await db.query<EvidenceRow>(EVIDENCE_SQL, [ids]);
  if (result.rows.length !== ids.length) throw new ThemeFactDerivationError('missing_evidence');
  const normalizedRows: EvidenceRow[] = result.rows.map(
    (row): EvidenceRow => ({
      ...row,
      passage: {
        ...row.passage,
        id: databaseUuid(row.passage.id),
        document_id: databaseUuid(row.passage.document_id),
      },
      document: { ...row.document, id: databaseUuid(row.document.id) },
      binding: row.binding
        ? { ...row.binding, document_id: databaseUuid(row.binding.document_id) }
        : null,
    })
  );
  const byId = new Map(normalizedRows.map((row) => [row.passage.id as string, row]));
  if (byId.size !== ids.length) throw new ThemeFactDerivationError('invalid_evidence');
  const passages: ValidatedEvidence[] = [];
  const manifestPassages: Record<string, unknown>[] = [];
  let characters = 0;
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw new ThemeFactDerivationError('missing_evidence');
    const p = row.passage;
    const d = row.document;
    const s = row.binding;
    const r = row.registry;
    const document = sourceDocumentSchema.safeParse({
      contractVersion: d.contract_version,
      id: d.id,
      requestedUrl: d.requested_url,
      finalUrl: d.final_url,
      canonicalUrl: d.canonical_url,
      publisherId: d.publisher_id,
      sourceClass: d.source_class,
      publisher: d.publisher,
      originGroup: d.origin_group,
      sourcePolicyVersion: d.source_policy_version,
      extractorVersion: d.extractor_version,
      title: d.title,
      language: d.language,
      status: d.status,
      contentHash: d.content_hash,
      retrievedAt: timestamp(d.retrieved_at),
      publishedAt: timestamp(d.published_at),
      sourceUpdatedAt: timestamp(d.source_updated_at),
      validUntil: timestamp(d.valid_until),
      httpStatus: d.http_status,
      mediaType: d.media_type,
    });
    const passage = evidencePassageSchema.safeParse({
      contractVersion: p.contract_version,
      id: p.id,
      documentId: p.document_id,
      ordinal: p.ordinal,
      locator: p.locator,
      text: p.passage_text,
      contentHash: p.content_hash,
    });
    if (
      !document.success ||
      !passage.success ||
      passage.data.documentId !== document.data.id ||
      passage.data.text !== p.passage_text
    )
      throw new ThemeFactDerivationError('invalid_evidence');
    if (
      createHash('sha256').update(passage.data.text, 'utf8').digest('hex') !==
      passage.data.contentHash
    )
      throw new ThemeFactDerivationError('invalid_evidence');
    characters += passage.data.text.length;
    if (characters > MAX_PASSAGE_CHARACTERS) throw new ThemeFactDerivationError('invalid_evidence');
    if (!s || !r) throw new ThemeFactDerivationError('provenance_mismatch');
    const parsedRegistry = themeSourceRegistrySchema.safeParse(r.manifest);
    if (!parsedRegistry.success) throw new ThemeFactDerivationError('provenance_mismatch');
    const manifest = parsedRegistry.data;
    const registryHash = hashThemeSourceRegistry(manifest);
    if (
      r.source_policy_version !== policy.sourcePolicyVersion ||
      manifest.sourcePolicyVersion !== r.source_policy_version ||
      r.contract_version !== manifest.contractVersion ||
      r.manifest_hash !== registryHash ||
      s.source_policy_version !== policy.sourcePolicyVersion ||
      s.registry_hash !== registryHash ||
      d.source_policy_version !== policy.sourcePolicyVersion ||
      d.extractor_version !== policy.extractorVersion
    )
      throw new ThemeFactDerivationError('provenance_mismatch');
    const entry = manifest.entries.find((candidate) => candidate.id === s.entry_id);
    if (
      !entry ||
      entry.publisherId !== d.publisher_id ||
      entry.publisherName !== d.publisher ||
      entry.originGroup !== d.origin_group ||
      entry.sourceClass !== d.source_class ||
      !entry.scope.languages.includes(d.language as string)
    )
      throw new ThemeFactDerivationError('provenance_mismatch');
    for (const url of [
      document.data.requestedUrl,
      document.data.finalUrl,
      document.data.canonicalUrl,
    ]) {
      const resolution = resolveThemeSourceUrl(manifest, url);
      if (resolution.status !== 'matched' || resolution.entry.id !== entry.id)
        throw new ThemeFactDerivationError('provenance_mismatch');
    }
    if (
      !allowStale &&
      (document.data.status !== 'retrieved' ||
        document.data.httpStatus !== 200 ||
        !policy.allowedSourceClasses.includes(document.data.sourceClass))
    )
      throw new ThemeFactDerivationError('stale_evidence');
    const retrievedAt = Date.parse(document.data.retrievedAt);
    if (
      !allowStale &&
      (retrievedAt > nowMs ||
        nowMs - retrievedAt > policy.maxSourceAgeMs ||
        (document.data.publishedAt !== null && Date.parse(document.data.publishedAt) > nowMs) ||
        (document.data.sourceUpdatedAt !== null &&
          Date.parse(document.data.sourceUpdatedAt) > nowMs) ||
        (document.data.validUntil !== null && Date.parse(document.data.validUntil) <= nowMs))
    )
      throw new ThemeFactDerivationError('stale_evidence');
    passages.push({
      passageId: passage.data.id,
      text: passage.data.text,
      contentHash: passage.data.contentHash,
      document: document.data,
    });
    manifestPassages.push({
      passageId: passage.data.id,
      passageContentHash: passage.data.contentHash,
      ordinal: passage.data.ordinal,
      locator: passage.data.locator,
      document: document.data,
      registryBinding: {
        sourcePolicyVersion: s.source_policy_version,
        registryHash: s.registry_hash,
        entryId: s.entry_id,
      },
      registry: {
        contractVersion: r.contract_version,
        sourcePolicyVersion: r.source_policy_version,
        manifestHash: r.manifest_hash,
      },
    });
  }
  const manifest = { passages: manifestPassages };
  return { passages, manifest, fingerprint: hash(manifest) };
}

function prepareProposal(
  raw: ThemeFactProposerOutput,
  evidence: EvidenceSet,
  policy: z.infer<typeof policySchema>,
  nowMs: number,
  revisionId: string,
  expectedLatestRevision: number
): ThemeFactDerivationResult {
  const parsed = proposerOutputSchema.safeParse(raw);
  if (!parsed.success || !allTextSafe(parsed.data))
    throw new ThemeFactDerivationError('invalid_proposal');
  if (parsed.data.status !== 'proposed') return { status: parsed.data.status };
  const proposal: Proposed = parsed.data;
  if (proposal.statement.includes('\n') || proposal.statement.includes('\r'))
    throw new ThemeFactDerivationError('invalid_proposal');
  const cited = new Map<string, ValidatedEvidence>();
  for (const passage of evidence.passages) cited.set(passage.passageId, passage);
  const citations = [...proposal.citations].sort((a, b) =>
    a.passageId < b.passageId ? -1 : a.passageId > b.passageId ? 1 : 0
  );
  const seen = new Set<string>();
  const supports: ValidatedEvidence[] = [];
  for (const citation of citations) {
    if (seen.has(citation.passageId)) throw new ThemeFactDerivationError('invalid_proposal');
    seen.add(citation.passageId);
    const passage = cited.get(citation.passageId);
    if (!passage) throw new ThemeFactDerivationError('unknown_citation');
    if (passage.contentHash !== citation.passageContentHash)
      throw new ThemeFactDerivationError('citation_mismatch');
    if (citation.supportKind === 'supports') supports.push(passage);
  }
  if (citations.some((citation) => citation.supportKind === 'conflicts'))
    return { status: 'conflicted' };
  if (!supports.length) return { status: 'insufficient_evidence' };
  const asOf = proposal.scope.asOf === null ? null : Date.parse(proposal.scope.asOf);
  if (asOf !== null && (asOf > nowMs || Number.isNaN(asOf)))
    throw new ThemeFactDerivationError('invalid_proposal');
  if (
    proposal.timeSensitive &&
    (asOf === null || supports.every((item) => Date.parse(item.document.retrievedAt) < asOf))
  )
    throw new ThemeFactDerivationError('invalid_proposal');
  const expiries = supports.flatMap((item) =>
    item.document.validUntil === null ? [] : [Date.parse(item.document.validUntil)]
  );
  if (proposal.timeSensitive && asOf !== null) expiries.push(asOf + policy.timeSensitiveTtlMs);
  const expiry = expiries.length ? Math.min(...expiries) : null;
  if (expiry !== null && (!Number.isFinite(expiry) || expiry <= nowMs))
    return { status: 'insufficient_evidence' };
  const canonicalAnswer = proposal.canonicalAnswer.normalize('NFC');
  const aliases = Array.from(
    new Set(proposal.supportedAliases.map((alias) => alias.normalize('NFC')))
  )
    .filter((alias) => alias !== canonicalAnswer)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const snapshot: FactSnapshot = {
    statement: proposal.statement.normalize('NFC'),
    scope: proposal.scope,
    canonicalAnswer,
    supportedAliases: aliases,
    timeSensitive: proposal.timeSensitive,
    validUntil: expiry === null ? null : new Date(expiry).toISOString(),
  };
  const contentHash = hashThemeFactSnapshot(snapshot);
  if (
    !scopedFactRevisionSchema.safeParse({
      contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
      id: revisionId,
      factId: revisionId,
      revision: expectedLatestRevision + 1,
      ...snapshot,
      contentHash,
    }).success
  )
    throw new ThemeFactDerivationError('invalid_proposal');
  const supportOriginCount = new Set(supports.map((item) => item.document.originGroup)).size;
  return {
    status: 'proposed',
    snapshot,
    contentHash,
    citations,
    supportOriginCount,
    policySatisfied: supportOriginCount >= policy.minimumOriginGroups,
    persistence: null,
  };
}

type RevisionRow = {
  id: string;
  fact_id: string;
  contract_version: string;
  revision: number;
  statement: string;
  scope: unknown;
  canonical_answer: string;
  supported_aliases: unknown;
  content_hash: string;
  time_sensitive: boolean;
  valid_until: Date | null;
};

function sameRevision(
  row: RevisionRow,
  prepared: Extract<ThemeFactDerivationResult, { status: 'proposed' }>,
  factId: string,
  revisionId: string,
  revision: number
): boolean {
  const snapshot = prepared.snapshot;
  return (
    databaseUuid(row.id) === revisionId &&
    databaseUuid(row.fact_id) === factId &&
    row.contract_version === THEME_RELIABILITY_CONTRACT_VERSION &&
    row.revision === revision &&
    row.statement === snapshot.statement &&
    canonical(row.scope) === canonical(snapshot.scope) &&
    row.canonical_answer === snapshot.canonicalAnswer &&
    canonical(row.supported_aliases) === canonical(snapshot.supportedAliases) &&
    row.content_hash === prepared.contentHash &&
    row.time_sensitive === snapshot.timeSensitive &&
    (row.valid_until === null ? null : row.valid_until.toISOString()) === snapshot.validUntil
  );
}

async function sameBindings(
  client: PoolClient,
  revisionId: string,
  citations: Citation[]
): Promise<boolean> {
  const result = await client.query<{ passage_id: string; support_kind: string }>(
    'SELECT passage_id, support_kind FROM theme_fact_evidence_passages WHERE fact_revision_id = $1 ORDER BY passage_id',
    [revisionId]
  );
  return (
    result.rows.length === citations.length &&
    result.rows.every(
      (row, index) =>
        databaseUuid(row.passage_id) === citations[index].passageId &&
        row.support_kind === citations[index].supportKind
    )
  );
}

type Request = z.infer<typeof requestSchema>;
type AttemptHeader = {
  id: string;
  contract_version: string;
  canonical_key: string;
  requested_revision_id: string;
  expected_latest_revision: number;
  derivation_policy_version: string;
  policy_snapshot: unknown;
  policy_hash: string;
  prompt_version: string;
  prompt_hash: string;
  input_manifest: unknown;
  input_fingerprint: string;
  producer_kind: 'model' | 'human';
  producer_id: string;
  provider: string | null;
  model: string | null;
  execution_id: string;
};
type AttemptOutcome = {
  outcome:
    | 'persisted'
    | 'insufficient_evidence'
    | 'conflicted'
    | 'policy_unsatisfied'
    | 'invalid_output'
    | 'failed';
  proposal_snapshot: unknown;
  output_hash: string | null;
  fact_revision_id: string | null;
  fact_content_hash: string | null;
  bindings_fingerprint: string | null;
  failure_code: string | null;
};

function attemptHeader(request: Request, evidence: EvidenceSet): AttemptHeader {
  const provenance = request.provenance;
  const inputManifest = {
    canonicalKey: request.canonicalKey,
    requestedRevisionId: request.revisionId,
    expectedLatestRevision: request.expectedLatestRevision,
    passageIds: request.passageIds,
    policy: request.policy,
    evidence: evidence.manifest,
  };
  return {
    id: provenance.attemptId,
    contract_version: PROVENANCE_CONTRACT_VERSION,
    canonical_key: request.canonicalKey,
    requested_revision_id: request.revisionId,
    expected_latest_revision: request.expectedLatestRevision,
    derivation_policy_version: provenance.derivationPolicyVersion,
    policy_snapshot: request.policy,
    policy_hash: hash(request.policy),
    prompt_version: provenance.promptVersion,
    prompt_hash: createHash('sha256').update(provenance.promptText, 'utf8').digest('hex'),
    input_manifest: inputManifest,
    input_fingerprint: hash(inputManifest),
    producer_kind: provenance.producerKind,
    producer_id: provenance.producerId,
    provider: provenance.provider,
    model: provenance.model,
    execution_id: provenance.executionId,
  };
}

function sameAttempt(actual: AttemptHeader, expected: AttemptHeader): boolean {
  return (
    databaseUuid(actual.id) === expected.id &&
    actual.contract_version === expected.contract_version &&
    actual.canonical_key === expected.canonical_key &&
    databaseUuid(actual.requested_revision_id) === expected.requested_revision_id &&
    actual.expected_latest_revision === expected.expected_latest_revision &&
    actual.derivation_policy_version === expected.derivation_policy_version &&
    canonical(actual.policy_snapshot) === canonical(expected.policy_snapshot) &&
    actual.policy_hash === expected.policy_hash &&
    actual.prompt_version === expected.prompt_version &&
    actual.prompt_hash === expected.prompt_hash &&
    canonical(actual.input_manifest) === canonical(expected.input_manifest) &&
    actual.input_fingerprint === expected.input_fingerprint &&
    actual.producer_kind === expected.producer_kind &&
    actual.producer_id === expected.producer_id &&
    actual.provider === expected.provider &&
    actual.model === expected.model &&
    databaseUuid(actual.execution_id) === expected.execution_id
  );
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch {
    throw new ThemeFactDerivationError('storage_failure');
  }
  let committing = false;
  let discard = false;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    committing = true;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (committing) {
      discard = true;
      throw new ThemeFactDerivationError('storage_unknown_outcome');
    }
    try {
      await client.query('ROLLBACK');
    } catch {
      discard = true;
    }
    if (error instanceof ThemeFactDerivationError) throw error;
    throw new ThemeFactDerivationError('storage_failure');
  } finally {
    client.release(discard);
  }
}

async function readOutcome(client: PoolClient, attemptId: string): Promise<AttemptOutcome | null> {
  const result = await client.query<AttemptOutcome>(
    'SELECT * FROM theme_fact_derivation_outcomes WHERE attempt_id = $1',
    [attemptId]
  );
  return result.rows[0] ?? null;
}

async function registerAttempt(pool: Pool, header: AttemptHeader): Promise<AttemptOutcome | null> {
  return transaction(pool, async (client) => {
    const inserted = await client.query(
      `INSERT INTO theme_fact_derivation_attempts
       (id, contract_version, canonical_key, requested_revision_id, expected_latest_revision,
        derivation_policy_version, policy_snapshot, policy_hash, prompt_version, prompt_hash,
        input_manifest, input_fingerprint, producer_kind, producer_id, provider, model, execution_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17)
       ON CONFLICT DO NOTHING`,
      [
        header.id,
        header.contract_version,
        header.canonical_key,
        header.requested_revision_id,
        header.expected_latest_revision,
        header.derivation_policy_version,
        JSON.stringify(header.policy_snapshot),
        header.policy_hash,
        header.prompt_version,
        header.prompt_hash,
        JSON.stringify(header.input_manifest),
        header.input_fingerprint,
        header.producer_kind,
        header.producer_id,
        header.provider,
        header.model,
        header.execution_id,
      ]
    );
    const locked = await client.query<AttemptHeader>(
      'SELECT * FROM theme_fact_derivation_attempts WHERE id = $1 FOR UPDATE',
      [header.id]
    );
    if (!locked.rows[0] || !sameAttempt(locked.rows[0], header))
      throw new ThemeFactDerivationError('attempt_conflict');
    const outcome = await readOutcome(client, header.id);
    if (inserted.rowCount === 0 && !outcome)
      throw new ThemeFactDerivationError('attempt_unresolved');
    return outcome;
  });
}

async function writeTerminalOutcome(
  pool: Pool,
  attemptId: string,
  outcome: AttemptOutcome
): Promise<void> {
  await transaction(pool, async (client) => {
    const locked = await client.query(
      'SELECT id FROM theme_fact_derivation_attempts WHERE id = $1 FOR UPDATE',
      [attemptId]
    );
    if (!locked.rows[0]) throw new ThemeFactDerivationError('storage_failure');
    await insertOutcome(client, attemptId, outcome);
  });
}

async function insertOutcome(client: PoolClient, attemptId: string, outcome: AttemptOutcome) {
  await client.query(
    `INSERT INTO theme_fact_derivation_outcomes
     (attempt_id, outcome, proposal_snapshot, output_hash, fact_revision_id,
      fact_content_hash, bindings_fingerprint, failure_code)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8)`,
    [
      attemptId,
      outcome.outcome,
      outcome.proposal_snapshot === null ? null : JSON.stringify(outcome.proposal_snapshot),
      outcome.output_hash,
      outcome.fact_revision_id,
      outcome.fact_content_hash,
      outcome.bindings_fingerprint,
      outcome.failure_code,
    ]
  );
}

function proposalOutcome(prepared: ThemeFactDerivationResult): AttemptOutcome {
  if (prepared.status !== 'proposed')
    return {
      outcome: prepared.status,
      proposal_snapshot: null,
      output_hash: hash(prepared),
      fact_revision_id: null,
      fact_content_hash: null,
      bindings_fingerprint: null,
      failure_code: null,
    };
  const snapshot = { ...prepared, persistence: null };
  return {
    outcome: prepared.policySatisfied ? 'persisted' : 'policy_unsatisfied',
    proposal_snapshot: snapshot,
    output_hash: hash(snapshot),
    fact_revision_id: null,
    fact_content_hash: null,
    bindings_fingerprint: null,
    failure_code: null,
  };
}

async function replayOutcome(
  pool: Pool,
  header: AttemptHeader,
  outcome: AttemptOutcome
): Promise<ThemeFactDerivationResult> {
  if (outcome.outcome === 'invalid_output') {
    const code = outcome.failure_code;
    if (code === 'invalid_proposal' || code === 'unknown_citation' || code === 'citation_mismatch')
      throw new ThemeFactDerivationError(code);
    throw new ThemeFactDerivationError('storage_failure');
  }
  if (outcome.outcome === 'failed') throw new ThemeFactDerivationError('proposer_failure');
  if (outcome.outcome === 'insufficient_evidence' || outcome.outcome === 'conflicted') {
    if (outcome.output_hash !== hash({ status: outcome.outcome }))
      throw new ThemeFactDerivationError('storage_failure');
    return { status: outcome.outcome };
  }
  if (!outcome.proposal_snapshot || outcome.output_hash !== hash(outcome.proposal_snapshot))
    throw new ThemeFactDerivationError('storage_failure');
  const prepared = outcome.proposal_snapshot as Extract<
    ThemeFactDerivationResult,
    { status: 'proposed' }
  >;
  if (prepared.status !== 'proposed') throw new ThemeFactDerivationError('storage_failure');
  if (outcome.outcome === 'policy_unsatisfied') return prepared;
  if (
    !outcome.fact_revision_id ||
    !outcome.fact_content_hash ||
    !outcome.bindings_fingerprint ||
    databaseUuid(outcome.fact_revision_id) !== header.requested_revision_id
  )
    throw new ThemeFactDerivationError('storage_failure');
  const revision = await pool.query<RevisionRow>(
    'SELECT * FROM theme_fact_revisions WHERE id = $1',
    [outcome.fact_revision_id]
  );
  const row = revision.rows[0];
  if (
    !row ||
    row.content_hash !== outcome.fact_content_hash ||
    !sameRevision(row, prepared, databaseUuid(row.fact_id), databaseUuid(row.id), row.revision)
  )
    throw new ThemeFactDerivationError('storage_failure');
  const bindings = await pool.query<{ passage_id: string; support_kind: string }>(
    'SELECT passage_id, support_kind FROM theme_fact_evidence_passages WHERE fact_revision_id = $1 ORDER BY passage_id',
    [outcome.fact_revision_id]
  );
  const bound = bindings.rows.map((item) => ({
    passageId: databaseUuid(item.passage_id),
    supportKind: item.support_kind,
  }));
  if (
    hash(prepared.citations) !== outcome.bindings_fingerprint ||
    canonical(bound) !==
      canonical(
        prepared.citations.map((item) => ({
          passageId: item.passageId,
          supportKind: item.supportKind,
        }))
      )
  )
    throw new ThemeFactDerivationError('storage_failure');
  return {
    ...prepared,
    persistence: {
      factId: databaseUuid(row.fact_id),
      revisionId: databaseUuid(row.id),
      revision: row.revision,
      created: false,
    },
  };
}

/** Model-agnostic proposal and atomic fact revision writer. No model call occurs in the transaction. */
export function createPostgresThemeFactDerivationRepository(pool: Pool, now: () => Date) {
  return {
    async deriveAndPersist(
      input: ThemeFactDerivationRequest,
      proposer: ThemeFactProposer
    ): Promise<ThemeFactDerivationResult> {
      const parsedRequest = requestSchema.safeParse(input);
      if (
        !parsedRequest.success ||
        !allTextSafe(parsedRequest.data) ||
        parsedRequest.data.provenance.promptText.trim().length === 0 ||
        new Set(parsedRequest.data.passageIds).size !== parsedRequest.data.passageIds.length ||
        new Set(parsedRequest.data.policy.allowedSourceClasses).size !==
          parsedRequest.data.policy.allowedSourceClasses.length ||
        (parsedRequest.data.provenance.producerKind === 'model' &&
          (!parsedRequest.data.provenance.provider || !parsedRequest.data.provenance.model)) ||
        (parsedRequest.data.provenance.producerKind === 'human' &&
          (parsedRequest.data.provenance.provider !== null ||
            parsedRequest.data.provenance.model !== null)) ||
        typeof proposer !== 'function'
      )
        throw new ThemeFactDerivationError('invalid_request');
      const request = parsedRequest.data;
      const firstNow = instant(now);
      let evidence: EvidenceSet;
      try {
        const prior = await pool.query<{ id: string }>(
          'SELECT id FROM theme_fact_derivation_attempts WHERE id = $1',
          [request.provenance.attemptId]
        );
        try {
          evidence = await loadEvidence(
            pool,
            request.passageIds,
            request.policy,
            firstNow,
            Boolean(prior.rows[0])
          );
        } catch (error) {
          if (prior.rows[0] && error instanceof ThemeFactDerivationError)
            throw new ThemeFactDerivationError('attempt_conflict');
          throw error;
        }
      } catch (error) {
        if (error instanceof ThemeFactDerivationError) throw error;
        throw new ThemeFactDerivationError('storage_failure');
      }
      const header = attemptHeader(request, evidence);
      const completed = await registerAttempt(pool, header);
      if (completed) {
        try {
          return await replayOutcome(pool, header, completed);
        } catch (error) {
          if (error instanceof ThemeFactDerivationError) throw error;
          throw new ThemeFactDerivationError('storage_failure');
        }
      }
      let raw: ThemeFactProposerOutput;
      try {
        raw = await proposer(
          evidence.passages.map(({ passageId, text, contentHash }) => ({
            passageId,
            text,
            contentHash,
          }))
        );
      } catch {
        await writeTerminalOutcome(pool, header.id, {
          outcome: 'failed',
          proposal_snapshot: null,
          output_hash: null,
          fact_revision_id: null,
          fact_content_hash: null,
          bindings_fingerprint: null,
          failure_code: 'proposer_failure',
        });
        throw new ThemeFactDerivationError('proposer_failure');
      }
      let prepared: ThemeFactDerivationResult;
      try {
        prepared = prepareProposal(
          raw,
          evidence,
          request.policy,
          firstNow,
          request.revisionId,
          request.expectedLatestRevision
        );
      } catch (error) {
        if (!(error instanceof ThemeFactDerivationError)) throw error;
        await writeTerminalOutcome(pool, header.id, {
          outcome: 'invalid_output',
          proposal_snapshot: null,
          output_hash: null,
          fact_revision_id: null,
          fact_content_hash: null,
          bindings_fingerprint: null,
          failure_code: error.code,
        });
        throw error;
      }
      const terminal = proposalOutcome(prepared);
      if (prepared.status !== 'proposed' || !prepared.policySatisfied) {
        await writeTerminalOutcome(pool, header.id, terminal);
        return prepared;
      }
      let client: PoolClient;
      try {
        client = await pool.connect();
      } catch {
        throw new ThemeFactDerivationError('storage_failure');
      }
      let committing = false;
      let discardClient = false;
      try {
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO theme_facts (canonical_key) VALUES ($1) ON CONFLICT (canonical_key) DO NOTHING',
          [request.canonicalKey]
        );
        const identity = await client.query<{ id: string }>(
          'SELECT id FROM theme_facts WHERE canonical_key = $1 FOR UPDATE',
          [request.canonicalKey]
        );
        const parsedFactId = uuidSchema.safeParse(identity.rows[0]?.id);
        if (!parsedFactId.success) throw new ThemeFactDerivationError('storage_failure');
        const factId = parsedFactId.data;
        const currentNow = instant(now);
        const currentEvidence = await loadEvidence(
          client,
          request.passageIds,
          request.policy,
          currentNow
        );
        if (currentEvidence.fingerprint !== evidence.fingerprint)
          throw new ThemeFactDerivationError('invalid_evidence');
        const current = prepareProposal(
          raw,
          currentEvidence,
          request.policy,
          currentNow,
          request.revisionId,
          request.expectedLatestRevision
        );
        if (
          current.status !== 'proposed' ||
          !current.policySatisfied ||
          current.contentHash !== prepared.contentHash
        )
          throw new ThemeFactDerivationError('stale_evidence');
        const existing = await client.query<RevisionRow>(
          'SELECT * FROM theme_fact_revisions WHERE id = $1',
          [request.revisionId]
        );
        const revision = request.expectedLatestRevision + 1;
        if (existing.rows[0]) {
          // A completed attempt replays above. Never attach a new attempt to an old revision.
          throw new ThemeFactDerivationError('fact_conflict');
        }
        const latest = await client.query<{ revision: number }>(
          'SELECT revision FROM theme_fact_revisions WHERE fact_id = $1 ORDER BY revision DESC LIMIT 1',
          [factId]
        );
        if ((latest.rows[0]?.revision ?? 0) !== request.expectedLatestRevision)
          throw new ThemeFactDerivationError('fact_conflict');
        const duplicateHash = await client.query<{ id: string }>(
          'SELECT id FROM theme_fact_revisions WHERE fact_id = $1 AND content_hash = $2',
          [factId, prepared.contentHash]
        );
        if (duplicateHash.rows[0]) {
          if (
            !(await sameBindings(
              client,
              databaseUuid(duplicateHash.rows[0].id),
              prepared.citations
            ))
          )
            throw new ThemeFactDerivationError('evidence_change_conflict');
          throw new ThemeFactDerivationError('fact_conflict');
        }
        const snapshot = prepared.snapshot;
        await client.query(
          `INSERT INTO theme_fact_revisions
           (id, fact_id, contract_version, revision, statement, scope, canonical_answer,
            supported_aliases, content_hash, time_sensitive, valid_until)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11)`,
          [
            request.revisionId,
            factId,
            THEME_RELIABILITY_CONTRACT_VERSION,
            revision,
            snapshot.statement,
            JSON.stringify(snapshot.scope),
            snapshot.canonicalAnswer,
            JSON.stringify(snapshot.supportedAliases),
            prepared.contentHash,
            snapshot.timeSensitive,
            snapshot.validUntil,
          ]
        );
        for (const citation of prepared.citations) {
          await client.query(
            `INSERT INTO theme_fact_evidence_passages (fact_revision_id, passage_id, support_kind)
             VALUES ($1, $2, $3)`,
            [request.revisionId, citation.passageId, citation.supportKind]
          );
        }
        await insertOutcome(client, header.id, {
          ...terminal,
          fact_revision_id: request.revisionId,
          fact_content_hash: prepared.contentHash,
          bindings_fingerprint: hash(prepared.citations),
        });
        committing = true;
        await client.query('COMMIT');
        return {
          ...prepared,
          persistence: { factId, revisionId: request.revisionId, revision, created: true },
        };
      } catch (error) {
        if (committing) {
          discardClient = true;
          throw new ThemeFactDerivationError('storage_unknown_outcome');
        }
        try {
          await client.query('ROLLBACK');
        } catch {
          discardClient = true;
        }
        if (error instanceof ThemeFactDerivationError) throw error;
        if (
          typeof error === 'object' &&
          error !== null &&
          'constraint' in error &&
          error.constraint === 'uq_theme_fact_revisions_fact_hash'
        )
          throw new ThemeFactDerivationError('evidence_change_conflict');
        if (
          typeof error === 'object' &&
          error !== null &&
          'constraint' in error &&
          error.constraint === 'theme_fact_revisions_pkey'
        )
          throw new ThemeFactDerivationError('fact_conflict');
        throw new ThemeFactDerivationError('storage_failure');
      } finally {
        if (discardClient) client.release(true);
        else client.release();
      }
    },
  };
}
