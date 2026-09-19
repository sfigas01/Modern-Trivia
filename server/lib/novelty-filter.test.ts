import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyDuplicateCounts,
  type DuplicateMatch,
  type DuplicateDetectionReport,
} from '@shared/models/quality-sweep';
import { filterNovelQuestions, SemanticCheckIncompleteError } from './novelty-filter';
import { detectDuplicates } from './duplicate-detector';
vi.mock('./duplicate-detector', () => ({ detectDuplicates: vi.fn() }));
const detect = vi.mocked(detectDuplicates);
const q = (id: string) => ({ id, question: `Question ${id}`, answer: `Answer ${id}` });
function match(
  a: string,
  b: string,
  matchType: DuplicateMatch['matchType'] = 'semantic_duplicate',
  score = 0.9
): DuplicateMatch {
  return {
    questionIdA: a,
    questionIdB: b,
    matchType,
    similarityScore: score,
    questionTextA: '',
    questionTextB: '',
    answerA: '',
    answerB: '',
  };
}
function report(matches: DuplicateMatch[], extra: Partial<DuplicateDetectionReport> = {}) {
  detect.mockResolvedValue({
    totalPairsChecked: 3,
    duplicatesFound: matches,
    duplicatesByType: emptyDuplicateCounts(),
    status: 'complete',
    ...extra,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  report([]);
});
describe('generation novelty decisions', () => {
  it('skips empty batches', async () => {
    expect(await filterNovelQuestions([], [q('e')])).toEqual({ kept: [], dropped: [] });
    expect(detect).not.toHaveBeenCalled();
  });
  it('keeps distinct candidates', async () => {
    expect((await filterNovelQuestions([q('a'), q('b')], [])).kept).toHaveLength(2);
  });
  it('limits comparisons to the batch and persistence to existing rows', async () => {
    await filterNovelQuestions([q('a')], [q('e')]);
    expect(detect.mock.calls[0][1]).toEqual({
      scopeIds: new Set(['a']),
      persistIds: new Set(['e']),
    });
  });
  it('drops an ordinary duplicate of an existing row', async () => {
    report([match('e', 'a', 'exact')]);
    const r = await filterNovelQuestions([q('a'), q('b')], [q('e')]);
    expect(r.kept.map((q) => q.id)).toEqual(['b']);
    expect(r.dropped[0]).toMatchObject({ reason: 'duplicate_of_existing', matchedExistingId: 'e' });
  });
  it('keeps the first of ordinary within-batch duplicates', async () => {
    report([match('a', 'b')]);
    expect((await filterNovelQuestions([q('a'), q('b')], [])).kept).toEqual([q('a')]);
  });
  it('preserves the non-transitive ordinary chain regression', async () => {
    report([match('a', 'b'), match('b', 'c')]);
    expect((await filterNovelQuestions([q('a'), q('b'), q('c')], [])).kept).toEqual([
      q('a'),
      q('c'),
    ]);
  });
  it('does not drop a candidate solely because of an already-dropped winner', async () => {
    report([match('e', 'a'), match('a', 'b')]);
    expect((await filterNovelQuestions([q('a'), q('b')], [q('e')])).kept).toEqual([q('b')]);
  });
  it('withholds both endpoints of every conflicting chain, including the first candidate', async () => {
    report([match('a', 'b', 'answer_conflict'), match('b', 'c', 'answer_conflict')]);
    const r = await filterNovelQuestions([q('a'), q('b'), q('c')], []);
    expect(r.kept).toEqual([]);
    expect(r.dropped.every((d) => d.reason === 'answer_conflict')).toBe(true);
  });
  it('withholds an existing conflict without modifying the existing row', async () => {
    const existing = [q('e')];
    report([match('e', 'a', 'answer_conflict')]);
    const r = await filterNovelQuestions([q('a')], existing);
    expect(r.dropped[0]).toMatchObject({ reason: 'answer_conflict', matchedExistingId: 'e' });
    expect(existing).toEqual([q('e')]);
  });
  it('does not allow canonical selection to override a conflict', async () => {
    report([match('e', 'a', 'exact'), match('a', 'b', 'answer_conflict')]);
    const r = await filterNovelQuestions([q('a'), q('b')], [q('e')]);
    expect(r.kept).toEqual([]);
    expect(r.dropped.every((d) => d.reason === 'answer_conflict')).toBe(true);
  });
  it('withholds ambiguity separately and prioritizes a confirmed conflict', async () => {
    report([match('a', 'b', 'review_required'), match('a', 'c', 'answer_conflict')]);
    const r = await filterNovelQuestions([q('a'), q('b'), q('c')], []);
    expect(r.dropped.map((d) => d.reason)).toEqual([
      'answer_conflict',
      'review_required',
      'answer_conflict',
    ]);
  });
  it('fails closed rather than stage unchecked candidates', async () => {
    report([], { status: 'incomplete', failedPairs: 1, failureCategory: 'configuration' });
    await expect(filterNovelQuestions([q('a')], [q('e')])).rejects.toMatchObject({
      name: 'SemanticCheckIncompleteError',
      category: 'configuration',
      failedPairs: 1,
    });
  });
});
