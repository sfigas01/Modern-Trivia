import { createHash, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import {
  EVIDENCE_DIMENSIONS,
  THEME_RELIABILITY_CONTRACT_VERSION,
  evidenceDimensionResultSchema,
  evidencePassageSchema,
  evidenceReviewSchema,
  questionContentSnapshotSchema,
  questionRevisionSchema,
  scopedFactRevisionSchema,
  sourceDocumentSchema,
  type EvidenceDimensionResult,
} from '@shared/models/theme-evidence';
import {
  themeQuestionGenerationPolicySchema,
  themeQuestionGenerationRequestSchema,
  type ThemeQuestionGenerationRequest,
} from '@shared/models/theme-question-generation';
import { themeFactReviewPolicySchema } from '@shared/models/theme-fact-review';
import {
  hashQuestionSnapshot,
  evaluateThemeEvidenceEligibility,
  themeEligibilityPolicySchema,
  type ThemeEligibilityPolicy,
  type ThemeEligibilityInput,
} from './theme-evidence-eligibility';
import { evaluateThemeFactReviewEligibility } from './theme-fact-review-eligibility';
import {
  loadGenerationContext,
  ThemeQuestionGenerationError,
  type ThemeQuestionGenerationConfig,
} from './theme-question-generation';

export const THEME_QUESTION_EVIDENCE_REVIEW_VERSION = 'theme-question-evidence-review-v1' as const;
const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z
  .object({
    attemptId: uuid,
    candidateId: uuid,
    questionRevisionId: uuid,
    questionContentHash: sha,
  })
  .strict();
const reviewerSchema = z.discriminatedUnion('kind', [
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
const outputSchema = z
  .object({
    dimensionResults: z.array(evidenceDimensionResultSchema).length(EVIDENCE_DIMENSIONS.length),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.dimensionResults.map((result) => result.dimension)).size ===
      EVIDENCE_DIMENSIONS.length
  );

export type ThemeQuestionEvidenceReviewConfig = {
  executionId: string;
  reviewer: z.infer<typeof reviewerSchema>;
  policy: ThemeEligibilityPolicy;
  promptText: string;
};
export type ThemeQuestionEvidenceReviewInput = Readonly<{
  contractVersion: typeof THEME_QUESTION_EVIDENCE_REVIEW_VERSION;
  question: {
    revisionId: string;
    contentHash: string;
    content: z.infer<typeof questionContentSnapshotSchema>;
  };
  fact: {
    revisionId: string;
    contentHash: string;
    statement: string;
    scope: z.infer<typeof scopedFactRevisionSchema>['scope'];
    canonicalAnswer: string;
    supportedAliases: string[];
  };
  evidence: Array<{
    passageId: string;
    passageContentHash: string;
    text: string;
    supportKind: 'supports' | 'conflicts' | 'context' | 'uncited';
    originGroup: string;
    sourceClass: string;
    retrievedAt: string;
    validUntil: string | null;
  }>;
  evaluatedAt: string;
}>;
export type ThemeQuestionEvidenceReviewer = (
  input: ThemeQuestionEvidenceReviewInput
) => Promise<unknown> | unknown;
export type ThemeQuestionEvidenceReviewResult =
  | { status: 'reviewed'; attemptId: string; reviewId: string; verdict: 'pass' | 'flag' | 'fail' }
  | { status: 'invalid_output' | 'failed' | 'ineligible'; attemptId: string; failureCode: string };
export type ThemeQuestionQaContext = Readonly<{
  candidateId: string;
  questionRevisionId: string;
  questionContentHash: string;
  question: z.infer<typeof questionContentSnapshotSchema>;
  evidenceAttemptId: string;
  evidenceReviewId: string;
  evidenceFingerprint: string;
  source: {
    documentId: string;
    url: string;
    name: string;
  };
}>;
export class ThemeQuestionEvidenceReviewError extends Error {
  constructor(
    public readonly code:
      | 'invalid_request'
      | 'invalid_configuration'
      | 'ineligible'
      | 'reviewer_not_independent'
      | 'attempt_conflict'
      | 'attempt_unresolved'
      | 'storage_failure'
      | 'storage_unknown_outcome'
  ) {
    super(code);
    this.name = 'ThemeQuestionEvidenceReviewError';
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function iso(value: unknown): string {
  const date = new Date(value as string | Date);
  if (!Number.isFinite(date.valueOf())) throw new ThemeQuestionEvidenceReviewError('ineligible');
  return date.toISOString();
}
function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}
function safe<T>(operation: () => Promise<T>): Promise<T> {
  return operation().catch((error: unknown) => {
    if (error instanceof ThemeQuestionEvidenceReviewError) throw error;
    throw new ThemeQuestionEvidenceReviewError('storage_failure');
  });
}
async function transaction<T>(pool: Pool, operation: (db: PoolClient) => Promise<T>): Promise<T> {
  let db: PoolClient;
  try {
    db = await pool.connect();
  } catch {
    throw new ThemeQuestionEvidenceReviewError('storage_failure');
  }
  let discarded = false;
  try {
    try {
      await db.query('BEGIN');
    } catch (error) {
      db.release(error instanceof Error ? error : new Error('begin failed'));
      discarded = true;
      throw new ThemeQuestionEvidenceReviewError('storage_failure');
    }
    let value: T;
    try {
      value = await operation(db);
    } catch (error) {
      try {
        await db.query('ROLLBACK');
      } catch (rollbackError) {
        db.release(rollbackError instanceof Error ? rollbackError : new Error('rollback failed'));
        discarded = true;
        throw new ThemeQuestionEvidenceReviewError('storage_failure');
      }
      if (error instanceof ThemeQuestionEvidenceReviewError) throw error;
      throw new ThemeQuestionEvidenceReviewError('storage_failure');
    }
    try {
      await db.query('COMMIT');
    } catch (error) {
      db.release(error instanceof Error ? error : new Error('commit failed'));
      discarded = true;
      throw new ThemeQuestionEvidenceReviewError('storage_unknown_outcome');
    }
    return value;
  } finally {
    if (!discarded) db.release();
  }
}
export function isIndependentThemeQuestionReviewer(
  reviewer: z.infer<typeof reviewerSchema>,
  executionId: string,
  source: {
    id: string;
    executionId: string;
    kind: string;
    provider: string | null;
    model: string | null;
  }
): boolean {
  return (
    reviewer.id !== source.id &&
    executionId !== source.executionId &&
    !(
      reviewer.kind === 'model' &&
      source.kind === 'model' &&
      reviewer.provider === source.provider &&
      reviewer.model === source.model
    )
  );
}

type Context = {
  generation: Record<string, unknown>;
  question: z.infer<typeof questionRevisionSchema>;
  input: ThemeQuestionEvidenceReviewInput;
  graph: ThemeEligibilityInput;
  manifest: Record<string, unknown>;
  fingerprint: string;
  supportIds: string[];
};

async function loadContext(
  db: Pool | PoolClient,
  request: z.infer<typeof requestSchema>,
  config: ThemeQuestionEvidenceReviewConfig,
  at: Date,
  enforceIndependence = true
): Promise<Context> {
  const result = await db.query(
    `SELECT g.*, o.status AS generation_status, o.question_content_hash AS outcome_question_hash,
       c.status AS candidate_status, c.revision AS candidate_revision, c.content_hash AS candidate_hash,
       c.content AS candidate_content, c.fact_id AS candidate_fact_id, c.fact_revision_id AS candidate_fact_revision_id,
       c.parent_candidate_id AS candidate_parent_candidate_id,
       q.contract_version AS question_contract, q.revision AS question_revision, q.content_hash AS revision_hash,
       q.content AS revision_content, q.created_at AS revision_created_at,
       pg.writer_kind AS parent_writer_kind, pg.writer_id AS parent_writer_id,
       pg.provider AS parent_provider, pg.model AS parent_model,
       pg.execution_id AS parent_execution_id
     FROM theme_question_generation_attempts g
     JOIN theme_question_generation_outcomes o ON o.attempt_id = g.id
     JOIN theme_candidates c ON c.id = g.candidate_id
     JOIN theme_question_revisions q ON q.id = g.question_revision_id
     LEFT JOIN theme_question_generation_attempts pg ON pg.candidate_id = g.parent_candidate_id
     WHERE g.candidate_id = $1 AND g.question_revision_id = $2`,
    [request.candidateId, request.questionRevisionId]
  );
  const g = result.rows[0] as Record<string, unknown> | undefined;
  if (
    !g ||
    g.generation_status !== 'persisted' ||
    g.candidate_status !== 'pending' ||
    g.candidate_hash !== request.questionContentHash ||
    g.revision_hash !== request.questionContentHash ||
    g.outcome_question_hash !== request.questionContentHash ||
    g.candidate_fact_id !== g.fact_id ||
    g.candidate_fact_revision_id !== g.fact_revision_id ||
    (g.candidate_parent_candidate_id ?? null) !== (g.parent_candidate_id ?? null) ||
    Number(g.candidate_revision) !== Number(g.question_revision) ||
    !same(g.candidate_content, g.revision_content)
  )
    throw new ThemeQuestionEvidenceReviewError('ineligible');
  const content = questionContentSnapshotSchema.safeParse(g.revision_content);
  if (!content.success || hashQuestionSnapshot(content.data) !== request.questionContentHash)
    throw new ThemeQuestionEvidenceReviewError('ineligible');
  const question = questionRevisionSchema.safeParse({
    contractVersion: g.question_contract,
    id: request.questionRevisionId,
    questionId: null,
    candidateId: request.candidateId,
    revision: Number(g.question_revision),
    contentHash: request.questionContentHash,
    content: content.data,
    createdAt: iso(g.revision_created_at),
  });
  if (!question.success) throw new ThemeQuestionEvidenceReviewError('ineligible');
  const snapshot = g.policy_snapshot as Record<string, unknown>;
  if (
    !snapshot ||
    hash(snapshot) !== g.policy_hash ||
    !same(hash(g.input_manifest), g.input_fingerprint) ||
    hashText(String(g.prompt_snapshot)) !== g.prompt_hash
  )
    throw new ThemeQuestionEvidenceReviewError('ineligible');
  const generationPolicy = themeQuestionGenerationPolicySchema.safeParse(snapshot.generationPolicy);
  const factReviewPolicy = themeFactReviewPolicySchema.safeParse(snapshot.factReviewPolicy);
  if (
    !generationPolicy.success ||
    !factReviewPolicy.success ||
    typeof g.prompt_snapshot !== 'string' ||
    generationPolicy.data.generationPolicyVersion !== g.generation_policy_version ||
    typeof snapshot.factReviewPolicyVersion !== 'string' ||
    hash(factReviewPolicy.data) !== snapshot.factReviewPolicyHash ||
    !sha.safeParse(snapshot.factReviewPromptHash).success
  )
    throw new ThemeQuestionEvidenceReviewError('ineligible');
  const generationConfig: ThemeQuestionGenerationConfig = {
    executionId: String(g.execution_id),
    writer: {
      kind: g.writer_kind as 'model' | 'human',
      id: String(g.writer_id),
      provider: g.provider as string | null,
      model: g.model as string | null,
    },
    generationPolicy: generationPolicy.data,
    promptVersion: String(g.prompt_version),
    promptText: g.prompt_snapshot,
    factReviewPolicyVersion: String(snapshot.factReviewPolicyVersion),
    factReviewPolicy: factReviewPolicy.data,
    factReviewPromptVersion: String(snapshot.factReviewPromptVersion),
    factReviewPromptText: '',
  };
  // S7 stores the S6b prompt hash in its immutable policy snapshot; the S8a loader
  // supplies that exact hash without needing the original raw S6b prompt text.
  const repairOf =
    g.parent_candidate_id === null || g.parent_candidate_id === undefined
      ? undefined
      : (g.input_manifest as { request?: { repairOf?: unknown } } | null)?.request?.repairOf;
  const parsedGenerationRequest = themeQuestionGenerationRequestSchema.safeParse({
    attemptId: String(g.id),
    jobId: String(g.job_id),
    ordinal: Number(g.ordinal),
    candidateId: request.candidateId,
    questionRevisionId: request.questionRevisionId,
    factId: String(g.fact_id),
    factRevisionId: String(g.fact_revision_id),
    factContentHash: String(g.fact_content_hash),
    factReviewAttemptId: String(g.fact_review_attempt_id),
    factReviewOutputHash: String(g.fact_review_output_hash),
    repairOf,
  });
  if (!parsedGenerationRequest.success) throw new ThemeQuestionEvidenceReviewError('ineligible');
  const generationRequest: ThemeQuestionGenerationRequest = parsedGenerationRequest.data;
  let loaded: Awaited<ReturnType<typeof loadGenerationContext>>;
  try {
    loaded = await loadGenerationContext(
      db,
      generationRequest,
      generationConfig,
      at,
      String(snapshot.factReviewPromptHash)
    );
  } catch (error) {
    if (error instanceof ThemeQuestionGenerationError && error.code === 'ineligible')
      throw new ThemeQuestionEvidenceReviewError('ineligible');
    throw error;
  }
  const s6bGraph = loaded.graph;
  const s6bDecision = evaluateThemeFactReviewEligibility(s6bGraph);
  const originalDecision = evaluateThemeFactReviewEligibility({
    ...s6bGraph,
    now: iso(g.evaluated_at),
  });
  if (
    !s6bDecision.eligible ||
    s6bDecision.attemptId !== generationRequest.factReviewAttemptId ||
    !originalDecision.eligible ||
    originalDecision.fingerprint !== g.eligibility_fingerprint ||
    loaded.selectedReview.outcome?.outputHash !== generationRequest.factReviewOutputHash
  )
    throw new ThemeQuestionEvidenceReviewError('ineligible');
  const derivation = loaded.graph.derivation;
  const selected = loaded.selectedReview;
  const sources = [
    {
      id: derivation.producerId,
      executionId: derivation.executionId,
      kind: derivation.producerKind,
      provider: derivation.provider,
      model: derivation.model,
    },
    {
      id: String(selected.reviewerId),
      executionId: String(selected.executionId),
      kind: String(selected.reviewerKind),
      provider: selected.provider as string | null,
      model: selected.model as string | null,
    },
    {
      id: String(g.writer_id),
      executionId: String(g.execution_id),
      kind: String(g.writer_kind),
      provider: g.provider as string | null,
      model: g.model as string | null,
    },
  ];
  if (generationRequest.repairOf) {
    if (
      typeof g.parent_writer_id !== 'string' ||
      typeof g.parent_execution_id !== 'string' ||
      !['model', 'human'].includes(String(g.parent_writer_kind))
    )
      throw new ThemeQuestionEvidenceReviewError('ineligible');
    sources.push({
      id: String(g.parent_writer_id),
      executionId: String(g.parent_execution_id),
      kind: String(g.parent_writer_kind),
      provider: g.parent_provider as string | null,
      model: g.parent_model as string | null,
    });
  }
  if (
    enforceIndependence &&
    sources.some(
      (source) =>
        !isIndependentThemeQuestionReviewer(
          config.reviewer,
          config.executionId.toLowerCase(),
          source
        )
    )
  )
    throw new ThemeQuestionEvidenceReviewError('reviewer_not_independent');

  const evidenceIds = loaded.writerInput.evidence.map((item) => item.passageId);
  const evidenceResult = await db.query(
    `SELECT p.*, d.id AS doc_id, d.contract_version AS doc_contract, d.requested_url, d.final_url,
       d.canonical_url, d.publisher_id, d.source_class, d.publisher, d.origin_group,
       d.source_policy_version, d.extractor_version, d.title, d.language, d.status,
       d.content_hash AS doc_hash, d.retrieved_at, d.published_at, d.source_updated_at,
       d.valid_until AS doc_valid_until, d.http_status, d.media_type
     FROM theme_evidence_passages p JOIN theme_evidence_documents d ON d.id = p.document_id
     WHERE p.id = ANY($1::uuid[])`,
    [evidenceIds]
  );
  if (evidenceResult.rows.length !== evidenceIds.length)
    throw new ThemeQuestionEvidenceReviewError('ineligible');
  const evidenceById = new Map(
    evidenceResult.rows.map((row: Record<string, unknown>) => [String(row.id), row])
  );
  const passages: ThemeEligibilityInput['passages'] = [];
  const documents: ThemeEligibilityInput['documents'] = [];
  const reviewerEvidence: ThemeQuestionEvidenceReviewInput['evidence'] = [];
  const bindings: ThemeEligibilityInput['factPassageBindings'] = [];
  const supportIds: string[] = [];
  for (const item of loaded.writerInput.evidence) {
    const row = evidenceById.get(item.passageId);
    if (!row) throw new ThemeQuestionEvidenceReviewError('ineligible');
    const passageResult = evidencePassageSchema.safeParse({
      contractVersion: row.contract_version,
      id: row.id,
      documentId: row.document_id,
      ordinal: row.ordinal,
      locator: row.locator,
      text: row.passage_text,
      contentHash: row.content_hash,
    });
    const documentResult = sourceDocumentSchema.safeParse({
      contractVersion: row.doc_contract,
      id: row.doc_id,
      requestedUrl: row.requested_url,
      finalUrl: row.final_url,
      canonicalUrl: row.canonical_url,
      publisherId: row.publisher_id,
      sourceClass: row.source_class,
      publisher: row.publisher,
      originGroup: row.origin_group,
      sourcePolicyVersion: row.source_policy_version,
      extractorVersion: row.extractor_version,
      title: row.title,
      language: row.language,
      status: row.status,
      contentHash: row.doc_hash,
      retrievedAt: iso(row.retrieved_at),
      publishedAt: row.published_at === null ? null : iso(row.published_at),
      sourceUpdatedAt: row.source_updated_at === null ? null : iso(row.source_updated_at),
      validUntil: row.doc_valid_until === null ? null : iso(row.doc_valid_until),
      httpStatus: row.http_status,
      mediaType: row.media_type,
    });
    if (!passageResult.success || !documentResult.success)
      throw new ThemeQuestionEvidenceReviewError('ineligible');
    const passage = passageResult.data;
    const document = documentResult.data;
    if (
      passage.contentHash !== item.passageContentHash ||
      document.originGroup !== item.originGroup ||
      document.sourceClass !== item.sourceClass ||
      document.sourcePolicyVersion !== config.policy.sourcePolicyVersion ||
      document.extractorVersion !== config.policy.extractorVersion ||
      !config.policy.allowedSourceClasses.includes(document.sourceClass) ||
      document.status !== 'retrieved' ||
      document.httpStatus !== 200 ||
      Date.parse(document.retrievedAt) > at.valueOf() ||
      at.valueOf() - Date.parse(document.retrievedAt) > config.policy.maxSourceAgeMs ||
      (document.validUntil !== null && Date.parse(document.validUntil) <= at.valueOf())
    )
      throw new ThemeQuestionEvidenceReviewError('ineligible');
    passages.push(passage);
    if (!documents.some((stored) => stored.id === document.id)) documents.push(document);
    if (item.supportKind !== 'uncited') {
      bindings.push({
        factRevisionId: String(g.fact_revision_id),
        passageId: item.passageId,
        supportKind: item.supportKind,
      });
      if (item.supportKind === 'supports') supportIds.push(item.passageId);
    }
    reviewerEvidence.push({
      passageId: item.passageId,
      passageContentHash: item.passageContentHash,
      text: item.text,
      supportKind: item.supportKind,
      originGroup: item.originGroup,
      sourceClass: item.sourceClass,
      retrievedAt: document.retrievedAt,
      validUntil: document.validUntil,
    });
  }
  const factResult = scopedFactRevisionSchema.safeParse({
    contractVersion: loaded.fact.contract_version,
    id: loaded.fact.fact_revision_id,
    factId: loaded.fact.fact_id,
    revision: loaded.fact.revision,
    statement: loaded.fact.statement,
    scope: loaded.fact.scope,
    canonicalAnswer: loaded.fact.canonical_answer,
    supportedAliases: loaded.fact.supported_aliases,
    contentHash: loaded.fact.content_hash,
    timeSensitive: loaded.fact.time_sensitive,
    validUntil: loaded.fact.valid_until === null ? null : iso(loaded.fact.valid_until),
  });
  if (!factResult.success) throw new ThemeQuestionEvidenceReviewError('ineligible');
  const fact = factResult.data;
  const input: ThemeQuestionEvidenceReviewInput = {
    contractVersion: THEME_QUESTION_EVIDENCE_REVIEW_VERSION,
    question: {
      revisionId: question.data.id,
      contentHash: question.data.contentHash,
      content: question.data.content,
    },
    fact: {
      revisionId: fact.id,
      contentHash: fact.contentHash,
      statement: fact.statement,
      scope: fact.scope,
      canonicalAnswer: fact.canonicalAnswer,
      supportedAliases: fact.supportedAliases,
    },
    evidence: reviewerEvidence,
    evaluatedAt: at.toISOString(),
  };
  const manifest = {
    generationAttemptId: g.id,
    generationInputFingerprint: g.input_fingerprint,
    s6bReviewAttemptId: selected.attemptId,
    s6bReviewOutputHash: selected.outcome?.outputHash,
    factContentHash: fact.contentHash,
    questionContentHash: question.data.contentHash,
    evidence: reviewerEvidence.map(({ text: _text, ...entry }) => entry),
  };
  return {
    generation: g,
    question: question.data,
    input,
    manifest,
    fingerprint: hash(manifest),
    supportIds,
    graph: {
      liveQuestion: {
        revisionId: question.data.id,
        contentHash: question.data.contentHash,
        content: question.data.content,
      },
      questionRevision: question.data,
      reviews: [],
      facts: [fact],
      passages,
      documents,
      factPassageBindings: bindings,
      policy: config.policy,
    },
  };
}

export function evaluateLatestThemeQuestionEvidenceReview(
  graph: ThemeEligibilityInput,
  attempts: Array<{
    id: string;
    sequence: number;
    outcome: { status: string; review: unknown } | null;
  }>,
  now: Date
) {
  const sorted = [...attempts].sort((a, b) => b.sequence - a.sequence || b.id.localeCompare(a.id));
  const newest = sorted[0];
  if (!newest || new Set(attempts.map((attempt) => attempt.sequence)).size !== attempts.length)
    return {
      eligible: false,
      reason: 'missing_or_invalid_attempt',
      attemptId: newest?.id ?? null,
    } as const;
  if (!newest.outcome || newest.outcome.status !== 'reviewed')
    return {
      eligible: false,
      reason: 'latest_attempt_not_reviewed',
      attemptId: newest.id,
    } as const;
  const decision = evaluateThemeEvidenceEligibility(
    { ...graph, reviews: [newest.outcome.review] },
    now
  );
  return { ...decision, attemptId: newest.id };
}

export function createPostgresThemeQuestionEvidenceReviewRepository(
  pool: Pool,
  rawConfig: ThemeQuestionEvidenceReviewConfig,
  now: () => Date = () => new Date()
) {
  const reviewer = reviewerSchema.safeParse(rawConfig.reviewer);
  const policy = themeEligibilityPolicySchema.safeParse(rawConfig.policy);
  if (
    !reviewer.success ||
    !policy.success ||
    !uuid.safeParse(rawConfig.executionId).success ||
    !rawConfig.promptText.trim() ||
    rawConfig.promptText.length > 32_000 ||
    new Set(policy.data.allowedSourceClasses).size !== policy.data.allowedSourceClasses.length
  )
    throw new ThemeQuestionEvidenceReviewError('invalid_configuration');
  const config = {
    ...rawConfig,
    reviewer: reviewer.data,
    policy: policy.data,
    executionId: rawConfig.executionId.toLowerCase(),
  };
  function attemptHeaderMatches(
    prior: Record<string, unknown>,
    request: z.infer<typeof requestSchema>
  ): boolean {
    return (
      prior.candidate_id === request.candidateId &&
      prior.question_revision_id === request.questionRevisionId &&
      prior.question_content_hash === request.questionContentHash &&
      prior.reviewer_kind === config.reviewer.kind &&
      prior.reviewer_id === config.reviewer.id &&
      prior.provider === config.reviewer.provider &&
      prior.model === config.reviewer.model &&
      prior.execution_id === config.executionId &&
      prior.review_policy_version === config.policy.reviewPolicyVersion &&
      prior.policy_hash === hash(config.policy) &&
      prior.prompt_version === config.policy.reviewerPromptVersion &&
      prior.prompt_hash === hashText(config.promptText)
    );
  }
  async function replay(
    request: z.infer<typeof requestSchema>,
    prior: Record<string, unknown>
  ): Promise<ThemeQuestionEvidenceReviewResult> {
    if (!attemptHeaderMatches(prior, request))
      throw new ThemeQuestionEvidenceReviewError('attempt_conflict');
    const outcome = await pool.query(
      'SELECT * FROM theme_question_evidence_review_outcomes WHERE attempt_id = $1',
      [request.attemptId]
    );
    const row = outcome.rows[0];
    if (!row) throw new ThemeQuestionEvidenceReviewError('attempt_unresolved');
    return row.status === 'reviewed'
      ? {
          status: 'reviewed',
          attemptId: request.attemptId,
          reviewId: row.review_id,
          verdict: row.verdict,
        }
      : { status: row.status, attemptId: request.attemptId, failureCode: row.failure_code };
  }
  const repository = {
    async eligibility(rawRequest: Omit<z.infer<typeof requestSchema>, 'attemptId'>) {
      const parsed = requestSchema.omit({ attemptId: true }).safeParse(rawRequest);
      if (!parsed.success) throw new ThemeQuestionEvidenceReviewError('invalid_request');
      const request = { ...parsed.data, attemptId: randomUUID() };
      const at = now();
      if (!Number.isFinite(at.valueOf()))
        throw new ThemeQuestionEvidenceReviewError('invalid_request');
      const current = await safe(() => loadContext(pool, request, config, at, false));
      const unowned = await safe(() =>
        pool.query(
          `SELECT r.id FROM theme_evidence_reviews r
         LEFT JOIN theme_question_evidence_review_outcomes o
           ON o.review_id = r.id AND o.status = 'reviewed'
         WHERE r.question_revision_id = $1 AND r.question_content_hash = $2
           AND o.attempt_id IS NULL LIMIT 1`,
          [request.questionRevisionId, request.questionContentHash]
        )
      );
      if (unowned.rowCount)
        return { eligible: false, reason: 'unowned_review', attemptId: null } as const;
      const rows = await safe(() =>
        pool.query(
          `SELECT a.*, o.status AS outcome_status, o.review_id, o.verdict AS outcome_verdict,
                o.output_hash AS outcome_hash, r.contract_version AS review_contract,
                r.review_policy_version AS stored_review_policy_version,
                r.reviewer_prompt_version AS stored_prompt_version,
                r.dimension_results, r.reviewer_kind AS stored_reviewer_kind,
                r.reviewer_model, r.reviewed_at, r.valid_until
         FROM theme_question_evidence_review_attempts a
         LEFT JOIN theme_question_evidence_review_outcomes o ON o.attempt_id = a.id
         LEFT JOIN theme_evidence_reviews r ON r.id = o.review_id
         WHERE a.question_revision_id = $1 ORDER BY a.review_sequence DESC`,
          [request.questionRevisionId]
        )
      );
      const attempts = rows.rows.map((row: Record<string, unknown>) => ({
        id: String(row.id),
        sequence: Number(row.review_sequence),
        outcome:
          row.outcome_status === null
            ? null
            : { status: String(row.outcome_status), review: null as unknown },
      }));
      const newest = rows.rows[0] as Record<string, unknown> | undefined;
      if (
        !newest ||
        newest.question_content_hash !== request.questionContentHash ||
        newest.candidate_id !== request.candidateId ||
        newest.contract_version !== THEME_QUESTION_EVIDENCE_REVIEW_VERSION ||
        newest.review_policy_version !== config.policy.reviewPolicyVersion ||
        newest.policy_hash !== hash(config.policy) ||
        newest.prompt_version !== config.policy.reviewerPromptVersion ||
        newest.prompt_hash !== hashText(config.promptText) ||
        newest.input_fingerprint !== current.fingerprint ||
        hash(newest.input_manifest) !== newest.input_fingerprint
      ) {
        return {
          eligible: false,
          reason: 'latest_attempt_mismatch',
          attemptId: newest?.id ?? null,
        } as const;
      }
      if (newest.outcome_status === 'reviewed') {
        const reviewId = String(newest.review_id);
        const facts = await safe(() =>
          pool.query(
            'SELECT fact_revision_id FROM theme_evidence_review_facts WHERE review_id = $1 ORDER BY fact_revision_id',
            [reviewId]
          )
        );
        const passages = await safe(() =>
          pool.query(
            'SELECT passage_id FROM theme_evidence_review_passages WHERE review_id = $1 ORDER BY passage_id',
            [reviewId]
          )
        );
        const review = evidenceReviewSchema.safeParse({
          contractVersion: newest.review_contract,
          id: reviewId,
          questionRevisionId: request.questionRevisionId,
          questionContentHash: request.questionContentHash,
          reviewPolicyVersion: newest.stored_review_policy_version,
          reviewerPromptVersion: newest.stored_prompt_version,
          verdict: newest.outcome_verdict,
          dimensionResults: newest.dimension_results,
          factRevisionIds: facts.rows.map(
            (row: { fact_revision_id: string }) => row.fact_revision_id
          ),
          passageIds: passages.rows.map((row: { passage_id: string }) => row.passage_id),
          reviewerKind: newest.stored_reviewer_kind,
          reviewerModel: newest.reviewer_model,
          reviewedAt: iso(newest.reviewed_at),
          validUntil: newest.valid_until === null ? null : iso(newest.valid_until),
        });
        if (
          !review.success ||
          newest.review_id !== review.data.id ||
          newest.outcome_hash !== hash(review.data.dimensionResults)
        )
          return {
            eligible: false,
            reason: 'latest_review_mismatch',
            attemptId: newest.id,
          } as const;
        attempts[0].outcome = { status: 'reviewed', review: review.data };
      }
      return evaluateLatestThemeQuestionEvidenceReview(current.graph, attempts, at);
    },
    async qaContext(
      rawRequest: Omit<z.infer<typeof requestSchema>, 'attemptId'>
    ): Promise<ThemeQuestionQaContext> {
      const parsed = requestSchema.omit({ attemptId: true }).safeParse(rawRequest);
      if (!parsed.success) throw new ThemeQuestionEvidenceReviewError('invalid_request');
      const at = now();
      if (!Number.isFinite(at.valueOf()))
        throw new ThemeQuestionEvidenceReviewError('invalid_request');
      const decision = await repository.eligibility(parsed.data);
      if (!decision.eligible || !decision.attemptId || !decision.reviewId)
        throw new ThemeQuestionEvidenceReviewError('ineligible');
      const request = { ...parsed.data, attemptId: randomUUID() };
      const current = await safe(() => loadContext(pool, request, config, at, false));
      const linked = await safe(() =>
        pool.query(
          'SELECT passage_id FROM theme_evidence_review_passages WHERE review_id = $1 ORDER BY passage_id',
          [decision.reviewId]
        )
      );
      const storedDimensions = await safe(() =>
        pool.query(
          `SELECT r.dimension_results
           FROM theme_question_evidence_review_outcomes o
           JOIN theme_evidence_reviews r ON r.id = o.review_id
           WHERE o.attempt_id = $1 AND o.review_id = $2
             AND o.status = 'reviewed' AND o.verdict = 'pass'`,
          [decision.attemptId, decision.reviewId]
        )
      );
      const dimensions = outputSchema.safeParse({
        dimensionResults: storedDimensions.rows[0]?.dimension_results,
      });
      if (!dimensions.success || storedDimensions.rows.length !== 1)
        throw new ThemeQuestionEvidenceReviewError('ineligible');
      const dimensionPassageIds = new Set(
        dimensions.data.dimensionResults.flatMap((result) => result.passageIds)
      );
      const citedSupportId = linked.rows
        .map((row: { passage_id: string }) => row.passage_id)
        .find(
          (passageId: string) =>
            dimensionPassageIds.has(passageId) && current.supportIds.includes(passageId)
        );
      const passage = current.graph.passages.find((item) => item.id === citedSupportId);
      const document = current.graph.documents.find((item) => item.id === passage?.documentId);
      if (!passage || !document) throw new ThemeQuestionEvidenceReviewError('ineligible');
      return {
        candidateId: parsed.data.candidateId,
        questionRevisionId: parsed.data.questionRevisionId,
        questionContentHash: parsed.data.questionContentHash,
        question: structuredClone(current.question.content),
        evidenceAttemptId: decision.attemptId,
        evidenceReviewId: decision.reviewId,
        evidenceFingerprint: decision.fingerprint,
        source: {
          documentId: document.id,
          url: document.canonicalUrl,
          name: document.publisher,
        },
      };
    },
    async review(
      rawRequest: z.infer<typeof requestSchema>,
      callback: ThemeQuestionEvidenceReviewer
    ): Promise<ThemeQuestionEvidenceReviewResult> {
      const parsed = requestSchema.safeParse(rawRequest);
      if (!parsed.success || typeof callback !== 'function')
        throw new ThemeQuestionEvidenceReviewError('invalid_request');
      const request = parsed.data;
      const prior = await safe(() =>
        pool.query('SELECT * FROM theme_question_evidence_review_attempts WHERE id = $1', [
          request.attemptId,
        ])
      );
      if (prior.rows[0]) return safe(() => replay(request, prior.rows[0]));
      const at = now();
      if (!Number.isFinite(at.valueOf()))
        throw new ThemeQuestionEvidenceReviewError('invalid_request');
      const optimistic = await safe(() => loadContext(pool, request, config, at));
      const registration = await transaction(pool, async (db) => {
        await db.query('SELECT id FROM theme_facts WHERE id = $1 FOR UPDATE', [
          optimistic.generation.fact_id,
        ]);
        await db.query('SELECT id FROM theme_fact_revisions WHERE id = $1 FOR UPDATE', [
          optimistic.generation.fact_revision_id,
        ]);
        await db.query('SELECT id FROM theme_candidates WHERE id = $1 FOR UPDATE', [
          request.candidateId,
        ]);
        await db.query('SELECT id FROM theme_question_revisions WHERE id = $1 FOR UPDATE', [
          request.questionRevisionId,
        ]);
        const existing = await db.query(
          'SELECT * FROM theme_question_evidence_review_attempts WHERE id = $1 FOR UPDATE',
          [request.attemptId]
        );
        if (existing.rows[0]) {
          if (!attemptHeaderMatches(existing.rows[0], request))
            throw new ThemeQuestionEvidenceReviewError('attempt_conflict');
          const outcome = await db.query(
            'SELECT attempt_id FROM theme_question_evidence_review_outcomes WHERE attempt_id = $1',
            [request.attemptId]
          );
          if (!outcome.rows[0]) throw new ThemeQuestionEvidenceReviewError('attempt_unresolved');
          return { kind: 'replay' as const };
        }
        const lockedAt = now();
        if (!Number.isFinite(lockedAt.valueOf()))
          throw new ThemeQuestionEvidenceReviewError('invalid_request');
        const locked = await loadContext(db, request, config, lockedAt);
        if (locked.fingerprint !== optimistic.fingerprint)
          throw new ThemeQuestionEvidenceReviewError('ineligible');
        const next = await db.query(
          'SELECT COALESCE(MAX(review_sequence), 0) + 1 AS sequence FROM theme_question_evidence_review_attempts WHERE question_revision_id = $1',
          [request.questionRevisionId]
        );
        const sequence = Number(next.rows[0].sequence);
        await db.query(
          `INSERT INTO theme_question_evidence_review_attempts
           (id,contract_version,candidate_id,question_revision_id,question_content_hash,generation_attempt_id,fact_revision_id,review_sequence,reviewer_kind,reviewer_id,provider,model,execution_id,review_policy_version,policy_snapshot,policy_hash,prompt_version,prompt_hash,input_manifest,input_fingerprint,evaluated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19::jsonb,$20,$21)`,
          [
            request.attemptId,
            THEME_QUESTION_EVIDENCE_REVIEW_VERSION,
            request.candidateId,
            request.questionRevisionId,
            request.questionContentHash,
            locked.generation.id,
            locked.generation.fact_revision_id,
            sequence,
            config.reviewer.kind,
            config.reviewer.id,
            config.reviewer.provider,
            config.reviewer.model,
            config.executionId,
            config.policy.reviewPolicyVersion,
            JSON.stringify(config.policy),
            hash(config.policy),
            config.policy.reviewerPromptVersion,
            hashText(config.promptText),
            JSON.stringify(locked.manifest),
            locked.fingerprint,
            lockedAt,
          ]
        );
        return { kind: 'dispatch' as const, context: locked };
      });
      if (registration.kind === 'replay') {
        const replayHeader = await safe(() =>
          pool.query('SELECT * FROM theme_question_evidence_review_attempts WHERE id = $1', [
            request.attemptId,
          ])
        );
        if (!replayHeader.rows[0]) throw new ThemeQuestionEvidenceReviewError('storage_failure');
        return safe(() => replay(request, replayHeader.rows[0]));
      }
      const registered = registration.context;
      let status: 'reviewed' | 'invalid_output' | 'failed' | 'ineligible' = 'reviewed';
      let dimensions: EvidenceDimensionResult[] | null = null;
      try {
        const output = outputSchema.safeParse(await callback(structuredClone(registered.input)));
        if (
          !output.success ||
          output.data.dimensionResults.some((dimension) =>
            dimension.passageIds.some(
              (id) => !registered.input.evidence.some((passage) => passage.passageId === id)
            )
          )
        )
          status = 'invalid_output';
        else dimensions = output.data.dimensionResults;
      } catch {
        status = 'failed';
      }
      const reviewId = randomUUID();
      let verdict: 'pass' | 'flag' | 'fail' | null = null;
      try {
        await transaction(pool, async (db) => {
          await db.query('SELECT id FROM theme_facts WHERE id = $1 FOR UPDATE', [
            registered.generation.fact_id,
          ]);
          await db.query('SELECT id FROM theme_fact_revisions WHERE id = $1 FOR UPDATE', [
            registered.generation.fact_revision_id,
          ]);
          await db.query('SELECT id FROM theme_candidates WHERE id = $1 FOR UPDATE', [
            request.candidateId,
          ]);
          await db.query('SELECT id FROM theme_question_revisions WHERE id = $1 FOR UPDATE', [
            request.questionRevisionId,
          ]);
          const header = await db.query(
            'SELECT * FROM theme_question_evidence_review_attempts WHERE id = $1 FOR UPDATE',
            [request.attemptId]
          );
          if (!header.rows[0] || header.rows[0].input_fingerprint !== registered.fingerprint)
            throw new ThemeQuestionEvidenceReviewError('attempt_conflict');
          const completedAt = now();
          if (!Number.isFinite(completedAt.valueOf()))
            throw new ThemeQuestionEvidenceReviewError('storage_failure');
          let current: Context | null = null;
          try {
            current = await loadContext(db, request, config, completedAt);
          } catch (error) {
            if (error instanceof ThemeQuestionEvidenceReviewError && error.code === 'ineligible')
              current = null;
            else throw error;
          }
          if (!current || current.fingerprint !== registered.fingerprint) {
            status = 'ineligible';
            dimensions = null;
          }
          if (status === 'reviewed' && dimensions && current) {
            verdict = dimensions.some((dimension) => dimension.verdict === 'fail')
              ? 'fail'
              : dimensions.some((dimension) => dimension.verdict === 'flag')
                ? 'flag'
                : 'pass';
            const expires = Math.min(
              completedAt.valueOf() + config.policy.maxReviewAgeMs,
              ...current.graph.documents.map((document) =>
                Math.min(
                  Date.parse(document.retrievedAt) + config.policy.maxSourceAgeMs,
                  document.validUntil === null ? Infinity : Date.parse(document.validUntil)
                )
              ),
              ...current.graph.facts.map((fact) =>
                fact.validUntil === null ? Infinity : Date.parse(fact.validUntil)
              )
            );
            if (!Number.isFinite(expires) || expires <= completedAt.valueOf()) {
              status = 'ineligible';
              verdict = null;
            } else {
              const parsedReview = evidenceReviewSchema.safeParse({
                contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
                id: reviewId,
                questionRevisionId: request.questionRevisionId,
                questionContentHash: request.questionContentHash,
                reviewPolicyVersion: config.policy.reviewPolicyVersion,
                reviewerPromptVersion: config.policy.reviewerPromptVersion,
                verdict,
                dimensionResults: dimensions,
                factRevisionIds: [String(current.generation.fact_revision_id)],
                passageIds:
                  verdict === 'pass'
                    ? current.supportIds
                    : current.input.evidence.map((item) => item.passageId),
                reviewerKind: config.reviewer.kind,
                reviewerModel: config.reviewer.model,
                reviewedAt: completedAt.toISOString(),
                validUntil: new Date(expires).toISOString(),
              });
              if (!parsedReview.success) {
                status = 'invalid_output';
                verdict = null;
              } else {
                const review = parsedReview.data;
                const decision = evaluateThemeEvidenceEligibility(
                  { ...current.graph, reviews: [review] },
                  completedAt
                );
                if (verdict === 'pass' && !decision.eligible) {
                  status = 'ineligible';
                  verdict = null;
                } else {
                  await db.query(
                    `INSERT INTO theme_evidence_reviews (id,contract_version,question_revision_id,question_content_hash,review_policy_version,reviewer_prompt_version,verdict,dimension_results,reviewer_kind,reviewer_model,reviewed_at,valid_until) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)`,
                    [
                      reviewId,
                      review.contractVersion,
                      review.questionRevisionId,
                      review.questionContentHash,
                      review.reviewPolicyVersion,
                      review.reviewerPromptVersion,
                      review.verdict,
                      JSON.stringify(review.dimensionResults),
                      review.reviewerKind,
                      review.reviewerModel,
                      review.reviewedAt,
                      review.validUntil,
                    ]
                  );
                  await db.query(
                    'INSERT INTO theme_evidence_review_facts (review_id,fact_revision_id) VALUES ($1,$2)',
                    [reviewId, current.generation.fact_revision_id]
                  );
                  for (const passageId of review.passageIds)
                    await db.query(
                      'INSERT INTO theme_evidence_review_passages (review_id,passage_id) VALUES ($1,$2)',
                      [reviewId, passageId]
                    );
                }
              }
            }
          }
          const failure =
            status === 'invalid_output'
              ? 'invalid_output'
              : status === 'failed'
                ? 'reviewer_failure'
                : status === 'ineligible'
                  ? 'evidence_changed'
                  : null;
          await db.query(
            `INSERT INTO theme_question_evidence_review_outcomes (attempt_id,candidate_id,question_revision_id,question_content_hash,status,review_id,verdict,output_hash,failure_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              request.attemptId,
              request.candidateId,
              request.questionRevisionId,
              request.questionContentHash,
              status,
              status === 'reviewed' ? reviewId : null,
              verdict,
              status === 'reviewed' ? hash(dimensions) : null,
              failure,
            ]
          );
        });
      } catch (error) {
        if (error instanceof ThemeQuestionEvidenceReviewError) throw error;
        throw new ThemeQuestionEvidenceReviewError('storage_failure');
      }
      return status === 'reviewed' && verdict
        ? { status, attemptId: request.attemptId, reviewId, verdict }
        : {
            status: status as 'invalid_output' | 'failed' | 'ineligible',
            attemptId: request.attemptId,
            failureCode:
              status === 'invalid_output'
                ? 'invalid_output'
                : status === 'failed'
                  ? 'reviewer_failure'
                  : 'evidence_changed',
          };
    },
  };
  return repository;
}
