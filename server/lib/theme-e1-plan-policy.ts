import { themeClaimEvidencePolicySchema } from '@shared/models/theme-source-policy';

import { hashThemeSourceRegistry } from './theme-source-registry';
import { themeLiveRuntimePlanV2Schema, type ThemeLiveRuntimePlanV2 } from './theme-runtime-plan';
import {
  createWikipediaDiscoveryPolicy,
  createWikipediaSourceRegistry,
} from './theme-wikipedia-discovery';

export const THEME_E1_SOURCE_POLICY_VERSION = 'theme-e1-wikipedia-source-2026-11-08-v1' as const;
export const THEME_E1_DISCOVERY_POLICY_VERSION =
  'theme-e1-wikipedia-discovery-2026-11-08-v1' as const;
export const THEME_E1_CLAIM_POLICY_VERSION = 'theme-e1-claim-evidence-2026-11-08-v1' as const;
export const THEME_E1_SLOTS_PER_JOB = 4 as const;
export const THEME_E1_JOB_COUNT = 3 as const;
export const THEME_E1_TOTAL_SLOTS = THEME_E1_SLOTS_PER_JOB * THEME_E1_JOB_COUNT;
/** Independently calculated upper bound for any one pipeline callback. */
export const THEME_E1_MAX_PIPELINE_CALLBACK_MS = 540_000;
/** Research, retrieve, extract, generate, review, approve, repair and reapprove. */
export const THEME_E1_MAX_CALLBACKS_PER_SLOT = 8 as const;
export const THEME_E1_OPERATOR_MARGIN_MS = 8 * 60 * 1000;
/** Three serial jobs x four slots x eight callbacks, plus operator margin. */
export const THEME_E1_MINIMUM_HOLD_MS =
  THEME_E1_JOB_COUNT *
    THEME_E1_SLOTS_PER_JOB *
    THEME_E1_MAX_CALLBACKS_PER_SLOT *
    THEME_E1_MAX_PIPELINE_CALLBACK_MS +
  THEME_E1_OPERATOR_MARGIN_MS;

export const THEME_E1_SOURCE_REGISTRY = createWikipediaSourceRegistry(
  THEME_E1_SOURCE_POLICY_VERSION
);
export const THEME_E1_SOURCE_REGISTRY_HASH = hashThemeSourceRegistry(THEME_E1_SOURCE_REGISTRY);
export const THEME_E1_DISCOVERY_POLICY = createWikipediaDiscoveryPolicy({
  discoveryPolicyVersion: THEME_E1_DISCOVERY_POLICY_VERSION,
  sourcePolicyVersion: THEME_E1_SOURCE_POLICY_VERSION,
  sourceRegistryHash: THEME_E1_SOURCE_REGISTRY_HASH,
  maximumResults: 4,
  minimumResults: 1,
});

export const THEME_E1_CLAIM_EVIDENCE_POLICY = themeClaimEvidencePolicySchema.parse({
  contractVersion: 'theme-claim-evidence-policy-v1',
  policyVersion: THEME_E1_CLAIM_POLICY_VERSION,
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
});

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Reject an outer E1 version label wrapped around a changed source or evidence policy. */
export function assertThemeE1PlanPolicy(input: unknown): ThemeLiveRuntimePlanV2 {
  const plan = themeLiveRuntimePlanV2Schema.parse(input);
  if (
    plan.sourcePolicyVersion !== THEME_E1_SOURCE_POLICY_VERSION ||
    plan.sourceRegistryHash !== THEME_E1_SOURCE_REGISTRY_HASH ||
    !same(plan.discoveryPolicy, THEME_E1_DISCOVERY_POLICY) ||
    !same(plan.claimEvidencePolicy, THEME_E1_CLAIM_EVIDENCE_POLICY) ||
    plan.proposalSlotPolicy.totalSlots !== THEME_E1_SLOTS_PER_JOB ||
    plan.proposalSlotPolicy.maximumSlotsPerSource !== THEME_E1_SLOTS_PER_JOB
  )
    throw new TypeError('theme_e1_plan_policy_mismatch');
  return plan;
}
