import { describe, expect, it, vi } from 'vitest';

import type { Question } from '@shared/models/questions';
import { detectThemeQaDuplicates } from './theme-qa-duplicate-detector';

const question = (id: string, text: string, answer = `answer-${id}`) =>
  ({ id, question: text, answer }) as Question;
const hash = 'a'.repeat(64);
const verdict = (value: 'equivalent' | 'conflict' | 'distinct' | 'uncertain') => ({
  assessment: `fixture ${value}`,
  verdict: value,
});

function options(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: 'candidate-1',
    candidateContentHash: hash,
    embed: vi.fn(async (questions: readonly Question[]) => questions.map(() => [1, 0])),
    adjudicateBatch: vi.fn(async (_id, _hash, pairs) => pairs.map(() => verdict('equivalent'))),
    ...overrides,
  };
}

describe('theme QA duplicate detector', () => {
  it('uses deterministic exact, near and cosine screening and dispatches one bounded batch', async () => {
    const qs = [
      question('a', 'Who wrote Hamlet?', 'Shakespeare'),
      question('b', 'Who wrote Hamlet?', 'Shakespeare'),
      question('c', 'Who was the writer of Hamlet?', 'William Shakespeare'),
    ];
    const deps = options({
      embed: vi.fn(async () => [
        [1, 0],
        [1, 0],
        [0.9, 0.1],
      ]),
      adjudicateBatch: vi.fn(async (_id, _hash, pairs) => pairs.map(() => verdict('equivalent'))),
    });

    const report = await detectThemeQaDuplicates(qs, deps as never);

    expect(report.totalPairsChecked).toBe(3);
    expect(report.status).toBe('complete');
    expect(report.duplicatesByType.exact).toBe(1);
    expect(report.duplicatesByType.semantic_duplicate).toBe(2);
    expect(deps.adjudicateBatch).toHaveBeenCalledOnce();
    expect(deps.adjudicateBatch.mock.calls[0][2]).toHaveLength(2);
  });

  it('fails closed before dispatch when more than four pairs need adjudication', async () => {
    const qs = Array.from({ length: 4 }, (_, index) =>
      question(String(index), `Shared question ${index}?`)
    );
    const deps = options({ embed: vi.fn(async () => qs.map(() => [1, 0])) });

    const report = await detectThemeQaDuplicates(qs, deps as never);

    expect(report.totalPairsChecked).toBe(6);
    expect(report.status).toBe('incomplete');
    expect(report.failedPairs).toBe(6);
    expect(deps.adjudicateBatch).not.toHaveBeenCalled();
  });

  it('preserves answer-similarity screening when text and embeddings are dissimilar', async () => {
    const qs = [
      question('a', 'Which playwright created Ophelia?', 'William Shakespeare'),
      question('b', 'Name the English author born in Stratford.', 'Shakespeare'),
    ];
    const deps = options({
      embed: vi.fn(async () => [
        [1, 0],
        [0, 1],
      ]),
    });

    const report = await detectThemeQaDuplicates(qs, deps as never);

    expect(report.status).toBe('complete');
    expect(report.duplicatesByType.conceptual).toBe(1);
    expect(deps.adjudicateBatch).toHaveBeenCalledOnce();
  });

  it('withholds instead of truncating when answer similarity creates more than four pairs', async () => {
    const qs = Array.from({ length: 4 }, (_, index) =>
      question(String(index), `Unrelated wording ${index}?`, 'Shared Answer')
    );
    const deps = options({
      embed: vi.fn(async () => [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ]),
    });

    const report = await detectThemeQaDuplicates(qs, deps as never);

    expect(report.status).toBe('incomplete');
    expect(report.failedPairs).toBe(6);
    expect(deps.adjudicateBatch).not.toHaveBeenCalled();
  });

  it.each([
    [[1, 0]],
    [
      [1, 0],
      [1, Number.NaN],
      [0, 1],
    ],
    [
      [1, 0],
      [0, 1, 2],
      [0, 1],
    ],
    [
      [0, 0],
      [0, 1],
      [1, 0],
    ],
  ])('marks malformed embedding output incomplete', async (vectors) => {
    const qs = [
      question('a', 'Question A?'),
      question('b', 'Question B?'),
      question('c', 'Question C?'),
    ];
    const deps = options({ embed: vi.fn(async () => vectors) });

    const report = await detectThemeQaDuplicates(qs, deps as never);

    expect(report.status).toBe('incomplete');
    expect(report.failedPairs).toBe(3);
    expect(deps.adjudicateBatch).not.toHaveBeenCalled();
  });

  it('reports candidate-versus-corpus pair count and maps adjudication outcomes', async () => {
    const qs = [
      question('candidate', 'Who wrote Hamlet?', 'Shakespeare'),
      question('corpus-1', 'Name the author of Hamlet.', 'William Shakespeare'),
      question('corpus-2', 'Who wrote King Lear?', 'Shakespeare'),
    ];
    const deps = options({
      scopeIds: new Set(['candidate']),
      embed: vi.fn(async () => [
        [1, 0],
        [1, 0],
        [1, 0],
      ]),
      adjudicateBatch: vi.fn().mockResolvedValue([verdict('equivalent'), verdict('conflict')]),
    });

    const report = await detectThemeQaDuplicates(qs, deps as never);

    expect(report.totalPairsChecked).toBe(2);
    expect(report.duplicatesByType.semantic_duplicate).toBe(1);
    expect(report.duplicatesByType.answer_conflict).toBe(1);
    expect(deps.adjudicateBatch).toHaveBeenCalledWith(
      'candidate-1',
      hash,
      expect.arrayContaining([expect.objectContaining({ pairKey: expect.any(String) })])
    );
  });

  it('fails closed when injected adjudication fails or returns a short batch', async () => {
    const qs = [question('a', 'Who wrote Hamlet?'), question('b', 'Name the author of Hamlet?')];
    const failed = options({
      adjudicateBatch: vi.fn(async () => {
        throw new Error('private');
      }),
    });
    const short = options({ adjudicateBatch: vi.fn(async () => []) });

    for (const deps of [failed, short]) {
      const report = await detectThemeQaDuplicates(qs, deps as never);
      expect(report.status).toBe('incomplete');
      expect(report.failedPairs).toBe(1);
      expect(JSON.stringify(report)).not.toContain('private');
    }
  });
});
