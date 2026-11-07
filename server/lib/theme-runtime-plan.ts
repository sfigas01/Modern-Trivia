import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';

import {
  themeClaimEvidencePolicySchema,
  type ThemeClaimEvidencePolicy,
} from '@shared/models/theme-source-policy';

import {
  buildWikipediaDiscoveryRequestUrl,
  normalizeWikipediaTheme,
  wikipediaDiscoveredSourceSchema,
  wikipediaDiscoveryPolicySchema,
  type WikipediaDiscoveryPolicy,
  type WikipediaDiscoveryResult,
} from './theme-wikipedia-discovery';

const sourceItemSchema = z
  .object({
    key: z.string().trim().min(1).max(255),
    ordinal: z.number().int().positive().max(100),
    requestedUrl: z
      .string()
      .url()
      .refine((value) => value.startsWith('https://')),
    title: z.string().trim().min(1).max(500),
    language: z.string().trim().min(2).max(35),
    canonicalFactKey: z.string().trim().min(1).max(255),
    expectedLatestFactRevision: z.number().int().min(0).max(2_147_483_646),
  })
  .strict();

export const themePreviewRuntimePlanSchema = z
  .object({
    contractVersion: z.literal('theme-preview-runtime-plan-v1'),
    mode: z.literal('offline_fixture'),
    fixtureVersion: z.string().trim().min(1).max(64),
    sourcePolicyVersion: z.string().trim().min(1).max(255),
    budgetPolicyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    items: z.array(sourceItemSchema).min(1).max(100),
  })
  .strict()
  .superRefine((plan, context) => {
    if (new Set(plan.items.map((item) => item.key)).size !== plan.items.length)
      context.addIssue({ code: 'custom', path: ['items'], message: 'Item keys must be unique' });
    if (new Set(plan.items.map((item) => item.ordinal)).size !== plan.items.length)
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Item ordinals must be unique',
      });
  });

export type ThemePreviewRuntimePlan = z.infer<typeof themePreviewRuntimePlanSchema>;

const liveSourceSchema = wikipediaDiscoveredSourceSchema.extend({
  key: z.string().trim().min(1).max(255),
  ordinal: z.number().int().positive().max(20),
});

export const themeProposalSlotPolicySchema = z
  .object({
    contractVersion: z.literal('theme-proposal-slot-policy-v1'),
    allocationVersion: z.literal('theme-proposal-slot-round-robin-v1'),
    totalSlots: z.number().int().min(1).max(100),
    maximumSlotsPerSource: z.number().int().min(1).max(20),
  })
  .strict();

const proposalSlotSchema = z
  .object({
    key: z.string().regex(/^proposal:[0-9]{3}$/),
    ordinal: z.number().int().positive().max(100),
    sourceKey: z.string().trim().min(1).max(255),
  })
  .strict();

export const themeLiveRuntimePlanSchema = z
  .object({
    contractVersion: z.literal('theme-live-runtime-plan-v1'),
    mode: z.literal('wikipedia_discovery'),
    normalizedTheme: z.string().trim().min(1).max(160),
    discoveryRequestUrl: z.string().url().max(4096),
    sourcePolicyVersion: z.string().trim().min(1).max(255),
    sourceRegistryHash: z.string().regex(/^[a-f0-9]{64}$/),
    discoveryPolicy: wikipediaDiscoveryPolicySchema,
    claimEvidencePolicy: themeClaimEvidencePolicySchema,
    budgetPolicyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    sources: z.array(liveSourceSchema).min(1).max(20),
  })
  .strict()
  .superRefine((plan, context) => {
    if (normalizeWikipediaTheme(plan.normalizedTheme) !== plan.normalizedTheme)
      context.addIssue({
        code: 'custom',
        path: ['normalizedTheme'],
        message: 'Theme must already be normalized',
      });
    if (
      plan.discoveryRequestUrl !==
      buildWikipediaDiscoveryRequestUrl(plan.normalizedTheme, plan.discoveryPolicy).href
    )
      context.addIssue({
        code: 'custom',
        path: ['discoveryRequestUrl'],
        message: 'Discovery request must match the pinned theme and policy',
      });
    if (
      plan.sourcePolicyVersion !== plan.discoveryPolicy.sourcePolicyVersion ||
      plan.sourceRegistryHash !== plan.discoveryPolicy.sourceRegistryHash
    )
      context.addIssue({
        code: 'custom',
        path: ['discoveryPolicy'],
        message: 'Discovery policy must use the pinned source registry',
      });
    if (
      plan.sources.length < plan.discoveryPolicy.minimumResults ||
      plan.sources.length > plan.discoveryPolicy.maximumResults
    )
      context.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'Selected sources violate discovery result bounds',
      });
    for (let index = 0; index < plan.sources.length; index++)
      if (plan.sources[index].ordinal !== index + 1)
        context.addIssue({
          code: 'custom',
          path: ['sources', index, 'ordinal'],
          message: 'Selected source ordinals must be contiguous and ordered',
        });
      else if (plan.sources[index].key !== `wikipedia:${plan.sources[index].pageId}`)
        context.addIssue({
          code: 'custom',
          path: ['sources', index, 'key'],
          message: 'Selected source key must match its Wikipedia page ID',
        });
    for (let index = 1; index < plan.sources.length; index++) {
      const previous = plan.sources[index - 1];
      const current = plan.sources[index];
      if (
        previous.rank > current.rank ||
        (previous.rank === current.rank && previous.pageId > current.pageId) ||
        (previous.rank === current.rank &&
          previous.pageId === current.pageId &&
          previous.canonicalUrl.localeCompare(current.canonicalUrl) > 0)
      )
        context.addIssue({
          code: 'custom',
          path: ['sources', index],
          message: 'Selected sources must preserve deterministic discovery order',
        });
    }
    for (const field of ['key', 'pageId', 'canonicalUrl'] as const)
      if (new Set(plan.sources.map((source) => source[field])).size !== plan.sources.length)
        context.addIssue({
          code: 'custom',
          path: ['sources'],
          message: `Selected source ${field} values must be unique`,
        });
  });

export const themeLiveRuntimePlanV2Schema = z
  .object({
    contractVersion: z.literal('theme-live-runtime-plan-v2'),
    mode: z.literal('wikipedia_discovery'),
    normalizedTheme: z.string().trim().min(1).max(160),
    discoveryRequestUrl: z.string().url().max(4096),
    sourcePolicyVersion: z.string().trim().min(1).max(255),
    sourceRegistryHash: z.string().regex(/^[a-f0-9]{64}$/),
    discoveryPolicy: wikipediaDiscoveryPolicySchema,
    claimEvidencePolicy: themeClaimEvidencePolicySchema,
    budgetPolicyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    sources: z.array(liveSourceSchema).min(1).max(20),
    proposalSlotPolicy: themeProposalSlotPolicySchema,
    proposalSlots: z.array(proposalSlotSchema).min(1).max(100),
  })
  .strict()
  .superRefine((plan, context) => {
    const base = themeLiveRuntimePlanSchema.safeParse({
      contractVersion: 'theme-live-runtime-plan-v1',
      mode: plan.mode,
      normalizedTheme: plan.normalizedTheme,
      discoveryRequestUrl: plan.discoveryRequestUrl,
      sourcePolicyVersion: plan.sourcePolicyVersion,
      sourceRegistryHash: plan.sourceRegistryHash,
      discoveryPolicy: plan.discoveryPolicy,
      claimEvidencePolicy: plan.claimEvidencePolicy,
      budgetPolicyFingerprint: plan.budgetPolicyFingerprint,
      sources: plan.sources,
    });
    if (!base.success)
      for (const issue of base.error.issues) context.addIssue({ ...issue, path: issue.path });
    if (plan.proposalSlots.length !== plan.proposalSlotPolicy.totalSlots)
      context.addIssue({
        code: 'custom',
        path: ['proposalSlots'],
        message: 'Proposal slot count must match the pinned policy',
      });
    if (
      plan.proposalSlotPolicy.totalSlots >
      plan.sources.length * plan.proposalSlotPolicy.maximumSlotsPerSource
    )
      context.addIssue({
        code: 'custom',
        path: ['proposalSlotPolicy', 'totalSlots'],
        message: 'Proposal slot policy exceeds the pinned source capacity',
      });
    const sourceKeys = new Set(plan.sources.map((source) => source.key));
    const perSource = new Map<string, number>();
    for (let index = 0; index < plan.proposalSlots.length; index++) {
      const slot = plan.proposalSlots[index];
      const expectedSource = plan.sources[index % plan.sources.length]?.key;
      if (
        slot.ordinal !== index + 1 ||
        slot.key !== `proposal:${String(index + 1).padStart(3, '0')}` ||
        slot.sourceKey !== expectedSource
      )
        context.addIssue({
          code: 'custom',
          path: ['proposalSlots', index],
          message: 'Proposal slots must use deterministic contiguous round-robin allocation',
        });
      if (!sourceKeys.has(slot.sourceKey))
        context.addIssue({
          code: 'custom',
          path: ['proposalSlots', index, 'sourceKey'],
          message: 'Proposal slot must reference a pinned source',
        });
      perSource.set(slot.sourceKey, (perSource.get(slot.sourceKey) ?? 0) + 1);
    }
    if (
      Array.from(perSource.values()).some(
        (count) => count > plan.proposalSlotPolicy.maximumSlotsPerSource
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['proposalSlots'],
        message: 'Proposal slots exceed the per-source policy bound',
      });
  });

export type ThemeLiveRuntimePlan = z.infer<typeof themeLiveRuntimePlanSchema>;
export type ThemeLiveRuntimePlanV2 = z.infer<typeof themeLiveRuntimePlanV2Schema>;
export const themeRuntimePlanSchema = z.union([
  themePreviewRuntimePlanSchema,
  themeLiveRuntimePlanSchema,
  themeLiveRuntimePlanV2Schema,
]);
export type ThemeRuntimePlan = z.infer<typeof themeRuntimePlanSchema>;

export function createThemeLiveRuntimePlan(input: {
  discovery: Extract<WikipediaDiscoveryResult, { ok: true }>['value'];
  claimEvidencePolicy: ThemeClaimEvidencePolicy;
  budgetPolicyFingerprint: string;
}): ThemeLiveRuntimePlan {
  const discoveryPolicy: WikipediaDiscoveryPolicy = input.discovery.discoveryPolicy;
  return themeLiveRuntimePlanSchema.parse({
    contractVersion: 'theme-live-runtime-plan-v1',
    mode: 'wikipedia_discovery',
    normalizedTheme: input.discovery.normalizedTheme,
    discoveryRequestUrl: input.discovery.requestUrl,
    sourcePolicyVersion: discoveryPolicy.sourcePolicyVersion,
    sourceRegistryHash: discoveryPolicy.sourceRegistryHash,
    discoveryPolicy,
    claimEvidencePolicy: input.claimEvidencePolicy,
    budgetPolicyFingerprint: input.budgetPolicyFingerprint,
    sources: input.discovery.sources.map((source, index) => ({
      ...source,
      key: `wikipedia:${source.pageId}`,
      ordinal: index + 1,
    })),
  });
}

export function createThemeLiveRuntimePlanWithProposalSlots(input: {
  discovery: Extract<WikipediaDiscoveryResult, { ok: true }>['value'];
  claimEvidencePolicy: ThemeClaimEvidencePolicy;
  budgetPolicyFingerprint: string;
  totalSlots: number;
  maximumSlotsPerSource: number;
}): ThemeLiveRuntimePlanV2 {
  const base = createThemeLiveRuntimePlan(input);
  const proposalSlotPolicy = themeProposalSlotPolicySchema.parse({
    contractVersion: 'theme-proposal-slot-policy-v1',
    allocationVersion: 'theme-proposal-slot-round-robin-v1',
    totalSlots: input.totalSlots,
    maximumSlotsPerSource: input.maximumSlotsPerSource,
  });
  return themeLiveRuntimePlanV2Schema.parse({
    ...base,
    contractVersion: 'theme-live-runtime-plan-v2',
    proposalSlotPolicy,
    proposalSlots: Array.from({ length: proposalSlotPolicy.totalSlots }, (_, index) => ({
      key: `proposal:${String(index + 1).padStart(3, '0')}`,
      ordinal: index + 1,
      sourceKey: base.sources[index % base.sources.length].key,
    })),
  });
}

export class ThemeRuntimePlanError extends Error {
  constructor(
    public readonly code: 'invalid_plan' | 'plan_conflict' | 'plan_missing',
    message: string
  ) {
    super(message);
    this.name = 'ThemeRuntimePlanError';
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function hashThemeRuntimePlan(input: {
  planVersion: string;
  plan: ThemeRuntimePlan;
  holdUntil: Date;
}): string {
  return createHash('sha256')
    .update(
      canonical({
        planVersion: input.planVersion,
        plan: input.plan,
        holdUntil: input.holdUntil.toISOString(),
      })
    )
    .digest('hex');
}

function parse(input: { planVersion: string; plan: unknown; holdUntil: Date }): {
  planVersion: string;
  plan: ThemeRuntimePlan;
  holdUntil: Date;
  planHash: string;
} {
  const planVersion = input.planVersion.trim();
  const parsed = themeRuntimePlanSchema.safeParse(input.plan);
  if (
    !planVersion ||
    planVersion.length > 64 ||
    !parsed.success ||
    !(input.holdUntil instanceof Date) ||
    !Number.isFinite(input.holdUntil.valueOf())
  )
    throw new ThemeRuntimePlanError('invalid_plan', 'Invalid themed runtime plan');
  const value = { planVersion, plan: parsed.data, holdUntil: new Date(input.holdUntil) };
  return { ...value, planHash: hashThemeRuntimePlan(value) };
}

type PlanRow = {
  plan_version: string | null;
  plan_hash: string | null;
  plan_json: unknown;
  plan_hold_until: Date | null;
};

function fromRow(row: PlanRow | undefined) {
  if (!row?.plan_version || !row.plan_hash || !row.plan_hold_until)
    throw new ThemeRuntimePlanError('plan_missing', 'Preparation job has no runtime plan');
  const value = parse({
    planVersion: row.plan_version,
    plan: row.plan_json,
    holdUntil: row.plan_hold_until,
  });
  if (value.planHash !== row.plan_hash)
    throw new ThemeRuntimePlanError('plan_conflict', 'Stored runtime plan hash does not match');
  return value;
}

export function createThemeRuntimePlanRepository(pool: Pool) {
  async function load(jobId: string) {
    const result = await pool.query<PlanRow>(
      `SELECT plan_version,plan_hash,plan_json,plan_hold_until
       FROM theme_preparation_jobs WHERE id=$1`,
      [jobId]
    );
    return fromRow(result.rows[0]);
  }

  return {
    async attach(
      jobId: string,
      input: { planVersion: string; plan: unknown; holdUntil: Date }
    ): Promise<{ replay: boolean; planHash: string }> {
      const value = parse(input);
      const result = await pool.query<PlanRow>(
        `UPDATE theme_preparation_jobs
         SET plan_version=$2,plan_hash=$3,plan_json=$4,plan_hold_until=$5,updated_at=clock_timestamp()
         WHERE id=$1 AND plan_version IS NULL
           AND status IN ('queued','waiting')
         RETURNING plan_version,plan_hash,plan_json,plan_hold_until`,
        [jobId, value.planVersion, value.planHash, value.plan, value.holdUntil]
      );
      if (result.rows[0]) return { replay: false, planHash: value.planHash };
      const existing = await load(jobId);
      if (
        existing.planVersion !== value.planVersion ||
        existing.planHash !== value.planHash ||
        existing.holdUntil.getTime() !== value.holdUntil.getTime()
      )
        throw new ThemeRuntimePlanError(
          'plan_conflict',
          'Preparation job already has a different runtime plan'
        );
      return { replay: true, planHash: value.planHash };
    },

    load,
  };
}
