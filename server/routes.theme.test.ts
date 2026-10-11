import type { NextFunction, Express, Request, Response } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTestApp } from './test/testApp';

// Chainable db mock (mirrors routes.rooms.test.ts): each select()/insert()/etc.
// consumes the next queued result and supports the full builder chain used by
// the room + theme routes.
const dbMocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];

  function query(getResult: () => unknown[]) {
    const chain: Record<string, unknown> = {};
    const pass = () => chain;
    for (const m of ['for', 'from', 'groupBy', 'leftJoin', 'limit', 'orderBy']) {
      chain[m] = vi.fn(pass);
    }
    chain.returning = vi.fn(() => Promise.resolve(getResult()));
    chain.set = vi.fn(pass);
    chain.values = vi.fn(pass);
    chain.where = vi.fn(pass);
    const promise = Promise.resolve().then(() => getResult());
    chain.then = promise.then.bind(promise);
    return chain;
  }

  const methods = {
    delete: vi.fn(() => query(() => [])),
    insert: vi.fn(() => query(() => [])),
    select: vi.fn(() => query(() => selectResults.shift() ?? [])),
    selectDistinct: vi.fn(() => query(() => [])),
    update: vi.fn(() => query(() => [])),
  };
  const transaction = vi.fn(async (cb: (tx: typeof methods) => Promise<unknown>) => cb(methods));

  return { ...methods, transaction, selectResults };
});

const authMocks = vi.hoisted(() => ({
  isAuthenticated: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  registerAuthRoutes: vi.fn(),
  setupAuth: vi.fn(async (app: Express) => {
    app.use((req, _res, next) => {
      Object.defineProperty(req, 'isAuthenticated', {
        value: () => Boolean(req.get('X-Test-Session')),
      });
      if (req.get('X-Test-Session')) req.user = { claims: { sub: req.get('X-Test-Session') } };
      next();
    });
  }),
}));

vi.mock('./db', () => ({
  pool: {},
  db: {
    delete: dbMocks.delete,
    insert: dbMocks.insert,
    select: dbMocks.select,
    selectDistinct: dbMocks.selectDistinct,
    transaction: dbMocks.transaction,
    update: dbMocks.update,
  },
}));

vi.mock('./auth', () => authMocks);
const admissionMock = vi.hoisted(() => ({ start: vi.fn(), progress: vi.fn(), cancel: vi.fn() }));
vi.mock('./lib/theme-admission', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/theme-admission')>()),
  createThemeAdmission: () => admissionMock,
  cancelThemeAdmission: admissionMock.cancel,
}));

vi.mock('./lib/subjectivity-enricher', () => ({ enrichSubjectiveFindings: vi.fn() }));
vi.mock('./lib/ai', () => ({ analyzeDispute: vi.fn() }));
vi.mock('./lib/guardian', () => ({
  generateQuestions: vi.fn(),
  computeStrategyQuotas: vi.fn(),
}));
vi.mock('./lib/field-fix', () => ({ getAiFieldFix: vi.fn() }));
vi.mock('./lib/question-quality-audit', () => ({ auditQuestionQuality: vi.fn() }));
vi.mock('./lib/duplicate-detector', () => ({ detectDuplicates: vi.fn() }));
vi.mock('./lib/verifier', () => ({ batchFactCheck: vi.fn() }));
vi.mock('./lib/novelty-filter', () => ({ filterNovelQuestions: vi.fn() }));
vi.mock('./lib/topic-context', () => ({ selectTopicContext: vi.fn(() => []) }));

// Keep the real theme-game flag + progress store + seen-inputs logic; only stub
// the network-calling suggestion and the background orchestrator.
vi.mock('./lib/theme-game', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/theme-game')>();
  return {
    ...actual,
    suggestThemeCategories: vi.fn(),
    runThemedGamePreparation: vi.fn(async () => {}),
  };
});

import {
  suggestThemeCategories,
  runThemedGamePreparation,
  clearThemeProgress,
} from './lib/theme-game';

const roomId = '11111111-1111-4111-8111-111111111111';
const hostId = '22222222-2222-4222-8222-222222222222';
const guestId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-07-03T15:00:00.000Z');

function room(overrides: Record<string, unknown> = {}) {
  return {
    id: roomId,
    code: 'ABCD2',
    status: 'lobby',
    phase: 'LOBBY',
    version: 1,
    hostPlayerId: hostId,
    category: 'Sports',
    theme: 'Baseball',
    numRounds: 5,
    questionIds: [],
    currentQuestionIndex: 0,
    activePlayerId: null,
    currentAttempt: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date('2099-07-03T17:00:00.000Z'),
    ...overrides,
  };
}

function player(overrides: Record<string, unknown> = {}) {
  return {
    id: hostId,
    roomId,
    nickname: 'Host',
    token: 'host-secret',
    joinOrder: 0,
    score: 0,
    questionCount: 0,
    lastRoundDelta: 0,
    isHost: true,
    userId: null,
    guestSeenIds: null,
    lastSeenAt: now,
    leftAt: null,
    ...overrides,
  };
}

const ORIGINAL_FLAG = process.env.VITE_THEME_ROUNDS;

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.selectResults.length = 0;
  process.env.VITE_THEME_ROUNDS = 'true';
  clearThemeProgress('ABCD2');
});

afterEach(() => {
  clearThemeProgress('ABCD2');
});

afterAll(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.VITE_THEME_ROUNDS;
  else process.env.VITE_THEME_ROUNDS = ORIGINAL_FLAG;
});

function job(shortfall = false) {
  return {
    gameId: '11111111-1111-4111-8111-111111111111',
    jobId: '44444444-4444-4444-8444-444444444444',
    progress: {
      status: shortfall ? 'shortfall' : 'waiting',
      readyCount: 0,
      requiredCount: 40,
      canStart: false,
      failure: shortfall
        ? { code: 'related_inventory_shortfall', message: 'Not enough verified related questions.' }
        : null,
    },
  };
}

describe('signed-in themed setup', () => {
  it('requires a real sign-in session for suggestions and makes no model call', async () => {
    const app = await buildTestApp();
    await request(app).post('/api/theme/suggest').send({ theme: 'baseball' }).expect(401);
    const res = await request(app)
      .post('/api/theme/suggest')
      .set('X-Test-Session', 'host-account')
      .send({ theme: 'baseball' })
      .expect(200);
    expect(res.body).toEqual({ theme: 'baseball', categories: ['Sports'] });
    expect(suggestThemeCategories).not.toHaveBeenCalled();
  });
  it('rejects malformed themes after sign-in', async () => {
    await request(await buildTestApp())
      .post('/api/theme/suggest')
      .set('X-Test-Session', 'host-account')
      .send({ theme: 'a' })
      .expect(422);
  });
  it('rejects guest themed creation before writing a room', async () => {
    await request(await buildTestApp())
      .post('/api/rooms')
      .send({ nickname: 'Guest', categories: ['Sports'], numRounds: 5, theme: 'Baseball' })
      .expect(401);
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });
  it('enforces five rounds for signed-in themed creation', async () => {
    await request(await buildTestApp())
      .post('/api/rooms')
      .set('X-Test-Session', 'host-account')
      .send({ nickname: 'Host', categories: ['Sports'], numRounds: 10, theme: 'Baseball' })
      .expect(422);
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });
});

describe('durable theme-start route', () => {
  it('requires sign-in even with a valid host token', async () => {
    await request(await buildTestApp())
      .post('/api/rooms/ABCD2/theme-start')
      .set('X-Player-Token', 'host-secret')
      .send({})
      .expect(401);
    expect(admissionMock.start).not.toHaveBeenCalled();
  });
  it('requires the room token as well as the account session', async () => {
    await request(await buildTestApp())
      .post('/api/rooms/ABCD2/theme-start')
      .set('X-Test-Session', 'host-account')
      .send({})
      .expect(401);
    expect(admissionMock.start).not.toHaveBeenCalled();
  });
  it('returns durable paused progress and never dispatches the legacy generator', async () => {
    admissionMock.start.mockResolvedValueOnce(job());
    const res = await request(await buildTestApp())
      .post('/api/rooms/ABCD2/theme-start')
      .set('X-Test-Session', 'host-account')
      .set('X-Player-Token', 'host-secret')
      .send({ excludeQuestionIds: ['untrusted-client-id'] })
      .expect(202);
    expect(res.body).toMatchObject({
      status: 'preparing',
      total: 40,
      ready: 0,
      job: { progress: { canStart: false } },
    });
    expect(admissionMock.start).toHaveBeenCalledWith({
      code: 'ABCD2',
      playerToken: 'host-secret',
      userId: 'host-account',
    });
    expect(runThemedGamePreparation).not.toHaveBeenCalled();
  });
  it('reports an explicit inventory shortfall', async () => {
    admissionMock.start.mockResolvedValueOnce(job(true));
    const res = await request(await buildTestApp())
      .post('/api/rooms/ABCD2/theme-start')
      .set('X-Test-Session', 'host-account')
      .set('X-Player-Token', 'host-secret')
      .send({})
      .expect(409);
    expect(res.body.job.progress.failure.code).toBe('related_inventory_shortfall');
    expect(runThemedGamePreparation).not.toHaveBeenCalled();
  });
  it('is absent when the feature flag is off', async () => {
    process.env.VITE_THEME_ROUNDS = 'false';
    await request(await buildTestApp())
      .post('/api/rooms/ABCD2/theme-start')
      .send({})
      .expect(404);
    expect(admissionMock.start).not.toHaveBeenCalled();
  });
});

describe('authenticated durable progress', () => {
  it('requires a participant token', async () => {
    await request(await buildTestApp())
      .get('/api/rooms/ABCD2/theme-progress')
      .expect(401);
    expect(admissionMock.progress).not.toHaveBeenCalled();
  });
  it('lets guest participants read using their locked token', async () => {
    admissionMock.progress.mockResolvedValueOnce(job());
    const res = await request(await buildTestApp())
      .get('/api/rooms/ABCD2/theme-progress')
      .set('X-Player-Token', 'guest-secret')
      .expect(200);
    expect(res.body.job.gameId).toBe(job().gameId);
    expect(admissionMock.progress).toHaveBeenCalledWith({
      code: 'ABCD2',
      playerToken: 'guest-secret',
    });
  });
  it('blocks joins and departures once preparation locks the roster', async () => {
    const app = await buildTestApp();
    dbMocks.selectResults.push([room({ themePreparationGameId: job().gameId })]);
    await request(app).post('/api/rooms/ABCD2/join').send({ nickname: 'Late' }).expect(409);
    dbMocks.selectResults.push(
      [room({ themePreparationGameId: job().gameId })],
      [player({ id: guestId, isHost: false })]
    );
    await request(app)
      .post('/api/rooms/ABCD2/leave')
      .set('X-Player-Token', 'guest-secret')
      .send({})
      .expect(409);
  });
});
