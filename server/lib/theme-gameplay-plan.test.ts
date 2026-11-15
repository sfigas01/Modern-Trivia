import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  allocateThemeGameplaySlots,
  assertThemeGameplayPlanPolicy,
  createPostgresThemeGameplayPlanner,
  THEME_GAMEPLAY_DISCOVERY_POLICY,
  THEME_GAMEPLAY_PLAN_VERSION,
} from './theme-gameplay-plan';
import { THEME_E1_CLAIM_EVIDENCE_POLICY } from './theme-e1-plan-policy';
import { createThemeLiveRuntimeGameplayPlan } from './theme-runtime-plan';
import { buildWikipediaDiscoveryRequestUrl } from './theme-wikipedia-discovery';

const discovery = {
  contractVersion: 'theme-wikipedia-discovery-v1' as const,
  normalizedTheme: 'Volcanoes',
  requestUrl: buildWikipediaDiscoveryRequestUrl('Volcanoes', THEME_GAMEPLAY_DISCOVERY_POLICY).href,
  discoveryPolicy: THEME_GAMEPLAY_DISCOVERY_POLICY,
  sources: [
    {
      pageId: 1,
      rank: 1,
      title: 'Volcano',
      language: 'en' as const,
      canonicalUrl: 'https://en.wikipedia.org/wiki/Volcano',
    },
    {
      pageId: 2,
      rank: 2,
      title: 'Volcanology',
      language: 'en' as const,
      canonicalUrl: 'https://en.wikipedia.org/wiki/Volcanology',
    },
  ],
};

describe('automatic gameplay plan', () => {
  it.each([
    { themed: 30, related: 10, ceiling: 50, expected: [38, 12] },
    { themed: 45, related: 15, ceiling: 75, expected: [56, 19] },
    { themed: 60, related: 20, ceiling: 100, expected: [75, 25] },
    { themed: 30, related: 0, ceiling: 50, expected: [50, 0] },
  ])('allocates bounded replacement capacity %#', ({ themed, related, ceiling, expected }) => {
    const slots = allocateThemeGameplaySlots({
      requiredThemed: themed,
      requiredRelated: related,
      candidateCeiling: ceiling,
      relatedCategories: ['Science & Nature', 'Geography'],
    });
    expect(slots).toHaveLength(ceiling);
    expect(slots.filter((slot) => slot.role === 'theme')).toHaveLength(expected[0]);
    expect(slots.filter((slot) => slot.role === 'related_backup')).toHaveLength(expected[1]);
    expect(
      slots.filter((slot) => slot.role === 'related_backup').map((slot) => slot.topic)
    ).toEqual(
      Array.from({ length: expected[1] }, (_, index) =>
        index % 2 === 0 ? 'Science & Nature' : 'Geography'
      )
    );
  });

  it('pins every gameplay slot role and topic without changing frozen evaluation plans', () => {
    const slots = allocateThemeGameplaySlots({
      requiredThemed: 30,
      requiredRelated: 10,
      candidateCeiling: 50,
      relatedCategories: ['Science & Nature'],
    }).map((slot) => ({ ...slot, topic: slot.role === 'theme' ? 'Volcanoes' : slot.topic }));
    const plan = createThemeLiveRuntimeGameplayPlan({
      discovery,
      claimEvidencePolicy: THEME_E1_CLAIM_EVIDENCE_POLICY,
      budgetPolicyFingerprint: 'a'.repeat(64),
      slots,
      maximumSlotsPerSource: 25,
    });
    expect(assertThemeGameplayPlanPolicy(plan)).toEqual(plan);
    expect(plan.proposalSlots[0]).toMatchObject({ role: 'theme', topic: 'Volcanoes' });
    expect(plan.proposalSlots.some((slot) => slot.role === 'related_backup')).toBe(true);
  });

  it('discovers once and atomically attaches a replayable gameplay plan', async () => {
    let storedPlan: unknown = null;
    let storedVersion: string | null = null;
    const query = vi.fn(async (sql: string, args: unknown[] = []) => {
      if (sql.includes('SELECT job.id AS job_id'))
        return {
          rows: [
            {
              job_id: 'job-1',
              game_id: 'game-1',
              room_id: 'room-1',
              job_status: 'waiting',
              game_status: 'waiting',
              room_status: 'lobby',
              room_phase: 'LOBBY',
              theme: 'Volcanoes',
              related_categories: ['Science & Nature'],
              candidate_ceiling: 50,
              candidates_used: 0,
              themed_target: 30,
              related_target: 10,
              related_ready: 0,
              plan_version: storedVersion,
              lease_owner: null,
              game_expires_at: new Date('2026-11-15T14:00:00Z'),
              room_expires_at: new Date('2026-11-15T14:00:00Z'),
            },
          ],
          rowCount: 1,
        };
      if (sql.startsWith('INSERT INTO theme_source_registry_versions'))
        return {
          rows: [
            {
              source_policy_version: args[0],
              contract_version: args[1],
              manifest: JSON.parse(String(args[2])),
              manifest_hash: args[3],
              created_at: new Date('2026-11-15T13:00:00Z'),
            },
          ],
          rowCount: 1,
        };
      if (sql.startsWith('UPDATE theme_preparation_jobs')) {
        storedVersion = String(args[1]);
        storedPlan = args[3];
        return {
          rows: [
            {
              plan_version: args[1],
              plan_hash: args[2],
              plan_json: args[3],
              plan_hold_until: args[4],
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith('UPDATE rooms') || sql.startsWith('UPDATE theme_game_sessions'))
        return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn() };
    const pool = { query, connect: vi.fn(async () => client) } as unknown as Pool;
    const planner = createPostgresThemeGameplayPlanner(pool, {
      budgetPolicyFingerprint: 'a'.repeat(64),
      discover: vi.fn(async () => ({ ok: true as const, value: discovery })),
      now: () => new Date('2026-11-15T13:00:00Z'),
    });

    await expect(planner.prepare('job-1')).resolves.toMatchObject({
      replay: false,
      themedSlots: 38,
      relatedSlots: 12,
    });
    expect(storedVersion).toBe(THEME_GAMEPLAY_PLAN_VERSION);
    expect(assertThemeGameplayPlanPolicy(storedPlan).proposalSlots).toHaveLength(50);
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE rooms'))).toBe(true);
    expect(
      query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE theme_game_sessions'))
    ).toBe(true);
  });
});
