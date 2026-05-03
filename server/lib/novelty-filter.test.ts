import { describe, expect, it, vi, beforeEach } from 'vitest';

import { filterNovelQuestions } from './novelty-filter';
import type { Question } from '@shared/models/questions';

// vi.hoisted ensures mockCreate is available both inside the vi.mock factory
// and in the test body (vi.mock is hoisted to the top of the file).
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

function makeQuestion(
  overrides: Partial<Question> & { id: string; question: string; answer: string }
): Question {
  return {
    category: 'General Knowledge',
    difficulty: 'Easy',
    explanation: 'Test explanation.',
    pillar: 'GlobalEh',
    tags: ['Global', 'GlobalEh'],
    acceptableAnswers: [],
    sourceUrl: null,
    sourceName: null,
    status: 'approved',
    aiAnalysis: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  mockCreate.mockReset();
  // Default: GPT-4o says not a duplicate (prevents conceptual matches from
  // interfering with tests that don't expect them).
  mockCreate.mockResolvedValue({
    choices: [
      { message: { content: JSON.stringify({ isDuplicate: false, reasoning: 'Different.' }) } },
    ],
  });
});

describe('filterNovelQuestions — empty input', () => {
  it('returns an empty result when batch is empty', async () => {
    const result = await filterNovelQuestions(
      [],
      [makeQuestion({ id: 'e1', question: 'Q?', answer: 'A' })]
    );
    expect(result.kept).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  it('keeps the entire batch when there are no existing questions', async () => {
    const batch = [
      makeQuestion({ id: 'b1', question: 'Brand new question one?', answer: 'Answer one' }),
      makeQuestion({ id: 'b2', question: 'Brand new question two?', answer: 'Answer two' }),
    ];

    const result = await filterNovelQuestions(batch, []);

    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
  });
});

describe('filterNovelQuestions — collisions with existing', () => {
  it('drops a batch question that exactly matches an existing question', async () => {
    const existing = [
      makeQuestion({ id: 'e1', question: 'What is the capital of France?', answer: 'Paris' }),
    ];
    const batch = [
      makeQuestion({ id: 'b1', question: 'What is the capital of France?', answer: 'Paris' }),
      makeQuestion({ id: 'b2', question: 'What is the longest river in Asia?', answer: 'Yangtze' }),
    ];

    const result = await filterNovelQuestions(batch, existing);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].id).toBe('b2');

    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].question.id).toBe('b1');
    expect(result.dropped[0].reason).toBe('duplicate_of_existing');
    expect(result.dropped[0].matchType).toBe('exact');
    expect(result.dropped[0].matchedExistingId).toBe('e1');
  });

  it('drops a batch question that is a near-duplicate of an existing question', async () => {
    const existing = [
      makeQuestion({
        id: 'e1',
        question: 'Which city is the capital of France?',
        answer: 'Paris',
      }),
    ];
    const batch = [
      makeQuestion({
        id: 'b1',
        // Very similar wording, should hit the 0.8 Sørensen-Dice threshold.
        question: 'Which city is the capital of France, the country?',
        answer: 'Paris',
      }),
    ];

    const result = await filterNovelQuestions(batch, existing);

    expect(result.kept).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].reason).toBe('duplicate_of_existing');
    expect(result.dropped[0].matchType).toBe('near_duplicate');
    expect(result.dropped[0].matchedExistingId).toBe('e1');
  });

  it('drops a batch question flagged as a conceptual duplicate by GPT-4o', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isDuplicate: true,
              reasoning: 'Same fact phrased differently.',
            }),
          },
        },
      ],
    });

    const existing = [
      makeQuestion({ id: 'e1', question: 'What is the capital of France?', answer: 'Paris' }),
    ];
    const batch = [
      makeQuestion({
        id: 'b1',
        question: "Which city serves as France's capital?",
        answer: 'Paris',
      }),
    ];

    const result = await filterNovelQuestions(batch, existing);

    expect(result.kept).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].reason).toBe('duplicate_of_existing');
    expect(result.dropped[0].matchType).toBe('conceptual');
  });
});

describe('filterNovelQuestions — within-batch collisions', () => {
  it('drops the later of two within-batch exact duplicates and keeps the first', async () => {
    const batch = [
      makeQuestion({ id: 'b1', question: 'What is 2 + 2?', answer: '4' }),
      makeQuestion({ id: 'b2', question: 'What is 2 + 2?', answer: '4' }),
      makeQuestion({ id: 'b3', question: 'What is the speed of light?', answer: '299792458 m/s' }),
    ];

    const result = await filterNovelQuestions(batch, []);

    expect(result.kept.map((q) => q.id)).toEqual(['b1', 'b3']);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].question.id).toBe('b2');
    expect(result.dropped[0].reason).toBe('duplicate_within_batch');
    expect(result.dropped[0].matchedBatchId).toBe('b1');
  });

  it('does not over-drop in a non-transitive within-batch chain (a~b, b~c, no a~c)', async () => {
    // Regression for Pass 2 winner-alive check. Without the fix, processing
    // (a,b) marks b dead, then processing (b,c) re-checks only droppedByExisting
    // (which is empty), treats b as alive, and incorrectly drops c. With the
    // fix, (b,c) sees b in droppedByBatch and lets c through.
    //
    // All three questions share answer "Paris" so every pair becomes a Phase 3
    // candidate; question text is distinct enough that none passes Phase 2's
    // 0.8 Sørensen-Dice threshold. The mock returns isDuplicate=true only for
    // the (a,b) and (b,c) prompts — (a,c) is not a duplicate.
    mockCreate.mockImplementation(async (params: unknown) => {
      const messages = (params as { messages: { role: string; content: string }[] }).messages;
      const userMessage = messages.find((m) => m.role === 'user');
      const prompt = userMessage?.content ?? '';
      const hasA = prompt.includes('capital of France');
      const hasB = prompt.includes('Eiffel');
      const hasC = prompt.includes('Louvre');
      const isDuplicate = (hasA && hasB) || (hasB && hasC);
      return {
        choices: [
          {
            message: { content: JSON.stringify({ isDuplicate, reasoning: 'test' }) },
          },
        ],
      };
    });

    const batch = [
      makeQuestion({ id: 'a', question: 'What is the capital of France?', answer: 'Paris' }),
      makeQuestion({ id: 'b', question: 'Site of the Eiffel Tower?', answer: 'Paris' }),
      makeQuestion({ id: 'c', question: 'Home of the Louvre Museum?', answer: 'Paris' }),
    ];

    const result = await filterNovelQuestions(batch, []);

    // a is the canonical of the (a,b) cluster; c survives because its only
    // collision was with b, which is itself dropped.
    expect(result.kept.map((q) => q.id)).toEqual(['a', 'c']);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].question.id).toBe('b');
    expect(result.dropped[0].reason).toBe('duplicate_within_batch');
    expect(result.dropped[0].matchedBatchId).toBe('a');
  });

  it('keeps a batch item whose only collision is with another batch item that is itself a duplicate of existing', async () => {
    // Regression for two-pass logic. Without the fix, both `a` and `b` would be
    // dropped: `a` as duplicate_of_existing (matched with E1 via conceptual),
    // and `b` as duplicate_within_batch (matched with `a` via near-duplicate).
    // With the fix, only `a` is dropped — `b` survives because the within-batch
    // collision was solely with the now-removed `a`.
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isDuplicate: true,
              reasoning: 'Same fact phrased differently.',
            }),
          },
        },
      ],
    });

    const existing = [
      makeQuestion({ id: 'e1', question: 'What is the capital of France?', answer: 'Paris' }),
    ];
    const batch = [
      // Different wording from E1, same answer — Sørensen-Dice on text is below 0.8,
      // but identical answer triggers Phase 3 conceptual check (mock returns true).
      makeQuestion({
        id: 'a',
        question: 'Which European city hosts the Eiffel Tower?',
        answer: 'Paris',
      }),
      // Near-dup of `a` via Phase 2 (most bigrams shared with `a`'s text).
      // Different answer from E1 ("Paris" vs "Berlin"), so does NOT collide with E1
      // — Phase 3 candidate gate (answer similarity ≥ 0.7) is not met.
      makeQuestion({
        id: 'b',
        question: 'Which European city hosts the Brandenburg Gate?',
        answer: 'Berlin',
      }),
    ];

    const result = await filterNovelQuestions(batch, existing);

    expect(result.kept.map((q) => q.id)).toEqual(['b']);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].question.id).toBe('a');
    expect(result.dropped[0].reason).toBe('duplicate_of_existing');
    expect(result.dropped[0].matchedExistingId).toBe('e1');
  });
});

describe('filterNovelQuestions — performance guards', () => {
  it('does not call GPT-4o when no batch/existing pair has similar answers', async () => {
    const existing = [
      makeQuestion({ id: 'e1', question: 'What is the capital of France?', answer: 'Paris' }),
    ];
    const batch = [
      makeQuestion({ id: 'b1', question: 'What is the tallest mountain?', answer: 'Everest' }),
    ];

    await filterNovelQuestions(batch, existing);

    // Answer similarity Paris vs Everest is well below 0.7 — conceptual phase should not run
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('ignores collisions between two existing rows', async () => {
    const existing = [
      makeQuestion({ id: 'e1', question: 'What is the capital of France?', answer: 'Paris' }),
      makeQuestion({ id: 'e2', question: 'What is the capital of France?', answer: 'Paris' }),
    ];
    const batch = [
      makeQuestion({ id: 'b1', question: 'What is the longest river in Asia?', answer: 'Yangtze' }),
    ];

    const result = await filterNovelQuestions(batch, existing);

    // Existing-vs-existing duplicates are not our concern here.
    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  it('does not invoke the GPT-4o conceptual check for existing-vs-existing pairs', async () => {
    // Two existing rows with different question wording but identical answer —
    // would normally trigger Phase 3 (conceptual GPT-4o call). With the scopeIds
    // constraint, this pair must be skipped entirely.
    const existing = [
      makeQuestion({
        id: 'e1',
        question: 'What is the capital city of France?',
        answer: 'Paris',
      }),
      makeQuestion({
        id: 'e2',
        question: "Which European city serves as France's capital?",
        answer: 'Paris',
      }),
    ];
    // Batch is unrelated to the existing pair — so no batch-involving pair
    // should trigger GPT-4o either. The only way mockCreate could be called
    // is if existing-vs-existing is being evaluated.
    const batch = [
      makeQuestion({ id: 'b1', question: 'What is the tallest mountain?', answer: 'Everest' }),
    ];

    await filterNovelQuestions(batch, existing);

    expect(mockCreate).not.toHaveBeenCalled();
  });
});
