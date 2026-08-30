import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Avoid pulling in the real schema (which can drag in pg drivers) -- the
// SQL expressions only need column-shaped placeholders to build correctly.
vi.mock('@shared/schema', () => ({
  seenQuestions: {
    questionId: 'seen_questions.question_id',
    seenAt: 'seen_questions.seen_at',
    seenCount: 'seen_questions.seen_count',
    userId: 'seen_questions.user_id',
  },
}));

import { logQuestionPoolBackfill } from './question-pool';

describe('logQuestionPoolBackfill', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('stays silent for a tier-0-only pool', () => {
    logQuestionPoolBackfill('test', [0, 0, 0]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('stays silent for an empty pool', () => {
    logQuestionPoolBackfill('test', []);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns when tier 1 (cooldown-expired) questions are present', () => {
    logQuestionPoolBackfill('solo question selection', [0, 0, 1]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0];
    expect(message).toContain('solo question selection');
    expect(message).toContain('backfilled from cooldown pool');
    expect(message).toContain('never-seen=2');
    expect(message).toContain('cooldown-expired=1');
    expect(message).toContain('in-cooldown=0');
  });

  it('warns when tier 2 (still-in-cooldown) questions are present', () => {
    logQuestionPoolBackfill('room start', [2]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0];
    expect(message).toContain('room start');
    expect(message).toContain('never-seen=0');
    expect(message).toContain('cooldown-expired=0');
    expect(message).toContain('in-cooldown=1');
  });

  it('counts a mixed pool of all three tiers correctly', () => {
    logQuestionPoolBackfill('test', [0, 0, 1, 1, 1, 2]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0];
    expect(message).toContain('never-seen=2');
    expect(message).toContain('cooldown-expired=3');
    expect(message).toContain('in-cooldown=1');
  });

  it('ignores out-of-range tier values when counting', () => {
    logQuestionPoolBackfill('test', [0, 0, -1, 3, 1]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0];
    expect(message).toContain('never-seen=2');
    expect(message).toContain('cooldown-expired=1');
    expect(message).toContain('in-cooldown=0');
  });
});
