import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_DIMENSIONS,
  THEME_RELIABILITY_CONTRACT_VERSION,
  evidenceReviewSchema,
  questionRevisionSchema,
  retrievalFailureSchema,
  scopedFactSchema,
  sourceDocumentSchema,
} from './theme-evidence';
import {
  THEME_GAME_LIMITS,
  internalThemeFailureSchema,
  publicThemeJobSchema,
  publicThemeProgressSchema,
  themeGamePlanFor,
  themeGamePlanSchema,
} from './theme';

const id = (suffix: number) => `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`;
const hash = (character: string) => character.repeat(64);
const now = '2026-09-20T14:00:00.000Z';

describe('theme-reliability-v1 evidence contracts', () => {
  it('requires freshness metadata for time-sensitive scoped facts', () => {
    const baseFact = {
      contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
      id: id(1),
      factId: id(10),
      revision: 1,
      statement: 'The first event final was held in the stated city.',
      scope: {
        entity: 'First event final',
        relation: 'was held in',
        time: 'inaugural tournament',
        geography: 'host city',
        competitionOrDomain: 'professional tournament',
        qualifiers: ['final game'],
        asOf: null,
      },
      canonicalAnswer: 'San Diego',
      supportedAliases: [],
      contentHash: hash('a'),
      timeSensitive: true,
      validUntil: null,
    };

    const result = scopedFactSchema.safeParse(baseFact);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(
      expect.arrayContaining(['scope.asOf', 'validUntil'])
    );
  });

  it('accepts retrieved source versions and typed provider failures', () => {
    expect(
      sourceDocumentSchema.safeParse({
        contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
        id: id(2),
        requestedUrl: 'https://example.org/reference',
        finalUrl: 'https://example.org/reference',
        canonicalUrl: 'https://example.org/reference',
        publisherId: 'example-authority',
        sourceClass: 'primary_official',
        publisher: 'Example Authority',
        originGroup: 'example-authority',
        sourcePolicyVersion: 'source-policy-v1',
        extractorVersion: 'html-extractor-v1',
        title: 'Reference',
        language: 'en',
        status: 'retrieved',
        contentHash: hash('b'),
        retrievedAt: now,
        publishedAt: null,
        sourceUpdatedAt: null,
        validUntil: null,
        httpStatus: 200,
        mediaType: 'text/html',
      }).success
    ).toBe(true);
    expect(
      retrievalFailureSchema.safeParse({
        contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
        code: 'provider_unknown_outcome',
        retryable: false,
        provider: 'provider-name',
        httpStatus: null,
      }).success
    ).toBe(true);
  });

  it('binds a review to an exact question revision and requires every check to pass', () => {
    const revision = questionRevisionSchema.parse({
      contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
      id: id(3),
      questionId: null,
      candidateId: id(4),
      revision: 1,
      contentHash: hash('c'),
      content: {
        question: 'In which city was the first event final held?',
        answer: 'San Diego',
        acceptableAnswers: [],
        explanation: 'The final was held in San Diego.',
        category: 'Sports',
        difficulty: 'Medium',
        pillar: 'TimeCapsule',
        tags: ['event'],
        themeSlug: 'event-history',
      },
      createdAt: now,
    });
    const dimensionResults = EVIDENCE_DIMENSIONS.map((dimension) => ({
      dimension,
      verdict: 'pass' as const,
      reasons: ['supported' as const],
      passageIds: [id(7)],
    }));
    const review = {
      contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
      id: id(5),
      questionRevisionId: revision.id,
      questionContentHash: revision.contentHash,
      reviewPolicyVersion: 'review-policy-v1',
      reviewerPromptVersion: 'reviewer-prompt-v1',
      verdict: 'pass',
      dimensionResults,
      factRevisionIds: [id(6)],
      passageIds: [id(7)],
      reviewerKind: 'model',
      reviewerModel: 'reviewer-model',
      reviewedAt: now,
      validUntil: null,
    };

    expect(evidenceReviewSchema.safeParse(review).success).toBe(true);
    expect(
      evidenceReviewSchema.safeParse({
        ...review,
        dimensionResults: dimensionResults.map((result, index) =>
          index === 0 ? { ...result, verdict: 'flag', reasons: ['claim_not_entailed'] } : result
        ),
      }).success
    ).toBe(false);
    expect(
      evidenceReviewSchema.safeParse({
        ...review,
        dimensionResults: dimensionResults.map((result, index) =>
          index === 0 ? { ...result, reasons: ['missing_evidence'] } : result
        ),
      }).success
    ).toBe(false);
    expect(
      evidenceReviewSchema.safeParse({
        ...review,
        dimensionResults: [...dimensionResults.slice(0, -1), dimensionResults[0]],
      }).success
    ).toBe(false);
  });

  it('requires a revision to belong to exactly one owner', () => {
    const base = {
      contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
      id: id(11),
      revision: 1,
      contentHash: hash('d'),
      content: {
        question: 'Question?',
        answer: 'Answer',
        acceptableAnswers: [],
        explanation: 'Explanation.',
        category: 'Sports',
        difficulty: 'Easy',
        pillar: 'TimeCapsule',
        tags: [],
        themeSlug: 'example',
      },
      createdAt: now,
    };
    expect(
      questionRevisionSchema.safeParse({ ...base, questionId: 'q-1', candidateId: id(12) }).success
    ).toBe(false);
    expect(
      questionRevisionSchema.safeParse({ ...base, questionId: null, candidateId: null }).success
    ).toBe(false);
  });
});

describe('theme-reliability-v1 game and public contracts', () => {
  it.each([2, 3, 4] as const)('locks the approved limits for %s participants', (playerCount) => {
    const plan = themeGamePlanFor(playerCount);
    expect(plan).toMatchObject({
      questionCount: THEME_GAME_LIMITS[playerCount].questions,
      candidateCeiling: THEME_GAME_LIMITS[playerCount].candidateCeiling,
      openingQuestionTarget: THEME_GAME_LIMITS[playerCount].openingQuestions,
    });
    expect(themeGamePlanSchema.safeParse({ ...plan, candidateCeiling: 101 }).success).toBe(false);
  });

  it('keeps public progress aggregate-only and bounded', () => {
    const progress = {
      contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
      gameId: id(8),
      jobId: id(9),
      status: 'reviewing',
      stage: 'verifying',
      readyCount: 15,
      requiredCount: 40,
      openingReadyCount: 15,
      openingRequiredCount: 16,
      themedReadyCount: 11,
      relatedReadyCount: 4,
      candidatesUsed: 22,
      candidateCeiling: 50,
      canStart: false,
      needsHostDecision: false,
      failure: null,
      updatedAt: now,
    };
    expect(publicThemeProgressSchema.safeParse(progress).success).toBe(true);
    expect(publicThemeProgressSchema.safeParse({ ...progress, answer: 'spoiler' }).success).toBe(
      false
    );
    expect(publicThemeProgressSchema.safeParse({ ...progress, candidatesUsed: 51 }).success).toBe(
      false
    );
    expect(publicThemeProgressSchema.safeParse({ ...progress, themedReadyCount: 12 }).success).toBe(
      false
    );

    const job = {
      contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
      gameId: progress.gameId,
      jobId: progress.jobId,
      theme: 'event history',
      relatedCategories: ['Sports'],
      progress,
    };
    expect(publicThemeJobSchema.safeParse(job).success).toBe(true);
    expect(
      publicThemeJobSchema.safeParse({
        ...job,
        progress: { ...progress, jobId: id(13) },
      }).success
    ).toBe(false);
  });

  it('keeps detailed provider failures in the internal contract', () => {
    expect(
      internalThemeFailureSchema.safeParse({
        contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
        code: 'provider_unknown_outcome',
        retryable: false,
        operation: 'generate',
        provider: 'provider-name',
        httpStatus: null,
        candidateOrdinal: 8,
      }).success
    ).toBe(true);
  });
});
