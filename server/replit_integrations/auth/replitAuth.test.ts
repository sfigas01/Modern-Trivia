import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isAuthenticated } from './replitAuth';

const VALID_KEY = 'a'.repeat(64);

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

  it('authenticates a request with a matching Bearer token and configured user id', async () => {
    process.env.ADMIN_API_KEY = VALID_KEY;
    process.env.ADMIN_API_KEY_USER_ID = 'stephanie-user-id';

    const req = buildReq({ headers: { authorization: `Bearer ${VALID_KEY}` } });
    const res = buildRes();
    const next = vi.fn() as NextFunction;

    await isAuthenticated(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect((req as unknown as { user: { claims: { sub: string } } }).user.claims.sub).toBe(
      'stephanie-user-id'
    );
  });

  it("defaults the synthetic user id to 'service-account' when ADMIN_API_KEY_USER_ID is unset", async () => {
    process.env.ADMIN_API_KEY = VALID_KEY;

    const req = buildReq({ headers: { authorization: `Bearer ${VALID_KEY}` } });
    const res = buildRes();
    const next = vi.fn() as NextFunction;

    await isAuthenticated(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as unknown as { user: { claims: { sub: string } } }).user.claims.sub).toBe(
      'service-account'
    );
  });

  it('rejects a request with a wrong Bearer token (falls through to session check)', async () => {
    process.env.ADMIN_API_KEY = VALID_KEY;

    const req = buildReq({ headers: { authorization: 'Bearer wrong-key' } });
    const res = buildRes();
    const next = vi.fn() as NextFunction;

    await isAuthenticated(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('does not bypass auth when ADMIN_API_KEY is not set, even with a Bearer header', async () => {
    const req = buildReq({ headers: { authorization: `Bearer ${VALID_KEY}` } });
    const res = buildRes();
    const next = vi.fn() as NextFunction;

    await isAuthenticated(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('still authenticates a normal, unexpired OIDC session when the API key path does not match', async () => {
    process.env.ADMIN_API_KEY = VALID_KEY;

    const req = buildReq({
      headers: {},
      isAuthenticated: vi.fn(() => true) as unknown as Request['isAuthenticated'],
      user: { expires_at: Math.floor(Date.now() / 1000) + 3600 },
    } as Partial<Request>);
    const res = buildRes();
    const next = vi.fn() as NextFunction;

    await isAuthenticated(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
