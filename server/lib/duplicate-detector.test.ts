import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Question } from '@shared/models/questions';
import { duplicateFindingKey, duplicatePairKey } from '@shared/models/quality-sweep';
import { detectDuplicates } from './duplicate-detector';
const mocks = vi.hoisted(() => ({ chat: vi.fn(), embed: vi.fn() }));
vi.mock('./embeddings', async (original) => ({
  ...(await original<typeof import('./embeddings')>()),
  embedQuestions: mocks.embed,
  semanticClient: () => ({ chat: { completions: { create: mocks.chat } } }),
}));
const q = (id: string, question: string, answer: string) => ({ id, question, answer }) as Question;
const pair = [
  q('a', 'Who wrote Hamlet?', 'Shakespeare'),
  q('b', 'Name the author of Hamlet.', 'William Shakespeare'),
];
function verdict(value: string) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            assessment: 'Scoped facts and answer referents compared.',
            verdict: value,
          }),
        },
      },
    ],
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.embed.mockImplementation(async (qs: Question[]) => new Map(qs.map((q) => [q.id, [1, 0]])));
  mocks.chat.mockResolvedValue(verdict('equivalent'));
});
describe('semantic duplicate detection', () => {
  it('detects paraphrases even when answer spelling differs', async () => {
    const r = await detectDuplicates(pair);
    expect(r.status).toBe('complete');
    expect(r.duplicatesByType.semantic_duplicate).toBe(1);
  });
  it('does not normalize away meaningful answer punctuation such as a negative sign', async () => {
    mocks.chat.mockResolvedValue(verdict('conflict'));
    const r = await detectDuplicates([
      q('a', 'What is the signed result?', '-2'),
      q('b', 'What is the signed result?', '2'),
    ]);
    expect(r.duplicatesByType.answer_conflict).toBe(1);
  });
  it('recognizes exact same-answer pairs without adjudication', async () => {
    const r = await detectDuplicates([pair[0], { ...pair[0], id: 'b' }]);
    expect(r.duplicatesByType.exact).toBe(1);
    expect(mocks.chat).not.toHaveBeenCalled();
  });
  it.each(['Who wrote Hamlet?', 'Who was the writer of Hamlet?'])(
    'checks conflicts through exact/fuzzy paths: %s',
    async (question) => {
      mocks.chat.mockResolvedValue(verdict('conflict'));
      const r = await detectDuplicates([pair[0], q('b', question, 'Another writer')]);
      expect(r.duplicatesByType.answer_conflict).toBe(1);
      expect(r.duplicatesByType.exact).toBe(0);
    }
  );
  it('does not merge same-topic distinct facts or time periods', async () => {
    mocks.chat.mockResolvedValue(verdict('distinct'));
    const r = await detectDuplicates([
      q('a', 'Who won the 2020 tournament?', 'A'),
      q('b', 'Who won the 2021 tournament?', 'B'),
    ]);
    expect(r.duplicatesFound).toEqual([]);
    expect(r.status).toBe('complete');
  });
  it('reports ambiguity separately from confirmed conflicts', async () => {
    mocks.chat.mockResolvedValue(verdict('uncertain'));
    expect((await detectDuplicates(pair)).duplicatesByType.review_required).toBe(1);
  });
  it('does not trust malformed structured verdicts', async () => {
    mocks.chat.mockResolvedValue({ choices: [{ message: { content: '{"isDuplicate":true}' } }] });
    const r = await detectDuplicates(pair);
    expect(r.status).toBe('incomplete');
    expect(r.failedPairs).toBe(1);
  });
  it('reports provider failure without exposing its response', async () => {
    mocks.chat.mockRejectedValue(new Error('private answer/provider secret'));
    const r = await detectDuplicates(pair);
    expect(r.status).toBe('incomplete');
    expect(JSON.stringify(r)).not.toContain('private answer/provider secret');
  });
  it('reports every pair as failed when embedding/cache fails', async () => {
    mocks.embed.mockRejectedValue(new Error('cache down'));
    const r = await detectDuplicates([...pair, q('c', 'Third question?', 'Other')]);
    expect(r.status).toBe('incomplete');
    expect(r.failedPairs).toBe(3);
  });
  it('excludes existing-versus-existing comparisons and forwards persist IDs', async () => {
    const persistIds = new Set(['a', 'b']);
    const r = await detectDuplicates([...pair, q('c', 'Third question?', 'Other')], {
      scopeIds: new Set(['c']),
      persistIds,
    });
    expect(r.totalPairsChecked).toBe(2);
    expect(mocks.chat).toHaveBeenCalledTimes(2);
    expect(mocks.embed.mock.calls[0][1].persistIds).toBe(persistIds);
  });
  it('keeps output in input-pair order despite parallel completions', async () => {
    mocks.chat.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(verdict('equivalent')), 10))
    );
    const r = await detectDuplicates([...pair, q('c', 'Third question?', 'Other')]);
    expect(r.duplicatesFound.map((m) => m.questionIdA + m.questionIdB)).toEqual(['ab', 'ac', 'bc']);
  });
  it('versions dismissal keys by content and finding type and preserves pair orientation', async () => {
    const original = (await detectDuplicates(pair)).duplicatesFound[0];
    const reversed = (await detectDuplicates([...pair].reverse())).duplicatesFound[0];
    expect(duplicateFindingKey(original)).toBe(duplicateFindingKey(reversed));
    const edited = (await detectDuplicates([pair[0], { ...pair[1], answer: 'W. Shakespeare' }]))
      .duplicatesFound[0];
    expect(edited.findingKey).not.toBe(original.findingKey);
    mocks.chat.mockResolvedValue(verdict('conflict'));
    expect((await detectDuplicates(pair)).duplicatesFound[0].findingKey).not.toBe(
      original.findingKey
    );
    expect(original.findingKey).not.toBe(duplicatePairKey('a', 'b'));
  });
  it('returns promptly and aborts outstanding paid work at the stage deadline', async () => {
    mocks.chat.mockImplementation(
      (_body, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        )
    );
    const r = await detectDuplicates(pair, { deadlineMs: 10 });
    expect(r.status).toBe('incomplete');
    expect(mocks.chat.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('bounds adjudication cost and reports omitted candidate pairs as incomplete', async () => {
    mocks.chat.mockResolvedValue(verdict('distinct'));
    const questions = Array.from({ length: 33 }, (_, i) =>
      q(String(i), `Question ${i}?`, `Answer ${i}`)
    );
    const report = await detectDuplicates(questions);
    expect(mocks.chat).toHaveBeenCalledTimes(500);
    expect(report.totalPairsChecked).toBe(528);
    expect(report.failedPairs).toBe(28);
    expect(report.status).toBe('incomplete');
  });
  it('does no paid work when no pairs are in scope', async () => {
    expect((await detectDuplicates(pair, { scopeIds: new Set() })).totalPairsChecked).toBe(0);
    expect(mocks.embed).not.toHaveBeenCalled();
  });
});
