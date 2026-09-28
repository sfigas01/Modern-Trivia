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
  | 'proposer_failure';

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

const requestSchema = z
  .object({
    canonicalKey: z.string().trim().min(1).max(255),
    revisionId: uuidSchema,
    expectedLatestRevision: z.number().int().min(0).max(2_147_483_646),
    passageIds: z.array(uuidSchema).min(1).max(MAX_PASSAGES),
    policy: policySchema,
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
type EvidenceSet = { passages: ValidatedEvidence[]; fingerprint: string };
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
  nowMs: number
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
      document.data.status !== 'retrieved' ||
      document.data.httpStatus !== 200 ||
      !policy.allowedSourceClasses.includes(document.data.sourceClass)
    )
      throw new ThemeFactDerivationError('stale_evidence');
    const retrievedAt = Date.parse(document.data.retrievedAt);
    if (
      retrievedAt > nowMs ||
      nowMs - retrievedAt > policy.maxSourceAgeMs ||
      (document.data.publishedAt !== null && Date.parse(document.data.publishedAt) > nowMs) ||
      (document.data.sourceUpdatedAt !== null &&
        Date.parse(document.data.sourceUpdatedAt) > nowMs) ||
      (document.data.validUntil !== null && Date.parse(document.data.validUntil) <= nowMs)
    )
      throw new ThemeFactDerivationError('stale_evidence');
    passages.push({
      passageId: passage.data.id,
      text: passage.data.text,
      contentHash: passage.data.contentHash,
      document: document.data,
    });
  }
  return { passages, fingerprint: hash(ids.map((id) => byId.get(id))) };
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
        new Set(parsedRequest.data.passageIds).size !== parsedRequest.data.passageIds.length ||
        new Set(parsedRequest.data.policy.allowedSourceClasses).size !==
          parsedRequest.data.policy.allowedSourceClasses.length ||
        typeof proposer !== 'function'
      )
        throw new ThemeFactDerivationError('invalid_request');
      const request = parsedRequest.data;
      const firstNow = instant(now);
      let evidence: EvidenceSet;
      try {
        evidence = await loadEvidence(pool, request.passageIds, request.policy, firstNow);
      } catch (error) {
        if (error instanceof ThemeFactDerivationError) throw error;
        throw new ThemeFactDerivationError('storage_failure');
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
        throw new ThemeFactDerivationError('proposer_failure');
      }
      const prepared = prepareProposal(
        raw,
        evidence,
        request.policy,
        firstNow,
        request.revisionId,
        request.expectedLatestRevision
      );
      if (prepared.status !== 'proposed' || !prepared.policySatisfied) return prepared;
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
          if (
            !sameRevision(existing.rows[0], prepared, factId, request.revisionId, revision) ||
            !(await sameBindings(client, request.revisionId, prepared.citations))
          )
            throw new ThemeFactDerivationError('fact_conflict');
          committing = true;
          await client.query('COMMIT');
          return {
            ...prepared,
            persistence: { factId, revisionId: request.revisionId, revision, created: false },
          };
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
