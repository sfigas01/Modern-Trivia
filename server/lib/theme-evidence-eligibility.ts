import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  evidencePassageSchema,
  evidenceReviewSchema,
  evidenceSupportKindSchema,
  questionContentSnapshotSchema,
  questionRevisionSchema,
  scopedFactRevisionSchema,
  sourceClassSchema,
  sourceDocumentSchema,
  type EvidenceReview,
  type QuestionContentSnapshot,
} from '@shared/models/theme-evidence';

export const THEME_ELIGIBILITY_VERSION = 'theme-eligibility-v1' as const;

export const THEME_ELIGIBILITY_REASONS = [
  'eligible',
  'malformed_input',
  'missing_evidence',
  'revision_hash_mismatch',
  'review_incomplete',
  'review_adverse',
  'policy_version_mismatch',
  'source_untrusted',
  'source_stale',
  'fact_stale',
  'review_stale',
  'bad_binding',
  'claim_conflicted',
  'source_not_independent',
  'answer_unsupported',
  'alias_unsupported',
] as const;
export type ThemeEligibilityReason = (typeof THEME_ELIGIBILITY_REASONS)[number];

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const identifierSchema = z.string().trim().min(1).max(255);
const liveQuestionSchema = z
  .object({
    revisionId: z.string().uuid(),
    contentHash: hashSchema,
    content: questionContentSnapshotSchema,
  })
  .strict();
const factPassageBindingSchema = z
  .object({
    factRevisionId: z.string().uuid(),
    passageId: z.string().uuid(),
    supportKind: evidenceSupportKindSchema,
  })
  .strict();
export const themeEligibilityPolicySchema = z
  .object({
    sourcePolicyVersion: identifierSchema,
    extractorVersion: identifierSchema,
    reviewPolicyVersion: identifierSchema,
    reviewerPromptVersion: identifierSchema,
    allowedSourceClasses: z.array(sourceClassSchema).min(1),
    maxSourceAgeMs: z.number().int().positive(),
    maxReviewAgeMs: z.number().int().positive(),
    minIndependentOriginGroupsPerFact: z.number().int().min(1),
  })
  .strict();
export type ThemeEligibilityPolicy = z.infer<typeof themeEligibilityPolicySchema>;

const graphSchema = z
  .object({
    liveQuestion: liveQuestionSchema,
    questionRevision: questionRevisionSchema,
    reviews: z.array(z.unknown()),
    facts: z.array(scopedFactRevisionSchema),
    passages: z.array(evidencePassageSchema),
    documents: z.array(sourceDocumentSchema),
    factPassageBindings: z.array(factPassageBindingSchema),
    policy: themeEligibilityPolicySchema,
  })
  .strict();
export type ThemeEligibilityInput = z.infer<typeof graphSchema>;
export type ThemeEligibilityDecision = {
  version: typeof THEME_ELIGIBILITY_VERSION;
  eligible: boolean;
  reason: ThemeEligibilityReason;
  reviewId: string | null;
  fingerprint: string;
};

// Sorted object keys make the snapshot and decision hashes independent of object insertion order.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function hashQuestionSnapshot(content: QuestionContentSnapshot): string {
  return sha256(canonical(questionContentSnapshotSchema.parse(content)));
}

function uniqueIds(items: Array<{ id: string }>): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}
function isFresh(then: string, now: number, maxAge: number): boolean {
  const timestamp = Date.parse(then);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= maxAge;
}
function beforeExpiry(until: string | null, now: number): boolean {
  return until === null || Date.parse(until) > now;
}
function byId<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function eligibilityFingerprint(graph: ThemeEligibilityInput, reviews: EvidenceReview[]): string {
  return sha256(
    canonical({
      version: THEME_ELIGIBILITY_VERSION,
      liveQuestion: graph.liveQuestion,
      questionRevision: graph.questionRevision,
      reviews: byId(reviews).map((review) => ({
        ...review,
        factRevisionIds: [...review.factRevisionIds].sort(),
        passageIds: [...review.passageIds].sort(),
        dimensionResults: [...review.dimensionResults]
          .sort((a, b) => (a.dimension < b.dimension ? -1 : a.dimension > b.dimension ? 1 : 0))
          .map((result) => ({
            ...result,
            reasons: [...result.reasons].sort(),
            passageIds: [...result.passageIds].sort(),
          })),
      })),
      facts: byId(graph.facts),
      passages: byId(graph.passages),
      documents: byId(graph.documents),
      factPassageBindings: [...graph.factPassageBindings].sort((a, b) =>
        canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0
      ),
      policy: {
        ...graph.policy,
        allowedSourceClasses: [...graph.policy.allowedSourceClasses].sort(),
      },
    })
  );
}

/** Pure policy decision over a complete, caller-supplied evidence graph. No retrieval or model judgment. */
export function evaluateThemeEvidenceEligibility(
  value: unknown,
  now: Date
): ThemeEligibilityDecision {
  const time = now instanceof Date ? now.getTime() : Number.NaN;
  const parsed = graphSchema.safeParse(value);
  let fingerprint = sha256(`${THEME_ELIGIBILITY_VERSION}:malformed_input`);
  const decision = (reason: ThemeEligibilityReason, reviewId: string | null = null) => ({
    version: THEME_ELIGIBILITY_VERSION,
    eligible: reason === 'eligible',
    reason,
    reviewId,
    fingerprint,
  });
  if (!Number.isFinite(time) || !parsed.success) return decision('malformed_input');
  const graph = parsed.data;
  const { liveQuestion, questionRevision: revision, policy } = graph;
  // Parse before hashing unknown review objects. This also makes malformed later reviews fail
  // closed instead of allowing a prior pass to become the selected review.
  const reviews: EvidenceReview[] = [];
  for (const raw of graph.reviews) {
    const result = evidenceReviewSchema.safeParse(raw);
    if (!result.success) return decision('review_incomplete');
    reviews.push(result.data);
  }
  fingerprint = eligibilityFingerprint(graph, reviews);
  if (
    !uniqueIds(graph.facts) ||
    !uniqueIds(graph.passages) ||
    !uniqueIds(graph.documents) ||
    !uniqueIds(reviews) ||
    new Set(policy.allowedSourceClasses).size !== policy.allowedSourceClasses.length ||
    new Set(graph.factPassageBindings.map((b) => `${b.factRevisionId}:${b.passageId}`)).size !==
      graph.factPassageBindings.length
  )
    return decision('malformed_input');
  if (
    liveQuestion.revisionId !== revision.id ||
    liveQuestion.contentHash !== revision.contentHash ||
    hashQuestionSnapshot(liveQuestion.content) !== revision.contentHash ||
    canonical(liveQuestion.content) !== canonical(revision.content)
  )
    return decision('revision_hash_mismatch');

  const applicable = reviews
    .filter((review) => review.questionRevisionId === revision.id)
    .sort(
      (a, b) =>
        Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt) ||
        (b.id < a.id ? -1 : b.id > a.id ? 1 : 0)
    );
  const review = applicable[0];
  if (!review) return decision('missing_evidence');
  if (review.questionContentHash !== revision.contentHash)
    return decision('revision_hash_mismatch', review.id);
  if (
    review.reviewPolicyVersion !== policy.reviewPolicyVersion ||
    review.reviewerPromptVersion !== policy.reviewerPromptVersion
  )
    return decision('policy_version_mismatch', review.id);
  if (
    review.verdict !== 'pass' ||
    review.dimensionResults.some((result) => result.verdict !== 'pass')
  )
    return decision('review_adverse', review.id);
  if (
    !isFresh(review.reviewedAt, time, policy.maxReviewAgeMs) ||
    !beforeExpiry(review.validUntil, time)
  )
    return decision('review_stale', review.id);

  const facts = new Map(graph.facts.map((fact) => [fact.id, fact]));
  const passages = new Map(graph.passages.map((passage) => [passage.id, passage]));
  const documents = new Map(graph.documents.map((document) => [document.id, document]));
  const reviewedFacts = review.factRevisionIds.map((id) => facts.get(id));
  const reviewedPassages = review.passageIds.map((id) => passages.get(id));
  if (reviewedFacts.some((fact) => !fact) || reviewedPassages.some((passage) => !passage))
    return decision('bad_binding', review.id);
  const factVersions = new Map<string, Set<number>>();
  for (const fact of graph.facts) {
    const versions = factVersions.get(fact.factId) ?? new Set<number>();
    if (versions.has(fact.revision)) return decision('malformed_input', review.id);
    versions.add(fact.revision);
    factVersions.set(fact.factId, versions);
  }
  for (const fact of reviewedFacts) {
    if (!fact) return decision('bad_binding', review.id);
    if (Array.from(factVersions.get(fact.factId)!).some((version) => version > fact.revision))
      return decision('fact_stale', review.id);
    if (
      !beforeExpiry(fact.validUntil, time) ||
      (fact.scope.asOf && Date.parse(fact.scope.asOf) > time)
    )
      return decision('fact_stale', review.id);
  }
  const answerFacts = reviewedFacts.filter(
    (fact) => fact?.canonicalAnswer === liveQuestion.content.answer
  );
  if (answerFacts.length === 0) return decision('answer_unsupported', review.id);
  const acceptedAnswers = new Set(
    answerFacts.flatMap((fact) => (fact ? [fact.canonicalAnswer, ...fact.supportedAliases] : []))
  );
  if (liveQuestion.content.acceptableAnswers.some((answer) => !acceptedAnswers.has(answer)))
    return decision('alias_unsupported', review.id);
  const boundPassageIds = new Set(review.passageIds);
  const boundFactIds = new Set(review.factRevisionIds);
  const supportByPassage = new Map<string, Set<string>>();
  const originGroupsByFact = new Map<string, Set<string>>();
  for (const binding of graph.factPassageBindings) {
    const passage = passages.get(binding.passageId);
    if (!facts.has(binding.factRevisionId) || !passage || !documents.has(passage.documentId))
      return decision('bad_binding', review.id);
    if (boundFactIds.has(binding.factRevisionId) && binding.supportKind === 'conflicts')
      return decision('claim_conflicted', review.id);
    if (!boundFactIds.has(binding.factRevisionId) || !boundPassageIds.has(binding.passageId))
      continue;
    if (binding.supportKind !== 'supports') continue;
    const document = documents.get(passage.documentId)!;
    const factsForPassage = supportByPassage.get(passage.id) ?? new Set<string>();
    factsForPassage.add(binding.factRevisionId);
    supportByPassage.set(passage.id, factsForPassage);
    const groups = originGroupsByFact.get(binding.factRevisionId) ?? new Set<string>();
    groups.add(document.originGroup);
    originGroupsByFact.set(binding.factRevisionId, groups);
  }
  for (const passage of reviewedPassages) {
    if (!passage) return decision('bad_binding', review.id);
    const document = documents.get(passage.documentId);
    if (!document || !supportByPassage.has(passage.id)) return decision('bad_binding', review.id);
    if (
      document.sourcePolicyVersion !== policy.sourcePolicyVersion ||
      document.extractorVersion !== policy.extractorVersion
    )
      return decision('policy_version_mismatch', review.id);
    if (!policy.allowedSourceClasses.includes(document.sourceClass))
      return decision('source_untrusted', review.id);
    if (document.status !== 'retrieved' || document.httpStatus < 200 || document.httpStatus >= 300)
      return decision(document.status === 'stale' ? 'source_stale' : 'source_untrusted', review.id);
    if (
      !isFresh(document.retrievedAt, time, policy.maxSourceAgeMs) ||
      !beforeExpiry(document.validUntil, time)
    )
      return decision('source_stale', review.id);
  }
  for (const dimension of review.dimensionResults) {
    if (dimension.passageIds.some((id) => !supportByPassage.has(id)))
      return decision('bad_binding', review.id);
  }
  if (
    review.factRevisionIds.some(
      (id) => (originGroupsByFact.get(id)?.size ?? 0) < policy.minIndependentOriginGroupsPerFact
    )
  )
    return decision('source_not_independent', review.id);
  return decision('eligible', review.id);
}
