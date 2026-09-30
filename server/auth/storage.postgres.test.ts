import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { IAuthStorage } from './storage';

// Runs the real email-matching SQL against PostgreSQL. Set
// AUTH_TEST_DATABASE_URL to a disposable database to run it; each run uses its
// own schema and drops it afterwards.
const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;

describe.runIf(Boolean(databaseUrl))('auth storage on PostgreSQL', () => {
  const schema = `auth_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: databaseUrl });
  let storage: IAuthStorage;
  let closePool: () => Promise<void>;

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    // Same shape as shared/models/auth.ts `users`.
    await admin.query(`
      CREATE TABLE ${schema}.users (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar UNIQUE,
        first_name varchar,
        last_name varchar,
        profile_image_url varchar,
        is_admin boolean NOT NULL DEFAULT false,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )`);

    const url = new URL(databaseUrl!);
    url.searchParams.set('options', `-c search_path=${schema}`);
    vi.stubEnv('DATABASE_URL', url.toString());
    vi.resetModules();
    ({ authStorage: storage } = await import('./storage'));
    const { pool } = await import('../db');
    closePool = () => pool.end();
  });

  afterAll(async () => {
    await closePool?.();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    vi.unstubAllEnvs();
  });

  async function insertUser(id: string, email: string | null, createdAt: string) {
    await admin.query(
      `INSERT INTO ${schema}.users (id, email, created_at) VALUES ($1, $2, $3::timestamp)`,
      [id, email, createdAt]
    );
  }

  it('keeps the existing id for a migrated user whose email differs only in case', async () => {
    await insertUser('12345678', 'Migrated.Player@Example.com', '2025-01-01');

    const user = await storage.upsertUserByEmail({
      email: 'migrated.player@example.com',
      firstName: 'Mig',
      lastName: 'Rated',
      profileImageUrl: 'https://img.example/p.png',
    });

    expect(user.id).toBe('12345678');
    expect(user.firstName).toBe('Mig');
    expect(user.email).toBe('Migrated.Player@Example.com');
    const { rows } = await admin.query(`SELECT count(*)::int AS n FROM ${schema}.users`);
    expect(rows[0].n).toBe(1);
  });

  it('creates a new user with a generated id for an unknown email', async () => {
    const user = await storage.upsertUserByEmail({ email: '  New.Player@Gmail.com ' });

    expect(user.email).toBe('new.player@gmail.com');
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.isAdmin).toBe(false);

    const again = await storage.upsertUserByEmail({ email: 'new.player@gmail.com' });
    expect(again.id).toBe(user.id);
  });

  it('prefers the exact lowercase match when case variants exist', async () => {
    await insertUser('older-variant', 'Dup@Example.com', '2024-01-01');
    await insertUser('exact-lowercase', 'dup@example.com', '2025-06-01');

    const user = await storage.upsertUserByEmail({ email: 'DUP@example.com' });

    expect(user.id).toBe('exact-lowercase');
  });

  it('otherwise picks the oldest case-insensitive match', async () => {
    await insertUser('newer', 'Old@Example.COM', '2025-06-01');
    await insertUser('oldest', 'OLD@example.com', '2023-01-01');

    const user = await storage.upsertUserByEmail({ email: 'old@example.com' });

    expect(user.id).toBe('oldest');
  });

  it('creates exactly one user when two first sign-ins race', async () => {
    const [a, b] = await Promise.all([
      storage.upsertUserByEmail({ email: 'race@example.com' }),
      storage.upsertUserByEmail({ email: 'race@example.com' }),
    ]);

    expect(a.id).toBe(b.id);
    const { rows } = await admin.query(
      `SELECT count(*)::int AS n FROM ${schema}.users WHERE email = 'race@example.com'`
    );
    expect(rows[0].n).toBe(1);
  });

  it('can find users by id', async () => {
    await insertUser('lookup-me', 'lookup@example.com', '2025-01-01');

    expect((await storage.getUser('lookup-me'))?.email).toBe('lookup@example.com');
    expect(await storage.getUser('missing')).toBeUndefined();
  });
});
