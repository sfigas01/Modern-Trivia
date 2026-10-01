import { describe, expect, it, vi } from 'vitest';

import { emptyDuplicateCounts } from '@shared/models/quality-sweep';
import { hashQuestionSnapshot } from './theme-evidence-eligibility';
import type { ThemeQuestionQaContext } from './theme-question-evidence-review';
import {
  runThemeQuestionQa,
  ThemeQuestionQaError,
  type ThemeQuestionQaDependencies,
} from './theme-question-qa';

const ids = {
  candidate: '11111111-1111-4111-8111-111111111111',
  revision: '22222222-2222-4222-8222-222222222222',
  attempt: '33333333-3333-4333-8333-333333333333',
  review: '44444444-4444-4444-8444-444444444444',
  document: '55555555-5555-4555-8555-555555555555',
};

const question = {
  question: 'Which planet has the largest and most visible ring system?',
  answer: 'Saturn',
  acceptableAnswers: [],
  explanation: 'Saturn has the most extensive and visible planetary ring system.',
  category: 'Science & Nature',
  difficulty: 'Easy' as const,
  pillar: 'GlobalEh',
  tags: ['Global', 'GlobalEh', 'Science & Nature'],
  themeSlug: 'planets',
};
const contentHash = hashQuestionSnapshot(question);
const request = {
  candidateId: ids.candidate,
  questionRevisionId: ids.revision,
  questionContentHash: contentHash,
};

function context(overrides: Partial<ThemeQuestionQaContext> = {}): ThemeQuestionQaContext {
  return {
    ...request,
    question: structuredClone(question),
    evidenceAttemptId: ids.attempt,
    evidenceReviewId: ids.review,
    evidenceFingerprint: 'a'.repeat(64),
    source: {
      documentId: ids.document,
      url: 'https://en.wikipedia.org/wiki/Saturn',
      name: 'Wikipedia',
    },
    ...overrides,
  };
}

function completeReport(totalPairsChecked = 0) {
  return {
    totalPairsChecked,
    duplicatesFound: [],
    duplicatesByType: emptyDuplicateCounts(),
    status: 'complete' as const,
    failedPairs: 0,
  };
}

function dependencies(overrides: Partial<ThemeQuestionQaDependencies> = {}) {
  return {
    loadContext: vi.fn(async () => context()),
    loadCorpus: vi.fn(async () => ({ revision: 'corpus-1', questions: [] })),
    checkQuality: vi.fn(async () => ({
      totalChecked: 1,
      results: [
        {
          questionId: ids.candidate,
          verdict: 'pass' as const,
          coherence: 'pass' as const,
          obviousness: 'pass' as const,
          confidence: 100,
          reason: 'Supported.',
        },
      ],
    })),
    detectDuplicates: vi.fn(async () => completeReport()),
    now: () => new Date('2026-09-30T12:00:00.000Z'),
    ...overrides,
  } satisfies ThemeQuestionQaDependencies;
}

describe('runThemeQuestionQa', () => {
  it('returns a provisional pass only after every gate and final recheck', async () => {
    const deps = dependencies();
    const result = await runThemeQuestionQa(request, deps);

    expect(result).toMatchObject({
      status: 'passed',
      reason: 'passed',
      stage: 'recheck',
      evidenceAttemptId: ids.attempt,
      evidenceReviewId: ids.review,
      corpusRevision: 'corpus-1',
    });
    expect(deps.loadContext).toHaveBeenCalledTimes(2);
    expect(deps.loadCorpus).toHaveBeenCalledTimes(2);
    expect(deps.detectDuplicates).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ cache: null, scopeIds: new Set([ids.candidate]) })
    );
  });

  it('withholds a content-hash mismatch before provider-backed checks', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () =>
        context({ question: { ...question, question: 'Which planet is Saturn?' } })
      ),
    });
    const result = await runThemeQuestionQa(request, deps);

    expect(result).toMatchObject({
      status: 'withheld',
      stage: 'evidence',
      reason: 'invalid_context',
    });
    expect(deps.checkQuality).not.toHaveBeenCalled();
  });

  it('withholds any static finding before provider-backed checks', async () => {
    const leakingQuestion = { ...question, question: 'Which planet is Saturn?' };
    const leakingRequest = {
      ...request,
      questionContentHash: hashQuestionSnapshot(leakingQuestion),
    };
    const deps = dependencies({
      loadContext: vi.fn(async () =>
        context({
          questionContentHash: leakingRequest.questionContentHash,
          question: leakingQuestion,
        })
      ),
    });
    const result = await runThemeQuestionQa(leakingRequest, deps);

    expect(result).toMatchObject({ status: 'withheld', stage: 'static', reason: 'static_finding' });
    expect(deps.checkQuality).not.toHaveBeenCalled();
  });

  it.each(['verdict', 'coherence', 'obviousness'] as const)(
    'withholds a non-pass %s result',
    async (field) => {
      const deps = dependencies({
        checkQuality: vi.fn(async () => ({
          totalChecked: 1,
          results: [
            {
              questionId: ids.candidate,
              verdict: 'pass' as const,
              coherence: 'pass' as const,
              obviousness: 'pass' as const,
              confidence: 50,
              reason: 'Needs review.',
              [field]: 'flag',
            },
          ],
        })),
      });
      await expect(runThemeQuestionQa(request, deps)).resolves.toMatchObject({
        status: 'withheld',
        stage: 'quality',
        reason: 'quality_adverse',
      });
      expect(deps.detectDuplicates).not.toHaveBeenCalled();
    }
  );

  it('withholds missing or duplicate quality output', async () => {
    const deps = dependencies({
      checkQuality: vi.fn(async () => ({ totalChecked: 1, results: [] })),
    });
    await expect(runThemeQuestionQa(request, deps)).resolves.toMatchObject({
      reason: 'quality_incomplete',
    });
  });

  it('withholds incomplete semantic work', async () => {
    const deps = dependencies({
      detectDuplicates: vi.fn(async () => ({
        ...completeReport(),
        status: 'incomplete' as const,
        failedPairs: 1,
      })),
    });
    await expect(runThemeQuestionQa(request, deps)).resolves.toMatchObject({
      stage: 'semantic',
      reason: 'semantic_incomplete',
    });
  });

  it('withholds a malformed semantic report instead of throwing', async () => {
    const deps = dependencies({
      detectDuplicates: vi.fn(async () => ({
        ...completeReport(),
        duplicatesFound: [null],
      })) as ThemeQuestionQaDependencies['detectDuplicates'],
    });
    await expect(runThemeQuestionQa(request, deps)).resolves.toMatchObject({
      stage: 'semantic',
      reason: 'semantic_incomplete',
    });
  });

  it('withholds contradictory semantic duplicate counts', async () => {
    const deps = dependencies({
      detectDuplicates: vi.fn(async () => ({
        ...completeReport(),
        duplicatesByType: { ...emptyDuplicateCounts(), answer_conflict: 1 },
      })),
    });
    await expect(runThemeQuestionQa(request, deps)).resolves.toMatchObject({
      stage: 'semantic',
      reason: 'semantic_incomplete',
    });
  });

  it('withholds malformed semantic duplicate counts', async () => {
    const deps = dependencies({
      detectDuplicates: vi.fn(async () => ({
        ...completeReport(),
        duplicatesByType: { ...emptyDuplicateCounts(), exact: -1 },
      })) as ThemeQuestionQaDependencies['detectDuplicates'],
    });
    await expect(runThemeQuestionQa(request, deps)).resolves.toMatchObject({
      stage: 'semantic',
      reason: 'semantic_incomplete',
    });
  });

  it('withholds every semantic match type', async () => {
    const existing = { id: 'existing-1', question: 'Name Saturn.', answer: 'Saturn' };
    const deps = dependencies({
      loadCorpus: vi.fn(async () => ({ revision: 'corpus-1', questions: [existing] })),
      detectDuplicates: vi.fn(async () => ({
        ...completeReport(1),
        duplicatesFound: [
          {
            questionIdA: ids.candidate,
            questionIdB: existing.id,
            matchType: 'review_required' as const,
            similarityScore: 0.7,
            questionTextA: question.question,
            questionTextB: existing.question,
            answerA: question.answer,
            answerB: existing.answer,
            findingKey: 'finding',
          },
        ],
        duplicatesByType: { ...emptyDuplicateCounts(), review_required: 1 },
      })),
    });
    await expect(runThemeQuestionQa(request, deps)).resolves.toMatchObject({
      reason: 'semantic_match',
    });
  });

  it('withholds if evidence changes while checks run', async () => {
    const deps = dependencies({
      loadContext: vi
        .fn()
        .mockResolvedValueOnce(context())
        .mockResolvedValueOnce(context({ evidenceFingerprint: 'b'.repeat(64) })),
    });
    await expect(runThemeQuestionQa(request, deps)).resolves.toMatchObject({
      stage: 'recheck',
      reason: 'context_changed',
    });
  });

  it('withholds if the comparison corpus changes while checks run', async () => {
    const deps = dependencies({
      loadCorpus: vi
        .fn()
        .mockResolvedValueOnce({ revision: 'corpus-1', questions: [] })
        .mockResolvedValueOnce({ revision: 'corpus-2', questions: [] }),
    });
    await expect(runThemeQuestionQa(request, deps)).resolves.toMatchObject({
      stage: 'recheck',
      reason: 'corpus_changed',
    });
  });

  it('does not expose dependency errors', async () => {
    const deps = dependencies({
      checkQuality: vi.fn(async () => {
        throw new Error('secret provider response');
      }),
    });
    const result = await runThemeQuestionQa(request, deps);
    expect(result).toMatchObject({ reason: 'dependency_failure' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('rejects malformed requests before invoking dependencies', async () => {
    const deps = dependencies();
    await expect(
      runThemeQuestionQa({ ...request, candidateId: 'not-a-uuid' }, deps)
    ).rejects.toEqual(
      expect.objectContaining<Partial<ThemeQuestionQaError>>({ code: 'invalid_request' })
    );
    expect(deps.loadContext).not.toHaveBeenCalled();
  });
});
