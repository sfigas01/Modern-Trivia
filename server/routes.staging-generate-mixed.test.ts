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
// Partial mock: keep the real computeStrategyQuotas/STRATEGY_PILLAR_TARGETS (this suite is
// testing that routes.ts actually uses them), only stub the network-calling generateQuestions.
vi.mock('./lib/guardian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/guardian')>();
  return { ...actual, generateQuestions: vi.fn() };
});
vi.mock('./lib/field-fix', () => ({ getAiFieldFix: vi.fn() }));
vi.mock('./lib/question-quality-audit', () => ({ auditQuestionQuality: vi.fn() }));
vi.mock('./lib/duplicate-detector', () => ({ detectDuplicates: vi.fn() }));
vi.mock('./lib/verifier', () => ({ batchFactCheck: vi.fn() }));
vi.mock('./lib/topic-context', () => ({ selectTopicContext: vi.fn(() => []) }));
vi.mock('./lib/novelty-filter', () => ({ filterNovelQuestions: vi.fn() }));

import { computeStrategyQuotas, generateQuestions } from './lib/guardian';
import { filterNovelQuestions } from './lib/novelty-filter';

const adminRole = { userId: 'admin-user' };

function existingRow(id: string, pillar: string) {
  return { id, question: `Question ${id}?`, answer: `Answer ${id}`, pillar };
}

describe('POST /api/staging/generate — Mixed pillar strategy quotas (STE-249)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
    vi.mocked(generateQuestions).mockResolvedValue([]);
    vi.mocked(filterNovelQuestions).mockResolvedValue({ kept: [], dropped: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it('allocates a Mixed batch using live per-pillar inventory counts, not a fixed split', async () => {
    // Pool is almost entirely GlobalEh, which is already far past its 30% CONTENT_STRATEGY.md
    // target share — a fresh Mixed batch should allocate it well below a naive fixed 30% split
    // and boost the under-represented pillars instead.
    const existingRows = [
      ...Array.from({ length: 97 }, (_, i) => existingRow(`ge${i}`, 'GlobalEh')),
      existingRow('tc0', 'TimeCapsule'),
      existingRow('fp0', 'FreshPrints'),
      existingRow('go0', 'GreatOutdoors'),
    ];

    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce(createQueryMock(existingRows));

    await request(await buildTestApp())
      .post('/api/staging/generate')
      .send({ topic: 'Hockey', count: 20, pillar: 'Mixed' })
      .expect(201);

    const expectedQuotas = computeStrategyQuotas(
      { GlobalEh: 97, TimeCapsule: 1, FreshPrints: 1, GreatOutdoors: 1 },
      20
    );
    expect(expectedQuotas.reduce((sum, q) => sum + q.count, 0)).toBe(20);

    const callsByPillar = new Map(
      vi
        .mocked(generateQuestions)
        .mock.calls.map(([, countArg, pillarArg]) => [pillarArg, countArg])
    );

    expect([...callsByPillar.keys()].sort()).toEqual(expectedQuotas.map((q) => q.pillar).sort());
    for (const quota of expectedQuotas) {
      expect(callsByPillar.get(quota.pillar)).toBe(quota.count);
    }

    // The naive fixed 30/30/25/15 split would give GlobalEh 6 of 20 regardless of inventory;
    // at 97% saturation it should get far fewer — here, zero (no call at all).
    expect(callsByPillar.get('GlobalEh') ?? 0).toBeLessThan(6);
  });

  it('falls back to the plain 30/30/25/15 split when the pool is empty', async () => {
    dbMocks.select
      .mockReturnValueOnce(createQueryMock([adminRole]))
      .mockReturnValueOnce(createQueryMock([]));

    await request(await buildTestApp())
      .post('/api/staging/generate')
      .send({ topic: 'Hockey', count: 20, pillar: 'Mixed' })
      .expect(201);

    const callsByPillar = new Map(
      vi
        .mocked(generateQuestions)
        .mock.calls.map(([, countArg, pillarArg]) => [pillarArg, countArg])
    );

    expect(callsByPillar.get('TimeCapsule')).toBe(6);
    expect(callsByPillar.get('GlobalEh')).toBe(6);
    expect(callsByPillar.get('FreshPrints')).toBe(5);
    expect(callsByPillar.get('GreatOutdoors')).toBe(3);
  });
});
