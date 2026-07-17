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
const questionPayload = {
  id: 'q-1',
  category: 'History & Geography',
  difficulty: 'Easy',
  question: 'What is the capital of Canada?',
  answer: 'Ottawa',
  acceptableAnswers: ['Ottawa, Ontario'],
  explanation: 'Ottawa is the federal capital of Canada.',
  pillar: 'GlobalEh',
  tags: ['CA', 'GlobalEh', 'History & Geography'],
  sourceUrl: 'https://www.canada.ca/en/canadian-heritage/services/crown-canada/about.html',
  sourceName: 'Government of Canada',
  status: 'approved',
};
const questionRow = {
  ...questionPayload,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  aiAnalysis: null,
};

function mockQuestionMetadata() {
  dbMocks.selectDistinct
    .mockReturnValueOnce(createQueryMock([{ category: questionPayload.category }]))
    .mockReturnValueOnce(createQueryMock([{ pillar: questionPayload.pillar }]));
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

describe('question routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns approved questions with filters, shuffle, and limit metadata', async () => {
    const questionQuery = createQueryMock([questionRow]);
    dbMocks.select.mockReturnValueOnce(questionQuery);
    mockQuestionMetadata();
    const app = await buildTestApp();

    const response = await request(app)
      .get('/api/questions?category=Geography&difficulty=Easy&pillar=GlobalEh&shuffle=true&limit=1')
      .expect(200);

    expect(questionQuery.where).toHaveBeenCalledOnce();
    expect(questionQuery.orderBy).toHaveBeenCalledOnce();
    expect(questionQuery.limit).toHaveBeenCalledWith(1);
    expect(response.body).toMatchObject({
      total: 1,
      categories: ['History & Geography'],
      pillars: ['GlobalEh'],
      questions: [{ id: 'q-1', question: questionPayload.question }],
    });
  });

  it('can exclude recently seen questions for authenticated users', async () => {
    const questionQuery = createQueryMock([questionRow]);
    dbMocks.select.mockReturnValueOnce(questionQuery);
    mockQuestionMetadata();
    const app = await buildTestApp();

    const response = await request(app)
      .get('/api/questions?excludeSeen=true&shuffle=true&limit=2')
      .set('x-test-user-id', 'player-1')
      .expect(200);

    expect(questionQuery.leftJoin).toHaveBeenCalledOnce();
    expect(questionQuery.where).toHaveBeenCalledOnce();
    expect(questionQuery.orderBy).toHaveBeenCalledTimes(1);
    expect(questionQuery.limit).toHaveBeenCalledWith(2);
    expect(response.body.questions).toHaveLength(1);
  });

  it('requires authentication to create questions', async () => {
    const app = await buildTestApp();

    const response = await request(app).post('/api/questions').send(questionPayload).expect(401);

    expect(response.body).toEqual({ message: 'Unauthorized' });
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });

  it('requires admin access to create questions', async () => {
    dbMocks.select.mockReturnValueOnce(createQueryMock([]));
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/questions')
      .set('x-test-user-id', 'regular-user')
      .send(questionPayload)
      .expect(403);

    expect(response.body).toEqual({ message: 'Forbidden: Admin access required' });
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });

  it('creates questions for admins', async () => {
    dbMocks.select.mockReturnValueOnce(createQueryMock([adminRole]));
    const insertQuery = createQueryMock([questionRow]);
    dbMocks.insert.mockReturnValue(insertQuery);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/questions')
      .set('x-test-user-id', 'admin-user')
      .send(questionPayload)
      .expect(201);

    expect(insertQuery.values).toHaveBeenCalledWith(questionPayload);
    expect(response.body).toMatchObject({ id: 'q-1', question: questionPayload.question });
  });

  it('updates questions for admins', async () => {
    dbMocks.select.mockReturnValueOnce(createQueryMock([adminRole]));
    const updateQuery = createQueryMock([{ ...questionRow, answer: 'Ottawa' }]);
    dbMocks.update.mockReturnValue(updateQuery);
    const app = await buildTestApp();

    const response = await request(app)
      .patch('/api/questions/q-1')
      .set('x-test-user-id', 'admin-user')
      .send({ answer: 'Ottawa' })
      .expect(200);

    expect(updateQuery.set).toHaveBeenCalledWith(
      expect.objectContaining({ answer: 'Ottawa', updatedAt: expect.any(Date) })
    );
    expect(response.body).toMatchObject({ id: 'q-1', answer: 'Ottawa' });
  });

  it('updates question status for admins when status is valid', async () => {
    dbMocks.select.mockReturnValueOnce(createQueryMock([adminRole]));
    const updateQuery = createQueryMock([{ ...questionRow, status: 'rejected' }]);
    dbMocks.update.mockReturnValue(updateQuery);
    const app = await buildTestApp();

    const response = await request(app)
      .patch('/api/questions/q-1')
      .set('x-test-user-id', 'admin-user')
      .send({ status: 'rejected' })
      .expect(200);

    expect(updateQuery.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected', updatedAt: expect.any(Date) })
    );
    expect(response.body).toMatchObject({ id: 'q-1', status: 'rejected' });
  });

  it('returns 404 when admins update a missing question', async () => {
    dbMocks.select.mockReturnValueOnce(createQueryMock([adminRole]));
    dbMocks.update.mockReturnValue(createQueryMock([]));
    const app = await buildTestApp();

    const response = await request(app)
      .patch('/api/questions/missing')
      .set('x-test-user-id', 'admin-user')
      .send({ answer: 'Ottawa' })
      .expect(404);

    expect(response.body).toEqual({ message: 'Question not found' });
  });

  it.each([
    ['id', 'different-id'],
    ['createdAt', '2026-01-01T00:00:00.000Z'],
    ['updatedAt', '2026-01-02T00:00:00.000Z'],
    ['aiAnalysis', { verdict: 'pass' }],
    ['unknownField', 'must not be accepted'],
  ])(
    'rejects server-owned or unknown question update field %s before writing',
    async (field, value) => {
      dbMocks.select.mockReturnValueOnce(createQueryMock([adminRole]));
      const app = await buildTestApp();

      const response = await request(app)
        .patch('/api/questions/q-1')
        .set('x-test-user-id', 'admin-user')
        .send({ [field]: value, answer: 'Ottawa' })
        .expect(422);

      expect(response.body).toMatchObject({ message: 'Invalid question update' });
      expect(dbMocks.update).not.toHaveBeenCalled();
    }
  );

  it('rejects invalid question status values before writing', async () => {
    dbMocks.select.mockReturnValueOnce(createQueryMock([adminRole]));
    const app = await buildTestApp();

    const response = await request(app)
      .patch('/api/questions/q-1')
      .set('x-test-user-id', 'admin-user')
      .send({ status: 'whatever' })
      .expect(422);

    expect(response.body).toMatchObject({ message: 'Invalid question update' });
    expect(dbMocks.update).not.toHaveBeenCalled();
  });

  it('requires authentication to mark questions as seen', async () => {
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/questions/seen')
      .send({ questionIds: ['q-1'] })
      .expect(401);

    expect(response.body).toEqual({ message: 'Unauthorized' });
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });

  it('validates seen-question payloads', async () => {
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/questions/seen')
      .set('x-test-user-id', 'player-1')
      .send({ questionIds: [] })
      .expect(422);

    expect(response.body).toMatchObject({ message: 'Invalid seen-question request' });
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });

  it('accepts the largest normal game seen-question payload', async () => {
    const insertQuery = createQueryMock(undefined);
    dbMocks.insert.mockReturnValue(insertQuery);
    const app = await buildTestApp();
    const questionIds = Array.from({ length: 480 }, (_, index) => `q-${index + 1}`);

    const response = await request(app)
      .post('/api/questions/seen')
      .set('x-test-user-id', 'player-1')
      .send({ questionIds })
      .expect(200);

    expect(insertQuery.values).toHaveBeenCalledWith(
      questionIds.map((questionId) => ({ userId: 'player-1', questionId }))
    );
    expect(response.body).toEqual({ message: 'Questions marked as seen', count: 480 });
  });

  it('rejects excessive seen-question payloads', async () => {
    const app = await buildTestApp();
    const questionIds = Array.from({ length: 501 }, (_, index) => `q-${index + 1}`);

    const response = await request(app)
      .post('/api/questions/seen')
      .set('x-test-user-id', 'player-1')
      .send({ questionIds })
      .expect(422);

    expect(response.body).toMatchObject({ message: 'Invalid seen-question request' });
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });

  it('upserts seen-question rows for authenticated users', async () => {
    const insertQuery = createQueryMock(undefined);
    dbMocks.insert.mockReturnValue(insertQuery);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/questions/seen')
      .set('x-test-user-id', 'player-1')
      .send({ questionIds: ['q-1', 'q-2'] })
      .expect(200);

    expect(insertQuery.values).toHaveBeenCalledWith([
      { userId: 'player-1', questionId: 'q-1' },
      { userId: 'player-1', questionId: 'q-2' },
    ]);
    expect(insertQuery.onConflictDoUpdate).toHaveBeenCalledOnce();
    expect(response.body).toEqual({ message: 'Questions marked as seen', count: 2 });
  });
});
