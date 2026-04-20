import type { Express, NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { analyzeDispute } from './lib/ai';
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

    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

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

const adminRole = { userId: 'admin-user' };
const disputeRow = {
  id: 'dispute-1',
  questionId: 'q-1',
  questionText: 'What is the capital of Canada?',
  correctAnswer: 'Ottawa',
  teamName: 'Alpha',
  submittedAnswer: 'Toronto',
  teamExplanation: 'The clue seemed to ask for the biggest city.',
  timestamp: new Date('2026-01-01T00:00:00Z'),
  status: 'pending',
  resolutionNote: null,
  aiAnalysis: null,
};
const analysis = {
  verdict: 'INCORRECT' as const,
  confidence: 92,
  reasoning: 'Ottawa is the capital of Canada.',
  sources: ['canada.ca'],
};

describe('AI dispute analysis route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(analyzeDispute).mockResolvedValue(analysis);
    dbMocks.update.mockReturnValue(createQueryMock(undefined));
  });

  it('requires authentication', async () => {
    const app = await buildTestApp();

    const response = await request(app).post('/api/disputes/dispute-1/analyze').expect(401);

    expect(response.body).toEqual({ message: 'Unauthorized' });
    expect(dbMocks.select).not.toHaveBeenCalled();
    expect(analyzeDispute).not.toHaveBeenCalled();
  });

  it('requires admin access', async () => {
    dbMocks.select.mockReturnValue(createQueryMock([]));
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/disputes/dispute-1/analyze')
      .set('x-test-user-id', 'regular-user')
      .expect(403);

    expect(response.body).toEqual({ message: 'Forbidden: Admin access required' });
    expect(analyzeDispute).not.toHaveBeenCalled();
  });

  it('returns 404 when the dispute does not exist', async () => {
    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce(createQueryMock([]));
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/disputes/missing/analyze')
      .set('x-test-user-id', 'admin-user')
      .expect(404);

    expect(response.body).toEqual({ message: 'Dispute not found' });
    expect(analyzeDispute).not.toHaveBeenCalled();
  });

  it('runs analysis and stores the result for admins', async () => {
    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce(createQueryMock([disputeRow]));
    const updateQuery = createQueryMock(undefined);
    dbMocks.update.mockReturnValue(updateQuery);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/disputes/dispute-1/analyze')
      .set('x-test-user-id', 'admin-user')
      .expect(200);

    expect(analyzeDispute).toHaveBeenCalledWith(
      disputeRow.questionText,
      disputeRow.correctAnswer,
      disputeRow.submittedAnswer,
      disputeRow.teamExplanation
    );
    expect(updateQuery.set).toHaveBeenCalledWith({ aiAnalysis: analysis });
    expect(response.body).toEqual(analysis);
  });

  it('passes through the AI rate limiter', async () => {
    let selectCount = 0;
    dbMocks.select.mockImplementation(() => {
      selectCount += 1;
      return createQueryMock(selectCount % 2 === 1 ? [adminRole] : [disputeRow]);
    });
    const app = await buildTestApp();
    const headers = { 'x-test-user-id': 'rate-limit-admin-ste-152' };

    for (let i = 0; i < 20; i++) {
      await request(app).post('/api/disputes/dispute-1/analyze').set(headers).expect(200);
    }

    const response = await request(app)
      .post('/api/disputes/dispute-1/analyze')
      .set(headers)
      .expect(429);

    expect(response.body).toEqual({
      message: 'AI analysis rate limit exceeded. Please wait before trying again.',
    });
    expect(analyzeDispute).toHaveBeenCalledTimes(20);
  });
});
