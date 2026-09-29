import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  evaluateThemeFactReviewEligibility,
  type ThemeFactReviewEligibilityGraph,
} from './theme-fact-review-eligibility';

const passDimensions = {
  entailment: {
    verdict: 'pass',
    reasons: ['supported'],
    passageRefs: [
      { passageId: '40d45c59-3386-45cb-9f89-653970cb0907', passageContentHash: 'a'.repeat(64) },
    ],
  },
  scope: {
    verdict: 'pass',
    reasons: ['scope_match'],
    passageRefs: [
      { passageId: '40d45c59-3386-45cb-9f89-653970cb0907', passageContentHash: 'a'.repeat(64) },
    ],
  },
  canonical_answer: {
    verdict: 'pass',
    reasons: ['answer_supported'],
    passageRefs: [
      { passageId: '40d45c59-3386-45cb-9f89-653970cb0907', passageContentHash: 'a'.repeat(64) },
    ],
  },
  aliases: { verdict: 'pass', reasons: ['no_aliases'], passageRefs: [] },
  conflict: {
    verdict: 'pass',
    reasons: ['no_conflict'],
    passageRefs: [
      { passageId: '40d45c59-3386-45cb-9f89-653970cb0907', passageContentHash: 'a'.repeat(64) },
    ],
  },
  source_independence: {
    verdict: 'pass',
    reasons: ['independent_origins'],
    passageRefs: [
      { passageId: '40d45c59-3386-45cb-9f89-653970cb0907', passageContentHash: 'a'.repeat(64) },
    ],
  },
};

function outputHash(dimensions: unknown): string {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value !== null && typeof value === 'object')
      return `{${Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
        .join(',')}}`;
    return JSON.stringify(value);
  };
  return createHash('sha256').update(canonical({ dimensions }), 'utf8').digest('hex');
}

function graph(): ThemeFactReviewEligibilityGraph {
  return {
    now: '2026-09-28T12:00:00.000Z',
    latestRevisionId: 'revision-2',
    fact: {
      id: 'revision-2',
      contentHash: 'a'.repeat(64),
      supportedAliases: [],
      validUntil: null,
      timeSensitive: false,
    },
    derivation: {
      attemptId: 'derive-2',
      executionId: 'derive-exec',
      producerKind: 'model',
      producerId: 'producer',
      provider: 'provider-a',
      model: 'model-a',
      outcome: 'persisted',
      factRevisionId: 'revision-2',
      factContentHash: 'a'.repeat(64),
      inputFingerprint: 'b'.repeat(64),
      bindingsFingerprint: 'c'.repeat(64),
    },
    evidence: {
      complete: true,
      fingerprint: 'd'.repeat(64),
      bindingsFingerprint: 'c'.repeat(64),
      validUntil: null,
      supportOriginCount: 2,
      minimumOriginGroups: 2,
      hasConflictEdge: false,
    },
    reviews: [
      {
        attemptId: 'review-1',
        derivationAttemptId: 'derive-2',
        factRevisionId: 'revision-2',
        factContentHash: 'a'.repeat(64),
        reviewSequence: 1,
        reviewerKind: 'model',
        reviewerId: 'reviewer',
        provider: 'provider-b',
        model: 'model-b',
        executionId: 'review-exec',
        inputFingerprint: 'b'.repeat(64),
        evidenceFingerprint: 'd'.repeat(64),
        policyVersion: 'review-v1',
        policyHash: 'e'.repeat(64),
        promptVersion: 'prompt-v1',
        promptHash: '8'.repeat(64),
        outcome: {
          status: 'reviewed',
          aggregateVerdict: 'pass',
          dimensions: structuredClone(passDimensions),
          outputHash: outputHash(passDimensions),
          validUntil: '2026-10-01T00:00:00.000Z',
        },
      },
    ],
    reviewPolicyVersion: 'review-v1',
    reviewPolicyHash: 'e'.repeat(64),
    reviewPromptVersion: 'prompt-v1',
    reviewPromptHash: '8'.repeat(64),
  };
}

describe('theme fact review eligibility', () => {
  it('accepts only the current exact fact with complete fresh independent passing evidence', () => {
    const result = evaluateThemeFactReviewEligibility(graph());
    expect(result).toMatchObject({ eligible: true, reason: 'eligible', attemptId: 'review-1' });
  });

  it('selects the newest sequence before checking outcome, so adverse reviews block older passes', () => {
    const input = graph();
    input.reviews.push({
      ...input.reviews[0],
      attemptId: 'review-2',
      reviewSequence: 2,
      outcome: null,
    });
    expect(evaluateThemeFactReviewEligibility(input)).toMatchObject({
      eligible: false,
      reason: 'latest_review_not_passing',
      attemptId: 'review-2',
    });
  });

  it('rejects expiry, changed evidence, insufficient origins, and conflict edges without extending TTL', () => {
    const input = graph();
    input.reviews[0].outcome!.validUntil = '2026-09-28T11:59:59.999Z';
    expect(evaluateThemeFactReviewEligibility(input)).toMatchObject({
      eligible: false,
      reason: 'review_expired',
    });
    input.reviews[0].outcome!.validUntil = '2026-10-01T00:00:00.000Z';
    input.reviews[0].evidenceFingerprint = '9'.repeat(64);
    expect(evaluateThemeFactReviewEligibility(input)).toMatchObject({
      eligible: false,
      reason: 'review_mismatch',
    });
    input.reviews[0].evidenceFingerprint = input.evidence.fingerprint;
    input.evidence.supportOriginCount = 1;
    expect(evaluateThemeFactReviewEligibility(input)).toMatchObject({
      eligible: false,
      reason: 'insufficient_support',
    });
    input.evidence.supportOriginCount = 2;
    input.evidence.hasConflictEdge = true;
    expect(evaluateThemeFactReviewEligibility(input)).toMatchObject({
      eligible: false,
      reason: 'conflict_edge',
    });
  });

  it('requires compatible dimension reasons and the current review policy and prompt', () => {
    const invalidDimension = graph();
    invalidDimension.reviews[0].outcome!.dimensions!.entailment.reasons = ['unsupported'];
    expect(evaluateThemeFactReviewEligibility(invalidDimension)).toMatchObject({
      eligible: false,
      reason: 'review_mismatch',
    });

    const stalePolicy = graph();
    stalePolicy.reviews[0].policyHash = '9'.repeat(64);
    expect(evaluateThemeFactReviewEligibility(stalePolicy)).toMatchObject({
      eligible: false,
      reason: 'review_mismatch',
    });

    const stalePrompt = graph();
    stalePrompt.reviews[0].promptVersion = 'old-prompt';
    expect(evaluateThemeFactReviewEligibility(stalePrompt)).toMatchObject({
      eligible: false,
      reason: 'review_mismatch',
    });
  });

  it('fails closed with deterministic expiry reasons for malformed timestamps', () => {
    const malformedFactExpiry = graph();
    malformedFactExpiry.fact.validUntil = 'not-a-date';
    expect(evaluateThemeFactReviewEligibility(malformedFactExpiry)).toMatchObject({
      eligible: false,
      reason: 'fact_expired',
    });

    const malformedEvidenceExpiry = graph();
    malformedEvidenceExpiry.evidence.validUntil = 'not-a-date';
    expect(evaluateThemeFactReviewEligibility(malformedEvidenceExpiry)).toMatchObject({
      eligible: false,
      reason: 'evidence_expired',
    });

    const malformedReviewExpiry = graph();
    malformedReviewExpiry.reviews[0].outcome!.validUntil = 'not-a-date';
    expect(evaluateThemeFactReviewEligibility(malformedReviewExpiry)).toMatchObject({
      eligible: false,
      reason: 'review_expired',
    });
  });
});
