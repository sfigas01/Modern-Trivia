import { describe, expect, it, vi } from 'vitest';

import { emptyDuplicateCounts } from '@shared/models/quality-sweep';
import { hashQuestionSnapshot } from './theme-evidence-eligibility';
import {
  createPostgresThemeQuestionApprovalRepository,
  ThemeQuestionApprovalError,
} from './theme-question-approval';

const evidenceMock = vi.hoisted(() => ({ qaContext: vi.fn() }));
vi.mock('./theme-question-evidence-review', () => ({
  createPostgresThemeQuestionEvidenceReviewRepository: () => evidenceMock,
}));

const ids = {
  approval: '11111111-1111-4111-8111-111111111111',
  candidate: '22222222-2222-4222-8222-222222222222',
  revision: '33333333-3333-4333-8333-333333333333',
  libraryRevision: '44444444-4444-4444-8444-444444444444',
  generation: '55555555-5555-4555-8555-555555555555',
  attempt: '66666666-6666-4666-8666-666666666666',
  review: '77777777-7777-4777-8777-777777777777',
  document: '88888888-8888-4888-8888-888888888888',
};
const content = {
  question: 'Which planet has the largest visible ring system?',
  answer: 'Saturn',
  acceptableAnswers: [],
  explanation: 'Saturn has the most extensive visible planetary ring system.',
  category: 'Science & Nature',
  difficulty: 'Easy' as const,
  pillar: 'GlobalEh',
  tags: ['Global', 'GlobalEh', 'Science & Nature'],
  themeSlug: 'planets',
};
const contentHash = hashQuestionSnapshot(content);
const request = {
  approvalId: ids.approval,
  candidateId: ids.candidate,
  questionRevisionId: ids.revision,
  questionContentHash: contentHash,
  libraryQuestionId: 'player-ai-planet-1',
  libraryRevisionId: ids.libraryRevision,
};
const context = {
  candidateId: ids.candidate,
  questionRevisionId: ids.revision,
  questionContentHash: contentHash,
  question: content,
  evidenceAttemptId: ids.attempt,
  evidenceReviewId: ids.review,
  evidenceFingerprint: 'a'.repeat(64),
  source: {
    documentId: ids.document,
    url: 'https://example.org/saturn',
    name: 'Planetary Institute',
  },
};

function setup(
  options: {
    corpusChange?: boolean;
    evidenceChange?: boolean;
    repairStatus?: string;
    originalClaim?: boolean;
    failRevisionInsert?: boolean;
  } = {}
) {
  let approval: Record<string, unknown> | null = null;
  let corpusReads = 0;
  const commands: string[] = [];
  const quality = vi.fn(async () => ({
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
  }));
  const semantic = vi.fn(async () => ({
    status: 'complete' as const,
    totalPairsChecked: 0,
    failedPairs: 0,
    duplicatesFound: [],
    duplicatesByType: emptyDuplicateCounts(),
  }));
  evidenceMock.qaContext.mockReset();
  evidenceMock.qaContext.mockImplementation(async (_request: unknown, db?: unknown) =>
    db && options.evidenceChange ? { ...context, evidenceFingerprint: 'b'.repeat(64) } : context
  );
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();
    commands.push(text);
    if (text.startsWith('SELECT * FROM theme_question_approvals'))
      return { rows: approval ? [approval] : [], rowCount: approval ? 1 : 0 };
    if (text.startsWith('SELECT * FROM questions')) {
      corpusReads++;
      return {
        rows:
          options.corpusChange && corpusReads === 3
            ? [
                {
                  id: 'other',
                  question: 'Other question?',
                  answer: 'Other answer',
                  status: 'approved',
                },
              ]
            : [],
      };
    }
    if (text.startsWith('SELECT clock_timestamp'))
      return { rows: [{ at: new Date('2026-10-06T12:00:00.000Z') }] };
    if (text.startsWith('SELECT fact_id, fact_revision_id FROM theme_candidates'))
      return { rows: [{ fact_id: 'fact', fact_revision_id: 'fact-revision' }], rowCount: 1 };
    if (text.startsWith('SELECT id FROM theme_facts'))
      return { rows: [{ id: 'fact' }], rowCount: 1 };
    if (text.startsWith('SELECT id FROM theme_fact_revisions'))
      return { rows: [{ id: 'fact-revision' }], rowCount: 1 };
    if (text.startsWith('SELECT id FROM theme_candidates'))
      return { rows: [{ id: ids.candidate }], rowCount: 1 };
    if (text.startsWith('SELECT id FROM theme_question_revisions'))
      return { rows: [{ id: ids.revision }], rowCount: 1 };
    if (text.startsWith('SELECT * FROM theme_candidates'))
      return {
        rows: [
          {
            id: ids.candidate,
            status: 'pending',
            content_hash: contentHash,
            content,
            revision: 1,
            fact_id: 'fact',
            fact_revision_id: 'fact-revision',
          },
        ],
      };
    if (text.startsWith('SELECT * FROM theme_question_revisions'))
      return {
        rows: [
          {
            id: ids.revision,
            candidate_id: ids.candidate,
            question_id: null,
            content_hash: contentHash,
            content,
            revision: 1,
          },
        ],
      };
    if (text.startsWith('SELECT * FROM theme_question_generation_attempts'))
      return {
        rows: [
          {
            id: ids.generation,
            candidate_id: ids.candidate,
            question_revision_id: ids.revision,
            fact_id: 'fact',
            fact_revision_id: 'fact-revision',
            parent_candidate_id: options.repairStatus ? 'parent' : null,
          },
        ],
      };
    if (text.startsWith('SELECT * FROM theme_question_generation_outcomes'))
      return { rows: [{ status: 'persisted', question_content_hash: contentHash }] };
    if (text.startsWith('SELECT * FROM theme_question_evidence_review_attempts'))
      return {
        rows: [
          {
            candidate_id: ids.candidate,
            question_revision_id: ids.revision,
            question_content_hash: contentHash,
          },
        ],
      };
    if (text.startsWith('SELECT * FROM theme_question_evidence_review_outcomes'))
      return { rows: [{ status: 'reviewed', verdict: 'pass', review_id: ids.review }] };
    if (text.startsWith('SELECT * FROM theme_evidence_reviews'))
      return {
        rows: [
          {
            id: ids.review,
            question_revision_id: ids.revision,
            question_content_hash: contentHash,
            verdict: 'pass',
          },
        ],
      };
    if (text.startsWith('SELECT * FROM theme_question_repair_outcomes'))
      return {
        rows: options.repairStatus
          ? [
              {
                status: options.repairStatus,
                stage: 'qa',
                candidate_id: ids.candidate,
                parent_candidate_id: 'parent',
                question_revision_id: ids.revision,
                question_content_hash: contentHash,
                evidence_review_attempt_id: ids.attempt,
                evidence_review_id: ids.review,
                evidence_fingerprint: context.evidenceFingerprint,
                qa_policy_version: 'theme-question-qa-v1',
                corpus_revision: 'old',
                corpus_hash: 'c'.repeat(64),
              },
            ]
          : [],
      };
    if (text.startsWith('SELECT id FROM theme_question_generation_attempts'))
      return { rows: options.originalClaim ? [{ id: 'claim' }] : [] };
    if (text.startsWith('INSERT INTO theme_question_revisions') && options.failRevisionInsert)
      throw new Error('simulated database failure');
    if (text.startsWith('INSERT INTO theme_question_approvals')) {
      approval = {
        id: values[0],
        candidate_id: values[2],
        question_revision_id: values[3],
        question_content_hash: values[4],
        library_question_id: values[13],
        library_revision_id: values[14],
        approved_at: new Date('2026-10-06T12:00:01.000Z'),
      };
      return { rows: [approval] };
    }
    if (text.startsWith('UPDATE theme_candidates')) return { rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const client = { query, release: vi.fn() };
  const pool = { query, connect: vi.fn(async () => client) };
  const repo = createPostgresThemeQuestionApprovalRepository(pool as never, {
    evidence: {} as never,
    checkQuality: quality,
    detectDuplicates: semantic,
    now: () => new Date('2026-10-06T11:59:00.000Z'),
  });
  return {
    repo,
    pool,
    commands,
    quality,
    semantic,
    setApproval: (row: Record<string, unknown>) => {
      approval = row;
    },
  };
}

describe('final theme question approval', () => {
  it('runs QA over DB-owned corpus and atomically inserts exact content, tags, source and separate revision', async () => {
    const { repo, commands, quality, semantic, pool } = setup();
    const result = await repo.approve(request);
    expect(result).toMatchObject({
      status: 'approved',
      approvalId: ids.approval,
      libraryQuestionId: request.libraryQuestionId,
    });
    expect(quality).toHaveBeenCalledOnce();
    expect(semantic).toHaveBeenCalledOnce();
    expect(commands.filter((item) => item.startsWith('SELECT * FROM questions'))).toHaveLength(3);
    expect(commands).toContain('LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE');
    expect(commands.some((item) => item.startsWith('LOCK TABLE theme_'))).toBe(false);
    expect(commands).toContain('SELECT * FROM theme_evidence_reviews WHERE id = $1 FOR UPDATE');
    const factLock = commands.findIndex((item) => item.startsWith('SELECT id FROM theme_facts'));
    const factRevisionLock = commands.findIndex((item) =>
      item.startsWith('SELECT id FROM theme_fact_revisions')
    );
    const candidateLock = commands.findIndex((item) =>
      item.startsWith('SELECT id FROM theme_candidates')
    );
    const revisionLock = commands.findIndex((item) =>
      item.startsWith('SELECT id FROM theme_question_revisions')
    );
    const tableBarrier = commands.findIndex((item) =>
      item.startsWith('LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE')
    );
    expect(factLock).toBeLessThan(factRevisionLock);
    expect(factRevisionLock).toBeLessThan(candidateLock);
    expect(candidateLock).toBeLessThan(revisionLock);
    expect(revisionLock).toBeLessThan(tableBarrier);
    const questionInsert = pool.query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO questions')
    );
    expect(questionInsert?.[1]).toEqual(
      expect.arrayContaining([
        JSON.stringify(content.tags),
        context.source.url,
        context.source.name,
      ])
    );
    expect(commands.some((item) => item.startsWith('INSERT INTO theme_question_revisions'))).toBe(
      true
    );
    expect(commands.some((item) => item.startsWith('UPDATE theme_candidates'))).toBe(true);
    expect(commands.at(-1)).toBe('COMMIT');
    const replay = await repo.approve(request);
    expect(replay).toEqual(result);
    expect(quality).toHaveBeenCalledOnce();
    expect(pool.connect).toHaveBeenCalledOnce();
  });

  it('rejects a conflicting completed replay before callbacks', async () => {
    const { repo, setApproval, quality } = setup();
    setApproval({
      id: ids.approval,
      candidate_id: ids.candidate,
      question_revision_id: ids.revision,
      question_content_hash: contentHash,
      library_question_id: request.libraryQuestionId,
      library_revision_id: ids.libraryRevision,
      approved_at: new Date(),
    });
    await expect(
      repo.approve({ ...request, libraryQuestionId: 'different-id' })
    ).rejects.toMatchObject({ code: 'request_conflict' });
    expect(quality).not.toHaveBeenCalled();
  });

  it.each([
    [{ corpusChange: true }, 'recheck_changed'],
    [{ evidenceChange: true }, 'recheck_changed'],
    [{ repairStatus: 'withheld' }, 'provenance_changed'],
    [{ originalClaim: true }, 'provenance_changed'],
  ] as const)(
    'withholds changed corpus/evidence or invalid repair binding %#',
    async (options, reason) => {
      const { repo, commands } = setup(options);
      await expect(repo.approve(request)).resolves.toMatchObject({ status: 'withheld', reason });
      expect(commands).not.toContain(expect.stringContaining('INSERT INTO questions'));
      expect(commands.at(-1)).toBe('ROLLBACK');
    }
  );

  it('rolls back an insertion failure before accepting the candidate', async () => {
    const { repo, commands } = setup({ failRevisionInsert: true });
    await expect(repo.approve(request)).rejects.toBeInstanceOf(ThemeQuestionApprovalError);
    expect(commands).not.toContain(expect.stringContaining('UPDATE theme_candidates'));
    expect(commands.at(-1)).toBe('ROLLBACK');
  });
});
