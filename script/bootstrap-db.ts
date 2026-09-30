/**
 * Railway pre-deploy step: give an EMPTY database its base schema.
 *
 * The SQL migrations in migrations/ cannot build a database from nothing:
 * 0000 is an old drizzle snapshot and runMigrations() treats it as already
 * applied, expecting `drizzle-kit push` to have created the base tables (on
 * Replit this happened on every publish). So on a database with no
 * application tables this script runs `drizzle-kit push`, and runMigrations()
 * applies the SQL migrations when the server boots — the same order CI's E2E
 * job uses.
 *
 * Any database that already has application tables is left untouched.
 * Production gets its schema from the data copy, so this is a no-op there.
 */
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { loadEnvironment } from '../server/lib/env';

loadEnvironment();

const MIGRATIONS_TABLE = '_sql_migrations';
// runMigrations() records 0000 as applied without running it.
const BOOTSTRAP_MIGRATION = '0000_daffy_malcolm_colcord.sql';
// Tables the base schema must contain once push has run.
const REQUIRED_TABLES = ['users', 'sessions', 'questions', 'admin_roles'];

async function main(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[bootstrap] DATABASE_URL must be set');
    return 1;
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows: tables } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
    );
    const appTables = tables.filter((t) => t.tablename !== MIGRATIONS_TABLE);

    if (appTables.length > 0) {
      // A push interrupted part-way leaves some tables behind. runMigrations()
      // assumes the base schema is complete, so fail loudly instead of
      // skipping a partially initialized database.
      const present = new Set(appTables.map((t) => t.tablename));
      const missing = REQUIRED_TABLES.filter((name) => !present.has(name));
      if (missing.length > 0) {
        console.error(
          `[bootstrap] database has ${appTables.length} application tables but is missing base tables: ${missing.join(', ')}. Refusing to continue; inspect or reset the database by hand.`
        );
        return 1;
      }
      console.log(
        `[bootstrap] database has ${appTables.length} application tables; skipping (runMigrations applies pending SQL migrations at boot)`
      );
      return 0;
    }

    // A boot against a schema-less database leaves _sql_migrations behind
    // holding only the 0000 marker. drizzle-kit would stop to ask whether it
    // is a renamed table, so remove it — but only if it records nothing else.
    if (tables.length > 0) {
      const { rows: applied } = await client.query<{ filename: string }>(
        `SELECT filename FROM ${MIGRATIONS_TABLE}`
      );
      if (applied.some((row) => row.filename !== BOOTSTRAP_MIGRATION)) {
        console.error(
          `[bootstrap] ${MIGRATIONS_TABLE} records applied migrations but no application tables exist; refusing to continue. Inspect the database by hand.`
        );
        return 1;
      }
      await client.query(`DROP TABLE ${MIGRATIONS_TABLE}`);
      console.log(`[bootstrap] removed a stale ${MIGRATIONS_TABLE} table (only the 0000 marker)`);
    }
  } finally {
    await client.end();
  }

  console.log('[bootstrap] empty database: creating the base schema with drizzle-kit push');
  // drizzle-kit can exit 0 after an error, so the result is checked below.
  spawnSync('npx', ['drizzle-kit', 'push', '--force'], { stdio: 'inherit', env: process.env });

  const verify = new pg.Client({ connectionString: databaseUrl });
  await verify.connect();
  try {
    const { rows } = await verify.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [REQUIRED_TABLES]
    );
    const present = new Set(rows.map((row) => row.tablename));
    const missing = REQUIRED_TABLES.filter((name) => !present.has(name));
    if (missing.length > 0) {
      console.error(
        `[bootstrap] base schema incomplete after push; missing: ${missing.join(', ')}`
      );
      return 1;
    }
  } finally {
    await verify.end();
  }

  console.log('[bootstrap] base schema created; SQL migrations run when the server starts');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('[bootstrap] failed:', error);
    process.exit(1);
  });
