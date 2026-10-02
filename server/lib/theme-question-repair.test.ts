import { randomUUID } from 'node:crypto';

import type { Pool, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { emptyDuplicateCounts } from '@shared/models/quality-sweep';
import type { ThemeQuestionWriterInput } from '@shared/models/theme-question-generation';
import { hashQuestionSnapshot } from './theme-evidence-eligibility';
import type { ThemeQuestionQaContext } from './theme-question-evidence-review';
import {
  createPostgresThemeQuestionRepairOrchestrator,
  ThemeQuestionRepairError,
  type ThemeQuestionRepairDependencies,
} from './theme-question-repair';
import { THEME_QUESTION_QA_POLICY_VERSION } from './theme-question-qa';

const parentQuestion = {
  question: 'Which planet is Saturn?',
  answer: 'Saturn',
  acceptableAnswers: [],
  explanation: 'Saturn is the sixth planet from the Sun.',
  category: 'Science & Nature',
  difficulty: 'Easy' as const,
  pillar: 'GlobalEh',
  tags: ['planets'],
  themeSlug: 'planets',
};
const childQuestion = {
  ...parentQuestion,
  question: 'Which planet has the largest and most visible ring system?',
  explanation: 'Saturn has the most extensive and visible planetary ring system.',
  tags: ['Global', 'GlobalEh', 'Science & Nature'],
};

function result(rows: Record<string, unknown>[] = []): QueryResult {
  return { rows, rowCount: rows.length } as QueryResult;
}

function fixture() {
  const ids = {
    job: randomUUID(),
    fact: randomUUID(),
    factRevision: randomUUID(),
    factReview: randomUUID(),
    generation: randomUUID(),
    parentCandidate: randomUUID(),
    parentRevision: randomUUID(),
    parentEvidenceAttempt: randomUUID(),
    parentEvidenceReview: randomUUID(),
    childCandidate: randomUUID(),
    childRevision: randomUUID(),
    childEvidenceAttempt: randomUUID(),
    childEvidenceReview: randomUUID(),
    document: randomUUID(),
  };
  const parentHash = hashQuestionSnapshot(parentQuestion);
  const childHash = hashQuestionSnapshot(childQuestion);
  const parentContext: ThemeQuestionQaContext = {
    candidateId: ids.parentCandidate,
    questionRevisionId: ids.parentRevision,
    questionContentHash: parentHash,
    question: parentQuestion,
    evidenceAttemptId: ids.parentEvidenceAttempt,
    evidenceReviewId: ids.parentEvidenceReview,
    evidenceFingerprint: 'a'.repeat(64),
    source: {
      documentId: ids.document,
      url: 'https://en.wikipedia.org/wiki/Saturn',
      name: 'Wikipedia',
    },
  };
  const childContext: ThemeQuestionQaContext = {
    ...parentContext,
    candidateId: ids.childCandidate,
    questionRevisionId: ids.childRevision,
    questionContentHash: childHash,
    question: childQuestion,
    evidenceAttemptId: ids.childEvidenceAttempt,
    evidenceReviewId: ids.childEvidenceReview,
    evidenceFingerprint: 'b'.repeat(64),
  };
  const generation = {
    attemptId: ids.generation,
    jobId: ids.job,
    ordinal: 2,
    candidateId: ids.childCandidate,
    questionRevisionId: ids.childRevision,
    factId: ids.fact,
    factRevisionId: ids.factRevision,
    factContentHash: 'c'.repeat(64),
    factReviewAttemptId: ids.factReview,
    factReviewOutputHash: 'd'.repeat(64),
    repairOf: {
      parentCandidateId: ids.parentCandidate,
      parentQuestionRevisionId: ids.parentRevision,
      parentQuestionContentHash: parentHash,
      evidenceReviewAttemptId: ids.childEvidenceAttempt,
      failureStage: 'static' as const,
      failureReason: 'static_finding' as const,
    },
  };
  const parentQaDecision = {
    status: 'withheld' as const,
    candidateId: ids.parentCandidate,
    questionRevisionId: ids.parentRevision,
    questionContentHash: parentHash,
    evidenceAttemptId: ids.parentEvidenceAttempt,
    evidenceReviewId: ids.parentEvidenceReview,
    evidenceFingerprint: parentContext.evidenceFingerprint,
    corpusRevision: null,
    corpusHash: null,
    policyVersion: THEME_QUESTION_QA_POLICY_VERSION,
    evaluatedAt: '2026-10-01T12:00:00.000Z',
    stage: 'static' as const,
    reason: 'static_finding' as const,
  };
  const writerInput: ThemeQuestionWriterInput = {
    contractVersion: 'theme-question-generation-v1',
    fact: {
      id: ids.fact,
      revisionId: ids.factRevision,
      contentHash: generation.factContentHash,
      statement: 'Saturn is the sixth planet from the Sun.',
      scope: {},
      canonicalAnswer: 'Saturn',
      supportedAliases: [],
    },
    evidence: [
      {
        passageId: randomUUID(),
        passageContentHash: 'e'.repeat(64),
        text: 'Saturn is the sixth planet from the Sun and has a prominent ring system.',
        originGroup: 'wikipedia',
        sourceClass: 'reference',
        supportKind: 'supports',
      },
    ],
  };
  let stored: Record<string, unknown> | null = null;
  let generationAttemptExists = false;
  const pool = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('FROM theme_question_repair_outcomes'))
        return result(stored ? [stored] : []);
      if (sql.includes('SELECT id FROM theme_question_generation_attempts'))
        return result(generationAttemptExists ? [{ id: ids.generation }] : []);
      if (sql.includes('INSERT INTO theme_question_repair_outcomes')) {
        stored = {
          generation_attempt_id: values[0],
          parent_candidate_id: values[1],
          candidate_id: values[2],
          question_revision_id: values[3],
          question_content_hash: values[4],
          status: values[5],
          stage: values[6],
          reason: values[7],
          evidence_review_attempt_id: values[8],
          evidence_review_id: values[9],
          evidence_fingerprint: values[10],
          qa_policy_version: values[11],
          qa_evaluated_at: values[12],
          corpus_revision: values[13],
          corpus_hash: values[14],
        };
        return result();
      }
      throw new Error(`unexpected query: ${sql}`);
    }),
  } as unknown as Pool;
  const generationRepository = {
    generate: vi.fn(async (_request, writer) => {
      generationAttemptExists = true;
      if (!stored) await writer(structuredClone(writerInput));
      return {
        status: 'persisted' as const,
        attemptId: ids.generation,
        candidateId: ids.childCandidate,
        questionRevisionId: ids.childRevision,
        contentHash: childHash,
        content: childQuestion,
      };
    }),
  };
  const review = vi.fn(async () => ({
    status: 'reviewed' as const,
    attemptId: ids.childEvidenceAttempt,
    reviewId: ids.childEvidenceReview,
    verdict: 'pass' as const,
  }));
  const loadParentContext = vi.fn(async () => parentContext);
  const qa = {
    loadContext: vi.fn(async () => childContext),
    loadCorpus: vi.fn(async () => ({ revision: 'corpus-1', questions: [] })),
    checkQuality: vi.fn(async () => ({
      totalChecked: 1,
      results: [
        {
          questionId: ids.childCandidate,
          verdict: 'pass' as const,
          coherence: 'pass' as const,
          obviousness: 'pass' as const,
          confidence: 100,
          reason: 'Supported.',
        },
      ],
    })),
    detectDuplicates: vi.fn(async () => ({
      totalPairsChecked: 0,
      duplicatesFound: [],
      duplicatesByType: emptyDuplicateCounts(),
      status: 'complete' as const,
      failedPairs: 0,
    })),
    now: () => new Date('2026-10-01T13:00:00.000Z'),
  };
  const dependencies = {
    generation: generationRepository,
    evidenceReview: { review },
    loadParentContext,
    qa,
  } satisfies ThemeQuestionRepairDependencies;
  return {
    ids,
    pool,
    generation,
    parentQaDecision,
    dependencies,
    generationRepository,
    review,
    loadParentContext,
    childContext,
    setGenerationAttemptExists: (value: boolean) => {
      generationAttemptExists = value;
    },
  };
}

describe('bounded theme question repair', () => {
  it('repairs once, re-runs evidence and every QA gate, then replays without callbacks', async () => {
    const f = fixture();
    const repository = createPostgresThemeQuestionRepairOrchestrator(f.pool, f.dependencies);
    const repairer = vi.fn(() => ({
      status: 'candidate' as const,
      question: childQuestion.question,
      explanation: childQuestion.explanation,
    }));
    const reviewer = vi.fn(() => ({ dimensionResults: [] }));

    const first = await repository.repair(
      { generation: f.generation, parentQaDecision: f.parentQaDecision },
      repairer,
      reviewer
    );
    expect(first).toMatchObject({ status: 'passed', stage: 'qa', reason: 'passed' });
    expect(repairer).toHaveBeenCalledTimes(1);
    expect(f.review).toHaveBeenCalledTimes(1);
    expect(f.dependencies.qa.checkQuality).toHaveBeenCalledTimes(1);
    expect(f.dependencies.qa.detectDuplicates).toHaveBeenCalledTimes(1);

    const replay = await repository.repair(
      { generation: f.generation, parentQaDecision: f.parentQaDecision },
      repairer,
      reviewer
    );
    expect(replay).toEqual(first);
    expect(repairer).toHaveBeenCalledTimes(1);
    expect(f.review).toHaveBeenCalledTimes(1);
    expect(f.generationRepository.generate).toHaveBeenCalledTimes(2);
  });

  it('withholds a child that fails fresh evidence review before QA', async () => {
    const f = fixture();
    f.review.mockResolvedValueOnce({
      status: 'reviewed',
      attemptId: f.ids.childEvidenceAttempt,
      reviewId: f.ids.childEvidenceReview,
      verdict: 'fail',
    });
    const repository = createPostgresThemeQuestionRepairOrchestrator(f.pool, f.dependencies);
    const decision = await repository.repair(
      { generation: f.generation, parentQaDecision: f.parentQaDecision },
      () => ({
        status: 'candidate',
        question: childQuestion.question,
        explanation: childQuestion.explanation,
      }),
      () => ({ dimensionResults: [] })
    );
    expect(decision).toMatchObject({
      status: 'withheld',
      stage: 'evidence',
      reason: 'evidence_fail',
    });
    expect(f.dependencies.qa.loadContext).not.toHaveBeenCalled();
  });

  it('withholds before provider QA if the fresh evidence review is no longer current', async () => {
    const f = fixture();
    f.dependencies.qa.loadContext.mockResolvedValueOnce({
      ...f.childContext,
      evidenceAttemptId: randomUUID(),
      evidenceReviewId: randomUUID(),
      evidenceFingerprint: 'f'.repeat(64),
    });
    const repository = createPostgresThemeQuestionRepairOrchestrator(f.pool, f.dependencies);
    const decision = await repository.repair(
      { generation: f.generation, parentQaDecision: f.parentQaDecision },
      () => ({
        status: 'candidate',
        question: childQuestion.question,
        explanation: childQuestion.explanation,
      }),
      () => ({ dimensionResults: [] })
    );

    expect(decision).toMatchObject({
      status: 'withheld',
      stage: 'evidence',
      reason: 'evidence_changed',
    });
    expect(f.dependencies.qa.checkQuality).not.toHaveBeenCalled();
  });

  it('does not dispatch review or QA when generation was replayed without a repair outcome', async () => {
    const f = fixture();
    f.generationRepository.generate.mockResolvedValueOnce({
      status: 'persisted',
      attemptId: f.ids.generation,
      candidateId: f.ids.childCandidate,
      questionRevisionId: f.ids.childRevision,
      contentHash: hashQuestionSnapshot(childQuestion),
      content: childQuestion,
    });
    const repository = createPostgresThemeQuestionRepairOrchestrator(f.pool, f.dependencies);
    const repairer = vi.fn(() => ({ status: 'declined' as const }));
    const reviewer = vi.fn(() => ({ dimensionResults: [] }));

    await expect(
      repository.repair(
        { generation: f.generation, parentQaDecision: f.parentQaDecision },
        repairer,
        reviewer
      )
    ).rejects.toMatchObject<Partial<ThemeQuestionRepairError>>({ code: 'attempt_unresolved' });
    expect(repairer).not.toHaveBeenCalled();
    expect(f.review).not.toHaveBeenCalled();
    expect(f.dependencies.qa.checkQuality).not.toHaveBeenCalled();
  });

  it('rejects non-repairable requests and unresolved registered attempts', async () => {
    const f = fixture();
    const repository = createPostgresThemeQuestionRepairOrchestrator(f.pool, f.dependencies);
    await expect(
      repository.repair(
        {
          generation: f.generation,
          parentQaDecision: { ...f.parentQaDecision, reason: 'quality_incomplete' },
        },
        () => ({ status: 'declined' }),
        () => ({ dimensionResults: [] })
      )
    ).rejects.toMatchObject<Partial<ThemeQuestionRepairError>>({ code: 'invalid_request' });

    f.setGenerationAttemptExists(true);
    await expect(
      repository.repair(
        { generation: f.generation, parentQaDecision: f.parentQaDecision },
        () => ({ status: 'declined' }),
        () => ({ dimensionResults: [] })
      )
    ).rejects.toMatchObject<Partial<ThemeQuestionRepairError>>({ code: 'attempt_unresolved' });
  });
});
