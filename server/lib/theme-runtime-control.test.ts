import { describe, expect, it, vi } from 'vitest';

import {
  createThemeRuntimeControl,
  THEME_BUDGET_LOCK_SQL,
  ThemeRuntimeControlError,
} from './theme-runtime-control';

function harness(options: { missing?: boolean } = {}) {
  let enabled = false;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql === THEME_BUDGET_LOCK_SQL)
      return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT enabled'))
      return options.missing
        ? { rows: [], rowCount: 0 }
        : {
            rows: [{ enabled }],
            rowCount: 1,
          };
    if (sql.startsWith('UPDATE theme_runtime_control')) {
      if (options.missing) return { rows: [], rowCount: 0 };
      enabled = Boolean(params[1]);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unhandled SQL: ${sql}`);
  });
  const client = { query, release: vi.fn() };
  const pool = { query, connect: vi.fn(async () => client) };
  return { control: createThemeRuntimeControl(pool as never), query };
}

describe('theme runtime control', () => {
  it('serializes changes with budget admission', async () => {
    const h = harness();
    expect(await h.control.read()).toEqual({ enabled: false });
    await h.control.set(true);
    expect(await h.control.read()).toEqual({ enabled: true });
    expect(h.query).toHaveBeenCalledWith(THEME_BUDGET_LOCK_SQL);
  });

  it('fails closed when the singleton row is missing', async () => {
    const h = harness({ missing: true });
    await expect(h.control.read()).rejects.toBeInstanceOf(ThemeRuntimeControlError);
    await expect(h.control.set(false)).rejects.toMatchObject({ code: 'runtime_disabled' });
  });
});
