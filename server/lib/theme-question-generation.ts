import { createHash, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import {
  questionContentSnapshotSchema,
  scopedFactRevisionSchema,
  sourceDocumentSchema,
  evidencePassageSchema,
  THEME_RELIABILITY_CONTRACT_VERSION,
  type QuestionContentSnapshot,
} from '@shared/models/theme-evidence';
import {
  themeQuestionGenerationPolicySchema,
  themeQuestionGenerationRequestSchema,
  themeQuestionWriterInputSchema,
  themeQuestionWriterOutputSchema,
  THEME_QUESTION_GENERATION_CONTRACT_VERSION,
  type ThemeQuestionGenerationDecision,
  type ThemeQuestionGenerationPolicy,
  type ThemeQuestionGenerationRequest,
  type ThemeQuestionWriterInput,
  type ThemeQuestionWriterOutput,
} from '@shared/models/theme-question-generation';
import {
  themeFactReviewPolicySchema,
  type ThemeFactReviewPolicy,
} from '@shared/models/theme-fact-review';
import { themeSourceRegistrySchema } from '@shared/models/theme-source-registry';
import { hashThemeFactSnapshot } from './theme-fact-derivation';
import {
  evaluateThemeFactReviewEligibility,
  type ThemeFactReviewEligibilityGraph,
} from './theme-fact-review-eligibility';
import { hashQuestionSnapshot } from './theme-evidence-eligibility';
import { hashThemeSourceRegistry } from './theme-source-registry';
import { resolveThemeSourceUrl } from '@shared/models/theme-source-registry';

const MAX_PASSAGES = 12;
const MAX_PASSAGE_CHARACTERS = 32_000;
const uuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());

export type ThemeQuestionGenerationCode =
  | 'invalid_request'
  | 'invalid_configuration'
  | 'ineligible'
  | 'attempt_conflict'
  | 'attempt_unresolved'
  | 'candidate_conflict'
  | 'repair_conflict'
  | 'storage_failure'
  | 'storage_unknown_outcome';

export class ThemeQuestionGenerationError extends Error {
  constructor(public readonly code: ThemeQuestionGenerationCode) {
    super(code);
    this.name = 'ThemeQuestionGenerationError';
  }
}

export type ThemeQuestionWriter = (
  input: Readonly<ThemeQuestionWriterInput>
) => Promise<ThemeQuestionWriterOutput> | ThemeQuestionWriterOutput;

export type ThemeQuestionGenerationWriterIdentity = {
  kind: 'model' | 'human';
  id: string;
  provider: string | null;
  model: string | null;
};

const writerIdentitySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('model'),
      id: z.string().trim().min(1).max(255),
      provider: z.string().trim().min(1).max(255),
      model: z.string().trim().min(1).max(255),
    })
    .strict(),
  z
    .object({
      kind: z.literal('human'),
      id: z.string().trim().min(1).max(255),
      provider: z.null(),
      model: z.null(),
    })
    .strict(),
]);

export type ThemeQuestionGenerationConfig = {
  executionId: string;
  writer: ThemeQuestionGenerationWriterIdentity;
  generationPolicy: ThemeQuestionGenerationPolicy;
  promptVersion: string;
  promptText: string;
  factReviewPolicyVersion: string;
  factReviewPolicy: ThemeFactReviewPolicy;
  factReviewPromptVersion: string;
  factReviewPromptText: string;
};

type EvidenceRow = {
  passage: Record<string, any>;
  document: Record<string, any>;
  binding: Record<string, any> | null;
  registry: Record<string, any> | null;
};

export type ThemeQuestionGenerationContext = {
  job: { id: string; candidate_ceiling: number; theme_slug: string };
  fact: Record<string, any>;
  factSnapshot: Record<string, any>;
  derivation: Record<string, any>;
  evidenceFingerprint: string;
  writerInput: ThemeQuestionWriterInput;
  eligibility: ReturnType<typeof evaluateThemeFactReviewEligibility>;
  graph: ThemeFactReviewEligibilityGraph;
  selectedReview: Record<string, any>;
  policySnapshot: Record<string, unknown>;
  header: Record<string, unknown>;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
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

function eq(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(value as string);
  if (!Number.isFinite(date.valueOf())) throw new ThemeQuestionGenerationError('ineligible');
  return date.toISOString();
}

function parsedTime(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const time = Date.parse(iso(value));
  return Number.isFinite(time) ? time : null;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function snapshotThemeQuestionWriterInput(input: ThemeQuestionWriterInput) {
  return deepFreeze(structuredClone(input));
}

export function projectThemeQuestionWriterOutput(
  raw: unknown,
  input: ThemeQuestionWriterInput,
  policy: ThemeQuestionGenerationPolicy,
  themeSlug: string
):
  | { status: 'candidate'; content: QuestionContentSnapshot }
  | { status: 'declined' }
  | { status: 'invalid_output' } {
  const parsedOutput = themeQuestionWriterOutputSchema.safeParse(raw);
  if (!parsedOutput.success || !safeTextTree(parsedOutput.data))
    return { status: 'invalid_output' };
  if (parsedOutput.data.status === 'declined') return { status: 'declined' };
  const projected = questionContentSnapshotSchema.safeParse({
    question: parsedOutput.data.question,
    answer: input.fact.canonicalAnswer,
    acceptableAnswers: input.fact.supportedAliases,
    explanation: parsedOutput.data.explanation,
    category: policy.category,
    difficulty: policy.difficulty,
    pillar: policy.pillar,
    tags: policy.tags,
    themeSlug,
  });
  return projected.success
    ? { status: 'candidate', content: projected.data }
    : { status: 'invalid_output' };
}

function safeTextTree(value: unknown): boolean {
  if (typeof value === 'string') {
    if (value.includes('\0')) return false;
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        if (i + 1 >= value.length) return false;
        const low = value.charCodeAt(++i);
        if (low < 0xdc00 || low > 0xdfff) return false;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
    }
    return true;
  }
  if (Array.isArray(value)) return value.every(safeTextTree);
  if (value && typeof value === 'object') return Object.values(value).every(safeTextTree);
  return true;
}

function storedJson(value: unknown): Record<string, any> {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new ThemeQuestionGenerationError('ineligible');
  return parsed as Record<string, any>;
}

async function lockRepairParent(
  db: PoolClient,
  request: ThemeQuestionGenerationRequest,
  writerInput: ThemeQuestionWriterInput,
  policy: ThemeQuestionGenerationPolicy,
  themeSlug: string
): Promise<void> {
  const repair = request.repairOf;
  if (!repair) return;
  if (
    request.candidateId === repair.parentCandidateId ||
    request.questionRevisionId === repair.parentQuestionRevisionId
  )
    throw new ThemeQuestionGenerationError('repair_conflict');
  const result = await db.query(
    `SELECT c.*, q.id AS parent_revision_id, q.contract_version AS parent_revision_contract,
       q.revision AS parent_revision_number, q.content_hash AS parent_revision_hash,
       q.content AS parent_revision_content, g.parent_candidate_id AS generation_parent_candidate_id
     FROM theme_candidates c
     JOIN theme_question_revisions q ON q.candidate_id = c.id AND q.id = $2
     JOIN theme_question_generation_attempts g ON g.candidate_id = c.id
     JOIN theme_question_generation_outcomes o ON o.attempt_id = g.id
       AND o.status = 'persisted' AND o.question_content_hash = c.content_hash
     WHERE c.id = $1 FOR UPDATE OF c, q`,
    [repair.parentCandidateId, repair.parentQuestionRevisionId]
  );
  const parent = result.rows[0] as Record<string, any> | undefined;
  const parsedParent = questionContentSnapshotSchema.safeParse(parent?.content);
  if (
    !parent ||
    parent.job_id !== request.jobId ||
    parent.fact_id !== request.factId ||
    parent.fact_revision_id !== request.factRevisionId ||
    parent.generation_parent_candidate_id !== null ||
    parent.parent_candidate_id !== null ||
    parent.status !== 'pending' ||
    Number(parent.ordinal) === request.ordinal ||
    Number(parent.revision) !== Number(parent.parent_revision_number) ||
    parent.parent_revision_contract !== THEME_RELIABILITY_CONTRACT_VERSION ||
    parent.content_hash !== repair.parentQuestionContentHash ||
    parent.parent_revision_hash !== repair.parentQuestionContentHash ||
    !eq(parent.content, parent.parent_revision_content) ||
    !parsedParent.success ||
    hashQuestionSnapshot(parsedParent.data) !== repair.parentQuestionContentHash ||
    parsedParent.data.answer !== writerInput.fact.canonicalAnswer ||
    !eq(parsedParent.data.acceptableAnswers, writerInput.fact.supportedAliases) ||
    parsedParent.data.category !== policy.category ||
    parsedParent.data.difficulty !== policy.difficulty ||
    parsedParent.data.pillar !== policy.pillar ||
    !eq(parsedParent.data.tags, policy.tags) ||
    parsedParent.data.themeSlug !== themeSlug
  )
    throw new ThemeQuestionGenerationError('repair_conflict');
}

export async function loadGenerationContext(
  db: Pool | PoolClient,
  request: ThemeQuestionGenerationRequest,
  config: ThemeQuestionGenerationConfig,
  evaluatedAt: Date,
  reviewPromptHashOverride?: string
): Promise<ThemeQuestionGenerationContext> {
  const jobResult = await db.query(
    `SELECT j.id, j.candidate_ceiling, g.theme_slug
     FROM theme_preparation_jobs j JOIN theme_game_sessions g ON g.id = j.game_id
     WHERE j.id = $1`,
    [request.jobId]
  );
  const job = jobResult.rows[0] as ThemeQuestionGenerationContext['job'] | undefined;
  if (!job || request.ordinal > job.candidate_ceiling)
    throw new ThemeQuestionGenerationError('ineligible');

  const factResult = await db.query(
    `SELECT f.id AS fact_id, f.canonical_key, r.id AS fact_revision_id, r.fact_id,
       r.contract_version, r.revision, r.statement, r.scope, r.canonical_answer,
       r.supported_aliases, r.content_hash, r.time_sensitive, r.valid_until
     FROM theme_facts f JOIN theme_fact_revisions r ON r.fact_id = f.id
     WHERE f.id = $1 AND r.id = $2`,
    [request.factId, request.factRevisionId]
  );
  const fact = factResult.rows[0] as Record<string, any> | undefined;
  if (!fact) throw new ThemeQuestionGenerationError('ineligible');
  const latestResult = await db.query(
    'SELECT id FROM theme_fact_revisions WHERE fact_id = $1 ORDER BY revision DESC LIMIT 1',
    [request.factId]
  );
  const latestRevisionId = String(latestResult.rows[0]?.id ?? '').toLowerCase();

  const derivationResult = await db.query(
    `SELECT a.*, o.outcome, o.proposal_snapshot, o.output_hash AS derivation_output_hash,
       o.fact_revision_id AS outcome_revision_id, o.fact_content_hash,
       o.bindings_fingerprint
     FROM theme_fact_derivation_attempts a
     JOIN theme_fact_derivation_outcomes o ON o.attempt_id = a.id
     WHERE o.fact_revision_id = $1 AND o.outcome = 'persisted'`,
    [request.factRevisionId]
  );
  if (derivationResult.rows.length !== 1) throw new ThemeQuestionGenerationError('ineligible');
  const derivation = derivationResult.rows[0] as Record<string, any>;
  const factSnapshot = {
    statement: fact.statement,
    scope: fact.scope,
    canonicalAnswer: fact.canonical_answer,
    supportedAliases: fact.supported_aliases,
    timeSensitive: fact.time_sensitive,
    validUntil: fact.valid_until === null ? null : iso(fact.valid_until),
  };
  if (
    !scopedFactRevisionSchema.safeParse({
      contractVersion: fact.contract_version,
      id: request.factRevisionId,
      factId: request.factId,
      revision: fact.revision,
      ...factSnapshot,
      contentHash: fact.content_hash,
    }).success
  )
    throw new ThemeQuestionGenerationError('ineligible');
  if (
    String(fact.fact_id).toLowerCase() !== request.factId ||
    String(fact.fact_revision_id).toLowerCase() !== request.factRevisionId ||
    String(fact.content_hash) !== request.factContentHash ||
    String(derivation.fact_content_hash) !== request.factContentHash ||
    String(derivation.outcome_revision_id).toLowerCase() !== request.factRevisionId ||
    hashThemeFactSnapshot(factSnapshot as never) !== request.factContentHash ||
    hash(derivation.proposal_snapshot) !== derivation.derivation_output_hash
  )
    throw new ThemeQuestionGenerationError('ineligible');

  const derivationPolicy = storedJson(derivation.policy_snapshot);
  const manifest = storedJson(derivation.input_manifest);
  if (
    hash(derivationPolicy) !== derivation.policy_hash ||
    hash(manifest) !== derivation.input_fingerprint ||
    !Array.isArray(manifest.passageIds) ||
    manifest.passageIds.length < 1 ||
    manifest.passageIds.length > MAX_PASSAGES ||
    !manifest.evidence ||
    !Array.isArray(manifest.evidence.passages)
  )
    throw new ThemeQuestionGenerationError('ineligible');
  const passageIds = manifest.passageIds.map((id: unknown) => uuidSchema.parse(id));
  if (new Set(passageIds).size !== passageIds.length)
    throw new ThemeQuestionGenerationError('ineligible');

  const evidenceRowsResult = await db.query<EvidenceRow>(
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
  if (evidenceRowsResult.rows.length !== passageIds.length)
    throw new ThemeQuestionGenerationError('ineligible');
  const evidenceById = new Map(
    evidenceRowsResult.rows.map((row) => [String(row.passage.id).toLowerCase(), row])
  );
  if (evidenceById.size !== passageIds.length) throw new ThemeQuestionGenerationError('ineligible');
  const expectedById = new Map<string, Record<string, any>>(
    manifest.evidence.passages.map((item: Record<string, any>) => [
      String(item.passageId).toLowerCase(),
      item,
    ])
  );
  if (expectedById.size !== passageIds.length) throw new ThemeQuestionGenerationError('ineligible');

  const edgesResult = await db.query<{ passage_id: string; support_kind: string }>(
    `SELECT passage_id, support_kind FROM theme_fact_evidence_passages
     WHERE fact_revision_id = $1 ORDER BY passage_id`,
    [request.factRevisionId]
  );
  const edges = edgesResult.rows.map((edge) => ({
    passageId: String(edge.passage_id).toLowerCase(),
    supportKind: edge.support_kind,
  }));
  const proposal = storedJson(derivation.proposal_snapshot);
  if (
    !Array.isArray(proposal.citations) ||
    hash(proposal.citations) !== derivation.bindings_fingerprint ||
    !eq(
      edges,
      proposal.citations.map((item: Record<string, any>) => ({
        passageId: String(item.passageId).toLowerCase(),
        supportKind: item.supportKind,
      }))
    ) ||
    edges.some((edge) => !passageIds.includes(edge.passageId))
  )
    throw new ThemeQuestionGenerationError('ineligible');
  const edgeKinds = new Map<string, 'supports' | 'conflicts' | 'context'>(
    edges.map((edge) => [edge.passageId, edge.supportKind as 'supports' | 'conflicts' | 'context'])
  );
  const citationById = new Map(
    proposal.citations.map((citation: Record<string, any>) => [
      String(citation.passageId).toLowerCase(),
      citation,
    ])
  );

  const parsedReviewPolicy = themeFactReviewPolicySchema.safeParse(config.factReviewPolicy);
  if (!parsedReviewPolicy.success) throw new ThemeQuestionGenerationError('invalid_configuration');
  const reviewPolicyHash = hash(parsedReviewPolicy.data);
  const currentSourcePolicyVersion = parsedReviewPolicy.data.sourcePolicyVersion;
  const currentExtractorVersion = parsedReviewPolicy.data.extractorVersion;
  if (
    derivationPolicy.sourcePolicyVersion !== currentSourcePolicyVersion ||
    derivationPolicy.extractorVersion !== currentExtractorVersion ||
    config.generationPolicy.sourcePolicyVersion !== currentSourcePolicyVersion ||
    config.generationPolicy.extractorVersion !== currentExtractorVersion ||
    !Array.isArray(derivationPolicy.allowedSourceClasses) ||
    !Array.isArray(parsedReviewPolicy.data.allowedSourceClasses)
  )
    throw new ThemeQuestionGenerationError('ineligible');

  let totalCharacters = 0;
  let reviewsComplete = true;
  const validUntilLimits: number[] = [];
  const writerEvidence: ThemeQuestionWriterInput['evidence'] = [];
  const reviewEvidence: Array<Record<string, unknown>> = [];
  const originByPassage = new Map<string, string>();
  for (const passageId of passageIds) {
    const row = evidenceById.get(passageId);
    const expected = expectedById.get(passageId);
    if (!row || !expected || !row.binding || !row.registry)
      throw new ThemeQuestionGenerationError('ineligible');
    const passage = evidencePassageSchema.safeParse({
      contractVersion: row.passage.contract_version,
      id: row.passage.id,
      documentId: row.passage.document_id,
      ordinal: row.passage.ordinal,
      locator: row.passage.locator,
      text: row.passage.passage_text,
      contentHash: row.passage.content_hash,
    });
    const document = sourceDocumentSchema.safeParse({
      contractVersion: row.document.contract_version,
      id: row.document.id,
      requestedUrl: row.document.requested_url,
      finalUrl: row.document.final_url,
      canonicalUrl: row.document.canonical_url,
      publisherId: row.document.publisher_id,
      sourceClass: row.document.source_class,
      publisher: row.document.publisher,
      originGroup: row.document.origin_group,
      sourcePolicyVersion: row.document.source_policy_version,
      extractorVersion: row.document.extractor_version,
      title: row.document.title,
      language: row.document.language,
      status: row.document.status,
      contentHash: row.document.content_hash,
      retrievedAt: iso(row.document.retrieved_at),
      publishedAt: row.document.published_at === null ? null : iso(row.document.published_at),
      sourceUpdatedAt:
        row.document.source_updated_at === null ? null : iso(row.document.source_updated_at),
      validUntil: row.document.valid_until === null ? null : iso(row.document.valid_until),
      httpStatus: row.document.http_status,
      mediaType: row.document.media_type,
    });
    const registry = themeSourceRegistrySchema.safeParse(row.registry.manifest);
    if (
      !passage.success ||
      !document.success ||
      !registry.success ||
      passage.data.documentId !== document.data.id ||
      hashText(passage.data.text) !== passage.data.contentHash ||
      document.data.status !== 'retrieved' ||
      document.data.httpStatus !== 200 ||
      document.data.sourcePolicyVersion !== currentSourcePolicyVersion ||
      document.data.extractorVersion !== currentExtractorVersion ||
      !parsedReviewPolicy.data.allowedSourceClasses.includes(document.data.sourceClass) ||
      !config.generationPolicy.allowedSourceClasses.includes(document.data.sourceClass) ||
      !derivationPolicy.allowedSourceClasses.includes(document.data.sourceClass) ||
      row.binding.source_policy_version !== currentSourcePolicyVersion ||
      row.document.source_policy_version !== row.binding.source_policy_version ||
      row.document.extractor_version !== currentExtractorVersion ||
      hashThemeSourceRegistry(registry.data) !== row.registry.manifest_hash ||
      row.registry.source_policy_version !== currentSourcePolicyVersion ||
      row.binding.registry_hash !== row.registry.manifest_hash
    )
      throw new ThemeQuestionGenerationError('ineligible');
    const resolution = resolveThemeSourceUrl(registry.data, document.data.requestedUrl);
    if (
      resolution.status !== 'matched' ||
      resolution.entry.id !== row.binding.entry_id ||
      resolution.entry.publisherId !== document.data.publisherId ||
      resolution.entry.publisherName !== document.data.publisher ||
      resolution.entry.originGroup !== document.data.originGroup ||
      resolution.entry.sourceClass !== document.data.sourceClass
    )
      throw new ThemeQuestionGenerationError('ineligible');
    for (const url of [document.data.finalUrl, document.data.canonicalUrl]) {
      const resolved = resolveThemeSourceUrl(registry.data, url);
      if (resolved.status !== 'matched' || resolved.entry.id !== resolution.entry.id)
        throw new ThemeQuestionGenerationError('ineligible');
    }
    const expectedBinding = {
      sourcePolicyVersion: row.binding.source_policy_version,
      registryHash: row.binding.registry_hash,
      entryId: row.binding.entry_id,
    };
    const expectedRegistry = {
      contractVersion: row.registry.contract_version,
      sourcePolicyVersion: row.registry.source_policy_version,
      manifestHash: row.registry.manifest_hash,
    };
    const expectedDocument = {
      id: row.document.id,
      contractVersion: row.document.contract_version,
      requestedUrl: row.document.requested_url,
      finalUrl: row.document.final_url,
      canonicalUrl: row.document.canonical_url,
      publisherId: row.document.publisher_id,
      sourceClass: row.document.source_class,
      publisher: row.document.publisher,
      originGroup: row.document.origin_group,
      sourcePolicyVersion: row.document.source_policy_version,
      extractorVersion: row.document.extractor_version,
      title: row.document.title,
      language: row.document.language,
      status: row.document.status,
      contentHash: row.document.content_hash,
      retrievedAt: iso(row.document.retrieved_at),
      publishedAt: row.document.published_at === null ? null : iso(row.document.published_at),
      sourceUpdatedAt:
        row.document.source_updated_at === null ? null : iso(row.document.source_updated_at),
      validUntil: row.document.valid_until === null ? null : iso(row.document.valid_until),
      httpStatus: row.document.http_status,
      mediaType: row.document.media_type,
    };
    if (
      !eq(expected.registryBinding, expectedBinding) ||
      !eq(expected.registry, expectedRegistry) ||
      !eq(expected.document, expectedDocument) ||
      String(expected.passageId).toLowerCase() !== passageId ||
      expected.passageContentHash !== passage.data.contentHash ||
      expected.ordinal !== passage.data.ordinal ||
      expected.locator !== passage.data.locator
    )
      throw new ThemeQuestionGenerationError('ineligible');

    const retrievedAt = parsedTime(document.data.retrievedAt);
    const maxAge = Math.min(
      parsedReviewPolicy.data.maxSourceAgeMs,
      config.generationPolicy.maxSourceAgeMs,
      derivationPolicy.maxSourceAgeMs
    );
    if (retrievedAt === null || retrievedAt > evaluatedAt.valueOf()) reviewsComplete = false;
    validUntilLimits.push(
      retrievedAt === null ? 0 : retrievedAt + maxAge,
      document.data.validUntil === null
        ? Number.MAX_SAFE_INTEGER
        : parsedTime(document.data.validUntil)!,
      Number.MAX_SAFE_INTEGER
    );
    if (document.data.validUntil !== null && parsedTime(document.data.validUntil) === null)
      reviewsComplete = false;
    totalCharacters += passage.data.text.length;
    if (totalCharacters > MAX_PASSAGE_CHARACTERS)
      throw new ThemeQuestionGenerationError('ineligible');
    const citation = citationById.get(passageId) as Record<string, any> | undefined;
    if (citation && citation.passageContentHash !== passage.data.contentHash)
      throw new ThemeQuestionGenerationError('ineligible');
    const supportKind: 'supports' | 'conflicts' | 'context' | 'uncited' =
      edgeKinds.get(passageId) ?? 'uncited';
    originByPassage.set(passageId, document.data.originGroup);
    writerEvidence.push({
      passageId,
      passageContentHash: passage.data.contentHash,
      text: passage.data.text,
      originGroup: document.data.originGroup,
      sourceClass: document.data.sourceClass,
      supportKind,
    });
    reviewEvidence.push({
      passageId,
      passageContentHash: passage.data.contentHash,
      text: passage.data.text,
      originGroup: document.data.originGroup,
      supportKind,
    });
  }
  const supportingOrigins = new Set(
    edges
      .filter((edge) => edge.supportKind === 'supports')
      .map((edge) => originByPassage.get(edge.passageId))
      .filter((origin): origin is string => Boolean(origin))
  );
  if (supportingOrigins.size < parsedReviewPolicy.data.minimumOriginGroups)
    throw new ThemeQuestionGenerationError('ineligible');
  if (factSnapshot.validUntil !== null) {
    const factExpiry = parsedTime(factSnapshot.validUntil);
    if (factExpiry === null) throw new ThemeQuestionGenerationError('ineligible');
    validUntilLimits.push(factExpiry);
  }
  const evidenceFingerprint = hash({
    inputFingerprint: derivation.input_fingerprint,
    fact: factSnapshot,
    edges,
  });
  const reviewInputBase = {
    contractVersion: 'theme-fact-review-v1',
    statement: factSnapshot.statement,
    scope: factSnapshot.scope,
    canonicalAnswer: factSnapshot.canonicalAnswer,
    supportedAliases: factSnapshot.supportedAliases,
    evidence: reviewEvidence,
  };
  const reviewInputSchema = z.object({
    contractVersion: z.literal('theme-fact-review-v1'),
    statement: z.string(),
    scope: z.record(z.string(), z.unknown()),
    canonicalAnswer: z.string(),
    supportedAliases: z.array(z.string()),
    evidence: z.array(
      z.object({
        passageId: z.string(),
        passageContentHash: z.string(),
        text: z.string(),
        originGroup: z.string(),
        supportKind: z.enum(['supports', 'conflicts', 'context', 'uncited']),
      })
    ),
  });
  const parsedReviewInput = reviewInputSchema.safeParse(reviewInputBase);
  if (!parsedReviewInput.success) throw new ThemeQuestionGenerationError('ineligible');
  const currentReviewInputFingerprint = hash(parsedReviewInput.data);

  const reviewsResult = await db.query(
    `SELECT a.*, o.status AS outcome_status, o.aggregate_verdict, o.dimensions,
       o.output_hash AS review_output_hash, o.valid_until, o.failure_code
     FROM theme_fact_review_attempts a
     LEFT JOIN theme_fact_review_outcomes o ON o.attempt_id = a.id
     WHERE a.fact_revision_id = $1 ORDER BY a.review_sequence`,
    [request.factRevisionId]
  );
  const reviews = reviewsResult.rows.map((row: Record<string, any>) => {
    let reviewInputManifest: Record<string, any>;
    try {
      reviewInputManifest = storedJson(row.input_manifest);
    } catch {
      reviewsComplete = false;
      reviewInputManifest = {};
    }
    if (
      reviewInputManifest.inputFingerprint !== derivation.input_fingerprint ||
      reviewInputManifest.evidenceFingerprint !== evidenceFingerprint ||
      row.input_fingerprint !== currentReviewInputFingerprint
    ) {
      reviewsComplete = false;
    }
    return {
      attemptId: String(row.id).toLowerCase(),
      derivationAttemptId: String(row.derivation_attempt_id).toLowerCase(),
      factRevisionId: String(row.fact_revision_id).toLowerCase(),
      factContentHash: String(row.fact_content_hash),
      reviewSequence: Number(row.review_sequence),
      reviewerKind: row.reviewer_kind,
      reviewerId: row.reviewer_id,
      provider: row.provider,
      model: row.model,
      executionId: String(row.execution_id).toLowerCase(),
      // The eligibility kernel binds to S6a's derivation input, not S6b's reviewer-payload hash.
      inputFingerprint: String(derivation.input_fingerprint),
      evidenceFingerprint: reviewInputManifest.evidenceFingerprint ?? '',
      policyVersion: row.review_policy_version,
      policyHash: row.policy_hash,
      promptVersion: row.prompt_version,
      promptHash: row.prompt_hash,
      outcome: row.outcome_status
        ? {
            status: row.outcome_status,
            aggregateVerdict: row.aggregate_verdict,
            dimensions: row.dimensions,
            outputHash: row.review_output_hash,
            validUntil: row.valid_until === null ? null : iso(row.valid_until),
          }
        : null,
    };
  });
  const selectedReview = reviews.find((review) => review.attemptId === request.factReviewAttemptId);
  if (
    !selectedReview ||
    selectedReview.outcome?.status !== 'reviewed' ||
    selectedReview.outcome.aggregateVerdict !== 'pass' ||
    selectedReview.outcome.outputHash !== request.factReviewOutputHash
  )
    throw new ThemeQuestionGenerationError('ineligible');

  const graph = {
    now: evaluatedAt.toISOString(),
    latestRevisionId,
    fact: {
      id: String(fact.fact_revision_id).toLowerCase(),
      contentHash: String(fact.content_hash),
      supportedAliases: fact.supported_aliases,
      validUntil: fact.valid_until === null ? null : iso(fact.valid_until),
      timeSensitive: fact.time_sensitive,
    },
    derivation: {
      attemptId: String(derivation.id).toLowerCase(),
      executionId: String(derivation.execution_id).toLowerCase(),
      producerKind: derivation.producer_kind,
      producerId: derivation.producer_id,
      provider: derivation.provider,
      model: derivation.model,
      outcome: derivation.outcome,
      factRevisionId: String(derivation.outcome_revision_id).toLowerCase(),
      factContentHash: String(derivation.fact_content_hash),
      inputFingerprint: String(derivation.input_fingerprint),
      bindingsFingerprint: String(derivation.bindings_fingerprint),
    },
    evidence: {
      complete: reviewsComplete,
      fingerprint: evidenceFingerprint,
      bindingsFingerprint: String(derivation.bindings_fingerprint),
      validUntil: validUntilLimits.length
        ? new Date(Math.min(...validUntilLimits)).toISOString()
        : null,
      supportOriginCount: supportingOrigins.size,
      minimumOriginGroups: Math.max(
        parsedReviewPolicy.data.minimumOriginGroups,
        config.generationPolicy.minimumOriginGroups
      ),
      hasConflictEdge: edges.some((edge) => edge.supportKind === 'conflicts'),
    },
    reviews,
    reviewPolicyVersion: config.factReviewPolicyVersion,
    reviewPolicyHash,
    reviewPromptVersion: config.factReviewPromptVersion,
    reviewPromptHash: reviewPromptHashOverride ?? hashText(config.factReviewPromptText),
  } satisfies ThemeFactReviewEligibilityGraph;
  const eligibility = evaluateThemeFactReviewEligibility(graph);

  const writerInputParsed = themeQuestionWriterInputSchema.safeParse({
    contractVersion: THEME_QUESTION_GENERATION_CONTRACT_VERSION,
    fact: {
      id: request.factId,
      revisionId: request.factRevisionId,
      contentHash: request.factContentHash,
      statement: factSnapshot.statement,
      scope: factSnapshot.scope,
      canonicalAnswer: factSnapshot.canonicalAnswer,
      supportedAliases: factSnapshot.supportedAliases,
    },
    evidence: writerEvidence,
  });
  if (!writerInputParsed.success) throw new ThemeQuestionGenerationError('ineligible');

  const policySnapshot = {
    generationPolicy: config.generationPolicy,
    factReviewPolicyVersion: config.factReviewPolicyVersion,
    factReviewPolicy: parsedReviewPolicy.data,
    factReviewPolicyHash: reviewPolicyHash,
    factReviewPromptVersion: config.factReviewPromptVersion,
    factReviewPromptHash: hashText(config.factReviewPromptText),
    themeSlug: job.theme_slug,
  };
  const inputManifest = {
    request,
    factSnapshot,
    derivationAttemptId: derivation.id,
    derivationInputFingerprint: derivation.input_fingerprint,
    factReviewAttemptId: selectedReview.attemptId,
    factReviewOutputHash: selectedReview.outcome.outputHash,
    evidenceFingerprint,
    evidence: writerInputParsed.data.evidence.map((item) => ({
      passageId: item.passageId,
      passageContentHash: item.passageContentHash,
      originGroup: item.originGroup,
      sourceClass: item.sourceClass,
      supportKind: item.supportKind,
    })),
    themeSlug: job.theme_slug,
  };
  const header = {
    id: request.attemptId,
    contract_version: THEME_QUESTION_GENERATION_CONTRACT_VERSION,
    job_id: request.jobId,
    ordinal: request.ordinal,
    candidate_id: request.candidateId,
    question_revision_id: request.questionRevisionId,
    parent_candidate_id: request.repairOf?.parentCandidateId ?? null,
    parent_question_revision_id: request.repairOf?.parentQuestionRevisionId ?? null,
    parent_question_content_hash: request.repairOf?.parentQuestionContentHash ?? null,
    fact_id: request.factId,
    fact_revision_id: request.factRevisionId,
    fact_content_hash: request.factContentHash,
    fact_review_attempt_id: selectedReview.attemptId,
    fact_review_verdict: 'pass',
    fact_review_output_hash: selectedReview.outcome.outputHash,
    writer_kind: config.writer.kind,
    writer_id: config.writer.id,
    provider: config.writer.provider,
    model: config.writer.model,
    execution_id: config.executionId.toLowerCase(),
    generation_policy_version: config.generationPolicy.generationPolicyVersion,
    policy_snapshot: policySnapshot,
    policy_hash: hash(policySnapshot),
    prompt_version: config.promptVersion,
    prompt_hash: hashText(config.promptText),
    prompt_snapshot: config.promptText,
    input_manifest: inputManifest,
    input_fingerprint: hash(inputManifest),
    eligibility_fingerprint: eligibility.fingerprint,
    evaluated_at: evaluatedAt.toISOString(),
  };
  return {
    job,
    fact,
    factSnapshot,
    derivation,
    evidenceFingerprint,
    writerInput: writerInputParsed.data,
    eligibility,
    graph,
    selectedReview: selectedReview as Record<string, any>,
    policySnapshot,
    header,
  };
}

function stableHeaderMatches(actual: Record<string, any>, expected: Record<string, any>): boolean {
  const stableFields = [
    'id',
    'contract_version',
    'job_id',
    'ordinal',
    'candidate_id',
    'question_revision_id',
    'parent_candidate_id',
    'parent_question_revision_id',
    'parent_question_content_hash',
    'fact_id',
    'fact_revision_id',
    'fact_content_hash',
    'fact_review_attempt_id',
    'fact_review_verdict',
    'fact_review_output_hash',
    'writer_kind',
    'writer_id',
    'provider',
    'model',
    'execution_id',
    'generation_policy_version',
    'policy_hash',
    'policy_snapshot',
    'prompt_version',
    'prompt_hash',
    'prompt_snapshot',
    'input_fingerprint',
    'input_manifest',
  ];
  return stableFields.every((key) => eq(actual[key], expected[key]));
}

export async function runThemeQuestionGenerationTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch {
    throw new ThemeQuestionGenerationError('storage_failure');
  }
  let discarded = false;
  try {
    try {
      await client.query('BEGIN');
    } catch (error) {
      client.release(error instanceof Error ? error : new Error('database begin failure'));
      discarded = true;
      throw new ThemeQuestionGenerationError('storage_failure');
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
        discarded = true;
        throw new ThemeQuestionGenerationError('storage_failure');
      }
      if (error instanceof ThemeQuestionGenerationError) throw error;
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        throw new ThemeQuestionGenerationError('candidate_conflict');
      throw new ThemeQuestionGenerationError('storage_failure');
    }
    try {
      await client.query('COMMIT');
    } catch (error) {
      client.release(error instanceof Error ? error : new Error('database commit failure'));
      discarded = true;
      throw new ThemeQuestionGenerationError('storage_unknown_outcome');
    }
    return result;
  } finally {
    if (!discarded) client.release();
  }
}

async function storageSafe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ThemeQuestionGenerationError) throw error;
    throw new ThemeQuestionGenerationError('storage_failure');
  }
}

function sameRequestAndConfig(
  row: Record<string, any>,
  request: ThemeQuestionGenerationRequest,
  config: ThemeQuestionGenerationConfig
): boolean {
  const policy = {
    generationPolicy: config.generationPolicy,
    factReviewPolicyVersion: config.factReviewPolicyVersion,
    factReviewPolicy: config.factReviewPolicy,
    factReviewPolicyHash: hash(config.factReviewPolicy),
    factReviewPromptVersion: config.factReviewPromptVersion,
    factReviewPromptHash: hashText(config.factReviewPromptText),
  };
  const storedPolicy = storedJson(row.policy_snapshot);
  const storedManifest = storedJson(row.input_manifest);
  const storedThemeSlug = storedPolicy.themeSlug;
  delete storedPolicy.themeSlug;
  return (
    String(row.id).toLowerCase() === request.attemptId &&
    String(row.job_id).toLowerCase() === request.jobId &&
    Number(row.ordinal) === request.ordinal &&
    String(row.candidate_id).toLowerCase() === request.candidateId &&
    String(row.question_revision_id).toLowerCase() === request.questionRevisionId &&
    (row.parent_candidate_id === null
      ? request.repairOf === undefined
      : String(row.parent_candidate_id).toLowerCase() === request.repairOf?.parentCandidateId) &&
    (row.parent_question_revision_id === null
      ? request.repairOf === undefined
      : String(row.parent_question_revision_id).toLowerCase() ===
        request.repairOf?.parentQuestionRevisionId) &&
    (row.parent_question_content_hash === null
      ? request.repairOf === undefined
      : row.parent_question_content_hash === request.repairOf?.parentQuestionContentHash) &&
    String(row.fact_id).toLowerCase() === request.factId &&
    String(row.fact_revision_id).toLowerCase() === request.factRevisionId &&
    row.fact_content_hash === request.factContentHash &&
    String(row.fact_review_attempt_id).toLowerCase() === request.factReviewAttemptId &&
    row.fact_review_output_hash === request.factReviewOutputHash &&
    row.writer_kind === config.writer.kind &&
    row.writer_id === config.writer.id &&
    row.provider === config.writer.provider &&
    row.model === config.writer.model &&
    String(row.execution_id).toLowerCase() === config.executionId.toLowerCase() &&
    row.generation_policy_version === config.generationPolicy.generationPolicyVersion &&
    typeof storedThemeSlug === 'string' &&
    storedThemeSlug.length > 0 &&
    eq(storedPolicy, policy) &&
    row.prompt_version === config.promptVersion &&
    row.prompt_hash === hashText(config.promptText) &&
    row.prompt_snapshot === config.promptText &&
    eq(storedManifest.request, request)
  );
}

async function readOutcome(db: Pool | PoolClient, attemptId: string) {
  const result = await db.query(
    'SELECT * FROM theme_question_generation_outcomes WHERE attempt_id = $1',
    [attemptId]
  );
  return result.rows[0] as Record<string, any> | undefined;
}

async function replay(
  db: Pool | PoolClient,
  request: ThemeQuestionGenerationRequest
): Promise<ThemeQuestionGenerationDecision> {
  const outcome = await readOutcome(db, request.attemptId);
  if (!outcome) throw new ThemeQuestionGenerationError('attempt_unresolved');
  if (outcome.status !== 'persisted')
    return {
      status: outcome.status,
      attemptId: request.attemptId,
      failureCode: outcome.failure_code,
    };
  const result = await db.query(
    `SELECT c.*, q.contract_version AS revision_contract, q.revision AS question_revision,
       q.content_hash AS revision_content_hash, q.content AS revision_content
     FROM theme_candidates c JOIN theme_question_revisions q ON q.candidate_id = c.id
     WHERE c.id = $1 AND q.id = $2`,
    [request.candidateId, request.questionRevisionId]
  );
  const row = result.rows[0] as Record<string, any> | undefined;
  const content = row?.content;
  if (
    !row ||
    row.job_id !== request.jobId ||
    Number(row.ordinal) !== request.ordinal ||
    row.fact_id !== request.factId ||
    row.fact_revision_id !== request.factRevisionId ||
    (request.repairOf
      ? row.parent_candidate_id !== request.repairOf.parentCandidateId
      : row.parent_candidate_id !== null) ||
    row.attempt_id !== null ||
    !['pending', 'reviewing', 'accepted', 'rejected', 'duplicate', 'superseded'].includes(
      row.status
    ) ||
    Number(row.revision) !== Number(row.question_revision) ||
    row.content_hash !== outcome.question_content_hash ||
    row.revision_content_hash !== outcome.question_content_hash ||
    !eq(content, row.revision_content) ||
    hashQuestionSnapshot(content) !== outcome.question_content_hash ||
    row.revision_contract !== THEME_RELIABILITY_CONTRACT_VERSION
  )
    throw new ThemeQuestionGenerationError('storage_failure');
  const parsed = questionContentSnapshotSchema.safeParse(content);
  if (!parsed.success) throw new ThemeQuestionGenerationError('storage_failure');
  return {
    status: 'persisted',
    attemptId: request.attemptId,
    candidateId: request.candidateId,
    questionRevisionId: request.questionRevisionId,
    contentHash: outcome.question_content_hash,
    content: parsed.data,
  };
}

export function createPostgresThemeQuestionGenerationRepository(
  pool: Pool,
  rawConfig: ThemeQuestionGenerationConfig,
  now: () => Date = () => new Date()
) {
  const policyParsed = themeQuestionGenerationPolicySchema.safeParse(rawConfig.generationPolicy);
  const factReviewPolicyParsed = themeFactReviewPolicySchema.safeParse(rawConfig.factReviewPolicy);
  const writerParsed = writerIdentitySchema.safeParse(rawConfig.writer);
  if (
    !policyParsed.success ||
    !factReviewPolicyParsed.success ||
    !writerParsed.success ||
    !uuidSchema.safeParse(rawConfig.executionId).success ||
    !rawConfig.promptVersion.trim() ||
    !rawConfig.promptText.trim() ||
    rawConfig.promptText.length > 32_000 ||
    !rawConfig.factReviewPolicyVersion.trim() ||
    !rawConfig.factReviewPromptVersion.trim() ||
    !rawConfig.factReviewPromptText.trim()
  )
    throw new ThemeQuestionGenerationError('invalid_configuration');
  if (
    new Set(policyParsed.data.allowedSourceClasses).size !==
    policyParsed.data.allowedSourceClasses.length
  )
    throw new ThemeQuestionGenerationError('invalid_configuration');
  if (
    new Set(factReviewPolicyParsed.data.allowedSourceClasses).size !==
    factReviewPolicyParsed.data.allowedSourceClasses.length
  )
    throw new ThemeQuestionGenerationError('invalid_configuration');
  const config: ThemeQuestionGenerationConfig = {
    ...rawConfig,
    writer: writerParsed.data,
    generationPolicy: policyParsed.data,
    factReviewPolicy: factReviewPolicyParsed.data,
  };

  return {
    async generate(
      rawRequest: ThemeQuestionGenerationRequest,
      writer: ThemeQuestionWriter
    ): Promise<ThemeQuestionGenerationDecision> {
      const parsedRequest = themeQuestionGenerationRequestSchema.safeParse(rawRequest);
      if (!parsedRequest.success || typeof writer !== 'function')
        throw new ThemeQuestionGenerationError('invalid_request');
      const request = parsedRequest.data;
      const priorResult = await storageSafe(() =>
        pool.query('SELECT * FROM theme_question_generation_attempts WHERE id = $1', [
          request.attemptId,
        ])
      );
      const prior = priorResult.rows[0] as Record<string, any> | undefined;
      if (prior) {
        if (!sameRequestAndConfig(prior, request, config))
          throw new ThemeQuestionGenerationError('attempt_conflict');
        return storageSafe(() => replay(pool, request));
      }

      const evaluatedAt = now();
      if (!(evaluatedAt instanceof Date) || !Number.isFinite(evaluatedAt.valueOf()))
        throw new ThemeQuestionGenerationError('invalid_request');
      const optimistic = await storageSafe(() =>
        loadGenerationContext(pool, request, config, evaluatedAt)
      );
      if (
        !optimistic.eligibility.eligible ||
        optimistic.eligibility.attemptId !== request.factReviewAttemptId ||
        optimistic.selectedReview.outcome?.outputHash !== request.factReviewOutputHash
      ) {
        throw new ThemeQuestionGenerationError('ineligible');
      }

      const registration = await runThemeQuestionGenerationTransaction(pool, async (client) => {
        await client.query('SELECT id FROM theme_facts WHERE id = $1 FOR UPDATE', [request.factId]);
        await client.query(
          'SELECT id FROM theme_fact_revisions WHERE id = $1 AND fact_id = $2 FOR UPDATE',
          [request.factRevisionId, request.factId]
        );
        const existing = await client.query(
          'SELECT * FROM theme_question_generation_attempts WHERE id = $1 FOR UPDATE',
          [request.attemptId]
        );
        if (existing.rows[0]) {
          if (!stableHeaderMatches(existing.rows[0] as Record<string, any>, optimistic.header))
            throw new ThemeQuestionGenerationError('attempt_conflict');
          const existingOutcome = await readOutcome(client, request.attemptId);
          if (!existingOutcome) throw new ThemeQuestionGenerationError('attempt_unresolved');
          return { kind: 'replay' as const };
        }
        const lockedEvaluatedAt = now();
        if (!(lockedEvaluatedAt instanceof Date) || !Number.isFinite(lockedEvaluatedAt.valueOf()))
          throw new ThemeQuestionGenerationError('invalid_request');
        const lockedContext = await loadGenerationContext(
          client,
          request,
          config,
          lockedEvaluatedAt
        );
        if (
          !lockedContext.eligibility.eligible ||
          lockedContext.eligibility.attemptId !== request.factReviewAttemptId ||
          lockedContext.selectedReview.outcome?.outputHash !== request.factReviewOutputHash
        )
          throw new ThemeQuestionGenerationError('ineligible');
        await lockRepairParent(
          client,
          request,
          lockedContext.writerInput,
          config.generationPolicy,
          String((lockedContext.header.policy_snapshot as Record<string, unknown>).themeSlug)
        );
        const occupied = await client.query(
          'SELECT id FROM theme_candidates WHERE job_id = $1 AND ordinal = $2',
          [request.jobId, request.ordinal]
        );
        if (occupied.rowCount) throw new ThemeQuestionGenerationError('candidate_conflict');
        const candidateIdOccupied = await client.query(
          'SELECT id FROM theme_candidates WHERE id = $1',
          [request.candidateId]
        );
        const questionRevisionIdOccupied = await client.query(
          'SELECT id FROM theme_question_revisions WHERE id = $1',
          [request.questionRevisionId]
        );
        if (candidateIdOccupied.rowCount || questionRevisionIdOccupied.rowCount)
          throw new ThemeQuestionGenerationError('candidate_conflict');
        await client.query(
          `INSERT INTO theme_question_generation_attempts
           (id, contract_version, job_id, ordinal, candidate_id, question_revision_id,
            parent_candidate_id, parent_question_revision_id, parent_question_content_hash, fact_id,
            fact_revision_id, fact_content_hash, fact_review_attempt_id, fact_review_verdict,
            fact_review_output_hash, writer_kind, writer_id, provider, model, execution_id,
            generation_policy_version, policy_snapshot, policy_hash, prompt_version, prompt_hash,
            prompt_snapshot, input_manifest, input_fingerprint, eligibility_fingerprint, evaluated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pass',$14,$15,$16,$17,$18,$19,$20,
                  $21::jsonb,$22,$23,$24,$25,$26::jsonb,$27,$28,$29)`,
          [
            lockedContext.header.id,
            lockedContext.header.contract_version,
            lockedContext.header.job_id,
            lockedContext.header.ordinal,
            lockedContext.header.candidate_id,
            lockedContext.header.question_revision_id,
            lockedContext.header.parent_candidate_id,
            lockedContext.header.parent_question_revision_id,
            lockedContext.header.parent_question_content_hash,
            lockedContext.header.fact_id,
            lockedContext.header.fact_revision_id,
            lockedContext.header.fact_content_hash,
            lockedContext.header.fact_review_attempt_id,
            lockedContext.header.fact_review_output_hash,
            lockedContext.header.writer_kind,
            lockedContext.header.writer_id,
            lockedContext.header.provider,
            lockedContext.header.model,
            lockedContext.header.execution_id,
            lockedContext.header.generation_policy_version,
            JSON.stringify(lockedContext.header.policy_snapshot),
            lockedContext.header.policy_hash,
            lockedContext.header.prompt_version,
            lockedContext.header.prompt_hash,
            lockedContext.header.prompt_snapshot,
            JSON.stringify(lockedContext.header.input_manifest),
            lockedContext.header.input_fingerprint,
            lockedContext.header.eligibility_fingerprint,
            lockedContext.header.evaluated_at,
          ]
        );
        return {
          kind: 'dispatch' as const,
          header: lockedContext.header,
          writerInput: lockedContext.writerInput,
        };
      });
      if (registration.kind === 'replay') return storageSafe(() => replay(pool, request));
      const attemptHeader = registration.header;
      const stableInput = snapshotThemeQuestionWriterInput(registration.writerInput);

      let status: 'persisted' | 'declined' | 'invalid_output' | 'ineligible' | 'failed' =
        'persisted';
      let failureCode: string | null = null;
      let content: QuestionContentSnapshot | null = null;
      try {
        const raw = await writer(structuredClone(stableInput));
        const projected = projectThemeQuestionWriterOutput(
          raw,
          stableInput,
          config.generationPolicy,
          String((attemptHeader.policy_snapshot as Record<string, unknown>).themeSlug)
        );
        if (projected.status === 'invalid_output') {
          status = 'invalid_output';
          failureCode = 'invalid_output';
        } else if (projected.status === 'declined') {
          status = 'declined';
          failureCode = 'writer_declined';
        } else {
          content = projected.content;
        }
      } catch {
        status = 'failed';
        failureCode = 'writer_failure';
      }

      try {
        await runThemeQuestionGenerationTransaction(pool, async (client) => {
          await client.query('SELECT id FROM theme_facts WHERE id = $1 FOR UPDATE', [
            request.factId,
          ]);
          await client.query(
            'SELECT id FROM theme_fact_revisions WHERE id = $1 AND fact_id = $2 FOR UPDATE',
            [request.factRevisionId, request.factId]
          );
          const attemptResult = await client.query(
            'SELECT * FROM theme_question_generation_attempts WHERE id = $1 FOR UPDATE',
            [request.attemptId]
          );
          const storedAttempt = attemptResult.rows[0] as Record<string, any> | undefined;
          if (!storedAttempt || !stableHeaderMatches(storedAttempt, attemptHeader))
            throw new ThemeQuestionGenerationError('attempt_conflict');
          const completedAt = now();
          if (!(completedAt instanceof Date) || !Number.isFinite(completedAt.valueOf()))
            throw new ThemeQuestionGenerationError('storage_failure');
          let current: ThemeQuestionGenerationContext | null = null;
          try {
            current = await loadGenerationContext(client, request, config, completedAt);
          } catch (error) {
            if (!(error instanceof ThemeQuestionGenerationError) || error.code !== 'ineligible')
              throw error;
          }
          let stillEligible = false;
          if (current) {
            const historicalTime = new Date(iso(storedAttempt.evaluated_at));
            const historicalDecision = evaluateThemeFactReviewEligibility({
              ...current.graph,
              now: historicalTime.toISOString(),
            });
            stillEligible =
              current.eligibility.eligible &&
              current.eligibility.attemptId === request.factReviewAttemptId &&
              historicalDecision.eligible &&
              historicalDecision.fingerprint === storedAttempt.eligibility_fingerprint;
          }
          if (!stillEligible) {
            status = 'ineligible';
            failureCode = 'ineligible';
            content = null;
          }
          await lockRepairParent(
            client,
            request,
            stableInput,
            config.generationPolicy,
            String((attemptHeader.policy_snapshot as Record<string, unknown>).themeSlug)
          );
          let questionContentHash = content ? hashQuestionSnapshot(content) : null;
          if (
            questionContentHash &&
            request.repairOf &&
            questionContentHash === request.repairOf.parentQuestionContentHash
          ) {
            status = 'failed';
            failureCode = 'repair_unchanged';
            content = null;
            questionContentHash = null;
          }
          if (content && questionContentHash) {
            await client.query(
              `INSERT INTO theme_candidates
             (id, job_id, attempt_id, parent_candidate_id, fact_id, fact_revision_id, ordinal,
              revision, status, content_hash, content, rejection_reasons)
             VALUES ($1,$2,NULL,$3,$4,$5,$6,1,'pending',$7,$8::jsonb,'[]'::jsonb)`,
              [
                request.candidateId,
                request.jobId,
                request.repairOf?.parentCandidateId ?? null,
                request.factId,
                request.factRevisionId,
                request.ordinal,
                questionContentHash,
                JSON.stringify(content),
              ]
            );
            await client.query(
              `INSERT INTO theme_question_revisions
             (id, contract_version, question_id, candidate_id, revision, content_hash, content)
             VALUES ($1,$2,NULL,$3,1,$4,$5::jsonb)`,
              [
                request.questionRevisionId,
                THEME_RELIABILITY_CONTRACT_VERSION,
                request.candidateId,
                questionContentHash,
                JSON.stringify(content),
              ]
            );
            status = 'persisted';
            failureCode = null;
          }
          const outcomeValues = [
            request.attemptId,
            request.jobId,
            request.ordinal,
            request.candidateId,
            request.questionRevisionId,
            request.factId,
            request.factRevisionId,
            request.factContentHash,
            request.factReviewAttemptId,
            request.factReviewOutputHash,
            status,
            questionContentHash,
            failureCode,
          ];
          await client.query(
            `INSERT INTO theme_question_generation_outcomes
           (attempt_id, job_id, ordinal, candidate_id, question_revision_id, fact_id,
            fact_revision_id, fact_content_hash, fact_review_attempt_id, fact_review_output_hash,
            status, question_content_hash, failure_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            outcomeValues
          );
          return { status, questionContentHash };
        });
      } catch (error) {
        if (!(error instanceof ThemeQuestionGenerationError) || error.code !== 'candidate_conflict')
          throw error;
        await runThemeQuestionGenerationTransaction(pool, async (client) => {
          await client.query('SELECT id FROM theme_facts WHERE id = $1 FOR UPDATE', [
            request.factId,
          ]);
          await client.query(
            'SELECT id FROM theme_fact_revisions WHERE id = $1 AND fact_id = $2 FOR UPDATE',
            [request.factRevisionId, request.factId]
          );
          const storedAttemptResult = await client.query(
            'SELECT * FROM theme_question_generation_attempts WHERE id = $1 FOR UPDATE',
            [request.attemptId]
          );
          const storedAttempt = storedAttemptResult.rows[0] as Record<string, any> | undefined;
          if (!storedAttempt || !stableHeaderMatches(storedAttempt, attemptHeader))
            throw new ThemeQuestionGenerationError('attempt_conflict');
          if (await readOutcome(client, request.attemptId)) return;
          await client.query(
            `INSERT INTO theme_question_generation_outcomes
             (attempt_id, job_id, ordinal, candidate_id, question_revision_id, fact_id,
              fact_revision_id, fact_content_hash, fact_review_attempt_id, fact_review_output_hash,
              status, question_content_hash, failure_code)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'failed',NULL,'candidate_conflict')`,
            [
              request.attemptId,
              request.jobId,
              request.ordinal,
              request.candidateId,
              request.questionRevisionId,
              request.factId,
              request.factRevisionId,
              request.factContentHash,
              request.factReviewAttemptId,
              request.factReviewOutputHash,
            ]
          );
        });
      }
      const stored = await storageSafe(() => readOutcome(pool, request.attemptId));
      if (!stored) throw new ThemeQuestionGenerationError('storage_unknown_outcome');
      return storageSafe(() => replay(pool, request));
    },
  };
}

export function newThemeQuestionGenerationExecutionId(): string {
  return randomUUID();
}
