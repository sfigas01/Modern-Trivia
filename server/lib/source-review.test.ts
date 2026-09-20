import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSourceReview,
  hasCurrentSourceReview,
  hasStrictQualityPass,
  isAllowedSource,
  retrieveSource,
  verifyQuestionSource,
} from './source-review';

const create = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));
const q = {
  id: 'q1',
  question: 'Where was the 2006 World Baseball Classic final played?',
  answer: 'Tokyo',
  acceptableAnswers: [],
  explanation: 'The championship game venue.',
  category: 'Sports' as const,
  pillar: 'GlobalEh' as const,
  difficulty: 'Medium' as const,
  sourceUrl: 'https://www.mlb.com/world-baseball-classic/history/2006',
  sourceName: 'MLB',
};
const text =
  'The 2006 World Baseball Classic final was played at Petco Park in San Diego. This account documents the championship game, not the earlier pool games.';
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(text, { headers: { 'content-type': 'text/plain' } }))
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('source evidence', () => {
  it.each([
    'http://www.mlb.com/x',
    'https://127.0.0.1/x',
    'https://www.mlb.com.evil.example/x',
    'https://name:password@www.mlb.com/x',
    'https://www.mlb.com:8443/x',
    'file:///etc/passwd',
  ])('rejects unapproved URL %s', async (url) => {
    expect(isAllowedSource(url)).toBe(false);
    await expect(retrieveSource(url)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not follow redirects and uses a timeout', async () => {
    await retrieveSource(q.sourceUrl);
    expect(fetch).toHaveBeenCalledWith(
      q.sourceUrl,
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })
    );
  });
  it('rejects oversized responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('x'.repeat(1_000_001), { headers: { 'content-type': 'text/plain' } })
    );
    await expect(retrieveSource(q.sourceUrl)).rejects.toThrow('size limit');
  });
  it.each(['factual', 'scope', 'explanation', 'aliases'])(
    'withholds a question with unsupported %s',
    async (key) => {
      create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                factual: 'pass',
                scope: 'pass',
                explanation: 'pass',
                aliases: 'pass',
                [key]: 'flag',
                quotes: ['Petco Park in San Diego'],
              }),
            },
          },
        ],
      });
      expect(await verifyQuestionSource(q)).toBeNull();
      expect(create.mock.calls[0][0].messages[1].content).toContain(text);
    }
  );
  it('rejects invented source quotations even when every model verdict passes', async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              factual: 'pass',
              scope: 'pass',
              explanation: 'pass',
              aliases: 'pass',
              quotes: ['The final took place in Tokyo.'],
            }),
          },
        },
      ],
    });
    expect(await verifyQuestionSource(q)).toBeNull();
  });
  it('rejects a wrong answer even when the model passes and quotes a real passage', async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              factual: 'pass',
              scope: 'pass',
              explanation: 'pass',
              aliases: 'pass',
              quotes: ['Petco Park in San Diego'],
            }),
          },
        },
      ],
    });
    expect(await verifyQuestionSource(q)).toBeNull();
  });
  it('withholds missing evidence fields and unreadable sources', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: '{"factual":"pass"}' } }] });
    expect(await verifyQuestionSource(q)).toBeNull();
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    expect(await verifyQuestionSource(q)).toBeNull();
  });
  it('stores a review tied to exact content and invalidates edits and legacy approvals', () => {
    const correct = { ...q, answer: 'San Diego', acceptableAnswers: ['San Diego, California'] };
    const aiAnalysis = {
      sourceReview: createSourceReview(correct, ['Petco Park in San Diego'], 'editorial'),
    };
    expect(hasCurrentSourceReview({ ...correct, aiAnalysis })).toBe(true);
    expect(hasCurrentSourceReview({ ...correct, answer: 'Tokyo', aiAnalysis })).toBe(false);
    expect(hasCurrentSourceReview({ ...correct, acceptableAnswers: ['Tokyo'], aiAnalysis })).toBe(
      false
    );
    expect(hasCurrentSourceReview({ ...correct, aiAnalysis: {} })).toBe(false);
  });
  it('accepts a supported answer only with complete verdicts and a literal quotation', async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              factual: 'pass',
              scope: 'pass',
              explanation: 'pass',
              aliases: 'pass',
              quotes: ['Petco Park in San Diego'],
            }),
          },
        },
      ],
    });
    const correct = { ...q, answer: 'San Diego' };
    const review = await verifyQuestionSource(correct);
    expect(hasCurrentSourceReview({ ...correct, aiAnalysis: { sourceReview: review } })).toBe(true);
  });
  it('requires explicit checks for the same question and rejects malformed QA', () => {
    const factCheck = { questionId: q.id, verdict: 'pass', coherence: 'pass', obviousness: 'pass' };
    expect(hasStrictQualityPass({ ...q, aiAnalysis: { factCheck, qaFindings: [] } })).toBe(true);
    for (const aiAnalysis of [
      null,
      { factCheck },
      { factCheck: { ...factCheck, coherence: undefined }, qaFindings: [] },
      { factCheck: { ...factCheck, questionId: 'another' }, qaFindings: [] },
      { factCheck, qaFindings: [{ severity: 'high' }] },
    ]) {
      expect(hasStrictQualityPass({ ...q, aiAnalysis })).toBe(false);
    }
  });
});
