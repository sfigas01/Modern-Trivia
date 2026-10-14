import type { Pool, PoolClient } from 'pg';

export const THEME_RUNTIME_CONTROL_ID = 1;
export const THEME_BUDGET_LOCK_SQL = 'SELECT pg_advisory_xact_lock(927421, 25011)';

export class ThemeRuntimeControlError extends Error {
  constructor(
    public readonly code: 'invalid_request' | 'runtime_disabled',
    message: string
  ) {
    super(message);
    this.name = 'ThemeRuntimeControlError';
  }
}

async function transaction<T>(pool: Pool, work: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(THEME_BUDGET_LOCK_SQL);
    const value = await work(db);
    await db.query('COMMIT');
    return value;
  } catch (error) {
    try {
      await db.query('ROLLBACK');
    } catch {
      // Preserve the original control failure.
    }
    throw error;
  } finally {
    db.release();
  }
}

export async function assertThemeDispatchEnabled(db: PoolClient): Promise<void> {
  const result = await db.query<{ dispatch_enabled: boolean }>(
    `SELECT enabled AS dispatch_enabled FROM theme_runtime_control
     WHERE singleton_id=$1 FOR UPDATE`,
    [THEME_RUNTIME_CONTROL_ID]
  );
  if (result.rows.length !== 1 || result.rows[0]?.dispatch_enabled !== true)
    throw new ThemeRuntimeControlError(
      'runtime_disabled',
      'Themed provider dispatch is disabled by the durable runtime control'
    );
}

/**
 * Serializes the last pre-invocation check with control changes. A committed
 * disable prevents every later admission; work admitted before it may finish.
 */
export async function assertThemeDispatchEnabledNow(pool: Pool): Promise<void> {
  await transaction(pool, assertThemeDispatchEnabled);
}

export function createThemeRuntimeControl(pool: Pool) {
  return {
    async read(): Promise<{ enabled: boolean }> {
      const result = await pool.query<{
        enabled: boolean;
      }>(
        `SELECT enabled FROM theme_runtime_control
         WHERE singleton_id=$1`,
        [THEME_RUNTIME_CONTROL_ID]
      );
      const row = result.rows[0];
      if (!row)
        throw new ThemeRuntimeControlError(
          'runtime_disabled',
          'The durable themed runtime control is missing'
        );
      return { enabled: row.enabled };
    },

    async set(enabled: boolean): Promise<void> {
      await transaction(pool, async (db) => {
        const result = await db.query(
          `UPDATE theme_runtime_control
           SET enabled=$2,updated_at=clock_timestamp()
           WHERE singleton_id=$1`,
          [THEME_RUNTIME_CONTROL_ID, enabled]
        );
        if (result.rowCount !== 1)
          throw new ThemeRuntimeControlError(
            'runtime_disabled',
            'The durable themed runtime control is missing'
          );
      });
    },
  };
}
