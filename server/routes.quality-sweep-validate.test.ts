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

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

describe('POST /api/admin/quality-sweep/validate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('rejects unauthenticated requests', async () => {
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/admin/quality-sweep/validate')
      .send({ questionIds: ['q-1'] })
      .expect(401);

    expect(response.body).toEqual({ message: 'Unauthorized' });
    expect(dbMocks.select).not.toHaveBeenCalled();
  });

  it('rejects non-admin users', async () => {
    dbMocks.select.mockReturnValueOnce(createQueryMock([]));
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/admin/quality-sweep/validate')
      .set('x-test-user-id', 'regular-user')
      .send({ questionIds: ['q-1'] })
      .expect(403);

    expect(response.body).toEqual({ message: 'Forbidden: Admin access required' });
  });

  it('rejects an empty questionIds array', async () => {
    dbMocks.select.mockReturnValueOnce(createQueryMock([adminRole]));
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/admin/quality-sweep/validate')
      .set('x-test-user-id', 'admin-user')
      .send({ questionIds: [] })
      .expect(422);

    expect(response.body).toMatchObject({ message: 'Invalid validate request' });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('rejects a request with more than 50 questionIds', async () => {
    dbMocks.select.mockReturnValueOnce(createQueryMock([adminRole]));
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/admin/quality-sweep/validate')
      .set('x-test-user-id', 'admin-user')
      .send({ questionIds: Array.from({ length: 51 }, (_, i) => `q-${i}`) })
      .expect(422);

    expect(response.body).toMatchObject({ message: 'Invalid validate request' });
  });

  it('rejects a missing questionIds field', async () => {
    dbMocks.select.mockReturnValueOnce(createQueryMock([adminRole]));
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/admin/quality-sweep/validate')
      .set('x-test-user-id', 'admin-user')
      .send({})
      .expect(422);

    expect(response.body).toMatchObject({ message: 'Invalid validate request' });
  });

  it('returns 404 when none of the requested IDs exist in the database', async () => {
    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole])) // admin check
      .mockReturnValueOnce(createQueryMock([])); // questions query — empty result
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/admin/quality-sweep/validate')
      .set('x-test-user-id', 'admin-user')
      .send({ questionIds: ['nonexistent-id'] })
      .expect(404);

    expect(response.body).toMatchObject({ message: 'No questions found for the provided IDs.' });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('validates a single question and returns audit results', async () => {
    const finding = {
      questionId: 'q-1',
      questionIndex: 0,
      severity: 'medium',
      rule: 'missing_source_metadata',
      message: 'Missing source metadata.',
    };
    const auditReport = {
      ...emptyAuditReport,
      totalFindings: 1,
      flaggedQuestionCount: 1,
      findingsBySeverity: { high: 0, medium: 1, low: 0 },
      findingsByRule: { missing_source_metadata: 1 },
      findings: [finding],
    };

    auditMock.mockReturnValueOnce(auditReport);
    factCheckMock.mockResolvedValueOnce({
      totalChecked: 1,
      results: [{ questionId: 'q-1', verdict: 'pass', confidence: 0.95, reason: 'Correct.' }],
    });

    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole])) // admin check
      .mockReturnValueOnce(createQueryMock([questionRow])) // questions query
      .mockReturnValueOnce(createQueryMock([])); // dismissals query — none
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/admin/quality-sweep/validate')
      .set('x-test-user-id', 'admin-user')
      .send({ questionIds: ['q-1'] })
      .expect(200);

    expect(response.body).toMatchObject({
      totalRequested: 1,
      totalFound: 1,
      audit: {
        totalFindings: 1,
        findingsBySeverity: { high: 0, medium: 1, low: 0 },
        findings: [expect.objectContaining({ questionId: 'q-1', rule: 'missing_source_metadata' })],
      },
      factCheck: {
        totalChecked: 1,
        results: [expect.objectContaining({ questionId: 'q-1', verdict: 'pass' })],
      },
      questionsById: {
        'q-1': expect.objectContaining({
          question: questionRow.question,
          answer: questionRow.answer,
          sourceDomain: 'Wikipedia',
        }),
      },
    });
    expect(auditMock).toHaveBeenCalledWith([questionRow]);
    expect(factCheckMock).toHaveBeenCalledWith([questionRow]);
  });

  it('skips fact-check when skipFactCheck is true', async () => {
    auditMock.mockReturnValueOnce(emptyAuditReport);

    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce(createQueryMock([questionRow]))
      .mockReturnValueOnce(createQueryMock([]));
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/admin/quality-sweep/validate')
      .set('x-test-user-id', 'admin-user')
      .send({ questionIds: ['q-1'], skipFactCheck: true })
      .expect(200);

    expect(response.body.factCheck).toBeNull();
    expect(factCheckMock).not.toHaveBeenCalled();
  });

  it('validates multiple questions in a single call', async () => {
    const q2 = { ...questionRow, id: 'q-2', question: 'What is the capital of France?' };
    auditMock.mockReturnValueOnce({ ...emptyAuditReport, totalQuestions: 2 });
    factCheckMock.mockResolvedValueOnce({
      totalChecked: 2,
      results: [
        { questionId: 'q-1', verdict: 'pass', confidence: 0.9, reason: 'Correct.' },
        { questionId: 'q-2', verdict: 'pass', confidence: 0.9, reason: 'Correct.' },
      ],
    });

    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce(createQueryMock([questionRow, q2]))
      .mockReturnValueOnce(createQueryMock([]));
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/admin/quality-sweep/validate')
      .set('x-test-user-id', 'admin-user')
      .send({ questionIds: ['q-1', 'q-2'] })
      .expect(200);

    expect(response.body.totalRequested).toBe(2);
    expect(response.body.totalFound).toBe(2);
    expect(Object.keys(response.body.questionsById)).toHaveLength(2);
    expect(auditMock).toHaveBeenCalledWith([questionRow, q2]);
  });

  it('reports totalFound accurately when some requested IDs are not in the database', async () => {
    auditMock.mockReturnValueOnce(emptyAuditReport);
    factCheckMock.mockResolvedValueOnce({ totalChecked: 1, results: [] });

    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce(createQueryMock([questionRow])) // only q-1 found, q-ghost missing
      .mockReturnValueOnce(createQueryMock([]));
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/admin/quality-sweep/validate')
      .set('x-test-user-id', 'admin-user')
      .send({ questionIds: ['q-1', 'q-ghost'] })
      .expect(200);

    expect(response.body.totalRequested).toBe(2);
    expect(response.body.totalFound).toBe(1);
  });

  it('filters out dismissed static findings', async () => {
    const finding = {
      questionId: 'q-1',
      questionIndex: 0,
      severity: 'low',
      rule: 'missing_source_metadata',
      message: 'Missing source metadata.',
    };
    auditMock.mockReturnValueOnce({
      ...emptyAuditReport,
      totalFindings: 1,
      flaggedQuestionCount: 1,
      findingsBySeverity: { high: 0, medium: 0, low: 1 },
      findingsByRule: { missing_source_metadata: 1 },
      findings: [finding],
    });
    factCheckMock.mockResolvedValueOnce({ totalChecked: 1, results: [] });

    const dismissal = {
      id: 'dismiss-1',
      questionId: 'q-1',
      findingType: 'static',
      findingKey: `${finding.rule}::${finding.message}`,
      dismissedAt: new Date(),
      dismissedBy: 'admin-user',
      reason: 'false positive',
    };

    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce(createQueryMock([questionRow]))
      .mockReturnValueOnce(createQueryMock([dismissal]));
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/admin/quality-sweep/validate')
      .set('x-test-user-id', 'admin-user')
      .send({ questionIds: ['q-1'] })
      .expect(200);

    expect(response.body.audit.findings).toHaveLength(0);
    expect(response.body.audit.totalFindings).toBe(0);
    expect(response.body.audit.findingsBySeverity.low).toBe(0);
  });

  it('filters out dismissed fact-check findings', async () => {
    auditMock.mockReturnValueOnce(emptyAuditReport);
    factCheckMock.mockResolvedValueOnce({
      totalChecked: 1,
      results: [{ questionId: 'q-1', verdict: 'fail', confidence: 0.1, reason: 'Incorrect.' }],
    });

    const dismissal = {
      id: 'dismiss-fc-1',
      questionId: 'q-1',
      findingType: 'fact_check',
      findingKey: 'fact_check',
      dismissedAt: new Date(),
      dismissedBy: 'admin-user',
      reason: 'verified manually',
    };

    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce(createQueryMock([questionRow]))
      .mockReturnValueOnce(createQueryMock([dismissal]));
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/admin/quality-sweep/validate')
      .set('x-test-user-id', 'admin-user')
      .send({ questionIds: ['q-1'] })
      .expect(200);

    expect(response.body.factCheck.results).toHaveLength(0);
  });

  it('returns 500 when a database error occurs', async () => {
    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce({ where: vi.fn().mockRejectedValue(new Error('DB connection lost')) });
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/admin/quality-sweep/validate')
      .set('x-test-user-id', 'admin-user')
      .send({ questionIds: ['q-1'] })
      .expect(500);

    expect(response.body).toEqual({ message: 'Question validation failed' });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error validating selected questions:',
      expect.any(Error)
    );
  });
});
