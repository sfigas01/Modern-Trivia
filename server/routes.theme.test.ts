import type { NextFunction, Request, Response } from 'express';
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
  setupAuth: vi.fn(async () => {}),
}));

vi.mock('./db', () => ({
  db: {
    delete: dbMocks.delete,
    insert: dbMocks.insert,
    select: dbMocks.select,
    selectDistinct: dbMocks.selectDistinct,
    transaction: dbMocks.transaction,
    update: dbMocks.update,
  },
}));

vi.mock('./replit_integrations/auth', () => authMocks);
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
  initThemeProgress,
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

describe('POST /api/theme/suggest', () => {
  it('returns suggested categories for a theme', async () => {
    vi.mocked(suggestThemeCategories).mockResolvedValueOnce(['Sports']);
    const res = await request(await buildTestApp())
      .post('/api/theme/suggest')
      .send({ theme: 'baseball' })
      .expect(200);
    expect(res.body).toEqual({ theme: 'baseball', categories: ['Sports'] });
  });

  it('rejects a too-short theme with 422', async () => {
    await request(await buildTestApp())
      .post('/api/theme/suggest')
      .send({ theme: 'a' })
      .expect(422);
  });

  it('returns 404 when the feature flag is off', async () => {
    process.env.VITE_THEME_ROUNDS = 'false';
    await request(await buildTestApp())
      .post('/api/theme/suggest')
      .send({ theme: 'baseball' })
      .expect(404);
    expect(suggestThemeCategories).not.toHaveBeenCalled();
  });
});

describe('POST /api/rooms/:code/theme-start', () => {
  it('starts background preparation and returns initial progress (202)', async () => {
    dbMocks.selectResults.push([room()]); // room lookup (for update)
    dbMocks.selectResults.push([player()]); // authenticateRoomPlayer (host)
    dbMocks.selectResults.push([player(), player({ id: guestId, isHost: false, joinOrder: 1 })]); // roster

    const res = await request(await buildTestApp())
      .post('/api/rooms/ABCD2/theme-start')
      .set('X-Player-Token', 'host-secret')
      .send({})
      .expect(202);

    expect(res.body).toMatchObject({
      status: 'preparing',
      total: 40, // 5 rounds × 2 players × 4
      ready: 0,
    });
    expect(runThemedGamePreparation).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-themed room with 409', async () => {
    dbMocks.selectResults.push([room({ theme: null })]);
    dbMocks.selectResults.push([player()]);
    dbMocks.selectResults.push([player(), player({ id: guestId, isHost: false })]);

    await request(await buildTestApp())
      .post('/api/rooms/ABCD2/theme-start')
      .set('X-Player-Token', 'host-secret')
      .send({})
      .expect(409);
    expect(runThemedGamePreparation).not.toHaveBeenCalled();
  });

  it('requires at least two players', async () => {
    dbMocks.selectResults.push([room()]);
    dbMocks.selectResults.push([player()]);
    dbMocks.selectResults.push([player()]); // only the host

    await request(await buildTestApp())
      .post('/api/rooms/ABCD2/theme-start')
      .set('X-Player-Token', 'host-secret')
      .send({})
      .expect(409);
    expect(runThemedGamePreparation).not.toHaveBeenCalled();
  });

  it('returns 404 when the feature flag is off', async () => {
    process.env.VITE_THEME_ROUNDS = 'false';
    await request(await buildTestApp())
      .post('/api/rooms/ABCD2/theme-start')
      .set('X-Player-Token', 'host-secret')
      .send({})
      .expect(404);
  });
});

describe('GET /api/rooms/:code/theme-progress', () => {
  it('returns stored progress', async () => {
    initThemeProgress('ABCD2', 40);
    const res = await request(await buildTestApp())
      .get('/api/rooms/ABCD2/theme-progress')
      .expect(200);
    expect(res.body).toMatchObject({ status: 'preparing', total: 40, ready: 0 });
  });

  it('returns 404 when no preparation is in progress', async () => {
    await request(await buildTestApp())
      .get('/api/rooms/ABCD2/theme-progress')
      .expect(404);
  });
});
