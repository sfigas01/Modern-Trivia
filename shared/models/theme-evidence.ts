import { z } from 'zod';

export const THEME_RELIABILITY_CONTRACT_VERSION = 'theme-reliability-v1' as const;

export const SOURCE_CLASSES = [
  'primary_official',
  'primary_record',
  'secondary_authoritative',
  'secondary_reputable',
] as const;
export const sourceClassSchema = z.enum(SOURCE_CLASSES);

export const SOURCE_DOCUMENT_STATUSES = ['retrieved', 'stale', 'withdrawn', 'unreadable'] as const;
export const sourceDocumentStatusSchema = z.enum(SOURCE_DOCUMENT_STATUSES);

export const EVIDENCE_SUPPORT_KINDS = ['supports', 'conflicts', 'context'] as const;
export const evidenceSupportKindSchema = z.enum(EVIDENCE_SUPPORT_KINDS);

export const EVIDENCE_REVIEW_VERDICTS = ['pass', 'flag', 'fail'] as const;
export const evidenceReviewVerdictSchema = z.enum(EVIDENCE_REVIEW_VERDICTS);

export const EVIDENCE_DIMENSIONS = [
  'premise',
  'answer',
  'scope',
  'aliases',
  'explanation',
  'freshness',
  'source_independence',
] as const;
export const evidenceDimensionSchema = z.enum(EVIDENCE_DIMENSIONS);

export const EVIDENCE_REASON_CODES = [
  'supported',
  'missing_evidence',
  'malformed_evidence',
  'source_untrusted',
  'source_stale',
  'source_withdrawn',
  'source_not_independent',
  'claim_not_entailed',
  'claim_conflicted',
  'scope_underspecified',
  'answer_not_unique',
  'answer_unsupported',
  'alias_unsupported',
  'explanation_unsupported',
  'time_sensitive_without_as_of',
  'review_incomplete',
] as const;
export const evidenceReasonCodeSchema = z.enum(EVIDENCE_REASON_CODES);

export const RETRIEVAL_FAILURE_CODES = [
  'invalid_url',
  'blocked_address',
  'unsupported_protocol',
  'redirect_limit',
  'redirect_blocked',
  'timeout',
  'response_too_large',
  'unsupported_content_type',
  'unreadable_content',
  'http_error',
  'provider_rate_limited',
  'provider_unavailable',
  'provider_rejected',
  'provider_unknown_outcome',
] as const;
export const retrievalFailureCodeSchema = z.enum(RETRIEVAL_FAILURE_CODES);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const identifierSchema = z.string().trim().min(1).max(255);

export const sourceDocumentSchema = z
  .object({
    contractVersion: z.literal(THEME_RELIABILITY_CONTRACT_VERSION),
    id: z.string().uuid(),
    requestedUrl: z.string().url(),
    finalUrl: z.string().url(),
    canonicalUrl: z.string().url(),
    publisherId: identifierSchema,
    sourceClass: sourceClassSchema,
    publisher: z.string().trim().min(1).max(255),
    originGroup: identifierSchema,
    sourcePolicyVersion: identifierSchema,
    extractorVersion: identifierSchema,
    title: z.string().trim().min(1).max(500),
    language: z.string().trim().min(2).max(35),
    status: sourceDocumentStatusSchema,
    contentHash: sha256Schema,
    retrievedAt: z.string().datetime(),
    publishedAt: z.string().datetime().nullable(),
    sourceUpdatedAt: z.string().datetime().nullable(),
    validUntil: z.string().datetime().nullable(),
    httpStatus: z.number().int().min(100).max(599),
    mediaType: z.string().trim().min(1).max(255),
  })
  .strict();

export const evidencePassageSchema = z
  .object({
    contractVersion: z.literal(THEME_RELIABILITY_CONTRACT_VERSION),
    id: z.string().uuid(),
    documentId: z.string().uuid(),
    ordinal: z.number().int().nonnegative(),
    locator: z.string().trim().min(1).max(500),
    text: z.string().trim().min(1).max(12_000),
    contentHash: sha256Schema,
  })
  .strict();

export const factScopeSchema = z
  .object({
    entity: z.string().trim().min(1).max(500),
    relation: z.string().trim().min(1).max(500),
    time: z.string().trim().min(1).max(500).nullable(),
    geography: z.string().trim().min(1).max(500).nullable(),
    competitionOrDomain: z.string().trim().min(1).max(500).nullable(),
    qualifiers: z.array(z.string().trim().min(1).max(500)).max(20),
    asOf: z.string().datetime().nullable(),
  })
  .strict();

export const factIdentitySchema = z
  .object({
    id: z.string().uuid(),
    canonicalKey: identifierSchema,
    createdAt: z.string().datetime(),
  })
  .strict();

export const scopedFactRevisionSchema = z
  .object({
    contractVersion: z.literal(THEME_RELIABILITY_CONTRACT_VERSION),
    id: z.string().uuid(),
    factId: z.string().uuid(),
    revision: z.number().int().positive(),
    statement: z.string().trim().min(1).max(4_000),
    scope: factScopeSchema,
    canonicalAnswer: z.string().trim().min(1).max(1_000),
    supportedAliases: z.array(z.string().trim().min(1).max(1_000)).max(50),
    contentHash: sha256Schema,
    timeSensitive: z.boolean(),
    validUntil: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((fact, context) => {
    if (fact.timeSensitive && fact.scope.asOf === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scope', 'asOf'],
        message: 'time-sensitive facts require an as-of timestamp',
      });
    }
    if (fact.timeSensitive && fact.validUntil === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validUntil'],
        message: 'time-sensitive facts require an expiry timestamp',
      });
    }
  });

// Backward-compatible contract name for callers that only need revision validation.
export const scopedFactSchema = scopedFactRevisionSchema;

export const questionContentSnapshotSchema = z
  .object({
    question: z.string().trim().min(1).max(4_000),
    answer: z.string().trim().min(1).max(1_000),
    acceptableAnswers: z.array(z.string().trim().min(1).max(1_000)).max(50),
    explanation: z.string().trim().min(1).max(8_000),
    category: z.string().trim().min(1).max(255),
    difficulty: z.enum(['Easy', 'Medium', 'Hard']),
    pillar: z.string().trim().min(1).max(100),
    tags: z.array(z.string().trim().min(1).max(255)).max(100),
    themeSlug: z.string().trim().min(1).max(100),
  })
  .strict();

export const questionRevisionSchema = z
  .object({
    contractVersion: z.literal(THEME_RELIABILITY_CONTRACT_VERSION),
    id: z.string().uuid(),
    questionId: z.string().trim().min(1).max(255).nullable(),
    candidateId: z.string().uuid().nullable(),
    revision: z.number().int().positive(),
    contentHash: sha256Schema,
    content: questionContentSnapshotSchema,
    createdAt: z.string().datetime(),
  })
  .strict()
  .refine((revision) => (revision.questionId === null) !== (revision.candidateId === null), {
    message: 'a question revision must belong to exactly one candidate or persisted question',
  });

export const evidenceDimensionResultSchema = z
  .object({
    dimension: evidenceDimensionSchema,
    verdict: evidenceReviewVerdictSchema,
    reasons: z.array(evidenceReasonCodeSchema).min(1),
    passageIds: z.array(z.string().uuid()).min(1),
  })
  .strict();

export const evidenceReviewSchema = z
  .object({
    contractVersion: z.literal(THEME_RELIABILITY_CONTRACT_VERSION),
    id: z.string().uuid(),
    questionRevisionId: z.string().uuid(),
    questionContentHash: sha256Schema,
    reviewPolicyVersion: identifierSchema,
    reviewerPromptVersion: identifierSchema,
    verdict: evidenceReviewVerdictSchema,
    dimensionResults: z.array(evidenceDimensionResultSchema).length(EVIDENCE_DIMENSIONS.length),
    factRevisionIds: z.array(z.string().uuid()).min(1),
    passageIds: z.array(z.string().uuid()).min(1),
    reviewerKind: z.enum(['model', 'human']),
    reviewerModel: z.string().trim().min(1).max(255).nullable(),
    reviewedAt: z.string().datetime(),
    validUntil: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((review, context) => {
    const dimensions = review.dimensionResults.map((result) => result.dimension);
    if (new Set(dimensions).size !== EVIDENCE_DIMENSIONS.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dimensionResults'],
        message: 'every evidence dimension must appear exactly once',
      });
    }
    const resultVerdicts = review.dimensionResults.map((result) => result.verdict);
    if (review.verdict === 'pass' && resultVerdicts.some((verdict) => verdict !== 'pass')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verdict'],
        message: 'an evidence pass requires every dimension to pass',
      });
    }
    if (review.reviewerKind === 'model' && review.reviewerModel === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reviewerModel'],
        message: 'model reviews require the model identifier',
      });
    }
    if (new Set(review.factRevisionIds).size !== review.factRevisionIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['factRevisionIds'],
        message: 'fact revision bindings must be unique',
      });
    }
    const boundPassages = new Set(review.passageIds);
    if (
      boundPassages.size !== review.passageIds.length ||
      review.dimensionResults.some((result) =>
        result.passageIds.some((passageId) => !boundPassages.has(passageId))
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['passageIds'],
        message: 'dimension passage references must be unique review bindings',
      });
    }
  });

export const retrievalFailureSchema = z
  .object({
    contractVersion: z.literal(THEME_RELIABILITY_CONTRACT_VERSION),
    code: retrievalFailureCodeSchema,
    retryable: z.boolean(),
    provider: z.string().trim().min(1).max(255).nullable(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
  })
  .strict();

export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
export type EvidencePassage = z.infer<typeof evidencePassageSchema>;
export type FactScope = z.infer<typeof factScopeSchema>;
export type FactIdentity = z.infer<typeof factIdentitySchema>;
export type ScopedFactRevision = z.infer<typeof scopedFactRevisionSchema>;
export type ScopedFact = ScopedFactRevision;
export type QuestionContentSnapshot = z.infer<typeof questionContentSnapshotSchema>;
export type QuestionRevision = z.infer<typeof questionRevisionSchema>;
export type EvidenceDimensionResult = z.infer<typeof evidenceDimensionResultSchema>;
export type EvidenceReview = z.infer<typeof evidenceReviewSchema>;
export type RetrievalFailure = z.infer<typeof retrievalFailureSchema>;
