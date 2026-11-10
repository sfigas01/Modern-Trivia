import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { hashThemeSourceRegistry } from './theme-source-registry';
import {
  createThemeLiveRuntimePlanWithProposalSlots,
  hashThemeRuntimePlan,
} from './theme-runtime-plan';
import {
  buildWikipediaDiscoveryRequestUrl,
  createWikipediaDiscoveryPolicy,
  createWikipediaSourceRegistry,
} from './theme-wikipedia-discovery';
import {
  createThemeE1PreviewPipelineBuilder,
  createThemeE1RepositoryConfig,
  loadThemeE1RequiredThemed,
  selectThemeE1ProposalPassages,
} from './theme-e1-preview-pipeline';
import { THEME_E1_BUNDLE_VERSION } from './theme-e1-provider-bundle';

const budgetFingerprint = 'c'.repeat(64);
const sourceRegistry = createWikipediaSourceRegistry('wikipedia-source-v1');
const sourceRegistryHash = hashThemeSourceRegistry(sourceRegistry);
const discoveryPolicy = createWikipediaDiscoveryPolicy({
  discoveryPolicyVersion: 'wikipedia-discovery-v1',
  sourcePolicyVersion: sourceRegistry.sourcePolicyVersion,
  sourceRegistryHash,
  maximumResults: 1,
  minimumResults: 1,
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
    allowedSourceClasses: ['secondary_reputable', 'primary_official'],
    atLeastOneFromSourceClasses: ['primary_official'],
    minimumIndependentOriginGroups: 2,
  },
  superlative: {
    allowedSourceClasses: ['secondary_reputable', 'primary_record'],
    atLeastOneFromSourceClasses: ['primary_record'],
    minimumIndependentOriginGroups: 2,
  },
  disputed: {
    allowedSourceClasses: ['secondary_reputable', 'secondary_authoritative'],
    atLeastOneFromSourceClasses: ['secondary_authoritative'],
    minimumIndependentOriginGroups: 2,
  },
} as const;
const normalizedTheme = 'World Baseball Classic';
const plan = createThemeLiveRuntimePlanWithProposalSlots({
  discovery: {
    contractVersion: 'theme-wikipedia-discovery-v1',
    normalizedTheme,
    requestUrl: buildWikipediaDiscoveryRequestUrl(normalizedTheme, discoveryPolicy).href,
    discoveryPolicy,
    sources: [
      {
        pageId: 10,
        rank: 1,
        title: 'World Baseball Classic',
        language: 'en',
        canonicalUrl: 'https://en.wikipedia.org/wiki/World_Baseball_Classic',
      },
    ],
  },
  claimEvidencePolicy,
  budgetPolicyFingerprint: budgetFingerprint,
  totalSlots: 2,
  maximumSlotsPerSource: 2,
});
const holdUntil = new Date('2026-11-09T00:00:00.000Z');
const planVersion = THEME_E1_BUNDLE_VERSION;
const planHash = hashThemeRuntimePlan({ planVersion, plan, holdUntil });

describe('E1 plan-bound pipeline composition', () => {
  it('builds repositories and the complete pipeline from the stored v2 plan without provider work', () => {
    const responseCreate = vi.fn();
    const embeddingCreate = vi.fn();
    const repositories = createThemeE1RepositoryConfig(plan);
    const builder = createThemeE1PreviewPipelineBuilder({
      pool: { query: vi.fn() } as unknown as Pool,
      expectedBudgetPolicyFingerprint: budgetFingerprint,
    });
    const pipeline = builder({
      jobId: '11111111-1111-4111-8111-111111111111',
      loadedPlan: { planVersion, plan, holdUntil, planHash },
      context: {
        repositories: {} as never,
        dispatchProvider: vi.fn(),
        persistSemanticBatch: vi.fn(),
      },
      transports: {
        responses: { create: responseCreate },
        embeddings: { create: embeddingCreate },
      } as never,
    });

    expect(repositories.factReview.reviewer).toMatchObject({
      provider: 'openai',
      model: 'gpt-6.1-sol',
    });
    expect(repositories.questionGeneration.writer).toMatchObject({
      provider: 'openai',
      model: 'gpt-6-luna',
    });
    expect(pipeline).toMatchObject({
      preflight: expect.any(Function),
      retrieve: expect.any(Function),
      approve: expect.any(Function),
      repair: expect.any(Function),
    });
    expect(responseCreate).not.toHaveBeenCalled();
    expect(embeddingCreate).not.toHaveBeenCalled();
  });

  it('rejects a stored plan pinned to a different budget policy', () => {
    const builder = createThemeE1PreviewPipelineBuilder({
      pool: { query: vi.fn() } as unknown as Pool,
      expectedBudgetPolicyFingerprint: 'd'.repeat(64),
    });
    expect(() =>
      builder({
        jobId: '11111111-1111-4111-8111-111111111111',
        loadedPlan: { planVersion, plan, holdUntil, planHash },
        context: {} as never,
        transports: {} as never,
      })
    ).toThrow('theme_e1_budget_policy_mismatch');
  });

  it('rejects a stored plan not pinned to the exact provider bundle', () => {
    const builder = createThemeE1PreviewPipelineBuilder({
      pool: { query: vi.fn() } as unknown as Pool,
      expectedBudgetPolicyFingerprint: budgetFingerprint,
    });
    expect(() =>
      builder({
        jobId: '11111111-1111-4111-8111-111111111111',
        loadedPlan: { planVersion: 'different-bundle', plan, holdUntil, planHash },
        context: {} as never,
        transports: {} as never,
      })
    ).toThrow('theme_e1_bundle_mismatch');
  });

  it('loads the durable themed target while retaining every proposal slot as replacement work', async () => {
    const query = vi.fn(async () => ({ rows: [{ required_themed: 1 }] }));
    const allocate = vi.fn(async () => ({ replay: false, allocated: 2 }));
    const pool = { query } as unknown as Pool;
    const builder = createThemeE1PreviewPipelineBuilder({
      pool,
      expectedBudgetPolicyFingerprint: budgetFingerprint,
    });
    const pipeline = builder({
      jobId: '11111111-1111-4111-8111-111111111111',
      loadedPlan: { planVersion, plan, holdUntil, planHash },
      context: {
        repositories: { proposalSlots: { allocate } } as never,
        dispatchProvider: vi.fn(),
        persistSemanticBatch: vi.fn(),
      },
      transports: {
        responses: { create: vi.fn() },
        embeddings: { create: vi.fn() },
      } as never,
    });

    await expect(
      pipeline.preflight({
        id: '11111111-1111-4111-8111-111111111111',
        candidateCeiling: 2,
      } as never)
    ).resolves.toEqual({
      ok: true,
      requiredThemed: 1,
      work: [{ key: 'proposal:001' }, { key: 'proposal:002' }],
    });
    await expect(loadThemeE1RequiredThemed(pool, 'job-id')).resolves.toBe(1);
    expect(allocate).toHaveBeenCalledOnce();
  });

  it('partitions a bounded passage set deterministically across source slots', () => {
    const passages = Array.from({ length: 30 }, (_, index) => ({
      passageId: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
      text: `Passage ${index}`,
      contentHash: String(index).padStart(64, 'a').slice(-64),
    }));
    const first = selectThemeE1ProposalPassages(
      plan,
      { key: 'proposal:001', sourceKey: 'wikipedia:10' } as never,
      passages
    );
    const second = selectThemeE1ProposalPassages(
      plan,
      { key: 'proposal:002', sourceKey: 'wikipedia:10' } as never,
      passages
    );

    expect(first).toHaveLength(12);
    expect(second).toHaveLength(12);
    expect(first.map(({ text }) => text)).toEqual(
      Array.from({ length: 12 }, (_, index) => `Passage ${index * 2}`)
    );
    expect(second.map(({ text }) => text)).toEqual(
      Array.from({ length: 12 }, (_, index) => `Passage ${index * 2 + 1}`)
    );
  });
});
