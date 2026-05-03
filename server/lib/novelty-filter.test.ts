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
});
