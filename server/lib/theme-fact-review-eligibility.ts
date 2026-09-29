import { createHash } from 'node:crypto';

import {
  THEME_FACT_REVIEW_DIMENSIONS,
  themeFactReviewDimensionsSchema,
  type ThemeFactReviewOutput,
} from '@shared/models/theme-fact-review';

type ReviewOutcome = {
  status: 'reviewed' | 'invalid_output' | 'failed';
  aggregateVerdict: 'pass' | 'flag' | 'fail' | null;
  dimensions: ThemeFactReviewOutput['dimensions'] | null;
  outputHash: string | null;
  validUntil: string | null;
};

export type ThemeFactReviewEligibilityGraph = {
  now: string;
  latestRevisionId: string;
  fact: {
    id: string;
    contentHash: string;
    supportedAliases: string[];
    validUntil: string | null;
    timeSensitive: boolean;
  };
  derivation: {
    attemptId: string;
    executionId: string;
    producerKind: 'model' | 'human';
    producerId: string;
    provider: string | null;
    model: string | null;
    outcome: string;
    factRevisionId: string | null;
    factContentHash: string | null;
    inputFingerprint: string;
    bindingsFingerprint: string | null;
  };
  evidence: {
    complete: boolean;
    fingerprint: string;
    bindingsFingerprint: string;
    validUntil: string | null;
    supportOriginCount: number;
    minimumOriginGroups: number;
    hasConflictEdge: boolean;
  };
  reviews: Array<{
    attemptId: string;
    derivationAttemptId: string;
    factRevisionId: string;
    factContentHash: string;
    reviewSequence: number;
    reviewerKind: 'model' | 'human';
    reviewerId: string;
    provider: string | null;
    model: string | null;
    executionId: string;
    inputFingerprint: string;
    evidenceFingerprint: string;
    policyVersion: string;
    policyHash: string;
    promptVersion: string;
    promptHash: string;
    outcome: ReviewOutcome | null;
  }>;
  reviewPolicyVersion: string;
  reviewPolicyHash: string;
  reviewPromptVersion: string;
  reviewPromptHash: string;
};

export type ThemeFactReviewEligibility =
  | { eligible: true; reason: 'eligible'; attemptId: string; fingerprint: string }
  | {
      eligible: false;
      reason:
        | 'incomplete_graph'
        | 'revision_mismatch'
        | 'derivation_mismatch'
        | 'insufficient_support'
        | 'conflict_edge'
        | 'missing_review'
        | 'latest_review_not_passing'
        | 'review_mismatch'
        | 'review_expired'
        | 'evidence_expired'
        | 'fact_expired';
      attemptId: string | null;
      fingerprint: string;
    };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function denied(
  reason: Extract<ThemeFactReviewEligibility, { eligible: false }>['reason'],
  attemptId: string | null,
  graph: ThemeFactReviewEligibilityGraph
): ThemeFactReviewEligibility {
  return { eligible: false, reason, attemptId, fingerprint: fingerprint(graph) };
}

export function evaluateThemeFactReviewEligibility(
  graph: ThemeFactReviewEligibilityGraph
): ThemeFactReviewEligibility {
  if (
    !graph.evidence.complete ||
    !Number.isFinite(Date.parse(graph.now)) ||
    !Number.isInteger(graph.evidence.minimumOriginGroups) ||
    !Number.isInteger(graph.evidence.supportOriginCount) ||
    graph.evidence.minimumOriginGroups < 1 ||
    graph.evidence.supportOriginCount < 0 ||
    graph.reviews.some(
      (review) => !Number.isInteger(review.reviewSequence) || review.reviewSequence < 1
    ) ||
    new Set(graph.reviews.map((review) => review.reviewSequence)).size !== graph.reviews.length
  )
    return denied('incomplete_graph', null, graph);
  if (graph.latestRevisionId !== graph.fact.id) return denied('revision_mismatch', null, graph);
  if (
    graph.derivation.outcome !== 'persisted' ||
    graph.derivation.factRevisionId !== graph.fact.id ||
    graph.derivation.factContentHash !== graph.fact.contentHash ||
    !graph.derivation.bindingsFingerprint ||
    graph.derivation.bindingsFingerprint !== graph.evidence.bindingsFingerprint
  )
    return denied('derivation_mismatch', null, graph);
  if (graph.evidence.supportOriginCount < graph.evidence.minimumOriginGroups)
    return denied('insufficient_support', null, graph);
  if (graph.evidence.hasConflictEdge) return denied('conflict_edge', null, graph);

  const attempts = [...graph.reviews]
    .filter((review) => review.factRevisionId === graph.fact.id)
    .sort(
      (left, right) =>
        right.reviewSequence - left.reviewSequence || right.attemptId.localeCompare(left.attemptId)
    );
  const latest = attempts[0];
  if (!latest) return denied('missing_review', null, graph);
  const outcome = latest.outcome;
  if (!outcome || outcome.status !== 'reviewed' || outcome.aggregateVerdict !== 'pass')
    return denied('latest_review_not_passing', latest.attemptId, graph);
  if (
    latest.derivationAttemptId !== graph.derivation.attemptId ||
    latest.factContentHash !== graph.fact.contentHash ||
    latest.inputFingerprint !== graph.derivation.inputFingerprint ||
    latest.evidenceFingerprint !== graph.evidence.fingerprint ||
    latest.policyVersion !== graph.reviewPolicyVersion ||
    latest.policyHash !== graph.reviewPolicyHash ||
    latest.promptVersion !== graph.reviewPromptVersion ||
    latest.promptHash !== graph.reviewPromptHash ||
    latest.reviewerId === graph.derivation.producerId ||
    latest.executionId === graph.derivation.executionId ||
    (latest.reviewerKind === 'model' &&
      graph.derivation.producerKind === 'model' &&
      latest.provider === graph.derivation.provider &&
      latest.model === graph.derivation.model) ||
    !outcome.dimensions ||
    !themeFactReviewDimensionsSchema.safeParse(outcome.dimensions).success ||
    !outcome.outputHash ||
    !/^[a-f0-9]{64}$/.test(outcome.outputHash) ||
    outcome.outputHash !== fingerprint({ dimensions: outcome.dimensions }) ||
    (graph.fact.supportedAliases.length === 0 &&
      !outcome.dimensions.aliases.reasons.includes('no_aliases')) ||
    (graph.fact.supportedAliases.length > 0 &&
      outcome.dimensions.aliases.reasons.includes('no_aliases')) ||
    THEME_FACT_REVIEW_DIMENSIONS.some(
      (dimension) => outcome.dimensions?.[dimension]?.verdict !== 'pass'
    )
  )
    return denied('review_mismatch', latest.attemptId, graph);
  const now = Date.parse(graph.now);
  const reviewExpiry = outcome.validUntil ? Date.parse(outcome.validUntil) : Number.NaN;
  if (!Number.isFinite(reviewExpiry) || reviewExpiry <= now)
    return denied('review_expired', latest.attemptId, graph);
  const evidenceExpiry = graph.evidence.validUntil ? Date.parse(graph.evidence.validUntil) : null;
  if (evidenceExpiry !== null && (!Number.isFinite(evidenceExpiry) || evidenceExpiry <= now))
    return denied('evidence_expired', latest.attemptId, graph);
  const factExpiry = graph.fact.validUntil ? Date.parse(graph.fact.validUntil) : null;
  // A present but malformed expiry is stale data, not an unbounded fact.
  if (
    (graph.fact.timeSensitive && factExpiry === null) ||
    (factExpiry !== null && (!Number.isFinite(factExpiry) || factExpiry <= now))
  )
    return denied('fact_expired', latest.attemptId, graph);
  return {
    eligible: true,
    reason: 'eligible',
    attemptId: latest.attemptId,
    fingerprint: fingerprint(graph),
  };
}
