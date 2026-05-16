import path from 'path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from '../db';

// Runs all pending SQL migration files from the migrations/ directory.
// Drizzle tracks applied migrations in __drizzle_migrations so this is idempotent.
// Must be called after db:push has applied the base schema (tables + columns).
export async function runMigrations() {
  const migrationsFolder = path.resolve(process.cwd(), 'migrations');
  await migrate(db, { migrationsFolder });
}
