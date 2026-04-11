import { describe, expect, it, vi, beforeEach } from 'vitest';

import { detectDuplicates } from './duplicate-detector';
import type { Question } from '@shared/models/questions';

// vi.hoisted ensures mockCreate is available both inside the vi.mock factory
// and in the test body (vi.mock is hoisted to the top of the file).
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

// Helper to build minimal valid Question objects
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
  // interfering with tests that don't expect them)
  mockCreate.mockResolvedValue({
    choices: [
      { message: { content: JSON.stringify({ isDuplicate: false, reasoning: 'Different.' }) } },
    ],
  });
});

describe('detectDuplicates — exact duplicates', () => {
  it('detects exact duplicate question text (case-insensitive)', async () => {
    const questions: Question[] = [
      makeQuestion({ id: 'q1', question: 'What is the capital of France?', answer: 'Paris' }),
      makeQuestion({ id: 'q2', question: 'What is the capital of France?', answer: 'Paris' }),
      makeQuestion({ id: 'q3', question: 'What is the capital of Germany?', answer: 'Berlin' }),
    ];

    const report = await detectDuplicates(questions);

    const exact = report.duplicatesFound.filter((m) => m.matchType === 'exact');
    expect(exact).toHaveLength(1);
    expect(exact[0].questionIdA).toBe('q1');
    expect(exact[0].questionIdB).toBe('q2');
    expect(exact[0].similarityScore).toBe(1);
    expect(report.duplicatesByType.exact).toBe(1);
    expect(report.duplicatesByType.near_duplicate).toBe(0);
  });

  it('detects exact duplicates with different casing and extra whitespace', async () => {
    const questions: Question[] = [
      makeQuestion({ id: 'q1', question: 'Who wrote Hamlet?', answer: 'Shakespeare' }),
      makeQuestion({ id: 'q2', question: '  who wrote hamlet?  ', answer: 'Shakespeare' }),
    ];

    const report = await detectDuplicates(questions);

    const exact = report.duplicatesFound.filter((m) => m.matchType === 'exact');
    expect(exact).toHaveLength(1);
    expect(exact[0].matchType).toBe('exact');
  });

  it('counts total pairs checked correctly for 3 questions', async () => {
    const questions: Question[] = [
      makeQuestion({ id: 'q1', question: 'Unique question one?', answer: 'Answer one' }),
      makeQuestion({ id: 'q2', question: 'Unique question two?', answer: 'Answer two' }),
      makeQuestion({ id: 'q3', question: 'Unique question three?', answer: 'Answer three' }),
    ];

    const report = await detectDuplicates(questions);
    // 3 questions → 3 pairs: (q1,q2), (q1,q3), (q2,q3)
    expect(report.totalPairsChecked).toBe(3);
  });
});

describe('detectDuplicates — near-duplicates', () => {
  it('detects near-duplicate question text at or above the 0.8 threshold', async () => {
    const questions: Question[] = [
      makeQuestion({
        id: 'q1',
        question: 'Which city is the capital of France?',
        answer: 'Paris',
      }),
      makeQuestion({
        id: 'q2',
        // Very similar wording — should score >= 0.8
        question: 'Which city is the capital of France, the country?',
        answer: 'Paris',
      }),
    ];

    const report = await detectDuplicates(questions);

    const nearDups = report.duplicatesFound.filter(
      (m) => m.matchType === 'near_duplicate' || m.matchType === 'exact'
    );
    expect(nearDups.length).toBeGreaterThanOrEqual(1);
    expect(nearDups[0].similarityScore).toBeGreaterThanOrEqual(0.8);
  });

  it('does not flag clearly different question pairs as duplicates', async () => {
    const questions: Question[] = [
      makeQuestion({ id: 'q1', question: 'What is the capital of France?', answer: 'Paris' }),
      makeQuestion({
        id: 'q2',
        question: 'Name the longest river in South America.',
        answer: 'Amazon',
      }),
    ];

    const report = await detectDuplicates(questions);

    const textDups = report.duplicatesFound.filter(
      (m) => m.matchType === 'near_duplicate' || m.matchType === 'exact'
    );
    expect(textDups).toHaveLength(0);
  });
});

describe('detectDuplicates — conceptual duplicates', () => {
  it('returns a conceptual match when GPT-4o says isDuplicate: true', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ isDuplicate: true, reasoning: 'Same underlying question.' }),
          },
        },
      ],
    });

    const questions: Question[] = [
      makeQuestion({ id: 'q1', question: 'What is the capital of France?', answer: 'Paris' }),
      makeQuestion({
        id: 'q2',
        question: "Which city serves as France's capital?",
        answer: 'Paris',
      }),
    ];

    const report = await detectDuplicates(questions);

    const conceptual = report.duplicatesFound.filter((m) => m.matchType === 'conceptual');
    expect(conceptual.length).toBeGreaterThanOrEqual(1);
    expect(conceptual[0].aiReasoning).toBe('Same underlying question.');
    expect(report.duplicatesByType.conceptual).toBeGreaterThanOrEqual(1);
  });

  it('does not flag a pair as conceptual when GPT-4o returns isDuplicate: false', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ isDuplicate: false, reasoning: 'Different questions.' }),
          },
        },
      ],
    });

    const questions: Question[] = [
      makeQuestion({
        id: 'q1',
        question: 'Who invented the telephone?',
        answer: 'Alexander Graham Bell',
      }),
      makeQuestion({
        id: 'q2',
        question: 'Who invented the light bulb?',
        answer: 'Alexander Graham Bell',
      }),
    ];

    const report = await detectDuplicates(questions);

    const conceptual = report.duplicatesFound.filter((m) => m.matchType === 'conceptual');
    expect(conceptual).toHaveLength(0);
  });

  it('does not call GPT-4o for pairs with dissimilar answers', async () => {
    const questions: Question[] = [
      makeQuestion({ id: 'q1', question: 'What is the capital of France?', answer: 'Paris' }),
      makeQuestion({ id: 'q2', question: 'What is the tallest mountain?', answer: 'Everest' }),
    ];

    await detectDuplicates(questions);

    // "Paris" vs "Everest" answer similarity is well below 0.7 — GPT should not be called
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('detectDuplicates — report structure', () => {
  it('returns empty report for a single question', async () => {
    const questions: Question[] = [
      makeQuestion({ id: 'q1', question: 'What is 2 + 2?', answer: '4' }),
    ];

    const report = await detectDuplicates(questions);

    expect(report.totalPairsChecked).toBe(0);
    expect(report.duplicatesFound).toHaveLength(0);
    expect(report.duplicatesByType.exact).toBe(0);
    expect(report.duplicatesByType.near_duplicate).toBe(0);
    expect(report.duplicatesByType.conceptual).toBe(0);
  });

  it('returns empty report for an empty array', async () => {
    const report = await detectDuplicates([]);

    expect(report.totalPairsChecked).toBe(0);
    expect(report.duplicatesFound).toHaveLength(0);
  });
});
