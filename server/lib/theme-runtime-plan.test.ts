import { describe, expect, it, vi } from 'vitest';

import {
  createThemeLiveRuntimePlan,
  createThemeLiveRuntimePlanWithProposalSlots,
  createThemeRuntimePlanRepository,
  hashThemeRuntimePlan,
  themeLiveRuntimePlanSchema,
  type ThemePreviewRuntimePlan,
} from './theme-runtime-plan';
import {
  buildWikipediaDiscoveryRequestUrl,
  createWikipediaDiscoveryPolicy,
  createWikipediaSourceRegistry,
} from './theme-wikipedia-discovery';
import { hashThemeSourceRegistry } from './theme-source-registry';

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

const sourceRegistry = createWikipediaSourceRegistry('wikipedia-source-v1');
const sourceRegistryHash = hashThemeSourceRegistry(sourceRegistry);
const discoveryPolicy = createWikipediaDiscoveryPolicy({
  discoveryPolicyVersion: 'wikipedia-discovery-v1',
  sourcePolicyVersion: sourceRegistry.sourcePolicyVersion,
  sourceRegistryHash,
  maximumResults: 2,
  minimumResults: 2,
});
const claimEvidencePolicy = {
  contractVersion: 'theme-claim-evidence-policy-v1',
  policyVersion: 'claim-evidence-v1',
  stable: {
    allowedSourceClasses: ['secondary_reputable'],
    atLeastOneFromSourceClasses: [],
    minimumIndependentOriginGroups: 1,
  },
  timeSensitive: {
    allowedSourceClasses: ['secondary_reputable', 'primary_official', 'secondary_authoritative'],
    atLeastOneFromSourceClasses: ['primary_official', 'secondary_authoritative'],
    minimumIndependentOriginGroups: 2,
  },
  superlative: {
    allowedSourceClasses: ['secondary_reputable', 'primary_record', 'secondary_authoritative'],
    atLeastOneFromSourceClasses: ['primary_record', 'secondary_authoritative'],
    minimumIndependentOriginGroups: 2,
  },
  disputed: {
    allowedSourceClasses: ['secondary_reputable', 'primary_record', 'secondary_authoritative'],
    atLeastOneFromSourceClasses: ['primary_record', 'secondary_authoritative'],
    minimumIndependentOriginGroups: 2,
  },
} as const;
const livePlan = createThemeLiveRuntimePlan({
  discovery: {
    contractVersion: 'theme-wikipedia-discovery-v1',
    normalizedTheme: 'World Baseball Classic',
    requestUrl: buildWikipediaDiscoveryRequestUrl('World Baseball Classic', discoveryPolicy).href,
    discoveryPolicy,
    sources: [
      {
        pageId: 10,
        rank: 1,
        title: '2006 World Baseball Classic',
        language: 'en',
        canonicalUrl: 'https://en.wikipedia.org/wiki/2006_World_Baseball_Classic',
      },
      {
        pageId: 20,
        rank: 2,
        title: 'World Baseball Classic',
        language: 'en',
        canonicalUrl: 'https://en.wikipedia.org/wiki/World_Baseball_Classic',
      },
    ],
  },
  claimEvidencePolicy,
  budgetPolicyFingerprint: 'c'.repeat(64),
});
const slottedLivePlan = createThemeLiveRuntimePlanWithProposalSlots({
  discovery: {
    contractVersion: 'theme-wikipedia-discovery-v1',
    normalizedTheme: 'World Baseball Classic',
    requestUrl: buildWikipediaDiscoveryRequestUrl('World Baseball Classic', discoveryPolicy).href,
    discoveryPolicy,
    sources: livePlan.sources.map(({ key: _key, ordinal: _ordinal, ...source }) => source),
  },
  claimEvidencePolicy,
  budgetPolicyFingerprint: 'c'.repeat(64),
  totalSlots: 4,
  maximumSlotsPerSource: 2,
});

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

  it('rejects a fact revision that downstream derivation cannot represent', async () => {
    const query = vi.fn();
    const repository = createThemeRuntimePlanRepository({ query } as never);
    await expect(
      repository.attach('job', {
        planVersion: 'preview-v1',
        plan: {
          ...plan,
          items: [{ ...plan.items[0], expectedLatestFactRevision: 2_147_483_647 }],
        },
        holdUntil,
      })
    ).rejects.toMatchObject({ code: 'invalid_plan' });
    expect(query).not.toHaveBeenCalled();
  });

  it('builds a strict live plan without pretending article identities are fact identities', () => {
    expect(livePlan).toMatchObject({
      contractVersion: 'theme-live-runtime-plan-v1',
      mode: 'wikipedia_discovery',
      normalizedTheme: 'World Baseball Classic',
      sourcePolicyVersion: 'wikipedia-source-v1',
      sourceRegistryHash,
      sources: [
        { key: 'wikipedia:10', ordinal: 1, pageId: 10 },
        { key: 'wikipedia:20', ordinal: 2, pageId: 20 },
      ],
    });
    expect('canonicalFactKey' in livePlan.sources[0]).toBe(false);
  });

  it('pins bounded proposal slots in deterministic round-robin order', () => {
    expect(slottedLivePlan).toMatchObject({
      contractVersion: 'theme-live-runtime-plan-v2',
      proposalSlotPolicy: {
        allocationVersion: 'theme-proposal-slot-round-robin-v1',
        totalSlots: 4,
        maximumSlotsPerSource: 2,
      },
      proposalSlots: [
        { key: 'proposal:001', ordinal: 1, sourceKey: 'wikipedia:10' },
        { key: 'proposal:002', ordinal: 2, sourceKey: 'wikipedia:20' },
        { key: 'proposal:003', ordinal: 3, sourceKey: 'wikipedia:10' },
        { key: 'proposal:004', ordinal: 4, sourceKey: 'wikipedia:20' },
      ],
    });
    expect(() =>
      createThemeLiveRuntimePlanWithProposalSlots({
        discovery: {
          contractVersion: 'theme-wikipedia-discovery-v1',
          normalizedTheme: slottedLivePlan.normalizedTheme,
          requestUrl: slottedLivePlan.discoveryRequestUrl,
          discoveryPolicy: slottedLivePlan.discoveryPolicy,
          sources: slottedLivePlan.sources.map(
            ({ key: _key, ordinal: _ordinal, ...source }) => source
          ),
        },
        claimEvidencePolicy,
        budgetPolicyFingerprint: 'c'.repeat(64),
        totalSlots: 5,
        maximumSlotsPerSource: 2,
      })
    ).toThrow();
    expect(() =>
      createThemeLiveRuntimePlanWithProposalSlots({
        discovery: {
          contractVersion: 'theme-wikipedia-discovery-v1',
          normalizedTheme: slottedLivePlan.normalizedTheme,
          requestUrl: slottedLivePlan.discoveryRequestUrl,
          discoveryPolicy: slottedLivePlan.discoveryPolicy,
          sources: slottedLivePlan.sources.map(
            ({ key: _key, ordinal: _ordinal, ...source }) => source
          ),
        },
        claimEvidencePolicy,
        budgetPolicyFingerprint: 'c'.repeat(64),
        totalSlots: Number.MAX_SAFE_INTEGER,
        maximumSlotsPerSource: 2,
      })
    ).toThrow();
  });

  it('rejects changed registry identity, unnormalized themes, and reordered live sources', () => {
    expect(
      themeLiveRuntimePlanSchema.safeParse({
        ...livePlan,
        sourceRegistryHash: 'd'.repeat(64),
      }).success
    ).toBe(false);
    expect(
      themeLiveRuntimePlanSchema.safeParse({
        ...livePlan,
        normalizedTheme: '  World  Baseball Classic ',
      }).success
    ).toBe(false);
    expect(
      themeLiveRuntimePlanSchema.safeParse({
        ...livePlan,
        sources: [livePlan.sources[1], livePlan.sources[0]],
      }).success
    ).toBe(false);
    expect(
      themeLiveRuntimePlanSchema.safeParse({
        ...livePlan,
        sources: [{ ...livePlan.sources[0], key: 'wikipedia:999' }, livePlan.sources[1]],
      }).success
    ).toBe(false);
  });

  it('binds the live plan to the discovery policy that produced its sources', () => {
    const alternatePolicy = createWikipediaDiscoveryPolicy({
      discoveryPolicyVersion: 'alternate-discovery-v1',
      sourcePolicyVersion: 'alternate-source-v1',
      sourceRegistryHash: 'd'.repeat(64),
      maximumResults: 2,
      minimumResults: 2,
    });
    const result = createThemeLiveRuntimePlan({
      discovery: {
        contractVersion: 'theme-wikipedia-discovery-v1',
        normalizedTheme: livePlan.normalizedTheme,
        requestUrl: buildWikipediaDiscoveryRequestUrl(livePlan.normalizedTheme, alternatePolicy)
          .href,
        discoveryPolicy: alternatePolicy,
        sources: livePlan.sources.map(({ key: _key, ordinal: _ordinal, ...source }) => source),
      },
      claimEvidencePolicy,
      budgetPolicyFingerprint: 'c'.repeat(64),
    });
    expect(result.discoveryPolicy).toEqual(alternatePolicy);
    expect(result.sourceRegistryHash).toBe(alternatePolicy.sourceRegistryHash);
  });

  it('attaches a live selection once and rejects changed selection replay', async () => {
    const liveRow = {
      plan_version: 'live-v1',
      plan_hash: hashThemeRuntimePlan({ planVersion: 'live-v1', plan: livePlan, holdUntil }),
      plan_json: livePlan,
      plan_hold_until: holdUntil,
    };
    const changed = {
      ...livePlan,
      sources: livePlan.sources.map((source, index) =>
        index === 0 ? { ...source, title: 'Changed title' } : source
      ),
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [liveRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [liveRow], rowCount: 1 });
    const repository = createThemeRuntimePlanRepository({ query } as never);
    await expect(
      repository.attach('job', { planVersion: 'live-v1', plan: livePlan, holdUntil })
    ).resolves.toMatchObject({ replay: false });
    await expect(
      repository.attach('job', { planVersion: 'live-v1', plan: changed, holdUntil })
    ).rejects.toMatchObject({ code: 'plan_conflict' });
  });
});
