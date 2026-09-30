import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Importing ./auth chains into ./storage -> server/db, whose module body
// throws when DATABASE_URL is unset (e.g. in CI). These tests inject a fake
// storage and never touch the DB, so stub the db module out.
vi.mock('../db', () => ({ db: {}, pool: {} }));

import { isAuthenticated, LOGIN_FAILED_REDIRECT, resolvePublicUrl, setupAuth } from './auth';
import type { OidcProvider, PendingSignIn, VerifiedIdentity } from './google-oidc';
import type { IAuthStorage, SignInProfile } from './storage';
import type { User } from '@shared/models/auth';

const VALID_KEY = 'a'.repeat(64);
const PUBLIC_URL = 'https://trivia.example.test';

function buildReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    isAuthenticated: vi.fn(() => false),
    ...overrides,
  } as unknown as Request;
}

function buildRes(): Response {
  const res = {} as Response;
  res.status = vi.fn(() => res) as unknown as Response['status'];
  res.json = vi.fn(() => res) as unknown as Response['json'];
  return res;
}

describe('isAuthenticated — admin API key bypass', () => {
  const originalKey = process.env.ADMIN_API_KEY;
  const originalUserId = process.env.ADMIN_API_KEY_USER_ID;

  beforeEach(() => {
    delete process.env.ADMIN_API_KEY;
    delete process.env.ADMIN_API_KEY_USER_ID;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = originalKey;
    if (originalUserId === undefined) delete process.env.ADMIN_API_KEY_USER_ID;
    else process.env.ADMIN_API_KEY_USER_ID = originalUserId;
    vi.restoreAllMocks();
  });

  it('authenticates a request with a matching Bearer token and configured user id', () => {
    process.env.ADMIN_API_KEY = VALID_KEY;
    process.env.ADMIN_API_KEY_USER_ID = 'stephanie-user-id';

    const req = buildReq({ headers: { authorization: `Bearer ${VALID_KEY}` } });
    const res = buildRes();
    const next = vi.fn() as NextFunction;

    isAuthenticated(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect((req as unknown as { user: { claims: { sub: string } } }).user.claims.sub).toBe(
      'stephanie-user-id'
    );
  });

  it("defaults the synthetic user id to 'service-account' when ADMIN_API_KEY_USER_ID is unset", () => {
    process.env.ADMIN_API_KEY = VALID_KEY;

    const req = buildReq({ headers: { authorization: `Bearer ${VALID_KEY}` } });
    const res = buildRes();
    const next = vi.fn() as NextFunction;

    isAuthenticated(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as unknown as { user: { claims: { sub: string } } }).user.claims.sub).toBe(
      'service-account'
    );
  });

  it('rejects a request with a wrong Bearer token (falls through to session check)', () => {
    process.env.ADMIN_API_KEY = VALID_KEY;

    const req = buildReq({ headers: { authorization: 'Bearer wrong-key' } });
    const res = buildRes();
    const next = vi.fn() as NextFunction;

    isAuthenticated(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('does not bypass auth when ADMIN_API_KEY is not set, even with a Bearer header', () => {
    const req = buildReq({ headers: { authorization: `Bearer ${VALID_KEY}` } });
    const res = buildRes();
    const next = vi.fn() as NextFunction;

    isAuthenticated(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('still authenticates a signed-in session when the API key path does not match', () => {
    process.env.ADMIN_API_KEY = VALID_KEY;

    const req = buildReq({
      headers: {},
      isAuthenticated: vi.fn(() => true) as unknown as Request['isAuthenticated'],
      user: { claims: { sub: 'player-1' } },
    } as Partial<Request>);
    const res = buildRes();
    const next = vi.fn() as NextFunction;

    isAuthenticated(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('resolvePublicUrl', () => {
  it('uses PUBLIC_URL without a trailing slash', () => {
    expect(resolvePublicUrl({ PUBLIC_URL: 'https://a.example/', NODE_ENV: 'production' })).toBe(
      'https://a.example'
    );
  });

  it('falls back to localhost outside production', () => {
    expect(resolvePublicUrl({ NODE_ENV: 'development', PORT: '5123' })).toBe(
      'http://localhost:5123'
    );
  });

  it('is undefined in production without PUBLIC_URL', () => {
    expect(resolvePublicUrl({ NODE_ENV: 'production' })).toBeUndefined();
  });
});

// --- Sign-in flow -----------------------------------------------------------

const PENDING: PendingSignIn = { state: 'state-1', nonce: 'nonce-1', codeVerifier: 'verifier-1' };

function buildUser(overrides: Partial<User>): User {
  return {
    id: 'user-id',
    email: 'player@example.com',
    firstName: null,
    lastName: null,
    profileImageUrl: null,
    isAdmin: false,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** In-memory storage with the same matching rule as the real one. */
function createFakeStorage(seed: User[]) {
  const usersById = new Map(seed.map((user) => [user.id, user]));
  let nextId = 1;
  const storage: IAuthStorage = {
    async getUser(id) {
      return usersById.get(id);
    },
    async upsertUserByEmail(profile: SignInProfile) {
      const email = profile.email.trim().toLowerCase();
      const existing = [...usersById.values()].find((u) => u.email?.toLowerCase() === email);
      if (existing) {
        const updated = { ...existing, firstName: profile.firstName ?? null };
        usersById.set(updated.id, updated);
        return updated;
      }
      const created = buildUser({ id: `new-user-${nextId++}`, email });
      usersById.set(created.id, created);
      return created;
    },
  };
  return { storage, usersById, upsertSpy: vi.spyOn(storage, 'upsertUserByEmail') };
}

function createFakeProvider(identity: VerifiedIdentity | Error) {
  const provider: OidcProvider = {
    begin: vi.fn(async (redirectUri: string) => ({
      url: new URL(
        `https://accounts.google.test/auth?redirect_uri=${encodeURIComponent(redirectUri)}`
      ),
      pending: PENDING,
    })),
    complete: vi.fn(async () => {
      if (identity instanceof Error) throw identity;
      return identity;
    }),
  };
  return provider;
}

async function buildAuthApp(options: {
  provider: OidcProvider | null;
  storage: IAuthStorage;
  adminIds?: string[];
}) {
  const app = express();
  await setupAuth(app, {
    provider: options.provider,
    storage: options.storage,
    publicUrl: PUBLIC_URL,
    session: session({ secret: 'test-secret', resave: false, saveUninitialized: false }),
  });
  app.get('/api/auth/user', isAuthenticated, async (req, res) => {
    const userId = (req.user as { claims: { sub: string } }).claims.sub;
    res.json(await options.storage.getUser(userId));
  });
  // Mirrors isAdmin in server/routes.ts: admin rights come only from admin_roles.
  const adminIds = new Set(options.adminIds ?? []);
  app.get('/api/admin/check', isAuthenticated, (req, res) => {
    const userId = (req.user as { claims: { sub: string } }).claims.sub;
    res.json({ isAdmin: adminIds.has(userId) });
  });
  return app;
}

async function signIn(agent: ReturnType<typeof request.agent>) {
  const login = await agent.get('/api/login');
  expect(login.status).toBe(302);
  return agent.get('/api/callback?code=abc&state=state-1');
}

describe('Google sign-in flow', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects /api/login to Google with the PUBLIC_URL callback', async () => {
    const { storage } = createFakeStorage([]);
    const provider = createFakeProvider({ email: 'a@example.com', emailVerified: true });
    const app = await buildAuthApp({ provider, storage });

    const res = await request(app).get('/api/login');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.test');
    expect(provider.begin).toHaveBeenCalledWith(`${PUBLIC_URL}/api/callback`);
  });

  it('keeps the existing users.id when the Google email matches a migrated user (case-insensitive)', async () => {
    const migrated = buildUser({ id: 'legacy-user-12345', email: 'Stephanie@Example.com' });
    const { storage } = createFakeStorage([migrated]);
    const provider = createFakeProvider({
      email: 'stephanie@example.com',
      emailVerified: true,
      firstName: 'Stephanie',
    });
    const app = await buildAuthApp({ provider, storage, adminIds: ['legacy-user-12345'] });
    const agent = request.agent(app);

    const callback = await signIn(agent);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe('/');

    const me = await agent.get('/api/auth/user');
    expect(me.status).toBe(200);
    expect(me.body.id).toBe('legacy-user-12345');

    // Admin access survives because admin_roles is keyed by the preserved id.
    const admin = await agent.get('/api/admin/check');
    expect(admin.body).toEqual({ isAdmin: true });

    expect(provider.complete).toHaveBeenCalledWith(
      new URL(`${PUBLIC_URL}/api/callback?code=abc&state=state-1`),
      PENDING
    );
  });

  it('creates a new player (not an admin) for an unknown Google account', async () => {
    const { storage, usersById } = createFakeStorage([
      buildUser({ id: 'admin-id', email: 'admin@example.com' }),
    ]);
    const provider = createFakeProvider({ email: 'newbie@gmail.com', emailVerified: true });
    const app = await buildAuthApp({ provider, storage, adminIds: ['admin-id'] });
    const agent = request.agent(app);

    await signIn(agent);

    const me = await agent.get('/api/auth/user');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('newbie@gmail.com');
    expect(me.body.id).not.toBe('admin-id');
    expect(usersById.size).toBe(2);

    const admin = await agent.get('/api/admin/check');
    expect(admin.body).toEqual({ isAdmin: false });
  });

  it('logs out: destroys the session and redirects home', async () => {
    const { storage } = createFakeStorage([]);
    const provider = createFakeProvider({ email: 'p@example.com', emailVerified: true });
    const app = await buildAuthApp({ provider, storage });
    const agent = request.agent(app);

    await signIn(agent);
    expect((await agent.get('/api/auth/user')).status).toBe(200);

    const logout = await agent.get('/api/logout');
    expect(logout.status).toBe(302);
    expect(logout.headers.location).toBe('/');

    expect((await agent.get('/api/auth/user')).status).toBe(401);
  });

  it('rejects an unverified Google email without creating a user', async () => {
    const { storage, upsertSpy } = createFakeStorage([]);
    const provider = createFakeProvider({ email: 'p@example.com', emailVerified: false });
    const app = await buildAuthApp({ provider, storage });
    const agent = request.agent(app);

    const callback = await signIn(agent);

    expect(callback.headers.location).toBe(LOGIN_FAILED_REDIRECT);
    expect(upsertSpy).not.toHaveBeenCalled();
    expect((await agent.get('/api/auth/user')).status).toBe(401);
  });

  it('fails closed when Google rejects the code exchange (e.g. state mismatch)', async () => {
    const { storage, upsertSpy } = createFakeStorage([]);
    const provider = createFakeProvider(new Error('unexpected "state" response parameter value'));
    const app = await buildAuthApp({ provider, storage });
    const agent = request.agent(app);

    const callback = await signIn(agent);

    expect(callback.headers.location).toBe(LOGIN_FAILED_REDIRECT);
    expect(upsertSpy).not.toHaveBeenCalled();
    expect((await agent.get('/api/auth/user')).status).toBe(401);
  });

  it('rejects a callback with no sign-in in progress', async () => {
    const { storage } = createFakeStorage([]);
    const provider = createFakeProvider({ email: 'p@example.com', emailVerified: true });
    const app = await buildAuthApp({ provider, storage });

    const callback = await request(app).get('/api/callback?code=abc&state=state-1');

    expect(callback.headers.location).toBe(LOGIN_FAILED_REDIRECT);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('does not allow replaying a callback after sign-in completed', async () => {
    const { storage } = createFakeStorage([]);
    const provider = createFakeProvider({ email: 'p@example.com', emailVerified: true });
    const app = await buildAuthApp({ provider, storage });
    const agent = request.agent(app);

    await signIn(agent);
    const replay = await agent.get('/api/callback?code=abc&state=state-1');

    expect(replay.headers.location).toBe(LOGIN_FAILED_REDIRECT);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('returns 503 from /api/login when Google sign-in is not configured', async () => {
    const { storage } = createFakeStorage([]);
    const app = await buildAuthApp({ provider: null, storage });

    const res = await request(app).get('/api/login');

    expect(res.status).toBe(503);
  });

  it('returns 503 when Google discovery is unreachable', async () => {
    const { storage } = createFakeStorage([]);
    const provider = createFakeProvider({ email: 'p@example.com', emailVerified: true });
    vi.mocked(provider.begin).mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));
    const app = await buildAuthApp({ provider, storage });

    const res = await request(app).get('/api/login');

    expect(res.status).toBe(503);
  });

  it('returns 401 from /api/auth/user when signed out', async () => {
    const { storage } = createFakeStorage([]);
    const app = await buildAuthApp({ provider: null, storage });

    expect((await request(app).get('/api/auth/user')).status).toBe(401);
  });
});
