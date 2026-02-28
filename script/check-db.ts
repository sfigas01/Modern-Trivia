import pg from 'pg';
import { loadEnvironment } from '../server/lib/env';

loadEnvironment();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error(
    'DATABASE_URL is not set. Copy .env.example to .env and provide your PostgreSQL connection string.'
  );
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
});

type HealthRow = {
  current_database: string;
  current_user: string;
};

async function main() {
  let client: pg.PoolClient | undefined;

  try {
    client = await pool.connect();
    const { rows } = await client.query<HealthRow>(
      'select current_database() as current_database, current_user as current_user'
    );

    const row = rows[0];
    console.log(
      `Connected to PostgreSQL database "${row.current_database}" as "${row.current_user}".`
    );
    console.log('Database connection check passed.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Database connection check failed: ${message}`);
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
}

void main();
