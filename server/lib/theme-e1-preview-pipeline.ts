import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { Pool } from 'pg';

import { THEME_SOURCE_EXTRACTOR_VERSION } from './theme-source-extraction';
import { createPinnedHttpsTransport } from './theme-source-https';
import type { SourceLookup } from './theme-source-address';
import {
  createPostgresThemeRuntimeCheckpoints,
  createThemeRuntimePipeline,
  type ThemeRuntimePipelineOptions,
  type ThemeRuntimeSourceItem,
} from './theme-runtime-pipeline';
import type { ThemeFactProposalPassage } from './theme-fact-derivation';
import type { ThemeLiveRuntimePlanV2 } from './theme-runtime-plan';
import type { ThemeSourceFirstRepositoryConfig } from './theme-runtime-composition';
import type { OpenAIThemePreviewPipelineBuilder } from './theme-openai-preview-runtime';
import {
  createThemeE1Providers,
  THEME_E1_BUNDLE_VERSION,
  THEME_E1_POLICY_SNAPSHOT,
} from './theme-e1-provider-bundle';

const DAY_MS = 24 * 60 * 60 * 1_000;
const SOURCE_MAX_AGE_MS = 7 * DAY_MS;
const REVIEW_VALID_FOR_MS = DAY_MS;
const MAX_PROPOSAL_PASSAGES = 12;
const MAX_PROPOSAL_PASSAGE_CHARACTERS = 12_000;
const THEME_E1_WIKIPEDIA_USER_AGENT =
  'Modern-Trivia-E1/1.0 (+https://superquestly.up.railway.app)' as const;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function livePlan(value: unknown): ThemeLiveRuntimePlanV2 {
  const plan = value as ThemeLiveRuntimePlanV2;
  if (plan?.contractVersion !== 'theme-live-runtime-plan-v2')
    throw new TypeError('theme_e1_live_plan_v2_required');
  return plan;
}

function derivationPolicy(plan: ThemeLiveRuntimePlanV2) {
  const stable = plan.claimEvidencePolicy.stable;
  return {
    sourcePolicyVersion: plan.sourcePolicyVersion,
    extractorVersion: THEME_SOURCE_EXTRACTOR_VERSION,
    allowedSourceClasses: [...stable.allowedSourceClasses],
    maxSourceAgeMs: SOURCE_MAX_AGE_MS,
    minimumOriginGroups: stable.minimumIndependentOriginGroups,
    timeSensitiveTtlMs: REVIEW_VALID_FOR_MS,
  };
}

function evidencePolicy(plan: ThemeLiveRuntimePlanV2) {
  const stable = plan.claimEvidencePolicy.stable;
  return {
    sourcePolicyVersion: plan.sourcePolicyVersion,
    extractorVersion: THEME_SOURCE_EXTRACTOR_VERSION,
    reviewPolicyVersion: `${THEME_E1_BUNDLE_VERSION}-evidence-review`,
    reviewerPromptVersion: `${THEME_E1_BUNDLE_VERSION}-evidence-review-prompt`,
    allowedSourceClasses: [...stable.allowedSourceClasses],
    maxSourceAgeMs: SOURCE_MAX_AGE_MS,
    maxReviewAgeMs: REVIEW_VALID_FOR_MS,
    minIndependentOriginGroupsPerFact: stable.minimumIndependentOriginGroups,
  };
}

/**
 * Repository policy is built from the immutable stored plan, never from a
 * caller-supplied theme or current process defaults.
 */
export function createThemeE1RepositoryConfig(
  plan: ThemeLiveRuntimePlanV2
): ThemeSourceFirstRepositoryConfig {
  const prompts = THEME_E1_POLICY_SNAPSHOT.prompts;
  const derivation = derivationPolicy(plan);
  const factReviewPolicy = {
    sourcePolicyVersion: plan.sourcePolicyVersion,
    extractorVersion: THEME_SOURCE_EXTRACTOR_VERSION,
    allowedSourceClasses: derivation.allowedSourceClasses,
    minimumOriginGroups: derivation.minimumOriginGroups,
    maxSourceAgeMs: SOURCE_MAX_AGE_MS,
    validForMs: REVIEW_VALID_FOR_MS,
  };
  const evidence = {
    executionId: randomUUID(),
    reviewer: {
      kind: 'model' as const,
      id: `${THEME_E1_BUNDLE_VERSION}-evidence-reviewer`,
      provider: 'openai',
      model: 'gpt-6.1-sol',
    },
    policy: evidencePolicy(plan),
    promptText: prompts.evidenceReview,
  };
  const unavailableQuality = async (): Promise<never> => {
    throw new TypeError('theme_e1_budgeted_qa_required');
  };
  const unavailableDuplicates = async (): Promise<never> => {
    throw new TypeError('theme_e1_budgeted_qa_required');
  };
  return {
    factReview: {
      executionId: randomUUID(),
      reviewPolicyVersion: `${THEME_E1_BUNDLE_VERSION}-fact-review`,
      policy: factReviewPolicy,
      promptVersion: `${THEME_E1_BUNDLE_VERSION}-fact-review-prompt`,
      promptText: prompts.factReview,
      reviewer: {
        kind: 'model',
        id: `${THEME_E1_BUNDLE_VERSION}-fact-reviewer`,
        provider: 'openai',
        model: 'gpt-6.1-sol',
      },
    },
    questionGeneration: {
      executionId: randomUUID(),
      writer: {
        kind: 'model',
        id: `${THEME_E1_BUNDLE_VERSION}-question-writer`,
        provider: 'openai',
        model: 'gpt-6-luna',
      },
      generationPolicy: {
        generationPolicyVersion: `${THEME_E1_BUNDLE_VERSION}-generation`,
        sourcePolicyVersion: plan.sourcePolicyVersion,
        extractorVersion: THEME_SOURCE_EXTRACTOR_VERSION,
        allowedSourceClasses: derivation.allowedSourceClasses,
        maxSourceAgeMs: SOURCE_MAX_AGE_MS,
        minimumOriginGroups: derivation.minimumOriginGroups,
        category: plan.normalizedTheme,
        difficulty: 'Medium',
        pillar: 'Theme',
        tags: ['themed', plan.normalizedTheme],
      },
      promptVersion: `${THEME_E1_BUNDLE_VERSION}-question-writer-prompt`,
      promptText: prompts.writer,
      factReviewPolicyVersion: `${THEME_E1_BUNDLE_VERSION}-fact-review`,
      factReviewPolicy,
      factReviewPromptVersion: `${THEME_E1_BUNDLE_VERSION}-fact-review-prompt`,
      factReviewPromptText: prompts.factReview,
    },
    evidenceReview: evidence,
    approval: {
      evidence,
      checkQuality: unavailableQuality,
      detectDuplicates: unavailableDuplicates,
    },
    repairQa: {
      checkQuality: unavailableQuality,
      detectDuplicates: unavailableDuplicates,
    },
  };
}

function runtimeItems(plan: ThemeLiveRuntimePlanV2): ThemeRuntimeSourceItem[] {
  return plan.proposalSlots.map((slot) => {
    const source = plan.sources.find((candidate) => candidate.key === slot.sourceKey);
    if (!source) throw new TypeError('theme_e1_plan_source_missing');
    return {
      key: slot.key,
      sourceKey: slot.sourceKey,
      ordinal: slot.ordinal,
      requestedUrl: source.canonicalUrl,
      title: source.title,
      language: source.language,
    };
  });
}

/** Deterministic coverage across repeated slots for the same pinned article. */
export function selectThemeE1ProposalPassages(
  plan: ThemeLiveRuntimePlanV2,
  item: ThemeRuntimeSourceItem,
  passages: readonly ThemeFactProposalPassage[]
): readonly ThemeFactProposalPassage[] {
  const sourceSlots = plan.proposalSlots.filter((slot) => slot.sourceKey === item.sourceKey);
  const sourceSlotIndex = sourceSlots.findIndex((slot) => slot.key === item.key);
  if (sourceSlotIndex < 0 || sourceSlots.length < 1 || passages.length < 1) return [];
  const selected: ThemeFactProposalPassage[] = [];
  let characters = 0;
  const start = sourceSlotIndex % passages.length;
  for (let index = start; index < passages.length; index += sourceSlots.length) {
    const passage = passages[index];
    if (
      selected.length >= MAX_PROPOSAL_PASSAGES ||
      characters + passage.text.length > MAX_PROPOSAL_PASSAGE_CHARACTERS
    )
      break;
    selected.push(passage);
    characters += passage.text.length;
  }
  return selected;
}

export type ThemeE1PipelineFactoryOptions = Readonly<{
  pool: Parameters<typeof createPostgresThemeRuntimeCheckpoints>[0];
  expectedBudgetPolicyFingerprint: string;
}>;

export async function loadThemeE1RequiredThemed(pool: Pick<Pool, 'query'>, jobId: string) {
  const result = await pool.query<{ required_themed: number }>(
    `SELECT COALESCE(game.accepted_themed_target, game.themed_question_target)::integer
            AS required_themed
       FROM theme_preparation_jobs job
       JOIN theme_game_sessions game ON game.id = job.game_id
      WHERE job.id = $1`,
    [jobId]
  );
  const required = Number(result.rows[0]?.required_themed);
  if (!Number.isInteger(required) || required < 1) throw new TypeError('theme_e1_target_missing');
  return required;
}

/** Builds the paid pipeline only after the preview scheduler has loaded a plan. */
export function createThemeE1PreviewPipelineBuilder(
  options: ThemeE1PipelineFactoryOptions
): OpenAIThemePreviewPipelineBuilder {
  return ({ loadedPlan, context, transports }) => {
    const plan = livePlan(loadedPlan.plan);
    if (loadedPlan.planVersion !== THEME_E1_BUNDLE_VERSION)
      throw new TypeError('theme_e1_bundle_mismatch');
    if (plan.budgetPolicyFingerprint !== options.expectedBudgetPolicyFingerprint)
      throw new TypeError('theme_e1_budget_policy_mismatch');
    const providers = createThemeE1Providers(transports);
    const items = runtimeItems(plan);
    const derivation = derivationPolicy(plan);
    const prompts = THEME_E1_POLICY_SNAPSHOT.prompts;
    const pipelineOptions: ThemeRuntimePipelineOptions = {
      planVersion: loadedPlan.planVersion,
      holdExpiresAt: loadedPlan.holdUntil,
      items,
      executionMode: 'evaluation',
      preflight: async (job) => {
        await loadThemeE1RequiredThemed(options.pool, job.id);
        const requiredThemed = items.length;
        return requiredThemed <= job.candidateCeiling
          ? {
              ok: true,
              requiredThemed,
              work: items.map(({ key }) => ({ key })),
            }
          : { ok: false, code: 'runtime_unavailable' };
      },
      checkpoints: createPostgresThemeRuntimeCheckpoints(options.pool),
      derivation: {
        policy: derivation,
        provenance: {
          attemptId: randomUUID(),
          derivationPolicyVersion: `${THEME_E1_BUNDLE_VERSION}-derivation`,
          promptVersion: `${THEME_E1_BUNDLE_VERSION}-fact-proposer-prompt`,
          promptText: prompts.proposer,
          producerKind: 'model',
          producerId: `${THEME_E1_BUNDLE_VERSION}-fact-proposer`,
          provider: 'openai',
          model: 'gpt-6-luna',
          executionId: randomUUID(),
        },
      },
      providers: {
        proposer: providers.proposer,
        factReviewer: providers.factReviewer,
        writer: providers.writer,
        evidenceReviewer: providers.evidenceReviewer,
        repairer: providers.repairer,
      } as ThemeRuntimePipelineOptions['providers'],
      qaMode: 'budgeted',
      qaProviders: {
        quality: providers.quality,
        embeddings: providers.embeddings,
        semantic: providers.semantic,
      } as ThemeRuntimePipelineOptions['qaProviders'],
      retrieval: {
        lookup: lookup as SourceLookup,
        transport: createPinnedHttpsTransport(undefined, {
          userAgent: THEME_E1_WIKIPEDIA_USER_AGENT,
        }),
      },
      proposalSlots: {
        planHash: loadedPlan.planHash,
        plan,
        proposer: providers.slotProposer,
        selectPassages: (item, passages) => selectThemeE1ProposalPassages(plan, item, passages),
        provenance: () => ({
          proposalPolicyVersion: `${THEME_E1_BUNDLE_VERSION}-proposal`,
          promptVersion: `${THEME_E1_BUNDLE_VERSION}-fact-proposer-prompt`,
          promptHash: sha256(prompts.proposer),
          producerKind: 'model',
          producerId: `${THEME_E1_BUNDLE_VERSION}-fact-proposer`,
          provider: 'openai',
          model: 'gpt-6-luna',
          claimRisks: ['stable'],
          derivationPolicy: derivation,
        }),
      },
    };
    return createThemeRuntimePipeline(context, pipelineOptions);
  };
}
