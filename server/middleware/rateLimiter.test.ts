import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { aiLimiter } from './rateLimiter';

type TestRequest = Request & {
  user?: {
    claims?: {
      sub?: string;
    };
  };
};

function buildLimitedApp({ trustProxy = false } = {}): Express {
  const app = express();

  if (trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use((req: Request, _res: Response, next: NextFunction) => {
    const userId = req.header('x-test-user-id');

    if (userId) {
      (req as TestRequest).user = { claims: { sub: userId } };
    }

    next();
  });

  app.post('/ai', aiLimiter, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  return app;
}

async function makeRequests(
  app: Express,
  headers: Record<string, string>,
  requestCount: number
): Promise<void> {
  for (let i = 0; i < requestCount; i++) {
    await request(app).post('/ai').set(headers).expect(200);
  }
}

describe('aiLimiter', () => {
  it('allows 20 requests and rejects the 21st request for the same user key', async () => {
    const app = buildLimitedApp();
    const headers = { 'x-test-user-id': 'rate-limit-user-quota' };

    await makeRequests(app, headers, 20);

    const response = await request(app).post('/ai').set(headers).expect(429);

    expect(response.body).toEqual({
      message: 'AI analysis rate limit exceeded. Please wait before trying again.',
    });
  });

  it('tracks authenticated users separately', async () => {
    const app = buildLimitedApp();

    await makeRequests(app, { 'x-test-user-id': 'rate-limit-user-a' }, 20);

    await request(app).post('/ai').set({ 'x-test-user-id': 'rate-limit-user-b' }).expect(200);
  });

  it('tracks unauthenticated IPs separately', async () => {
    const app = buildLimitedApp({ trustProxy: true });

    await makeRequests(app, { 'X-Forwarded-For': '203.0.113.10' }, 20);

    await request(app).post('/ai').set({ 'X-Forwarded-For': '203.0.113.11' }).expect(200);
  });
});
