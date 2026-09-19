import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  contentHash,
  cosineSimilarity,
  embedQuestions,
  databaseEmbeddingCache,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  SemanticPipelineError,
  type CachedEmbedding,
} from './embeddings';
const mocks = vi.hoisted(() => ({ create: vi.fn(), query: vi.fn() }));
vi.mock('openai', () => ({
  default: class {
    embeddings = { create: mocks.create };
  },
}));
vi.mock('../db', () => ({ pool: { query: mocks.query } }));
const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
const question = { id: 'saved', question: 'Which author wrote this book?', answer: 'A writer' };
const signal = () => new AbortController().signal;
// The production client intentionally fails fast when no provider credential is
// configured; provider behavior in this unit suite is supplied by the SDK mock.
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||= 'unit-test-key';
const cached = (): CachedEmbedding => ({
  questionId: question.id,
  contentHash: contentHash(question),
  model: EMBEDDING_MODEL,
  dimensions: EMBEDDING_DIMENSIONS,
  purpose: 'question',
  vector,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockImplementation(async ({ input }: { input: string[] }) => ({
    data: input.map((_q, index) => ({ index, embedding: vector })),
    usage: { total_tokens: 10 },
  }));
  mocks.query.mockResolvedValue({ rows: [] });
});
describe('embedding cache and scoring', () => {
  it('calculates cosine similarity and rejects malformed vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(() => cosineSimilarity([0, 0], [0, 1])).toThrow();
    expect(() => cosineSimilarity([NaN], [1])).toThrow();
    expect(() => cosineSimilarity([1, 2], [1])).toThrow();
  });
  it('does not call the provider on a valid cache hit', async () => {
    const cache = { read: vi.fn().mockResolvedValue([cached()]), write: vi.fn() };
    expect((await embedQuestions([question], { signal: signal(), cache })).get('saved')).toEqual(
      vector
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(cache.write).not.toHaveBeenCalled();
  });
  it.each(['contentHash', 'model', 'dimensions', 'purpose', 'vector'] as const)(
    'regenerates stale or malformed %s',
    async (field) => {
      const entry = {
        ...cached(),
        [field]: field === 'dimensions' ? 2 : field === 'vector' ? [0] : 'old',
      };
      const cache = { read: vi.fn().mockResolvedValue([entry]), write: vi.fn() };
      await embedQuestions([question], { signal: signal(), cache });
      expect(mocks.create).toHaveBeenCalledTimes(1);
      expect(cache.write).toHaveBeenCalledTimes(1);
    }
  );
  it('invalidates on either question or answer edit', () => {
    expect(contentHash({ ...question, answer: 'new' })).not.toBe(contentHash(question));
    expect(contentHash({ ...question, question: 'new' })).not.toBe(contentHash(question));
  });
  it('batches and deduplicates repeated text and never persists unsaved IDs', async () => {
    const cache = { read: vi.fn().mockResolvedValue([]), write: vi.fn() };
    const qs = [question, { ...question, id: 'unsaved' }];
    const result = await embedQuestions(qs, {
      signal: signal(),
      cache,
      persistIds: new Set(['saved']),
    });
    expect(mocks.create.mock.calls[0][0].input).toEqual([question.question]);
    expect(cache.read).toHaveBeenCalledWith(['saved']);
    expect(cache.write).toHaveBeenCalledTimes(1);
    expect(result.size).toBe(2);
  });
  it('maps out-of-order provider results by index', async () => {
    const other = vector.map((n, i) => (i === 0 ? 0 : i === 1 ? 1 : n));
    mocks.create.mockResolvedValue({
      data: [
        { index: 1, embedding: other },
        { index: 0, embedding: vector },
      ],
    });
    const r = await embedQuestions(
      [question, { ...question, id: 'other', question: 'Different?' }],
      { signal: signal(), cache: null }
    );
    expect(r.get('saved')).toEqual(vector);
    expect(r.get('other')).toEqual(other);
  });
  it('rejects missing and invalid embedding responses', async () => {
    mocks.create.mockResolvedValue({ data: [] });
    await expect(embedQuestions([question], { signal: signal(), cache: null })).rejects.toMatchObject(
      { category: 'invalid_response' }
    );
    mocks.create.mockResolvedValue({ data: [{ index: 0, embedding: [NaN] }] });
    await expect(embedQuestions([question], { signal: signal(), cache: null })).rejects.toMatchObject(
      { category: 'invalid_response' }
    );
  });
  it('classifies an unsupported embeddings endpoint without exposing provider text', async () => {
    mocks.create.mockRejectedValue(
      Object.assign(new Error('sensitive provider response'), {
        status: 400,
        code: 'INVALID_ENDPOINT',
      })
    );
    const failure = await embedQuestions([question], { signal: signal(), cache: null }).catch(
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(SemanticPipelineError);
    expect(failure).toMatchObject({ category: 'configuration' });
    expect(failure.message).not.toContain('sensitive provider response');
  });
  it('fails rather than ignore a cache outage', async () => {
    const cache = { read: vi.fn().mockRejectedValue(new Error('offline')), write: vi.fn() };
    await expect(embedQuestions([question], { signal: signal(), cache })).rejects.toBeInstanceOf(
      SemanticPipelineError
    );
    await expect(embedQuestions([question], { signal: signal(), cache })).rejects.toMatchObject({
      category: 'cache',
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects an expired stage before starting paid work', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      embedQuestions([question], { signal: controller.signal, cache: null })
    ).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('uses parameterized persistence conditional on the current saved question content', async () => {
    await databaseEmbeddingCache.write(question, cached());
    const query = mocks.query.mock.calls[0][0];
    expect(query.text).toContain('WHERE id = $1 AND question = $2 AND answer = $3');
    expect(query.values.slice(0, 3)).toEqual([question.id, question.question, question.answer]);
    expect(query.text).not.toContain(question.answer);
  });
});
