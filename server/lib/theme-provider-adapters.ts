import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { ThemeBudgetOperation, ThemeBudgetOutcome } from './theme-budget';
import type { ThemeSemanticBatchPersistenceRequest } from './theme-provider-persistence';

const int32 = z.number().int().min(0).max(2_147_483_647);
const positiveInt32 = int32.min(1);
const identifier = z.string().trim().min(1).max(255);
const jsonSchema = z.record(z.string(), z.unknown());

export const THEME_PROVIDER_ADAPTER_VERSION = 'theme-provider-adapter-v1' as const;
export const MAX_THEME_SEMANTIC_ADJUDICATIONS = 4 as const;

export const themeProviderPricingSchema = z
  .object({
    version: identifier,
    currency: z.literal('USD'),
    models: z.record(
      identifier,
      z
        .object({
          inputMicrosPerMillionTokens: positiveInt32,
          cachedInputMicrosPerMillionTokens: positiveInt32,
          outputMicrosPerMillionTokens: positiveInt32,
        })
        .strict()
    ),
    embeddings: z.record(
      identifier,
      z.object({ inputMicrosPerMillionTokens: positiveInt32 }).strict()
    ),
  })
  .strict();

export type ThemeProviderPricing = z.infer<typeof themeProviderPricingSchema>;

export const themeStructuredResponsePolicySchema = z
  .object({
    adapterVersion: z.literal(THEME_PROVIDER_ADAPTER_VERSION),
    policyVersion: identifier,
    promptVersion: identifier,
    provider: z.literal('openai'),
    model: identifier,
    serviceTier: z.literal('default'),
    reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']),
    maxInputTokens: positiveInt32,
    maxOutputTokens: positiveInt32,
    timeoutMs: z.number().int().min(1).max(120_000),
    maxRetries: z.literal(0),
    inputEstimatorVersion: identifier,
    schemaName: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    schemaVersion: identifier,
    pricingVersion: identifier,
  })
  .strict();

export type ThemeStructuredResponsePolicy = z.infer<typeof themeStructuredResponsePolicySchema>;

export type ThemeJsonSchema = Readonly<Record<string, unknown>>;

export type ThemeResponsesRequest = Readonly<{
  model: string;
  service_tier: 'default';
  instructions: string;
  input: string;
  reasoning: { effort: ThemeStructuredResponsePolicy['reasoningEffort'] };
  max_output_tokens: number;
  text: {
    format: {
      type: 'json_schema';
      name: string;
      strict: true;
      schema: ThemeJsonSchema;
    };
  };
}>;

export type ThemeResponsesResult = Readonly<{
  id: string;
  model: string;
  status: 'completed' | 'failed' | 'incomplete' | 'in_progress' | 'queued';
  output_text?: string;
  incomplete_details?: { reason?: string | null } | null;
  error?: { code?: string | null } | null;
  output?: readonly {
    type?: string;
    content?: readonly { type?: string; refusal?: string }[];
  }[];
  usage?: {
    input_tokens?: number;
    input_tokens_details?: { cached_tokens?: number } | null;
    output_tokens?: number;
  } | null;
}>;

/** Injected in S12B-2. This interface cannot discover credentials or create a client. */
export interface ThemeResponsesTransport {
  create(
    request: ThemeResponsesRequest,
    options: { signal: AbortSignal; maxRetries: 0 }
  ): Promise<ThemeResponsesResult>;
}

export type ThemeProviderMetadata = Readonly<{
  providerRequestId: string | null;
  returnedModel: string | null;
  latencyMs: number;
}>;

export type ThemeProviderInvocation<T> = Readonly<{
  value: T;
  outcome: ThemeBudgetOutcome;
  metadata?: ThemeProviderMetadata;
}>;

export type ThemeRuntimeProvider<Input, Output> = Readonly<{
  provider: string;
  model: string;
  requestIdentity: unknown;
  reservedCostMicros: number;
  invoke(input: Input): Promise<ThemeProviderInvocation<Output>>;
}>;

export class ThemeProviderAdapterError extends Error {
  constructor(public readonly code: 'invalid_configuration' | 'semantic_limit_exceeded') {
    super(code);
    this.name = 'ThemeProviderAdapterError';
  }
}

/** Safe transport failure. Throwing preserves the gateway's unknown-outcome hold. */
export class ThemeProviderTransportError extends Error {
  constructor(public readonly code: 'provider_timeout' | 'provider_outcome_unknown') {
    super(code);
    this.name = 'ThemeProviderTransportError';
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function costMicros(tokens: number, rate: number): number {
  if (!Number.isInteger(tokens) || tokens < 0 || !Number.isInteger(rate) || rate < 1)
    throw new ThemeProviderAdapterError('invalid_configuration');
  const value = (BigInt(tokens) * BigInt(rate) + BigInt(999_999)) / BigInt(1_000_000);
  if (value > BigInt(2_147_483_647)) throw new ThemeProviderAdapterError('invalid_configuration');
  return Number(value);
}

function inputCostMicros(
  uncachedTokens: number,
  cachedTokens: number,
  rates: { inputMicrosPerMillionTokens: number; cachedInputMicrosPerMillionTokens: number }
): number {
  const numerator =
    BigInt(uncachedTokens) * BigInt(rates.inputMicrosPerMillionTokens) +
    BigInt(cachedTokens) * BigInt(rates.cachedInputMicrosPerMillionTokens);
  const value = (numerator + BigInt(999_999)) / BigInt(1_000_000);
  if (value > BigInt(2_147_483_647)) throw new ThemeProviderAdapterError('invalid_configuration');
  return Number(value);
}

export function reserveStructuredResponseCostMicros(
  rawPricing: ThemeProviderPricing,
  rawPolicy: ThemeStructuredResponsePolicy
): number {
  const pricing = themeProviderPricingSchema.safeParse(rawPricing);
  const policy = themeStructuredResponsePolicySchema.safeParse(rawPolicy);
  if (!pricing.success || !policy.success || pricing.data.version !== policy.data.pricingVersion)
    throw new ThemeProviderAdapterError('invalid_configuration');
  const rates = pricing.data.models[policy.data.model];
  if (!rates) throw new ThemeProviderAdapterError('invalid_configuration');
  const reserved =
    costMicros(
      policy.data.maxInputTokens,
      Math.max(rates.inputMicrosPerMillionTokens, rates.cachedInputMicrosPerMillionTokens)
    ) + costMicros(policy.data.maxOutputTokens, rates.outputMicrosPerMillionTokens);
  if (reserved < 1 || reserved > 2_147_483_647)
    throw new ThemeProviderAdapterError('invalid_configuration');
  return reserved;
}

export function reserveEmbeddingCostMicros(
  rawPricing: ThemeProviderPricing,
  pricingVersion: string,
  model: string,
  maxInputTokens: number
): number {
  const pricing = themeProviderPricingSchema.safeParse(rawPricing);
  if (!pricing.success || pricing.data.version !== pricingVersion)
    throw new ThemeProviderAdapterError('invalid_configuration');
  const rates = pricing.data.embeddings[model];
  if (!rates || !Number.isInteger(maxInputTokens) || maxInputTokens < 1)
    throw new ThemeProviderAdapterError('invalid_configuration');
  return costMicros(maxInputTokens, rates.inputMicrosPerMillionTokens);
}

export function themeProviderPolicyFingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function refusal(response: ThemeResponsesResult): boolean {
  return Boolean(
    response.output?.some((item) => item.content?.some((content) => content.type === 'refusal'))
  );
}

export function createStructuredResponseProvider<Input, Output>(options: {
  transport: ThemeResponsesTransport;
  pricing: ThemeProviderPricing;
  policy: ThemeStructuredResponsePolicy;
  instructions: string;
  outputJsonSchema: ThemeJsonSchema;
  outputSchema: z.ZodType<Output>;
  serializeInput(input: Input): unknown;
  estimateInputTokens(request: ThemeResponsesRequest): number;
  now?: () => number;
}): ThemeRuntimeProvider<Input, Output> {
  const parsedPolicy = themeStructuredResponsePolicySchema.safeParse(options.policy);
  const parsedPricing = themeProviderPricingSchema.safeParse(options.pricing);
  if (
    !options.transport ||
    typeof options.transport.create !== 'function' ||
    !parsedPolicy.success ||
    !parsedPricing.success ||
    !options.instructions.trim() ||
    !jsonSchema.safeParse(options.outputJsonSchema).success ||
    typeof options.serializeInput !== 'function' ||
    typeof options.estimateInputTokens !== 'function'
  )
    throw new ThemeProviderAdapterError('invalid_configuration');
  const policy = deepFreeze(structuredClone(parsedPolicy.data));
  const pricing = deepFreeze(structuredClone(parsedPricing.data));
  const schema = deepFreeze(structuredClone(options.outputJsonSchema));
  const transport = options.transport;
  const instructions = options.instructions;
  const outputSchema = options.outputSchema;
  const serializeInput = options.serializeInput;
  const estimateInputTokens = options.estimateInputTokens;
  const reservedCostMicros = reserveStructuredResponseCostMicros(pricing, policy);
  const now = options.now ?? Date.now;
  const requestIdentity = deepFreeze({
    ...structuredClone(policy),
    instructionsHash: createHash('sha256').update(instructions).digest('hex'),
    schemaHash: themeProviderPolicyFingerprint(schema),
    pricingHash: themeProviderPolicyFingerprint(pricing),
    reservedCostMicros,
  });

  return Object.freeze({
    provider: policy.provider,
    model: policy.model,
    requestIdentity,
    reservedCostMicros,
    async invoke(input: Input): Promise<ThemeProviderInvocation<Output>> {
      const started = now();
      let body: ThemeResponsesRequest;
      try {
        const serialized = serializeInput(structuredClone(input));
        body = {
          model: policy.model,
          service_tier: policy.serviceTier,
          instructions,
          input: canonical(serialized),
          reasoning: { effort: policy.reasoningEffort },
          max_output_tokens: policy.maxOutputTokens,
          text: {
            format: {
              type: 'json_schema',
              name: policy.schemaName,
              strict: true,
              schema,
            },
          },
        };
      } catch {
        return failed('request_preparation_failed', { actualCostMicros: 0 }, null, started, now);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
      let response: ThemeResponsesResult | null = null;
      try {
        let estimatedInputTokens: number;
        try {
          estimatedInputTokens = estimateInputTokens(structuredClone(body));
        } catch {
          return failed('input_estimation_failed', { actualCostMicros: 0 }, null, started, now);
        }
        if (
          !Number.isInteger(estimatedInputTokens) ||
          estimatedInputTokens < 1 ||
          estimatedInputTokens > policy.maxInputTokens
        )
          return failed('input_token_ceiling', { actualCostMicros: 0 }, null, started, now);
        try {
          response = await transport.create(body, { signal: controller.signal, maxRetries: 0 });
        } catch {
          throw new ThemeProviderTransportError(
            controller.signal.aborted ? 'provider_timeout' : 'provider_outcome_unknown'
          );
        }
        if (
          response.status === 'queued' ||
          response.status === 'in_progress' ||
          response.model !== policy.model
        )
          throw new ThemeProviderTransportError('provider_outcome_unknown');
        const rawInputTokens = response.usage?.input_tokens;
        const rawOutputTokens = response.usage?.output_tokens;
        const rawCachedInputTokens = response.usage?.input_tokens_details?.cached_tokens ?? 0;
        if (
          !Number.isInteger(rawInputTokens) ||
          rawInputTokens! < 0 ||
          rawInputTokens! > 2_147_483_647 ||
          !Number.isInteger(rawCachedInputTokens) ||
          rawCachedInputTokens < 0 ||
          rawCachedInputTokens > rawInputTokens! ||
          !Number.isInteger(rawOutputTokens) ||
          rawOutputTokens! < 0 ||
          rawOutputTokens! > 2_147_483_647
        )
          return failed(
            'usage_missing',
            { actualCostMicros: reservedCostMicros },
            response,
            started,
            now
          );
        const inputTokens = rawInputTokens!;
        const outputTokens = rawOutputTokens!;
        const cachedInputTokens = rawCachedInputTokens;
        const uncachedInputTokens = inputTokens - cachedInputTokens;
        const rates = pricing.models[policy.model]!;
        const actualCostMicros =
          inputCostMicros(uncachedInputTokens, cachedInputTokens, rates) +
          costMicros(outputTokens, rates.outputMicrosPerMillionTokens);
        const base = {
          actualCostMicros,
          inputTokens,
          outputTokens,
        };
        if (refusal(response)) return failed('provider_refusal', base, response, started, now);
        if (response.status !== 'completed')
          return failed(
            response.status === 'incomplete' ? 'provider_incomplete' : 'provider_failed',
            base,
            response,
            started,
            now
          );
        let decoded: unknown;
        try {
          decoded = JSON.parse(response.output_text ?? '');
        } catch {
          return failed('invalid_output', base, response, started, now);
        }
        const parsed = outputSchema.safeParse(decoded);
        if (!parsed.success) return failed('invalid_output', base, response, started, now);
        return {
          value: parsed.data,
          outcome: { status: 'succeeded', ...base },
          metadata: metadata(response, started, now),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

function metadata(
  response: ThemeResponsesResult | null,
  started: number,
  now: () => number
): ThemeProviderMetadata {
  return {
    providerRequestId: response?.id ?? null,
    returnedModel: response?.model ?? null,
    latencyMs: Math.max(0, Math.round(now() - started)),
  };
}

function failed<T>(
  failureCode: string,
  usage: Pick<ThemeBudgetOutcome, 'actualCostMicros' | 'inputTokens' | 'outputTokens'>,
  response: ThemeResponsesResult | null,
  started: number,
  now: () => number
): ThemeProviderInvocation<T> {
  return {
    value: undefined as T,
    outcome: { status: 'failed', ...usage, failureCode },
    metadata: metadata(response, started, now),
  };
}

export type ThemeNestedProviderDispatch = <Input, Output>(request: {
  operation: Extract<ThemeBudgetOperation, 'review' | 'embed' | 'semantic_check'>;
  stableKey: string;
  provider: ThemeRuntimeProvider<Input, Output>;
  input: Input;
}) => Promise<Output>;

/**
 * Budget-aware seams for the three paid operations nested inside QA. The caller
 * supplies the durable gateway dispatch, so no operation can bypass admission.
 */
export function createBudgetedThemeQaTransports(options: {
  dispatch: ThemeNestedProviderDispatch;
  quality: ThemeRuntimeProvider<unknown, unknown>;
  embeddings: ThemeRuntimeProvider<readonly string[], readonly number[][]>;
  semantic: ThemeRuntimeProvider<unknown, unknown>;
  persistSemanticBatch(request: ThemeSemanticBatchPersistenceRequest): Promise<void>;
}) {
  if (
    !options ||
    typeof options.dispatch !== 'function' ||
    typeof options.persistSemanticBatch !== 'function' ||
    options.semantic?.requestIdentity === undefined
  )
    throw new ThemeProviderAdapterError('invalid_configuration');
  const semanticBatches = new Map<
    string,
    { fingerprint: string; result: Promise<readonly unknown[]> }
  >();
  return Object.freeze({
    quality<Input, Output>(candidateId: string, input: Input): Promise<Output> {
      return options.dispatch({
        operation: 'review',
        stableKey: `quality:${candidateId}`,
        provider: options.quality as ThemeRuntimeProvider<Input, Output>,
        input,
      });
    },
    embed(candidateId: string, input: readonly string[]): Promise<readonly number[][]> {
      return options.dispatch({
        operation: 'embed',
        stableKey: `embed:${candidateId}`,
        provider: options.embeddings,
        input,
      });
    },
    async adjudicateBatch<Input, Output>(
      candidateId: string,
      candidateContentHash: string,
      pairs: readonly Readonly<{ pairKey: string; input: Input }>[]
    ): Promise<readonly Output[]> {
      const batch = structuredClone(pairs);
      if (
        !candidateId.trim() ||
        !/^[a-f0-9]{64}$/.test(candidateContentHash) ||
        batch.length > MAX_THEME_SEMANTIC_ADJUDICATIONS ||
        new Set(batch.map(({ pairKey }) => pairKey)).size !== batch.length ||
        batch.some(({ pairKey }) => typeof pairKey !== 'string' || !pairKey.trim())
      )
        throw new ThemeProviderAdapterError('semantic_limit_exceeded');
      const semanticPolicyFingerprint = themeProviderPolicyFingerprint(
        options.semantic.requestIdentity
      );
      const fingerprint = themeProviderPolicyFingerprint({
        candidateContentHash,
        semanticPolicyFingerprint,
        batch,
      });
      const existing = semanticBatches.get(candidateId);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ThemeProviderAdapterError('semantic_limit_exceeded');
        return (await existing.result) as readonly Output[];
      }
      const result = (async () => {
        await options.persistSemanticBatch({
          candidateId,
          candidateContentHash,
          semanticPolicyFingerprint,
          pairs: batch,
        });
        const values: Output[] = [];
        for (const { pairKey, input } of batch)
          values.push(
            await options.dispatch({
              operation: 'semantic_check',
              stableKey: `semantic:${candidateId}:${pairKey}`,
              provider: options.semantic as ThemeRuntimeProvider<Input, Output>,
              input,
            })
          );
        return values;
      })();
      semanticBatches.set(candidateId, { fingerprint, result });
      try {
        return (await result) as readonly Output[];
      } catch (error) {
        if (semanticBatches.get(candidateId)?.result === result)
          semanticBatches.delete(candidateId);
        throw error;
      }
    },
  });
}
