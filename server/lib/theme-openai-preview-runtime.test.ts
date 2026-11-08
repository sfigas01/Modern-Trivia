import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ bootstrap: vi.fn() }));

vi.mock('./theme-preview-runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('./theme-preview-runtime')>();
  return { ...original, bootstrapPostgresThemePreviewRuntime: mocks.bootstrap };
});

import type { ThemeEmbeddingsRequest, ThemeResponsesRequest } from './theme-provider-adapters';
import {
  bootstrapOpenAIThemePreviewRuntime,
  createThemeOpenAIClient,
  createThemeOpenAITransports,
  ThemeOpenAIConnectionError,
  type ThemeOpenAIClient,
} from './theme-openai-preview-runtime';

const responseRequest: ThemeResponsesRequest = {
  model: 'test-model',
  service_tier: 'default',
  instructions: 'Return a reviewed result.',
  input: '{"candidate":"example"}',
  reasoning: { effort: 'low' },
  max_output_tokens: 100,
  text: {
    format: {
      type: 'json_schema',
      name: 'review_result',
      strict: true,
      schema: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
};

function fakeClient() {
  const withResponse = vi.fn().mockResolvedValue({
    request_id: 'req_embedding',
    data: {
      model: 'text-embedding-3-small',
      data: [{ index: 0, embedding: [0.25, 0.75] }],
      usage: { prompt_tokens: 3, total_tokens: 3 },
    },
  });
  const responsesCreate = vi.fn().mockResolvedValue({
    id: 'resp_1',
    model: 'test-model',
    status: 'completed',
    output_text: '{"ok":true}',
    incomplete_details: null,
    error: null,
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: '{"ok":true}', annotations: [], logprobs: [] }],
      },
    ],
    usage: {
      input_tokens: 12,
      input_tokens_details: { cached_tokens: 4 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 17,
    },
  });
  const embeddingsCreate = vi.fn(() => ({ withResponse }));
  return {
    client: {
      responses: { create: responsesCreate },
      embeddings: { create: embeddingsCreate },
    } as unknown as ThemeOpenAIClient,
    responsesCreate,
    embeddingsCreate,
    withResponse,
  };
}

describe('OpenAI theme transports', () => {
  it('forwards strict Responses requests with retries disabled and maps auditable metadata', async () => {
    const fake = fakeClient();
    const transports = createThemeOpenAITransports(fake.client);
    const controller = new AbortController();

    const result = await transports.responses.create(responseRequest, {
      signal: controller.signal,
      maxRetries: 0,
    });

    expect(fake.responsesCreate).toHaveBeenCalledWith(responseRequest, {
      signal: controller.signal,
      maxRetries: 0,
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'resp_1',
        model: 'test-model',
        status: 'completed',
        output_text: '{"ok":true}',
        usage: {
          input_tokens: 12,
          input_tokens_details: { cached_tokens: 4 },
          output_tokens: 5,
        },
      })
    );
  });

  it('captures embedding request IDs and usage without changing vector order', async () => {
    const fake = fakeClient();
    const transports = createThemeOpenAITransports(fake.client);
    const controller = new AbortController();
    const request: ThemeEmbeddingsRequest = {
      model: 'text-embedding-3-small',
      input: ['example'],
      dimensions: 2,
      encoding_format: 'float',
    };

    const result = await transports.embeddings.create(request, {
      signal: controller.signal,
      maxRetries: 0,
    });

    expect(fake.embeddingsCreate).toHaveBeenCalledWith(request, {
      signal: controller.signal,
      maxRetries: 0,
    });
    expect(fake.withResponse).toHaveBeenCalledOnce();
    expect(result).toEqual({
      id: 'req_embedding',
      model: 'text-embedding-3-small',
      data: [{ index: 0, embedding: [0.25, 0.75] }],
      usage: { prompt_tokens: 3, total_tokens: 3 },
    });
  });

  it('requires an explicitly supplied credential but does not make a request', () => {
    expect(() => createThemeOpenAIClient({ apiKey: ' ' })).toThrow(
      new ThemeOpenAIConnectionError('invalid_credential')
    );
    expect(createThemeOpenAIClient({ apiKey: 'test-not-a-real-key' })).toBeDefined();
  });
});

describe('OpenAI preview runtime connection', () => {
  it('does not construct a client when the gated preview runtime stays inert', async () => {
    mocks.bootstrap.mockResolvedValueOnce({ started: false, code: 'scheduler_disabled' });
    const createClient = vi.fn();
    const buildPipeline = vi.fn();

    const result = await bootstrapOpenAIThemePreviewRuntime({
      pool: {} as never,
      repositories: {} as never,
      pipelineMaxCallbackMs: 120_000,
      createClient,
      buildPipeline,
    });

    expect(result).toEqual({ started: false, code: 'scheduler_disabled' });
    expect(createClient).not.toHaveBeenCalled();
    expect(buildPipeline).not.toHaveBeenCalled();
  });

  it('constructs one shared client only after the stored-plan pipeline callback runs', async () => {
    const fake = fakeClient();
    const createClient = vi.fn(() => fake.client);
    const buildPipeline = vi.fn(() => ({}) as never);
    mocks.bootstrap.mockImplementationOnce(async (options) => {
      const input = {
        jobId: 'job-1',
        loadedPlan: { planVersion: 'v1' },
        context: {},
      } as never;
      options.buildPipeline(input);
      options.buildPipeline(input);
      return { started: true, enqueue: vi.fn(), stop: vi.fn() };
    });

    const result = await bootstrapOpenAIThemePreviewRuntime({
      pool: {} as never,
      repositories: {} as never,
      pipelineMaxCallbackMs: 120_000,
      createClient,
      buildPipeline,
    });

    expect(result.started).toBe(true);
    expect(createClient).toHaveBeenCalledOnce();
    expect(buildPipeline).toHaveBeenCalledTimes(2);
    expect(buildPipeline.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        jobId: 'job-1',
        transports: expect.objectContaining({
          responses: expect.any(Object),
          embeddings: expect.any(Object),
        }),
      })
    );
  });
});
