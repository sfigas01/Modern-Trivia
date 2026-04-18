import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { createServer } from 'http';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  delete: vi.fn(),
  insert: vi.fn(),
  returning: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  values: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  isAuthenticated: vi.fn((req: Request, res: Response, next: NextFunction) => {
    const userId = req.header('x-test-user-id');

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    (req as Request & { user?: { claims: { sub: string }; expires_at: number } }).user = {
      claims: { sub: userId },
      expires_at: Math.floor(Date.now() / 1000) + 60,
    };
    next();
  }),
  registerAuthRoutes: vi.fn(),
  setupAuth: vi.fn(async (_app: Express) => undefined),
}));

vi.mock('./db', () => ({
  db: {
    delete: dbMocks.delete,
    insert: dbMocks.insert,
    select: dbMocks.select,
    update: dbMocks.update,
  },
}));

vi.mock('@shared/schema', () => ({
  adminRoles: {},
  appConfig: {},
  disputes: {},
  duplicatePairKey: vi.fn(),
  insertDisputeSchema: {
    parse: vi.fn((body) => body),
  },
  insertQuestionSchema: {
    parse: vi.fn((body) => body),
  },
  questionEdits: {},
  questionQualitySweepDismissals: {},
  questions: {},
  seenQuestions: {},
}));

vi.mock('./replit_integrations/auth', () => authMocks);
vi.mock('./lib/subjectivity-enricher', () => ({ enrichSubjectiveFindings: vi.fn() }));
vi.mock('./lib/ai', () => ({ analyzeDispute: vi.fn() }));
vi.mock('./lib/guardian', () => ({ generateQuestions: vi.fn() }));
vi.mock('./lib/field-fix', () => ({ getAiFieldFix: vi.fn() }));
vi.mock('./lib/question-quality-audit', () => ({ auditQuestionQuality: vi.fn() }));
vi.mock('./lib/duplicate-detector', () => ({ detectDuplicates: vi.fn() }));
vi.mock('./lib/verifier', () => ({ batchFactCheck: vi.fn() }));
vi.mock('./middleware/rateLimiter', () => ({
  aiLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const disputePayload = {
  questionId: 'q-1',
  questionText: 'What is the capital of Canada?',
  correctAnswer: 'Ottawa',
  teamName: 'Alpha',
  submittedAnswer: 'Toronto',
  teamExplanation: 'We think Toronto should count because of the clue wording.',
};

async function buildApp() {
  const app = express();
  app.use(express.json());

  const { registerRoutes } = await import('./routes');
  await registerRoutes(createServer(app), app);

  return app;
}

describe('dispute routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.returning.mockResolvedValue([
      {
        ...disputePayload,
        id: 'dispute-1',
        status: 'pending',
        timestamp: new Date('2026-01-01T00:00:00Z'),
        resolutionNote: null,
        aiAnalysis: null,
      },
    ]);
    dbMocks.values.mockReturnValue({ returning: dbMocks.returning });
    dbMocks.insert.mockReturnValue({ values: dbMocks.values });
  });

  it('allows unauthenticated players to submit disputes', async () => {
    const app = await buildApp();

    const response = await request(app).post('/api/disputes').send(disputePayload).expect(201);

    expect(authMocks.isAuthenticated).not.toHaveBeenCalled();
    expect(dbMocks.insert).toHaveBeenCalledOnce();
    expect(dbMocks.values).toHaveBeenCalledWith(disputePayload);
    expect(response.body).toMatchObject({
      id: 'dispute-1',
      status: 'pending',
      teamName: 'Alpha',
      teamExplanation: disputePayload.teamExplanation,
    });
  });

  it.each([
    ['GET', '/api/disputes'],
    ['PATCH', '/api/disputes/dispute-1'],
    ['DELETE', '/api/disputes'],
    ['POST', '/api/disputes/dispute-1/analyze'],
  ])('keeps %s %s protected without a session', async (method, path) => {
    const app = await buildApp();
    let response: request.Response;

    switch (method) {
      case 'GET':
        response = await request(app).get(path);
        break;
      case 'PATCH':
        response = await request(app).patch(path).send({ status: 'resolved' });
        break;
      case 'DELETE':
        response = await request(app).delete(path);
        break;
      default:
        response = await request(app).post(path);
        break;
    }

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Unauthorized' });
  });
});
