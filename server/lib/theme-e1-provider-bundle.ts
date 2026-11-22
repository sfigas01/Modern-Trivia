import { z } from 'zod';

import type { Question } from '@shared/models/questions';
import { themeFactReviewOutputSchema } from '@shared/models/theme-fact-review';
import {
  themeQuestionCandidateOutputSchema,
  themeQuestionWriterOutputSchema,
  type ThemeQuestionWriterOutput,
} from '@shared/models/theme-question-generation';
import {
  themeFactConflictedOutputSchema,
  themeFactInsufficientEvidenceOutputSchema,
  themeFactProposedOutputSchema,
  themeFactProposerOutputSchema,
  type ThemeFactProposalPassage,
  type ThemeFactProposerOutput,
} from './theme-fact-derivation';
import { themeQuestionEvidenceReviewOutputSchema } from './theme-question-evidence-review';
import type { ThemeQuestionRepairerInput } from './theme-question-repair';
import type { ThemeProposalSlotProviderInput } from './theme-runtime-pipeline';
import {
  createEmbeddingProvider,
  createStructuredResponseProvider,
  themeEmbeddingPolicySchema,
  themeProviderPricingSchema,
  themeStructuredResponsePolicySchema,
  type ThemeJsonSchema,
  type ThemeResponsesRequest,
} from './theme-provider-adapters';
import type { ThemeOpenAITransports } from './theme-openai-preview-runtime';
import type { FactCheckReport } from './verifier';

export const THEME_E1_BUNDLE_VERSION = 'theme-e1-openai-2026-11-21-v4' as const;
export const THEME_E1_PRICING_VERSION = 'openai-standard-2026-11-08-v1' as const;
export const THEME_E1_INPUT_ESTIMATOR_VERSION = 'utf8-bytes-div-3-v1' as const;

/**
 * Immutable E1 Standard-price snapshot. Uncached input uses the higher
 * 30-minute cache-write rate for conservative admission; cached input uses the
 * published cache-read rate. Refreshing prices requires a new bundle version.
 */
export const THEME_E1_PRICING = themeProviderPricingSchema.parse({
  version: THEME_E1_PRICING_VERSION,
  currency: 'USD',
  models: {
    'gpt-6-luna': {
      inputMicrosPerMillionTokens: 125_000,
      cachedInputMicrosPerMillionTokens: 10_000,
      outputMicrosPerMillionTokens: 500_000,
    },
    'gpt-6.1-sol': {
      inputMicrosPerMillionTokens: 2_500_000,
      cachedInputMicrosPerMillionTokens: 200_000,
      outputMicrosPerMillionTokens: 10_000_000,
    },
  },
  embeddings: {
    'text-embedding-3-small': { inputMicrosPerMillionTokens: 20_000 },
  },
});

/*
 * Responses Structured Outputs require an object at the root. Keep that root
 * stable while placing the status-discriminated union below `result`, so the
 * provider and the application validate the exact same branch contract.
 */
const proposerWireSchema = z
  .object({ result: z.union(themeFactProposerOutputSchema.options) })
  .strict()
  .transform(({ result }): ThemeFactProposerOutput => result);

const slotProposerResultSchema = z.discriminatedUnion('status', [
  themeFactInsufficientEvidenceOutputSchema,
  themeFactConflictedOutputSchema,
  themeFactProposedOutputSchema
    .extend({ questionPackage: themeQuestionCandidateOutputSchema })
    .strict(),
]);

const slotProposerWireSchema = z
  .object({ result: slotProposerResultSchema })
  .strict()
  .transform(({ result }): ThemeFactProposerOutput => result);

const writerWireSchema = z
  .object({ result: z.union(themeQuestionWriterOutputSchema.options) })
  .strict()
  .transform(({ result }): ThemeQuestionWriterOutput => result);

const qualitySchema = z
  .object({
    totalChecked: z.number().int().min(1).max(1),
    results: z
      .array(
        z
          .object({
            questionId: z.string().min(1).max(255),
            verdict: z.enum(['pass', 'flag', 'fail']),
            coherence: z.enum(['pass', 'flag', 'fail']),
            obviousness: z.enum(['pass', 'flag', 'fail']),
            confidence: z.number().min(0).max(100),
            defectCodes: z
              .array(
                z.enum([
                  'multiple_reasonable_answers',
                  'missing_hint',
                  'giveaway_hint',
                  'incoherent_premise',
                  'unnatural_answer',
                  'missing_alias',
                  'difficulty_mismatch',
                  'specialist_only_recall',
                ])
              )
              .max(8),
            predictedCorrectRate: z.number().int().min(0).max(100),
            funScore: z.number().int().min(1).max(5),
            recommendedAction: z.enum(['approve', 'rewrite', 'reject']),
            reason: z.string().trim().min(1).max(2_000),
          })
          .strict()
          .superRefine((result, context) => {
            const cleanPass =
              result.verdict === 'pass' &&
              result.coherence === 'pass' &&
              result.obviousness === 'pass' &&
              result.defectCodes.length === 0 &&
              result.recommendedAction === 'approve';
            if ((result.verdict === 'pass') !== cleanPass)
              context.addIssue({
                code: 'custom',
                message: 'A player-quality pass requires no defects and an approve action',
              });
          })
      )
      .length(1),
  })
  .strict();

const semanticSchema = z
  .object({
    assessment: z.string().trim().min(1).max(2_000),
    verdict: z.enum(['equivalent', 'conflict', 'distinct', 'uncertain']),
  })
  .strict();

const PROMPTS = Object.freeze({
  proposer: `Using only the supplied Wikipedia passages, select one recognizable, stable fact and write its complete general-audience trivia Q&A package in the same response. Do not use model memory. The fact must have one short answer, avoid specialist-only knowledge, approximations, disputed or changing claims, and contested first/largest wording. Copy passage IDs and hashes exactly and cite direct support. For a proposed result, include questionPackage. Follow slot.targetDifficulty: Easy targets 75-95% correct, Medium 45-75%, Hard 20-45%. Keep the underlying fact knowable at every level; create difficulty with clue strength and a useful non-giveaway hint, never with obscurity. Medium and Hard require a narrowing hint. Use a natural 12-30 word question, Canadian spelling, metric units where relevant, and a 1-3 sentence Wikipedia-supported explanation with an interesting reveal. The answer and alternatives must exactly match the supported canonical answer and aliases. Return one top-level object containing only result, using proposed, insufficient_evidence, or conflicted.`,
  factReview: `Act as a skeptical evidence reviewer for stable trivia facts. Evaluate every required dimension using only the supplied fact and approved Wikipedia passages. A pass requires direct entailment, exact scope and qualifiers, a uniquely supported canonical answer, supported aliases, and no unresolved conflict. One approved Wikipedia origin is sufficient for a stable claim: pass source_independence with approved_single_source when there is one origin, and never flag solely because an independent second source is absent. Use independent_origins when multiple independent origins are supplied. Do not repair or infer missing facts.`,
  writer: `Write one fair, general-audience trivia Q&A package from the supplied fact and Wikipedia evidence. Follow targetDifficulty: Easy targets 75-95% correct, Medium 45-75%, Hard 20-45%. Adjust clue and hint strength rather than choosing obscure facts. Medium and Hard require a useful narrowing hint. The answer and acceptedAlternatives must exactly copy the supplied canonical answer and supported aliases. Write a natural 12-30 word question with exactly one reasonable answer, Canadian spelling and metric units where relevant. Avoid giveaways. The 1-3 sentence explanation must be fully supported and include an interesting reveal. Decline with a concrete reason when a fair unambiguous question is not possible. Return one top-level object containing only result, using exactly the candidate or declined schema branch.`,
  evidenceReview: `Fact-check the complete question-and-answer package only against the supplied Wikipedia fact and passages. Review the question, canonical answer, accepted alternatives, explanation, scope and freshness. Return exactly one result for every required dimension. Pass only when the passages directly support the full wording and exactly one reasonable answer; otherwise flag or fail with the applicable reason code and exact passage IDs. One approved Wikipedia origin is sufficient for a stable claim.`,
  repair: `Make one bounded repair to the supplied parent question for the stated static or quality failure. Preserve the evidence-backed canonical answer and scope, do not add facts, and return the complete Q&A package required by the candidate schema. The answer must exactly copy the supplied canonical answer. Accepted alternatives may only be retained or removed from the supplied supported aliases; never add one. Difficulty may change only when the stated quality failure requires reclassification. Revise wording, hint or explanation as needed, but never change the underlying fact or canonical answer. Decline with a concrete reason if the problem cannot be fixed without unsupported information. Return one top-level object containing only result, using exactly the candidate or declined schema branch.`,
  quality: `Review the completed Q&A as a general-audience trivia editor, not as a fact checker. Use only these defects: multiple reasonable answers, missing Medium/Hard hint, giveaway hint, incoherent premise, unnatural answer, missing common alias, predicted correct rate outside Easy 75-95 / Medium 45-75 / Hard 20-45, or specialist-only recall. Do not reject merely because the answer is unfamiliar. Return the reviewer predicted correct rate, a 1-5 fun score, explicit defect codes, and approve/rewrite/reject with a concrete reason. Pass only when defectCodes is empty and recommendedAction is approve.`,
  semantic: `Compare the two question-answer pairs. Classify them as equivalent, conflicting answers to substantially the same question, distinct, or uncertain. Use uncertain whenever equivalence or conflict is not clear.`,
});

type PolicyKey = keyof typeof PROMPTS;
const POLICY: Record<PolicyKey, ReturnType<typeof themeStructuredResponsePolicySchema.parse>> = {
  proposer: policy('proposer', 'gpt-6-luna', 'low', 6_000, 1_000),
  factReview: policy('fact_review', 'gpt-6.1-sol', 'medium', 6_000, 1_200),
  writer: policy('question_writer', 'gpt-6-luna', 'low', 4_000, 800),
  evidenceReview: policy('evidence_review', 'gpt-6.1-sol', 'medium', 6_000, 1_200),
  repair: policy('question_repair', 'gpt-6-luna', 'low', 4_000, 800),
  quality: policy('quality_review', 'gpt-6.1-sol', 'medium', 4_000, 800),
  semantic: policy('semantic_adjudication', 'gpt-6.1-sol', 'low', 1_500, 400),
};

function policy(
  name: string,
  model: 'gpt-6-luna' | 'gpt-6.1-sol',
  reasoningEffort: 'low' | 'medium',
  maxInputTokens: number,
  maxOutputTokens: number
) {
  return themeStructuredResponsePolicySchema.parse({
    adapterVersion: 'theme-provider-adapter-v1',
    policyVersion: `${THEME_E1_BUNDLE_VERSION}-${name}`,
    promptVersion: `${THEME_E1_BUNDLE_VERSION}-${name}-prompt`,
    provider: 'openai',
    model,
    serviceTier: 'default',
    reasoningEffort,
    maxInputTokens,
    maxOutputTokens,
    timeoutMs: 30_000,
    maxRetries: 0,
    inputEstimatorVersion: THEME_E1_INPUT_ESTIMATOR_VERSION,
    schemaName: `theme_e1_${name}`,
    schemaVersion: `${THEME_E1_BUNDLE_VERSION}-${name}-schema`,
    pricingVersion: THEME_E1_PRICING_VERSION,
  });
}

function jsonSchema(schema: z.ZodType): ThemeJsonSchema {
  const value = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' });
  delete value.$schema;
  return value;
}

/** Conservative English-text estimator; the adapter rejects any over-ceiling request. */
export function estimateThemeE1ResponseTokens(request: ThemeResponsesRequest): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(request), 'utf8') / 3) + 64);
}

export function estimateThemeE1EmbeddingTokens(input: readonly string[]): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(input), 'utf8') / 3) + 16);
}

function structured<Input, Output>(
  transports: ThemeOpenAITransports,
  key: PolicyKey,
  schema: z.ZodType<Output>,
  serializeInput: (input: Input) => unknown
) {
  return createStructuredResponseProvider<Input, Output>({
    transport: transports.responses,
    pricing: THEME_E1_PRICING,
    policy: POLICY[key],
    instructions: PROMPTS[key],
    outputJsonSchema: jsonSchema(schema),
    outputSchema: schema,
    serializeInput,
    estimateInputTokens: estimateThemeE1ResponseTokens,
  });
}

export function createThemeE1Providers(transports: ThemeOpenAITransports) {
  const slotProposer = structured<ThemeProposalSlotProviderInput, ThemeFactProposerOutput>(
    transports,
    'proposer',
    slotProposerWireSchema,
    (input) => input
  );
  return Object.freeze({
    proposer: structured<readonly ThemeFactProposalPassage[], ThemeFactProposerOutput>(
      transports,
      'proposer',
      proposerWireSchema,
      (input) => input
    ),
    slotProposer,
    factReviewer: structured(
      transports,
      'factReview',
      themeFactReviewOutputSchema,
      (input) => input
    ),
    writer: structured(transports, 'writer', writerWireSchema, (input) => input),
    evidenceReviewer: structured(
      transports,
      'evidenceReview',
      themeQuestionEvidenceReviewOutputSchema,
      (input) => input
    ),
    repairer: structured<ThemeQuestionRepairerInput, ThemeQuestionWriterOutput>(
      transports,
      'repair',
      writerWireSchema,
      (input) => input
    ),
    quality: structured<readonly Question[], FactCheckReport>(
      transports,
      'quality',
      qualitySchema,
      (input) => input
    ),
    semantic: structured(transports, 'semantic', semanticSchema, (input) => input),
    embeddings: createEmbeddingProvider({
      transport: transports.embeddings,
      pricing: THEME_E1_PRICING,
      policy: themeEmbeddingPolicySchema.parse({
        policyVersion: `${THEME_E1_BUNDLE_VERSION}-semantic-embedding`,
        provider: 'openai',
        model: 'text-embedding-3-small',
        dimensions: 512,
        maxInputTokens: 10_000,
        timeoutMs: 30_000,
        maxRetries: 0,
        inputEstimatorVersion: THEME_E1_INPUT_ESTIMATOR_VERSION,
        pricingVersion: THEME_E1_PRICING_VERSION,
      }),
      estimateInputTokens: estimateThemeE1EmbeddingTokens,
    }),
  });
}

export const THEME_E1_POLICY_SNAPSHOT = Object.freeze({
  bundleVersion: THEME_E1_BUNDLE_VERSION,
  pricing: THEME_E1_PRICING,
  policies: POLICY,
  prompts: PROMPTS,
});
