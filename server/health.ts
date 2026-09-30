import type { Express } from 'express';

/** Anything that can run a query — the app's pg Pool in production. */
export interface HealthDatabase {
  query(sql: string): Promise<unknown>;
}

const DEFAULT_DB_CHECK_TIMEOUT_MS = 3000;

/**
 * GET /health — Railway's healthcheck. Returns 200 only when the server has
 * finished booting (migrations, routes) and the database answers a trivial
 * query; 503 otherwise so Railway keeps traffic on the previous deploy.
 */
export function registerHealthRoute(
  app: Express,
  database: HealthDatabase,
  timeoutMs = DEFAULT_DB_CHECK_TIMEOUT_MS
) {
  app.get('/health', async (_req, res) => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        database.query('SELECT 1'),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('database check timed out')), timeoutMs);
        }),
      ]);
      res.set('Cache-Control', 'no-store').json({ status: 'ok', database: 'ok' });
    } catch (error) {
      console.error('Health check failed:', error);
      res
        .set('Cache-Control', 'no-store')
        .status(503)
        .json({ status: 'error', database: 'unavailable' });
    } finally {
      clearTimeout(timer);
    }
  });
}
