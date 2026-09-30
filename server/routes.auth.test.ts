import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryMock } from './test/dbMock';
import { buildTestApp } from './test/testApp';

// Integration test for Google sign-in through the real registerRoutes: real
// session + passport wiring, real /api/login, /api/callback, /api/logout,
// /api/auth/user and the real isAdmin check. Only Google, the user store and
// the database are faked.

const dbMocks = vi.hoisted(() => ({
  delete: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  selectDistinct: vi.fn(),
  update: vi.fn(),
}));

const fakes = vi.hoisted(() => ({
  identity: { email: 'player@example.com', emailVerified: true } as {
    email: string;
    emailVerified: boolean;
  },
  users: new Map<string, { id: string; email: string }>(),
}));

vi.mock('./db', () => ({ db: dbMocks }));

vi.mock('./auth/google-oidc', () => ({
  createGoogleOidcProvider: vi.fn(() => ({
    begin: vi.fn(async () => ({
      url: new URL('https://accounts.google.test/auth'),
      pending: { state: 's', nonce: 'n', codeVerifier: 'v' },
    })),
    complete: vi.fn(async () => fakes.identity),
  })),
}));

vi.mock('./auth/storage', () => ({
  authStorage: {
    getUser: vi.fn(async (id: string) => fakes.users.get(id)),
    upsertUserByEmail: vi.fn(async ({ email }: { email: string }) => {
      const normalized = email.toLowerCase();
      const existing = [...fakes.users.values()].find((u) => u.email.toLowerCase() === normalized);
      if (existing) return existing;
      const created = { id: `new-${fakes.users.size + 1}`, email: normalized };
      fakes.users.set(created.id, created);
      return created;
    }),
  },
}));

vi.mock('./lib/subjectivity-enricher', () => ({ enrichSubjectiveFindings: vi.fn() }));
vi.mock('./lib/ai', () => ({ analyzeDispute: vi.fn() }));
vi.mock('./lib/guardian', () => ({ generateQuestions: vi.fn() }));
vi.mock('./lib/field-fix', () => ({ getAiFieldFix: vi.fn() }));
vi.mock('./lib/question-quality-audit', () => ({ auditQuestionQuality: vi.fn() }));
vi.mock('./lib/duplicate-detector', () => ({ detectDuplicates: vi.fn() }));
vi.mock('./lib/verifier', () => ({ batchFactCheck: vi.fn() }));

async function signIn(agent: ReturnType<typeof request.agent>) {
  await agent.get('/api/login').expect(302);
  const callback = await agent.get('/api/callback?code=c&state=s');
  expect(callback.headers.location).toBe('/');
}

describe('Google sign-in through the app routes', () => {
  beforeAll(() => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-client-secret');
    vi.stubEnv('PUBLIC_URL', 'https://trivia.example.test');
    vi.stubEnv('SESSION_SECRET', 'test-session-secret');
    // No DATABASE_URL: getSession() falls back to the in-memory store.
    vi.stubEnv('DATABASE_URL', '');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    fakes.users.clear();
    fakes.users.set('legacy-admin-id', { id: 'legacy-admin-id', email: 'Owner@Example.com' });
  });

  it('signs a migrated admin in to their existing id and keeps admin access', async () => {
    fakes.identity = { email: 'owner@example.com', emailVerified: true };
    const app = await buildTestApp();
    const agent = request.agent(app);

    await signIn(agent);

    const me = await agent.get('/api/auth/user').expect(200);
    expect(me.body.id).toBe('legacy-admin-id');

    // isAdmin looks the preserved id up in admin_roles, then the route reads app_config.
    dbMocks.select
      .mockReturnValueOnce(createQueryMock([{ userId: 'legacy-admin-id' }]))
      .mockReturnValueOnce(createQueryMock([]));
    await agent.get('/api/admin/config').expect(200);
  });

  it('gives a new Google account player access only', async () => {
    fakes.identity = { email: 'newbie@gmail.com', emailVerified: true };
    const app = await buildTestApp();
    const agent = request.agent(app);

    await signIn(agent);

    const me = await agent.get('/api/auth/user').expect(200);
    expect(me.body.id).not.toBe('legacy-admin-id');

    dbMocks.select.mockReturnValueOnce(createQueryMock([]));
    await agent.get('/api/admin/config').expect(403);
  });

  it('signs out through /api/logout', async () => {
    fakes.identity = { email: 'newbie@gmail.com', emailVerified: true };
    const app = await buildTestApp();
    const agent = request.agent(app);

    await signIn(agent);
    await agent.get('/api/logout').expect(302);

    await agent.get('/api/auth/user').expect(401);
    await agent.get('/api/admin/config').expect(401);
  });
});
