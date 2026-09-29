import type { Express, NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryMock } from './test/dbMock';
import { buildTestApp } from './test/testApp';

const dbMocks = vi.hoisted(() => ({
  delete: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  selectDistinct: vi.fn(),
  update: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  isAuthenticated: vi.fn((req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { user?: TestUser }).user;
    if (!user) return res.status(401).json({ message: 'Unauthorized' });
    next();
  }),
  registerAuthRoutes: vi.fn(),
  setupAuth: vi.fn(async (app: Express) => {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const userId = req.header('x-test-user-id');
      if (userId) {
        (req as Request & { user?: TestUser }).user = {
          claims: { sub: userId },
          expires_at: Math.floor(Date.now() / 1000) + 60,
        };
      }
      next();
    });
  }),
}));

type TestUser = {
  claims: { sub: string };
  expires_at: number;
};

vi.mock('./db', () => ({
  db: {
    delete: dbMocks.delete,
    insert: dbMocks.insert,
    select: dbMocks.select,
    selectDistinct: dbMocks.selectDistinct,
    update: dbMocks.update,
  },
}));

vi.mock('./replit_integrations/auth', () => authMocks);
vi.mock('./lib/subjectivity-enricher', () => ({ enrichSubjectiveFindings: vi.fn() }));
vi.mock('./lib/ai', () => ({ analyzeDispute: vi.fn() }));
vi.mock('./lib/guardian', () => ({ generateQuestions: vi.fn() }));
vi.mock('./lib/field-fix', () => ({ getAiFieldFix: vi.fn() }));
vi.mock('./lib/question-quality-audit', () => ({ auditQuestionQuality: vi.fn() }));
vi.mock('./lib/duplicate-detector', () => ({ detectDuplicates: vi.fn() }));
vi.mock('./lib/verifier', () => ({ batchFactCheck: vi.fn() }));
vi.mock('./lib/topic-context', () => ({ selectTopicContext: vi.fn() }));
vi.mock('./lib/novelty-filter', () => ({ filterNovelQuestions: vi.fn() }));

import { detectDuplicates } from './lib/duplicate-detector';
import { filterNovelQuestions } from './lib/novelty-filter';
import { generateQuestions } from './lib/guardian';
import { emptyDuplicateCounts } from '@shared/models/quality-sweep';
import { auditQuestionQuality } from './lib/question-quality-audit';
import { batchFactCheck } from './lib/verifier';

const auditMock = vi.mocked(auditQuestionQuality);
const factCheckMock = vi.mocked(batchFactCheck);

const adminRole = { userId: 'admin-user' };

const questionRow = {
  id: 'q-1',
  category: 'Geography',
  difficulty: 'Easy',
  question: 'What is the capital of Canada?',
  answer: 'Ottawa',
  acceptableAnswers: ['Ottawa, Ontario'],
  explanation: 'Ottawa is the federal capital of Canada.',
  pillar: 'GlobalEh',
  tags: ['CA', 'GlobalEh', 'Geography'],
  sourceUrl: 'https://en.wikipedia.org/wiki/Ottawa',
  sourceName: 'Wikipedia',
  status: 'approved',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  aiAnalysis: null,
};

const emptyAuditReport = {
  generatedAt: new Date().toISOString(),
  totalQuestions: 1,
  totalFindings: 0,
  flaggedQuestionCount: 0,
  findingsBySeverity: { high: 0, medium: 0, low: 0 },
  findingsByRule: {},
  findings: [],
};

describe('semantic detection route integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Keep auth middleware implementations across cases.
    authMocks.isAuthenticated.mockImplementation((_req, _res, next) => next());
    authMocks.setupAuth.mockImplementation(async (app) => {
      app.use((req, _res, next) => {
        (req as Request & { user: TestUser }).user = {
          claims: { sub: 'admin-user' },
          expires_at: Date.now(),
        };
        next();
      });
    });
    dbMocks.select.mockReturnValue(createQueryMock([]));
    auditMock.mockReturnValue(emptyAuditReport as ReturnType<typeof auditQuestionQuality>);
    factCheckMock.mockResolvedValue({ totalChecked: 0, results: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns incomplete status without a clean-library recommendation', async () => {
    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce(createQueryMock([questionRow]));
    vi.mocked(detectDuplicates).mockResolvedValue({
      totalPairsChecked: 1,
      duplicatesFound: [],
      duplicatesByType: emptyDuplicateCounts(),
      status: 'incomplete',
      failedPairs: 1,
    });
    const response = await request(await buildTestApp())
      .post('/api/admin/quality-sweep')
      .send({ skipFactCheck: true })
      .expect(200);
    expect(response.body.duplicates.status).toBe('incomplete');
    expect(response.body.recommendations.join(' ')).toContain('incomplete');
    expect(response.body.recommendations.join(' ')).not.toContain('All approved questions passed');
  });
  it('keeps a new conflict visible despite an old pair dismissal and counts it', async () => {
    const match = {
      questionIdA: 'q-1',
      questionIdB: 'q-2',
      matchType: 'answer_conflict' as const,
      similarityScore: 1,
      questionTextA: 'Q',
      questionTextB: 'Q',
      answerA: 'A',
      answerB: 'B',
      findingKey: 'q-1::q-2::answer_conflict::new-hash',
    };
    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce(createQueryMock([questionRow]))
      .mockReturnValueOnce(createQueryMock([{ findingType: 'duplicate', findingKey: 'q-1::q-2' }]));
    vi.mocked(detectDuplicates).mockResolvedValue({
      totalPairsChecked: 1,
      duplicatesFound: [match],
      duplicatesByType: { ...emptyDuplicateCounts(), answer_conflict: 1 },
      status: 'complete',
    });
    const response = await request(await buildTestApp())
      .post('/api/admin/quality-sweep')
      .send({ skipFactCheck: true })
      .expect(200);
    expect(response.body.duplicates.duplicatesByType.answer_conflict).toBe(1);
    expect(response.body.duplicates.duplicatesFound).toHaveLength(1);
  });
  it('does not stage any question after an incomplete semantic gate', async () => {
    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce(createQueryMock([questionRow]));
    vi.mocked(generateQuestions).mockResolvedValue([]);
    const error = new Error(
      'Semantic checking could not finish. No questions were staged. Please retry.'
    );
    error.name = 'SemanticCheckIncompleteError';
    vi.mocked(filterNovelQuestions).mockRejectedValue(error);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await request(await buildTestApp())
      .post('/api/staging/generate')
      .send({ topic: 'Geography', count: 2, pillar: 'GlobalEh' })
      .expect(500);
    expect(response.body.message).toContain('No questions were staged');
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });
  it('reports conflicts separately from ordinary duplicate drops', async () => {
    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce(createQueryMock([questionRow]));
    vi.mocked(generateQuestions).mockResolvedValue([]);
    vi.mocked(filterNovelQuestions).mockResolvedValue({
      kept: [],
      dropped: [
        {
          question: questionRow,
          reason: 'answer_conflict',
          matchType: 'answer_conflict',
          similarityScore: 1,
        },
      ],
    });
    const response = await request(await buildTestApp())
      .post('/api/staging/generate')
      .send({ topic: 'Geography', count: 2, pillar: 'GlobalEh' })
      .expect(201);
    expect(response.body).toMatchObject({ count: 0, droppedAsConflict: 1, droppedAsDuplicate: 0 });
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });
});
