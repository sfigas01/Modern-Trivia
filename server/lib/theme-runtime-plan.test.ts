import { describe, expect, it, vi } from 'vitest';

import {
  createThemeRuntimePlanRepository,
  hashThemeRuntimePlan,
  type ThemePreviewRuntimePlan,
} from './theme-runtime-plan';

const holdUntil = new Date('2026-10-14T03:00:00.000Z');
const plan: ThemePreviewRuntimePlan = {
  contractVersion: 'theme-preview-runtime-plan-v1',
  mode: 'offline_fixture',
  fixtureVersion: 'fixture-v1',
  sourcePolicyVersion: 'source-v1',
  budgetPolicyFingerprint: 'a'.repeat(64),
  items: [
    {
      key: 'baseball-1',
      ordinal: 1,
      requestedUrl: 'https://example.org/baseball',
      title: 'Baseball fixture',
      language: 'en',
      canonicalFactKey: 'baseball:first-final-location',
      expectedLatestFactRevision: 0,
    },
  ],
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    plan_version: 'preview-v1',
    plan_hash: hashThemeRuntimePlan({ planVersion: 'preview-v1', plan, holdUntil }),
    plan_json: plan,
    plan_hold_until: holdUntil,
    ...overrides,
  };
}

describe('theme runtime plan repository', () => {
  it('populates a plan once and replays the exact identity', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [row()], rowCount: 1 });
    const repository = createThemeRuntimePlanRepository({ query } as never);
    await expect(
      repository.attach('job', { planVersion: 'preview-v1', plan, holdUntil })
    ).resolves.toMatchObject({ replay: false });
    await expect(
      repository.attach('job', { planVersion: 'preview-v1', plan, holdUntil })
    ).resolves.toMatchObject({ replay: true });
  });

  it('rejects a changed replay and a corrupted stored hash', async () => {
    const changed = { ...plan, fixtureVersion: 'fixture-v2' };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [row()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [row({ plan_hash: 'b'.repeat(64) })], rowCount: 1 });
    const repository = createThemeRuntimePlanRepository({ query } as never);
    await expect(
      repository.attach('job', { planVersion: 'preview-v1', plan: changed, holdUntil })
    ).rejects.toMatchObject({ code: 'plan_conflict' });
    await expect(repository.load('job')).rejects.toMatchObject({ code: 'plan_conflict' });
  });

  it('rejects missing, network, and duplicate-item plans before writing', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repository = createThemeRuntimePlanRepository({ query } as never);
    await expect(repository.load('missing')).rejects.toMatchObject({ code: 'plan_missing' });
    expect(query).toHaveBeenCalledOnce();
    query.mockClear();
    await expect(
      repository.attach('job', {
        planVersion: 'preview-v1',
        plan: {
          ...plan,
          items: [{ ...plan.items[0], requestedUrl: 'http://example.org/baseball' }],
        },
        holdUntil,
      })
    ).rejects.toMatchObject({ code: 'invalid_plan' });
    expect(query).not.toHaveBeenCalled();
  });
});
