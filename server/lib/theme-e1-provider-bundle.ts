import { z } from 'zod';

import type { Question } from '@shared/models/questions';
import { themeFactReviewOutputSchema } from '@shared/models/theme-fact-review';
import {
  themeQuestionWriterOutputSchema,
  type ThemeQuestionWriterOutput,
} from '@shared/models/theme-question-generation';
import {
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

export const THEME_E1_BUNDLE_VERSION = 'theme-e1-openai-2026-11-08-v1' as const;
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

const proposerWireSchema = z
  .object({
    status: z.enum(['proposed', 'insufficient_evidence', 'conflicted']),
    statement: z.string().trim().min(1).max(4_000).nullable(),
    scope: z
      .object({
        entity: z.string().trim().min(1).max(500),
        relation: z.string().trim().min(1).max(500),
        time: z.string().trim().min(1).max(500).nullable(),
        geography: z.string().trim().min(1).max(500).nullable(),
        competitionOrDomain: z.string().trim().min(1).max(500).nullable(),
        qualifiers: z.array(z.string().trim().min(1).max(500)).max(20),
        asOf: z.string().datetime().nullable(),
      })
      .strict()
      .nullable(),
    canonicalAnswer: z.string().trim().min(1).max(1_000).nullable(),
    supportedAliases: z.array(z.string().trim().min(1).max(1_000)).max(50).nullable(),
    timeSensitive: z.boolean().nullable(),
    citations: z
      .array(
        z
          .object({
            passageId: z.string().uuid(),
            passageContentHash: z.string().regex(/^[a-f0-9]{64}$/),
            supportKind: z.enum(['supports', 'conflicts', 'context']),
          })
          .strict()
      )
      .max(12)
      .nullable(),
  })
  .strict()
  .transform((value, context): ThemeFactProposerOutput => {
    const candidate =
      value.status === 'proposed'
        ? {
            status: value.status,
            statement: value.statement,
            scope: value.scope,
            canonicalAnswer: value.canonicalAnswer,
            supportedAliases: value.supportedAliases,
            timeSensitive: value.timeSensitive,
            citations: value.citations,
          }
        : { status: value.status };
    const parsed = themeFactProposerOutputSchema.safeParse(candidate);
    if (!parsed.success) {
      context.addIssue({ code: 'custom', message: 'invalid proposal fields' });
      return z.NEVER;
    }
    return parsed.data;
  });

const writerWireSchema = z
  .object({
    status: z.enum(['candidate', 'declined']),
    question: z.string().trim().min(1).max(4_000).nullable(),
    explanation: z.string().trim().min(1).max(8_000).nullable(),
  })
  .strict()
  .transform((value, context): ThemeQuestionWriterOutput => {
    const candidate =
      value.status === 'candidate'
        ? { status: value.status, question: value.question, explanation: value.explanation }
        : { status: value.status };
    const parsed = themeQuestionWriterOutputSchema.safeParse(candidate);
    if (!parsed.success) {
      context.addIssue({ code: 'custom', message: 'invalid writer fields' });
      return z.NEVER;
    }
    return parsed.data;
  });

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
            reason: z.string().trim().min(1).max(2_000),
          })
          .strict()
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
  proposer: `Extract exactly one stable trivia fact about the requested theme from the supplied passages. Use only the passages, copy passage IDs and hashes exactly, and cite at least one supporting passage. Do not use model memory. Reject disputed, superlative, current, changing, ambiguous, or weakly supported claims. Return null for every fact field when status is not proposed.`,
  factReview: `Act as an independent, skeptical evidence reviewer. Evaluate every required dimension using only the supplied fact and passages. A pass requires direct entailment, exact scope and qualifiers, a uniquely supported canonical answer, supported aliases, no unresolved conflict, and the required source independence. Do not repair or infer missing facts.`,
  writer: `Write one concise trivia question whose unique answer is the supplied canonical answer. Use only the supplied fact and evidence. Include all qualifiers needed to avoid ambiguity, never reveal the answer in the question, and make the explanation evidence-bound. Decline if a fair unambiguous question cannot be written.`,
  evidenceReview: `Review the question, answer, aliases, explanation, scope and freshness only against the supplied fact and passages. Return exactly one result for every required dimension. Pass only when the evidence directly supports the full wording and a unique answer; otherwise flag or fail with the applicable reason code and exact passage IDs.`,
  repair: `Make one bounded repair to the supplied parent question for the stated static or quality failure. Preserve the evidence-backed canonical answer and scope, do not add facts, and return a complete revised question and explanation. Decline if the problem cannot be fixed without unsupported information.`,
  quality: `Perform an adversarial trivia quality review. Check whether the premise and requested answer type are coherent, whether the answer is exposed or trivially constrained by the wording, and whether the stated difficulty is credible. Return one result with the exact supplied question ID. Any uncertainty must be flag, not pass.`,
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
    proposerWireSchema,
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
