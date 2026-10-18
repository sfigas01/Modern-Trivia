import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  MAX_THEME_SEMANTIC_ADJUDICATIONS,
  THEME_PROVIDER_ADAPTER_VERSION,
  ThemeProviderAdapterError,
  ThemeProviderTransportError,
  createBudgetedThemeQaTransports,
  createStructuredResponseProvider,
  reserveEmbeddingCostMicros,
  reserveStructuredResponseCostMicros,
  type ThemeProviderPricing,
  type ThemeResponsesResult,
  type ThemeResponsesTransport,
  type ThemeStructuredResponsePolicy,
} from './theme-provider-adapters';

const pricing = {
  version: 'openai-standard-2026-10-17',
  currency: 'USD',
  models: {
    'gpt-6-luna': {
      inputMicrosPerMillionTokens: 125_000,
      outputMicrosPerMillionTokens: 500_000,
    },
    'gpt-6.1-sol': {
      inputMicrosPerMillionTokens: 2_500_000,
      outputMicrosPerMillionTokens: 10_000_000,
    },
  },
  embeddings: {
    'text-embedding-3-small': { inputMicrosPerMillionTokens: 20_000 },
  },
} satisfies ThemeProviderPricing;

const policy = {
  adapterVersion: THEME_PROVIDER_ADAPTER_VERSION,
  policyVersion: 'fact-proposal-v1',
  promptVersion: 'fact-proposal-prompt-v1',
  provider: 'openai',
  model: 'gpt-6-luna',
  reasoningEffort: 'low',
  maxInputTokens: 6_000,
  maxOutputTokens: 1_000,
  timeoutMs: 5_000,
  maxRetries: 0,
  inputEstimatorVersion: 'fixture-token-estimator-v1',
  schemaName: 'fact_proposal',
  schemaVersion: 'fact-proposal-schema-v1',
  pricingVersion: pricing.version,
} satisfies ThemeStructuredResponsePolicy;

const outputSchema = z.object({ answer: z.string() }).strict();
const outputJsonSchema = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
};

function transport(result: ThemeResponsesResult) {
  return { create: vi.fn().mockResolvedValue(result) } satisfies ThemeResponsesTransport;
}

describe('theme provider pricing', () => {
  it('rounds each conservative token ceiling upward in micro-dollars', () => {
    expect(reserveStructuredResponseCostMicros(pricing, policy)).toBe(1_250);
    expect(
      reserveEmbeddingCostMicros(pricing, pricing.version, 'text-embedding-3-small', 10_000)
    ).toBe(200);
  });

  it('rejects stale pricing identities and missing models', () => {
    expect(() =>
      reserveStructuredResponseCostMicros(pricing, { ...policy, pricingVersion: 'stale' })
    ).toThrowError(expect.objectContaining({ code: 'invalid_configuration' }));
    expect(() =>
      reserveStructuredResponseCostMicros(pricing, { ...policy, model: 'unknown' })
    ).toThrowError(expect.objectContaining({ code: 'invalid_configuration' }));
  });
});

describe('createStructuredResponseProvider', () => {
  it('sends a strict Responses request and returns measured usage metadata', async () => {
    const fixture = transport({
      id: 'resp_fixture_1',
      model: policy.model,
      status: 'completed',
      output_text: JSON.stringify({ answer: 'San Diego' }),
      usage: { input_tokens: 101, output_tokens: 23 },
    });
    let clock = 1_000;
    const provider = createStructuredResponseProvider({
      transport: fixture,
      pricing,
      policy,
      instructions: 'Use only the supplied evidence.',
      outputJsonSchema,
      outputSchema,
      serializeInput: (input: { evidence: string }) => input,
      estimateInputTokens: () => 101,
      now: () => (clock += 25),
    });

    const result = await provider.invoke({ evidence: 'The final was in San Diego.' });

    expect(fixture.create).toHaveBeenCalledTimes(1);
    expect(fixture.create.mock.calls[0][1]).toMatchObject({ maxRetries: 0 });
    expect(fixture.create.mock.calls[0][0]).toEqual({
      model: policy.model,
      instructions: 'Use only the supplied evidence.',
      input: '{"evidence":"The final was in San Diego."}',
      reasoning: { effort: 'low' },
      max_output_tokens: 1_000,
      text: {
        format: {
          type: 'json_schema',
          name: 'fact_proposal',
          strict: true,
          schema: outputJsonSchema,
        },
      },
    });
    expect(result).toEqual({
      value: { answer: 'San Diego' },
      outcome: {
        status: 'succeeded',
        actualCostMicros: 25,
        inputTokens: 101,
        outputTokens: 23,
      },
      metadata: {
        providerRequestId: 'resp_fixture_1',
        returnedModel: policy.model,
        latencyMs: 25,
      },
    });
    expect(provider.reservedCostMicros).toBe(1_250);
    expect(provider.requestIdentity).toMatchObject({
      adapterVersion: THEME_PROVIDER_ADAPTER_VERSION,
      maxRetries: 0,
      timeoutMs: 5_000,
      reservedCostMicros: 1_250,
    });
    expect(Object.isFrozen(provider.requestIdentity)).toBe(true);
  });

  it('snapshots mutable construction options under the original identity', async () => {
    const original = transport({
      id: 'resp_original',
      model: policy.model,
      status: 'completed',
      output_text: '{"answer":"original"}',
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const replacement = transport({
      id: 'resp_replacement',
      model: policy.model,
      status: 'completed',
      output_text: '{"answer":"replacement"}',
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const mutable = {
      transport: original as ThemeResponsesTransport,
      pricing,
      policy,
      instructions: 'Original instructions.',
      outputJsonSchema,
      outputSchema,
      serializeInput: (input: unknown) => input,
      estimateInputTokens: () => 10,
    };
    const provider = createStructuredResponseProvider(mutable);
    mutable.transport = replacement;
    mutable.instructions = 'Replacement instructions.';
    mutable.serializeInput = () => ({ changed: true });
    mutable.estimateInputTokens = () => policy.maxInputTokens + 1;

    await expect(provider.invoke({ evidence: 'fixture' })).resolves.toMatchObject({
      value: { answer: 'original' },
    });
    expect(original).toHaveProperty('create');
    expect(original.create).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: 'Original instructions.',
        input: '{"evidence":"fixture"}',
      }),
      expect.objectContaining({ maxRetries: 0 })
    );
    expect(replacement.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'refusal',
      {
        id: 'resp_refusal',
        model: policy.model,
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] }],
        usage: { input_tokens: 10, output_tokens: 2 },
      },
      'provider_refusal',
    ],
    [
      'incomplete',
      {
        id: 'resp_incomplete',
        model: policy.model,
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        usage: { input_tokens: 10, output_tokens: 1_000 },
      },
      'provider_incomplete',
    ],
    [
      'invalid schema',
      {
        id: 'resp_invalid',
        model: policy.model,
        status: 'completed',
        output_text: JSON.stringify({ answer: 42 }),
        usage: { input_tokens: 10, output_tokens: 10 },
      },
      'invalid_output',
    ],
  ])('fails closed for %s', async (_name, response, failureCode) => {
    const provider = createStructuredResponseProvider({
      transport: transport(response),
      pricing,
      policy,
      instructions: 'Use evidence.',
      outputJsonSchema,
      outputSchema,
      serializeInput: (input) => input,
      estimateInputTokens: () => 10,
    });
    const result = await provider.invoke({ evidence: 'fixture' });
    expect(result.outcome).toMatchObject({ status: 'failed', failureCode });
    expect(result.value).toBeUndefined();
  });

  it.each([
    ['queued', 'queued'],
    ['in progress', 'in_progress'],
    ['model mismatch', 'completed'],
  ] as const)('preserves %s responses as unknown outcomes', async (name, status) => {
    const provider = createStructuredResponseProvider({
      transport: transport({
        id: `resp_${name.replaceAll(' ', '_')}`,
        model: name === 'model mismatch' ? 'gpt-6-luna-changed' : policy.model,
        status,
        output_text: '{"answer":"unused"}',
      }),
      pricing,
      policy,
      instructions: 'Use evidence.',
      outputJsonSchema,
      outputSchema,
      serializeInput: (input) => input,
      estimateInputTokens: () => 10,
    });

    await expect(provider.invoke({ evidence: 'fixture' })).rejects.toEqual(
      expect.objectContaining<Partial<ThemeProviderTransportError>>({
        code: 'provider_outcome_unknown',
      })
    );
  });

  it('charges the full reservation when usage is missing or unsafe', async () => {
    const provider = createStructuredResponseProvider({
      transport: transport({
        id: 'resp_bad_usage',
        model: policy.model,
        status: 'failed',
        usage: { input_tokens: 2_147_483_648, output_tokens: 1 },
      }),
      pricing,
      policy,
      instructions: 'Use evidence.',
      outputJsonSchema,
      outputSchema,
      serializeInput: (input) => input,
      estimateInputTokens: () => 10,
    });

    await expect(provider.invoke({ evidence: 'fixture' })).resolves.toMatchObject({
      outcome: {
        status: 'failed',
        actualCostMicros: provider.reservedCostMicros,
        failureCode: 'usage_missing',
      },
    });
  });

  it('preserves transport failures as unknown outcomes without retrying', async () => {
    const fixture = {
      create: vi.fn().mockRejectedValue(new Error('fixture failure')),
    } satisfies ThemeResponsesTransport;
    const provider = createStructuredResponseProvider({
      transport: fixture,
      pricing,
      policy,
      instructions: 'Use evidence.',
      outputJsonSchema,
      outputSchema,
      serializeInput: (input) => input,
      estimateInputTokens: () => 10,
    });

    await expect(provider.invoke({ evidence: 'fixture' })).rejects.toEqual(
      expect.objectContaining<Partial<ThemeProviderTransportError>>({
        code: 'provider_outcome_unknown',
      })
    );
    expect(fixture.create).toHaveBeenCalledTimes(1);
  });

  it('rejects input above the pinned ceiling before dispatch', async () => {
    const fixture = transport({
      id: 'unused',
      model: policy.model,
      status: 'completed',
      output_text: '{"answer":"unused"}',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const provider = createStructuredResponseProvider({
      transport: fixture,
      pricing,
      policy,
      instructions: 'Use evidence.',
      outputJsonSchema,
      outputSchema,
      serializeInput: (input) => input,
      estimateInputTokens: () => policy.maxInputTokens + 1,
    });

    const result = await provider.invoke({ evidence: 'fixture' });

    expect(fixture.create).not.toHaveBeenCalled();
    expect(result.outcome).toEqual({
      status: 'failed',
      actualCostMicros: 0,
      failureCode: 'input_token_ceiling',
    });
  });
});

describe('createBudgetedThemeQaTransports', () => {
  it('routes nested QA and embedding work through the supplied dispatch', async () => {
    const provider = createStructuredResponseProvider({
      transport: transport({
        id: 'unused',
        model: policy.model,
        status: 'completed',
        output_text: '{"answer":"ok"}',
      }),
      pricing,
      policy,
      instructions: 'Use evidence.',
      outputJsonSchema,
      outputSchema,
      serializeInput: (input) => input,
      estimateInputTokens: () => 10,
    });
    const dispatch = vi.fn(async ({ operation }: { operation: string }) => operation);
    const seams = createBudgetedThemeQaTransports({
      dispatch: dispatch as never,
      quality: provider,
      embeddings: provider as never,
      semantic: provider,
    });

    await expect(seams.quality('candidate-1', { question: 'Q?' })).resolves.toBe('review');
    await expect(seams.embed('candidate-1', ['Q?'])).resolves.toBe('embed');
    await expect(
      seams.adjudicateBatch('candidate-1', [{ pairKey: 'pair-a', input: {} }])
    ).resolves.toEqual(['semantic_check']);
    expect(dispatch.mock.calls.map(([request]) => request.stableKey)).toEqual([
      'quality:candidate-1',
      'embed:candidate-1',
      'semantic:candidate-1:pair-a',
    ]);
  });

  it('allows at most four semantic pair calls per candidate', async () => {
    const dispatch = vi.fn(async () => ({ verdict: 'distinct' }));
    const placeholder = {} as never;
    const seams = createBudgetedThemeQaTransports({
      dispatch: dispatch as never,
      quality: placeholder,
      embeddings: placeholder,
      semantic: placeholder,
    });

    const pairs = Array.from({ length: MAX_THEME_SEMANTIC_ADJUDICATIONS }, (_, index) => ({
      pairKey: `pair-${index}`,
      input: {},
    }));
    await expect(seams.adjudicateBatch('candidate-1', pairs)).resolves.toHaveLength(4);
    await expect(
      seams.adjudicateBatch('candidate-1', [...pairs, { pairKey: 'pair-4', input: {} }])
    ).rejects.toEqual(
      expect.objectContaining<Partial<ThemeProviderAdapterError>>({
        code: 'semantic_limit_exceeded',
      })
    );
    expect(dispatch).toHaveBeenCalledTimes(4);
    await expect(
      seams.adjudicateBatch('candidate-2', [{ pairKey: 'pair-0', input: {} }])
    ).resolves.toEqual([{ verdict: 'distinct' }]);
  });

  it('snapshots the semantic batch before the first dispatch awaits', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatch = vi.fn(async () => {
      await gate;
      return { verdict: 'distinct' };
    });
    const placeholder = {} as never;
    const seams = createBudgetedThemeQaTransports({
      dispatch: dispatch as never,
      quality: placeholder,
      embeddings: placeholder,
      semantic: placeholder,
    });
    const pairs = [{ pairKey: 'pair-0', input: {} }];

    const pending = seams.adjudicateBatch('candidate-1', pairs);
    pairs.push({ pairKey: 'pair-added-late', input: {} });
    release();

    await expect(pending).resolves.toEqual([{ verdict: 'distinct' }]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
