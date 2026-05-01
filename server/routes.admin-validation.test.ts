import type { Express, NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('admin route validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('rejects malformed admin grant requests before writing', async () => {
    dbMocks.select.mockReturnValueOnce(createQueryMock([adminRole]));
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/admin/grant')
      .set('x-test-user-id', 'admin-user')
      .send({ userId: '' })
      .expect(422);

    expect(response.body).toMatchObject({ message: 'Invalid admin grant request' });
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });

  it('rejects unapproved config keys before writing', async () => {
    dbMocks.select.mockReturnValueOnce(createQueryMock([adminRole]));
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/admin/config')
      .set('x-test-user-id', 'admin-user')
      .send({ key: 'unexpected_key', value: 'secret' })
      .expect(422);

    expect(response.body).toMatchObject({ message: 'Invalid configuration request' });
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });

  it('saves approved config keys for admins', async () => {
    dbMocks.select.mockReturnValueOnce(createQueryMock([adminRole]));
    const insertQuery = createQueryMock([{ key: 'openai_api_key', value: 'secret' }]);
    dbMocks.insert.mockReturnValue(insertQuery);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/admin/config')
      .set('x-test-user-id', 'admin-user')
      .send({ key: 'openai_api_key', value: 'secret' })
      .expect(200);

    expect(insertQuery.values).toHaveBeenCalledWith({ key: 'openai_api_key', value: 'secret' });
    expect(insertQuery.onConflictDoUpdate).toHaveBeenCalledOnce();
    expect(response.body).toEqual({ message: 'Configuration saved', key: 'openai_api_key' });
  });
});
