import { runMigrations } from '../server/lib/migrate';
import { pool } from '../server/db';

async function main() {
  try {
    await runMigrations();
    console.log('All SQL migrations applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void main();
