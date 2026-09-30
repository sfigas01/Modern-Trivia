import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerHealthRoute } from './health';

function buildApp(query: () => Promise<unknown>, timeoutMs?: number) {
  const app = express();
  registerHealthRoute(app, { query }, timeoutMs);
  return app;
}

describe('GET /health', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 when the database answers', async () => {
    const query = vi.fn(async () => ({ rows: [{ '?column?': 1 }] }));

    const res = await request(buildApp(query)).get('/health').expect(200);

    expect(res.body).toEqual({ status: 'ok', database: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns 503 when the database query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await request(buildApp(() => Promise.reject(new Error('ECONNREFUSED'))))
      .get('/health')
      .expect(503);

    expect(res.body).toEqual({ status: 'error', database: 'unavailable' });
  });

  it('returns 503 when the database does not answer in time', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await request(buildApp(() => new Promise(() => undefined), 20))
      .get('/health')
      .expect(503);
  });
});
