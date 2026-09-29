import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_DIMENSIONS,
  THEME_RELIABILITY_CONTRACT_VERSION,
} from '@shared/models/theme-evidence';
import {
  evaluateThemeEvidenceEligibility,
  hashQuestionSnapshot,
} from './theme-evidence-eligibility';

const now = new Date('2026-09-26T12:00:00.000Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function fixture() {
  const content = {
    question: 'Which city hosted the inaugural Example final?',
    answer: 'Ottawa',
    acceptableAnswers: ['City of Ottawa'],
    explanation: 'The inaugural final was held in Ottawa.',
    category: 'History',
    difficulty: 'Medium' as const,
    pillar: 'TimeCapsule',
    tags: ['example'],
    themeSlug: 'example-history',
  };
  const contentHash = hashQuestionSnapshot(content);
  const document = (n: number, originGroup: string) => ({
    contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
    id: id(n),
    requestedUrl: `https://example.org/${n}`,
    finalUrl: `https://example.org/${n}`,
    canonicalUrl: `https://example.org/${n}`,
    publisherId: `publisher-${n}`,
    sourceClass: 'primary_record',
    publisher: `Publisher ${n}`,
    originGroup,
    sourcePolicyVersion: 'sources-v1',
    extractorVersion: 'extractor-v1',
    title: `Record ${n}`,
    language: 'en',
    status: 'retrieved',
    contentHash: hash(`body-${n}`),
    retrievedAt: '2026-09-25T12:00:00.000Z',
    publishedAt: '2026-09-24T12:00:00.000Z',
    sourceUpdatedAt: null,
    validUntil: '2026-10-01T12:00:00.000Z',
    httpStatus: 200,
    mediaType: 'text/html',
  });
  const passage = (n: number, documentId: string) => ({
    contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
    id: id(n),
    documentId,
    ordinal: 0,
    locator: 'p1',
    text: 'The inaugural final was held in Ottawa.',
    contentHash: hash(`passage-${n}`),
  });
  const documents = [document(1, 'group-a'), document(2, 'group-b')];
  const passages = [passage(3, documents[0].id), passage(4, documents[1].id)];
  const revision = {
    contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
    id: id(5),
    questionId: null,
    candidateId: id(6),
    revision: 1,
    contentHash,
    content,
    createdAt: '2026-09-25T12:00:00.000Z',
  };
  const fact = {
    contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
    id: id(7),
    factId: id(8),
    revision: 1,
    statement: 'The inaugural Example final was held in Ottawa.',
    scope: {
      entity: 'Example final',
      relation: 'host city',
      time: 'inaugural',
      geography: 'Canada',
      competitionOrDomain: 'Example',
      qualifiers: [],
      asOf: null,
    },
    canonicalAnswer: 'Ottawa',
    supportedAliases: ['City of Ottawa'],
    contentHash: hash('fact-v1'),
    timeSensitive: false,
    validUntil: '2026-10-01T12:00:00.000Z',
  };
  const review = {
    contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
    id: id(9),
    questionRevisionId: revision.id,
    questionContentHash: contentHash,
    reviewPolicyVersion: 'review-v1',
    reviewerPromptVersion: 'prompt-v1',
    verdict: 'pass',
    dimensionResults: EVIDENCE_DIMENSIONS.map((dimension) => ({
      dimension,
      verdict: 'pass',
      reasons: ['supported'],
      passageIds: passages.map((item) => item.id),
    })),
    factRevisionIds: [fact.id],
    passageIds: passages.map((item) => item.id),
    reviewerKind: 'model',
    reviewerModel: 'reviewer-v1',
    reviewedAt: '2026-09-25T15:00:00.000Z',
    validUntil: '2026-10-01T12:00:00.000Z',
  };
  return {
    liveQuestion: { revisionId: revision.id, contentHash, content },
    questionRevision: revision,
    reviews: [review],
    facts: [fact],
    passages,
    documents,
    factPassageBindings: passages.map((item) => ({
      factRevisionId: fact.id,
      passageId: item.id,
      supportKind: 'supports',
    })),
    policy: {
      sourcePolicyVersion: 'sources-v1',
      extractorVersion: 'extractor-v1',
      reviewPolicyVersion: 'review-v1',
      reviewerPromptVersion: 'prompt-v1',
      allowedSourceClasses: ['primary_record'],
      maxSourceAgeMs: 7 * 24 * 60 * 60 * 1000,
      maxReviewAgeMs: 7 * 24 * 60 * 60 * 1000,
      minIndependentOriginGroupsPerFact: 2,
    },
  };
}

const decide = (graph: unknown) => evaluateThemeEvidenceEligibility(graph, now);

describe('theme evidence eligibility', () => {
  it('passes a complete, current graph and returns a versioned fingerprint', () => {
    const result = decide(fixture());
    expect(result).toMatchObject({
      version: 'theme-eligibility-v1',
      eligible: true,
      reason: 'eligible',
      reviewId: id(9),
    });
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(decide(fixture())).toEqual(result);
  });

  it('binds the live snapshot, revision, and review to the exact content hash', () => {
    const graph = fixture();
    graph.liveQuestion.content.answer = 'Toronto';
    expect(decide(graph).reason).toBe('revision_hash_mismatch');
    const other = fixture();
    other.reviews[0].questionContentHash = hash('wrong');
    expect(decide(other).reason).toBe('revision_hash_mismatch');
  });

  it('withholds expired sources, facts, reviews, and superseded policy versions', () => {
    const source = fixture();
    source.documents[0].validUntil = '2026-09-26T12:00:00.000Z';
    expect(decide(source).reason).toBe('source_stale');
    const fact = fixture();
    fact.facts[0].validUntil = '2026-09-26T11:59:59.000Z';
    expect(decide(fact).reason).toBe('fact_stale');
    const review = fixture();
    review.reviews[0].validUntil = '2026-09-26T11:59:59.000Z';
    expect(decide(review).reason).toBe('review_stale');
    const policy = fixture();
    policy.documents[0].sourcePolicyVersion = 'sources-v0';
    expect(decide(policy).reason).toBe('policy_version_mismatch');
    const aged = fixture();
    aged.documents[0].retrievedAt = '2026-09-01T12:00:00.000Z';
    expect(decide(aged).reason).toBe('source_stale');
  });

  it('withholds an alias or ambiguity dimension failure', () => {
    const graph = fixture();
    const aliases = graph.reviews[0].dimensionResults.find((item) => item.dimension === 'aliases')!;
    aliases.verdict = 'flag';
    aliases.reasons = ['alias_unsupported'];
    graph.reviews[0].verdict = 'flag';
    expect(decide(graph).reason).toBe('review_adverse');
    aliases.dimension = 'answer';
    expect(decide(graph).reason).toBe('review_incomplete');
  });

  it('requires the answer and accepted aliases to match a reviewed fact revision', () => {
    const answer = fixture();
    answer.facts[0].canonicalAnswer = 'Toronto';
    expect(decide(answer).reason).toBe('answer_unsupported');
    const alias = fixture();
    alias.facts[0].supportedAliases = [];
    expect(decide(alias).reason).toBe('alias_unsupported');
  });

  it('does not accept an alias or answer from a separate contextual fact', () => {
    for (const unrelatedAnswer of ['Toronto', 'Greater Toronto']) {
      const graph = fixture();
      const contextualFact = structuredClone(graph.facts[0]);
      contextualFact.id = id(11);
      contextualFact.factId = id(12);
      contextualFact.statement = 'A separate event was held in Toronto.';
      contextualFact.canonicalAnswer = 'Toronto';
      contextualFact.supportedAliases = ['Greater Toronto'];
      contextualFact.contentHash = hash('contextual-fact');
      graph.facts.push(contextualFact);
      graph.reviews[0].factRevisionIds.push(contextualFact.id);
      for (const passage of graph.passages) {
        graph.factPassageBindings.push({
          factRevisionId: contextualFact.id,
          passageId: passage.id,
          supportKind: 'supports',
        });
      }
      expect(decide(graph).reason).toBe('eligible');

      graph.liveQuestion.content.acceptableAnswers = [unrelatedAnswer];
      const contentHash = hashQuestionSnapshot(graph.liveQuestion.content);
      graph.liveQuestion.contentHash = contentHash;
      graph.questionRevision.contentHash = contentHash;
      graph.reviews[0].questionContentHash = contentHash;
      expect(decide(graph).reason).toBe('alias_unsupported');
    }
  });

  it('withholds an incomplete review even when its top-level verdict claims pass', () => {
    const graph = fixture();
    graph.reviews[0].dimensionResults.pop();
    expect(decide(graph).reason).toBe('review_incomplete');
  });

  it('requires each citation to bind a supporting fact, passage, and document', () => {
    const graph = fixture();
    graph.factPassageBindings.pop();
    expect(decide(graph).reason).toBe('bad_binding');
    const conflict = fixture();
    conflict.factPassageBindings[0].supportKind = 'conflicts';
    expect(decide(conflict).reason).toBe('claim_conflicted');
    const missingDocument = fixture();
    missingDocument.documents.pop();
    expect(decide(missingDocument).reason).toBe('bad_binding');
  });

  it('counts independent origin groups per fact, not document count', () => {
    const graph = fixture();
    graph.documents[1].originGroup = graph.documents[0].originGroup;
    expect(decide(graph).reason).toBe('source_not_independent');
  });

  it('withholds a reviewed fact superseded by a later supplied revision', () => {
    const graph = fixture();
    const revised = structuredClone(graph.facts[0]);
    revised.id = id(11);
    revised.revision = 2;
    revised.contentHash = hash('fact-v2');
    graph.facts.push(revised);
    expect(decide(graph).reason).toBe('fact_stale');
  });

  it('lets a newer adverse review supersede an older pass', () => {
    const graph = fixture();
    const adverse = structuredClone(graph.reviews[0]);
    adverse.id = id(10);
    adverse.reviewedAt = '2026-09-26T11:00:00.000Z';
    adverse.verdict = 'fail';
    adverse.dimensionResults[0].verdict = 'fail';
    adverse.dimensionResults[0].reasons = ['answer_not_unique'];
    graph.reviews.push(adverse);
    expect(decide(graph)).toMatchObject({
      eligible: false,
      reason: 'review_adverse',
      reviewId: id(10),
    });
    graph.reviews[1].dimensionResults.pop();
    expect(decide(graph).reason).toBe('review_incomplete');
  });

  it('orders same-timestamp reviews by stable ID regardless of input order', () => {
    const graph = fixture();
    const adverse = structuredClone(graph.reviews[0]);
    adverse.id = id(10);
    adverse.verdict = 'flag';
    adverse.dimensionResults[0].verdict = 'flag';
    adverse.dimensionResults[0].reasons = ['answer_not_unique'];
    graph.reviews.push(adverse);
    expect(decide(graph).reviewId).toBe(id(10));
    graph.reviews.reverse();
    expect(decide(graph).reviewId).toBe(id(10));
  });

  it('does not change a passing fingerprint when graph row order changes', () => {
    const graph = fixture();
    const first = decide(graph);
    graph.documents.reverse();
    graph.passages.reverse();
    graph.factPassageBindings.reverse();
    expect(decide(graph)).toEqual(first);
  });

  it('invalidates the fingerprint when evidence or policy changes', () => {
    const graph = fixture();
    const first = decide(graph);
    graph.facts[0].statement = 'A revised claim.';
    expect(decide(graph).fingerprint).not.toBe(first.fingerprint);
    graph.policy.minIndependentOriginGroupsPerFact = 3;
    expect(decide(graph).reason).toBe('source_not_independent');
  });
});
