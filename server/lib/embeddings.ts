import { createHash } from 'node:crypto';
import OpenAI from 'openai';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;
export const EMBEDDING_PURPOSE = 'question';
export type EmbeddableQuestion = { id: string; question: string; answer: string };
export type CachedEmbedding = {
  questionId: string;
  contentHash: string;
  model: string;
  dimensions: number;
  purpose: string;
  vector: number[];
};
export interface EmbeddingCache {
  read(ids: string[]): Promise<CachedEmbedding[]>;
  write(question: EmbeddableQuestion, value: CachedEmbedding): Promise<void>;
}

export type SemanticFailureCategory =
  | 'configuration'
  | 'authentication'
  | 'rate_limit'
  | 'provider'
  | 'invalid_response'
  | 'cache'
  | 'deadline'
  | 'capacity'
  | 'mixed'
  | 'unknown';

/** Carries only a fixed safe category across the semantic pipeline. */
export class SemanticPipelineError extends Error {
  constructor(
    public readonly category: SemanticFailureCategory,
    options?: ErrorOptions
  ) {
    super(`Semantic pipeline failed (${category})`, options);
    this.name = 'SemanticPipelineError';
  }
}

export function contentHash(q: Pick<EmbeddableQuestion, 'question' | 'answer'>): string {
  return createHash('sha256')
    .update(JSON.stringify([q.question, q.answer]))
    .digest('hex');
}

export function validVector(vector: unknown, dimensions: number): vector is number[] {
  return (
    Array.isArray(vector) &&
    vector.length === dimensions &&
    vector.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    vector.some((n) => n !== 0)
  );
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!validVector(a, b.length) || !validVector(b, a.length)) {
    throw new Error('Invalid embedding vectors');
  }
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] ** 2;
    normB += b[i] ** 2;
  }
  return Math.max(0, Math.min(1, dot / Math.sqrt(normA * normB)));
}

let client: OpenAI | undefined;
export function semanticClient(): OpenAI {
  return (client ??= new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    timeout: 30_000,
    maxRetries: 2,
  }));
}

let embeddingsClient: OpenAI | undefined;
export function semanticEmbeddingsClient(): OpenAI {
  const dedicatedKey =
    process.env.OPENAI_EMBEDDINGS_API_KEY ?? process.env.OPENAI_API_KEY;
  const apiKey = dedicatedKey ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) throw new SemanticPipelineError('configuration');
  return (embeddingsClient ??= new OpenAI({
    // The Replit chat integration currently does not necessarily expose /embeddings.
    // A dedicated compatible provider can be configured without changing chat traffic.
    apiKey,
    baseURL: dedicatedKey
      ? process.env.OPENAI_EMBEDDINGS_BASE_URL ?? process.env.OPENAI_BASE_URL
      : process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    timeout: 30_000,
    maxRetries: 2,
  }));
}

function providerFailureCategory(error: unknown): SemanticFailureCategory {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status?: unknown }).status
      : undefined;
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (status === 401 || status === 403) return 'authentication';
  if (status === 429) return 'rate_limit';
  if (
    code === 'INVALID_ENDPOINT' ||
    code === 'invalid_api_key' ||
    (typeof status === 'number' && status >= 400 && status < 500)
  )
    return 'configuration';
  return 'provider';
}

// An aborted stage must return promptly even if a database request is still finishing.
// Provider calls also receive the signal, so cancellation stops their retries.
export async function withinDeadline<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new SemanticPipelineError('deadline');
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new SemanticPipelineError('deadline'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

function throwIfSemanticAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new SemanticPipelineError('deadline');
}

export const databaseEmbeddingCache: EmbeddingCache = {
  async read(ids) {
    const { pool } = await import('../db');
    const result = await pool.query<CachedEmbedding>({
      text: `SELECT question_id AS "questionId", content_hash AS "contentHash", model,
        dimensions, purpose, vector FROM question_embeddings WHERE question_id = ANY($1::varchar[])`,
      values: [ids],
    });
    return result.rows;
  },
  async write(q, entry) {
    const { pool } = await import('../db');
    // INSERT ... SELECT never writes unsaved candidates or rows edited/deleted since the snapshot.
    await pool.query({
      text: `INSERT INTO question_embeddings (question_id, content_hash, model, dimensions, purpose, vector)
        SELECT id, $4, $5, $6, $7, $8::jsonb FROM questions
        WHERE id = $1 AND question = $2 AND answer = $3
        ON CONFLICT (question_id) DO UPDATE SET content_hash = EXCLUDED.content_hash,
        model = EXCLUDED.model, dimensions = EXCLUDED.dimensions, purpose = EXCLUDED.purpose,
        vector = EXCLUDED.vector, updated_at = now()`,
      values: [
        q.id,
        q.question,
        q.answer,
        entry.contentHash,
        entry.model,
        entry.dimensions,
        entry.purpose,
        JSON.stringify(entry.vector),
      ],
    });
  },
};

export async function embedQuestions(
  questions: EmbeddableQuestion[],
  options: { signal: AbortSignal; cache?: EmbeddingCache | null; persistIds?: ReadonlySet<string> }
): Promise<Map<string, number[]>> {
  const { signal, persistIds } = options;
  const cache = options.cache === undefined ? databaseEmbeddingCache : options.cache;
  const vectors = new Map<string, number[]>();
  const byContent = new Map<string, number[]>();
  let cacheHits = 0,
    tokens = 0,
    requests = 0;
  const start = Date.now();
  for (let offset = 0; offset < questions.length; offset += 64) {
    throwIfSemanticAborted(signal);
    const chunk = questions.slice(offset, offset + 64);
    const saved = chunk.filter((q) => !persistIds || persistIds.has(q.id));
    let cached: CachedEmbedding[] = [];
    if (cache && saved.length) {
      try {
        cached = await withinDeadline(cache.read(saved.map((q) => q.id)), signal);
      } catch (error) {
        if (error instanceof SemanticPipelineError) throw error;
        throw new SemanticPipelineError('cache', { cause: error });
      }
    }
    const lookup = new Map(cached.map((entry) => [entry.questionId, entry]));
    for (const q of chunk) {
      const entry = lookup.get(q.id);
      if (
        entry?.contentHash === contentHash(q) &&
        entry.model === EMBEDDING_MODEL &&
        entry.dimensions === EMBEDDING_DIMENSIONS &&
        entry.purpose === EMBEDDING_PURPOSE &&
        validVector(entry.vector, EMBEDDING_DIMENSIONS)
      ) {
        vectors.set(q.id, entry.vector);
        byContent.set(q.question, entry.vector);
        cacheHits++;
      }
    }
    const missing = Array.from(
      new Set(
        chunk.filter((q) => !vectors.has(q.id) && !byContent.has(q.question)).map((q) => q.question)
      )
    );
    if (missing.some((text) => !text.trim() || text.length > 16_000)) {
      throw new Error('Question text cannot be embedded safely');
    }
    if (missing.length) {
      let response;
      try {
        response = await withinDeadline(
          semanticEmbeddingsClient().embeddings.create(
            {
              model: EMBEDDING_MODEL,
              dimensions: EMBEDDING_DIMENSIONS,
              input: missing,
              encoding_format: 'float',
            },
            { signal }
          ),
          signal
        );
      } catch (error) {
        if (error instanceof SemanticPipelineError) throw error;
        throw new SemanticPipelineError(providerFailureCategory(error), { cause: error });
      }
      requests++;
      tokens += response.usage?.total_tokens ?? 0;
      const seen = new Set<number>();
      for (const entry of response.data) {
        if (
          !Number.isInteger(entry.index) ||
          entry.index < 0 ||
          entry.index >= missing.length ||
          seen.has(entry.index) ||
          !validVector(entry.embedding, EMBEDDING_DIMENSIONS)
        ) {
          throw new SemanticPipelineError('invalid_response');
        }
        seen.add(entry.index);
        byContent.set(missing[entry.index], entry.embedding);
      }
      if (seen.size !== missing.length) throw new SemanticPipelineError('invalid_response');
    }
    for (const q of chunk) {
      if (vectors.has(q.id)) continue;
      const vector = byContent.get(q.question)!;
      vectors.set(q.id, vector);
      throwIfSemanticAborted(signal);
      if (cache && (!persistIds || persistIds.has(q.id))) {
        try {
          await withinDeadline(
            cache.write(q, {
              questionId: q.id,
              contentHash: contentHash(q),
              model: EMBEDDING_MODEL,
              dimensions: EMBEDDING_DIMENSIONS,
              purpose: EMBEDDING_PURPOSE,
              vector,
            }),
            signal
          );
        } catch (error) {
          if (error instanceof SemanticPipelineError) throw error;
          throw new SemanticPipelineError('cache', { cause: error });
        }
      }
    }
  }
  console.info('[semantic] embeddings', {
    model: EMBEDDING_MODEL,
    questions: questions.length,
    cacheHits,
    requests,
    tokens,
    elapsedMs: Date.now() - start,
  });
  return vectors;
}
