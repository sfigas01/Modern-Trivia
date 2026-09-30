/**
 * Railway pre-deploy step: give an EMPTY database its base schema.
 *
 * The SQL migrations in migrations/ cannot build a database from nothing:
 * 0000 is an old drizzle snapshot and runMigrations() treats it as already
 * applied, expecting `drizzle-kit push` to have created the base tables (on
 * Replit this happened on every publish). So on a database with no tables this
 * script runs `drizzle-kit push`, and runMigrations() applies the SQL
 * migrations when the server boots — the same order CI's E2E job uses.
 *
 * Any database that already has tables is left untouched. Production gets its
 * schema from the data copy, so this is a no-op there.
 */
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { loadEnvironment } from '../server/lib/env';

loadEnvironment();

async function main(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[bootstrap] DATABASE_URL must be set');
    return 1;
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let tableCount: number;
  try {
    const { rows } = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public'`
    );
    tableCount = rows[0].count;
  } finally {
    await client.end();
  }

  if (tableCount > 0) {
    console.log(
      `[bootstrap] database has ${tableCount} tables; skipping (runMigrations applies pending SQL migrations at boot)`
    );
    return 0;
  }

  console.log('[bootstrap] empty database: creating the base schema with drizzle-kit push');
  const result = spawnSync('npx', ['drizzle-kit', 'push', '--force'], {
    stdio: 'inherit',
    env: process.env,
  });
  return result.status ?? 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('[bootstrap] failed:', error);
    process.exit(1);
  });
