import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  bootstrapThemeE1ApplicationRuntime,
  readThemeE1ApiKey,
} from './theme-e1-application-runtime';

const enabledPreview = {
  RAILWAY_ENVIRONMENT_NAME: 'preview',
  THEME_PREVIEW_SCHEDULER_ENABLED: 'true',
  THEME_PREVIEW_SCHEDULER_INTERVAL_MS: '60000',
  THEME_PREVIEW_SCHEDULER_QUEUE_LIMIT: '4',
  THEME_PREVIEW_SCHEDULER_SCAN_LIMIT: '4',
  THEME_PREVIEW_WORKER_LEASE_MS: '600000',
  THEME_PREVIEW_MAX_CALLBACK_MS: '540000',
  VITE_THEME_ROUNDS: 'true',
  THEME_LIVE_GENERATION: 'true',
  THEME_BUDGET_CURRENCY: 'USD',
  THEME_BUDGET_POLICY_VERSION: 'e1-preview-v1',
  THEME_ACCOUNT_DAILY_BUDGET_MICROS: '1000000',
  THEME_ACCOUNT_ROLLING_7D_BUDGET_MICROS: '2000000',
  THEME_GLOBAL_DAILY_BUDGET_MICROS: '3000000',
} satisfies NodeJS.ProcessEnv;

function guardedEnv(values: NodeJS.ProcessEnv) {
  let e1CredentialReads = 0;
  let existingCredentialReads = 0;
  const env = new Proxy(values, {
    get(target, property) {
      if (property === 'THEME_E1_OPENAI_API_KEY') e1CredentialReads += 1;
      if (property === 'AI_INTEGRATIONS_OPENAI_API_KEY') existingCredentialReads += 1;
      return Reflect.get(target, property);
    },
  });
  return {
    env,
    e1CredentialReads: () => e1CredentialReads,
    existingCredentialReads: () => existingCredentialReads,
  };
}

describe('E1 application runtime', () => {
  it('uses only the dedicated E1 credential and fails closed without it', () => {
    const guarded = guardedEnv({
      THEME_E1_OPENAI_API_KEY: ' dedicated-preview-key ',
      AI_INTEGRATIONS_OPENAI_API_KEY: 'existing-generation-key',
    });
    expect(readThemeE1ApiKey(guarded.env)).toBe('dedicated-preview-key');
    expect(guarded.e1CredentialReads()).toBe(1);
    expect(guarded.existingCredentialReads()).toBe(0);
    expect(() =>
      readThemeE1ApiKey({ AI_INTEGRATIONS_OPENAI_API_KEY: 'existing-generation-key' })
    ).toThrow('theme_e1_api_key_missing');
  });

  it('is inert in production without reading a credential or querying runtime control', async () => {
    const guarded = guardedEnv({ ...enabledPreview, RAILWAY_ENVIRONMENT_NAME: 'production' });
    const query = vi.fn();
    const result = await bootstrapThemeE1ApplicationRuntime({
      pool: { query } as unknown as Pool,
      env: guarded.env,
    });

    expect(result).toEqual({ started: false, code: 'scheduler_disabled' });
    expect(query).not.toHaveBeenCalled();
    expect(guarded.e1CredentialReads()).toBe(0);
    expect(guarded.existingCredentialReads()).toBe(0);
  });

  it('stops at the durable control gate without reading a credential', async () => {
    const guarded = guardedEnv({ ...enabledPreview });
    const query = vi.fn(async () => ({ rows: [{ enabled: false }], rowCount: 1 }));
    const result = await bootstrapThemeE1ApplicationRuntime({
      pool: { query } as unknown as Pool,
      env: guarded.env,
    });

    expect(result).toEqual({ started: false, code: 'runtime_control_disabled' });
    expect(query).toHaveBeenCalledOnce();
    expect(guarded.e1CredentialReads()).toBe(0);
    expect(guarded.existingCredentialReads()).toBe(0);
  });

  it('starts and stops an empty preview queue without requiring a credential', async () => {
    const guarded = guardedEnv({ ...enabledPreview });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM theme_runtime_control'))
        return { rows: [{ enabled: true }], rowCount: 1 };
      if (sql.includes('FROM theme_preparation_jobs')) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected query: ${sql}`);
    });
    const result = await bootstrapThemeE1ApplicationRuntime({
      pool: { query } as unknown as Pool,
      env: guarded.env,
    });

    expect(result.started).toBe(true);
    if (result.started) await result.stop();
    expect(guarded.e1CredentialReads()).toBe(0);
    expect(guarded.existingCredentialReads()).toBe(0);
  });
});
