import OpenAI from 'openai';
import type { Response } from 'openai/resources/responses/responses';

import type {
  ThemeEmbeddingsRequest,
  ThemeEmbeddingsResult,
  ThemeEmbeddingsTransport,
  ThemeResponsesRequest,
  ThemeResponsesResult,
  ThemeResponsesTransport,
} from './theme-provider-adapters';
import {
  bootstrapPostgresThemePreviewRuntime,
  type PostgresThemePreviewRuntimeOptions,
  type ThemePreviewRuntimePipelineBuilder,
} from './theme-preview-runtime';

export type ThemeOpenAIClient = Pick<OpenAI, 'responses' | 'embeddings'>;

export type ThemeOpenAITransports = Readonly<{
  responses: ThemeResponsesTransport;
  embeddings: ThemeEmbeddingsTransport;
}>;

export class ThemeOpenAIConnectionError extends Error {
  constructor(public readonly code: 'invalid_client' | 'invalid_credential') {
    super(code);
    this.name = 'ThemeOpenAIConnectionError';
  }
}

/**
 * Explicit credential boundary for the later owner-attended preview hookup.
 * This factory reads no environment variable and performs no network request.
 */
export function createThemeOpenAIClient(input: {
  apiKey: string;
  baseURL?: string;
}): ThemeOpenAIClient {
  if (typeof input.apiKey !== 'string' || !input.apiKey.trim())
    throw new ThemeOpenAIConnectionError('invalid_credential');

  return new OpenAI({
    apiKey: input.apiKey,
    baseURL: input.baseURL?.trim() || undefined,
    maxRetries: 0,
  });
}

function responseStatus(response: Response): ThemeResponsesResult['status'] {
  if (!response.status || response.status === 'cancelled') return 'failed';
  return response.status;
}

function responseOutput(response: Response): ThemeResponsesResult['output'] {
  return response.output.map((item) => {
    if (item.type !== 'message') return { type: item.type };
    return {
      type: item.type,
      content: item.content.map((content) => ({
        type: content.type,
        refusal: content.type === 'refusal' ? content.refusal : undefined,
      })),
    };
  });
}

/**
 * Concrete SDK transport only. Budget admission, timeouts, output validation,
 * model pinning and settlement remain owned by the existing provider adapters.
 */
export function createThemeOpenAITransports(client: ThemeOpenAIClient): ThemeOpenAITransports {
  if (
    !client ||
    typeof client.responses?.create !== 'function' ||
    typeof client.embeddings?.create !== 'function'
  )
    throw new ThemeOpenAIConnectionError('invalid_client');

  return Object.freeze({
    responses: Object.freeze({
      async create(
        request: ThemeResponsesRequest,
        options: Parameters<ThemeResponsesTransport['create']>[1]
      ): Promise<ThemeResponsesResult> {
        const response = await client.responses.create(request, {
          signal: options.signal,
          maxRetries: options.maxRetries,
        });
        return {
          id: response.id,
          model: response.model,
          status: responseStatus(response),
          output_text: response.output_text,
          incomplete_details: response.incomplete_details,
          error: response.error ? { code: response.error.code } : null,
          output: responseOutput(response),
          usage: response.usage
            ? {
                input_tokens: response.usage.input_tokens,
                input_tokens_details: {
                  cached_tokens: response.usage.input_tokens_details.cached_tokens,
                },
                output_tokens: response.usage.output_tokens,
              }
            : null,
        };
      },
    }),
    embeddings: Object.freeze({
      async create(
        request: ThemeEmbeddingsRequest,
        options: Parameters<ThemeEmbeddingsTransport['create']>[1]
      ): Promise<ThemeEmbeddingsResult> {
        const result = await client.embeddings
          .create(
            { ...request, input: [...request.input] },
            {
              signal: options.signal,
              maxRetries: options.maxRetries,
            }
          )
          .withResponse();
        return {
          id: result.request_id ?? undefined,
          model: result.data.model,
          data: result.data.data.map(({ index, embedding }) => ({ index, embedding })),
          usage: result.data.usage,
        };
      },
    }),
  });
}

export type OpenAIThemePreviewPipelineBuilder = (
  input: Parameters<ThemePreviewRuntimePipelineBuilder>[0] & {
    transports: ThemeOpenAITransports;
  }
) => ReturnType<ThemePreviewRuntimePipelineBuilder>;

export type OpenAIThemePreviewRuntimeOptions = Omit<
  PostgresThemePreviewRuntimeOptions,
  'buildPipeline'
> &
  Readonly<{
    /** Called lazily only after preview, runtime-control and stored-plan gates pass. */
    createClient: () => ThemeOpenAIClient;
    buildPipeline: OpenAIThemePreviewPipelineBuilder;
  }>;

/**
 * Adds the real provider connection seam without weakening the preview gates.
 * The returned scheduler stop handle remains the application shutdown seam.
 */
export async function bootstrapOpenAIThemePreviewRuntime(
  options: OpenAIThemePreviewRuntimeOptions
) {
  if (typeof options.createClient !== 'function' || typeof options.buildPipeline !== 'function')
    throw new ThemeOpenAIConnectionError('invalid_client');

  let transports: ThemeOpenAITransports | null = null;
  return bootstrapPostgresThemePreviewRuntime({
    ...options,
    buildPipeline: (input) => {
      transports ??= createThemeOpenAITransports(options.createClient());
      return options.buildPipeline({ ...input, transports });
    },
  });
}
