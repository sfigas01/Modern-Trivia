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
const disputePayload = {
  questionId: 'q-1',
  questionText: 'What is the capital of Canada?',
  correctAnswer: 'Ottawa',
  teamName: 'Alpha',
  submittedAnswer: 'Toronto',
  teamExplanation: 'We think Toronto should count because of the clue wording.',
};
const disputeRow = {
  ...disputePayload,
  id: 'dispute-1',
  status: 'pending',
  timestamp: new Date('2026-01-01T00:00:00Z'),
  resolutionNote: null,
  aiAnalysis: null,
  roomId: null,
  roomCode: null,
  attemptKey: null,
  disputingPlayerId: null,
  disputingPlayerName: null,
  votingEnabled: false,
  eligibleVoterSnapshot: null,
  threshold: null,
  outcome: null,
  originalPointsDelta: null,
  finalPointsDelta: null,
  decidedAt: null,
};

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

describe('dispute routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('allows unauthenticated players to submit disputes', async () => {
    const insertQuery = createQueryMock([disputeRow]);
    dbMocks.insert.mockReturnValue(insertQuery);
    const app = await buildTestApp();

    const response = await request(app).post('/api/disputes').send(disputePayload).expect(201);

    expect(authMocks.isAuthenticated).not.toHaveBeenCalled();
    expect(dbMocks.insert).toHaveBeenCalledOnce();
    expect(insertQuery.values).toHaveBeenCalledWith(disputePayload);
    expect(response.body).toMatchObject({
      id: 'dispute-1',
      status: 'pending',
      teamName: 'Alpha',
      teamExplanation: disputePayload.teamExplanation,
    });
  });

  it('returns 422 without writing when dispute validation fails', async () => {
    const app = await buildTestApp();
    const { teamExplanation: _teamExplanation, ...invalidPayload } = disputePayload;

    const response = await request(app).post('/api/disputes').send(invalidPayload).expect(422);

    expect(response.body).toEqual({ message: 'Invalid dispute data' });
    expect(dbMocks.insert).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error creating dispute:', expect.any(Error));
  });

  it('accepts long dispute explanations that stay within the JSON body limit', async () => {
    const longPayload = {
      ...disputePayload,
      teamExplanation: 'This should count. '.repeat(3_000),
    };
    const insertQuery = createQueryMock([{ ...disputeRow, ...longPayload }]);
    dbMocks.insert.mockReturnValue(insertQuery);
    const app = await buildTestApp();

    const response = await request(app).post('/api/disputes').send(longPayload).expect(201);

    expect(insertQuery.values).toHaveBeenCalledWith(longPayload);
    expect(response.body.teamExplanation).toBe(longPayload.teamExplanation);
  });

  it.each([
    ['GET', '/api/disputes'],
    ['PATCH', '/api/disputes/dispute-1'],
    ['DELETE', '/api/disputes'],
    ['POST', '/api/disputes/dispute-1/analyze'],
  ])('keeps %s %s protected without a session', async (method, path) => {
    const app = await buildTestApp();
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

  it.each([
    ['GET', '/api/disputes'],
    ['PATCH', '/api/disputes/dispute-1'],
    ['DELETE', '/api/disputes'],
    ['POST', '/api/disputes/dispute-1/analyze'],
  ])('rejects non-admin sessions for %s %s', async (method, path) => {
    dbMocks.select.mockReturnValue(createQueryMock([]));
    const app = await buildTestApp();
    let response: request.Response;

    switch (method) {
      case 'GET':
        response = await request(app).get(path).set('x-test-user-id', 'regular-user');
        break;
      case 'PATCH':
        response = await request(app)
          .patch(path)
          .set('x-test-user-id', 'regular-user')
          .send({ status: 'resolved' });
        break;
      case 'DELETE':
        response = await request(app).delete(path).set('x-test-user-id', 'regular-user');
        break;
      default:
        response = await request(app).post(path).set('x-test-user-id', 'regular-user');
        break;
    }

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Forbidden: Admin access required' });
  });

  it('lists disputes for admins', async () => {
    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce(createQueryMock([disputeRow]))
      .mockReturnValueOnce(createQueryMock([]));
    const app = await buildTestApp();

    const response = await request(app)
      .get('/api/disputes')
      .set('x-test-user-id', 'admin-user')
      .expect(200);

    expect(response.body).toMatchObject([{ id: 'dispute-1', teamName: 'Alpha', ballots: [] }]);
    expect(dbMocks.select).toHaveBeenCalledTimes(3);
  });

  it('loads all admin ballots in one query and groups them by dispute', async () => {
    const multiplayerDispute = {
      ...disputeRow,
      id: 'dispute-2',
      roomId: '11111111-1111-4111-8111-111111111111',
      roomCode: 'ABCD2',
      votingEnabled: true,
    };
    const ballot = {
      id: 'ballot-1',
      disputeId: multiplayerDispute.id,
      voterPlayerId: '22222222-2222-4222-8222-222222222222',
      voterPlayerName: 'Bravo',
      approve: true,
      castAt: new Date('2026-01-01T00:01:00Z'),
    };
    const disputesQuery = createQueryMock([disputeRow, multiplayerDispute]);
    const ballotsQuery = createQueryMock([ballot]);
    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce(disputesQuery)
      .mockReturnValueOnce(ballotsQuery);
    const app = await buildTestApp();

    const response = await request(app)
      .get('/api/disputes')
      .set('x-test-user-id', 'admin-user')
      .expect(200);

    expect(dbMocks.select).toHaveBeenCalledTimes(3);
    expect(ballotsQuery.where).toHaveBeenCalledOnce();
    expect(response.body).toMatchObject([
      { id: 'dispute-1', ballots: [] },
      { id: 'dispute-2', ballots: [{ id: 'ballot-1', approve: true }] },
    ]);
  });

  it('does not query ballots when there are no disputes', async () => {
    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce(createQueryMock([]));
    const app = await buildTestApp();

    const response = await request(app)
      .get('/api/disputes')
      .set('x-test-user-id', 'admin-user')
      .expect(200);

    expect(response.body).toEqual([]);
    expect(dbMocks.select).toHaveBeenCalledTimes(2);
  });

  it.each(['resolved', 'rejected'])('updates disputes to %s for admins', async (status) => {
    dbMocks.select.mockReturnValueOnce(createQueryMock([adminRole]));
    const updateQuery = createQueryMock([{ ...disputeRow, status, resolutionNote: 'Reviewed' }]);
    dbMocks.update.mockReturnValue(updateQuery);
    const app = await buildTestApp();

    const response = await request(app)
      .patch('/api/disputes/dispute-1')
      .set('x-test-user-id', 'admin-user')
      .send({ status, resolutionNote: 'Reviewed' })
      .expect(200);

    expect(updateQuery.set).toHaveBeenCalledWith(
      expect.objectContaining({ status, resolutionNote: 'Reviewed' })
    );
    expect(response.body).toMatchObject({ id: 'dispute-1', status, resolutionNote: 'Reviewed' });
  });

  it('rejects invalid dispute statuses before updating', async () => {
    dbMocks.select.mockReturnValueOnce(createQueryMock([adminRole]));
    const app = await buildTestApp();

    const response = await request(app)
      .patch('/api/disputes/dispute-1')
      .set('x-test-user-id', 'admin-user')
      .send({ status: 'closed' })
      .expect(422);

    expect(response.body).toMatchObject({ message: 'Invalid dispute update' });
    expect(dbMocks.update).not.toHaveBeenCalled();
  });

  it('clears disputes for admins', async () => {
    dbMocks.select.mockReturnValueOnce(createQueryMock([adminRole]));
    const deleteQuery = createQueryMock(undefined);
    dbMocks.delete.mockReturnValue(deleteQuery);
    const app = await buildTestApp();

    const response = await request(app)
      .delete('/api/disputes')
      .set('x-test-user-id', 'admin-user')
      .expect(200);

    expect(dbMocks.delete).toHaveBeenCalledOnce();
    expect(response.body).toEqual({ message: 'All disputes cleared' });
  });
});
