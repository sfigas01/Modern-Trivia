import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { themePreparationJobs, themeRuntimeControl } from '../../shared/models/theme-storage';

const databaseUrl = process.env.THEME_RELIABILITY_MIGRATION_TEST_DATABASE_URL;

describe('S12A preview runtime schema', () => {
  it('matches the durable plan and singleton control migration', async () => {
    const sql = await readFile(
      new URL('../../migrations/0019_theme_preview_runtime_control.sql', import.meta.url),
      'utf8'
    );
    const jobColumns = getTableConfig(themePreparationJobs).columns.map((column) => column.name);
    const control = getTableConfig(themeRuntimeControl);

    expect(jobColumns).toEqual(
      expect.arrayContaining(['plan_version', 'plan_hash', 'plan_json', 'plan_hold_until'])
    );
    expect(
      getTableConfig(themePreparationJobs).checks.map((constraint) => constraint.name)
    ).toEqual(
      expect.arrayContaining([
        'theme_preparation_jobs_plan_complete',
        'theme_preparation_jobs_plan_values',
      ])
    );
    expect(control.name).toBe('theme_runtime_control');
    expect(control.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['singleton_id', 'enabled', 'updated_at'])
    );
    expect(control.checks.map((constraint) => constraint.name)).toContain(
      'theme_runtime_control_singleton'
    );
    expect(sql).toContain('theme_preparation_jobs_plan_immutable');
    expect(sql).toContain('theme_runtime_control_no_delete');
    expect(sql).toContain('VALUES (1, false)');
  });
});

describe.runIf(Boolean(databaseUrl))('S12A preview runtime PostgreSQL migration', () => {
  it('reruns safely and enforces one-time complete plans and the disabled singleton', async () => {
    const db = new pg.Client({ connectionString: databaseUrl });
    const schema = `theme_plan_${randomUUID().replaceAll('-', '')}`;
    let connected = false;
    let created = false;
    try {
      await db.connect();
      connected = true;
      await db.query(`CREATE SCHEMA ${schema}`);
      created = true;
      await db.query(`SET search_path TO ${schema}`);
      await db.query('CREATE TABLE theme_preparation_jobs (id uuid PRIMARY KEY)');
      const migration = await readFile(
        new URL('../../migrations/0019_theme_preview_runtime_control.sql', import.meta.url),
        'utf8'
      );
      await db.query(migration);
      await db.query(migration);

      const emptyJobId = randomUUID();
      await db.query('INSERT INTO theme_preparation_jobs (id) VALUES ($1)', [emptyJobId]);
      await expect(
        db.query(
          `UPDATE theme_preparation_jobs SET plan_version = 'v1', plan_hash = $2,
             plan_json = '{"fixture":"preview"}'::jsonb, plan_hold_until = now() WHERE id = $1`,
          [emptyJobId, 'a'.repeat(64)]
        )
      ).resolves.toBeDefined();
      await expect(
        db.query(`UPDATE theme_preparation_jobs SET plan_hash = $2 WHERE id = $1`, [
          emptyJobId,
          'b'.repeat(64),
        ])
      ).rejects.toThrow('theme preparation job plan is immutable once populated');
      await expect(
        db.query(`INSERT INTO theme_preparation_jobs (id, plan_version) VALUES ($1, 'partial')`, [
          randomUUID(),
        ])
      ).rejects.toThrow();

      const control = await db.query('SELECT singleton_id, enabled FROM theme_runtime_control');
      expect(control.rows).toEqual([{ singleton_id: 1, enabled: false }]);
      await expect(
        db.query('INSERT INTO theme_runtime_control (singleton_id, enabled) VALUES (2, true)')
      ).rejects.toThrow();
      await expect(
        db.query('DELETE FROM theme_runtime_control WHERE singleton_id = 1')
      ).rejects.toThrow('theme runtime control singleton cannot be deleted');
    } finally {
      if (connected) {
        if (created) await db.query(`DROP SCHEMA ${schema} CASCADE`);
        await db.end();
      }
    }
  });
});
