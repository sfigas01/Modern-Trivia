import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Question } from '@shared/models/questions';
import { batchFactCheck } from './verifier';

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

function makeQuestion(overrides: Partial<Question> & { id: string; question: string }): Question {
  return {
    category: 'General Knowledge',
    difficulty: 'Medium',
    answer: 'Test answer',
    explanation: 'Test explanation.',
    pillar: 'GlobalEh',
    tags: ['Global', 'General Knowledge', 'GlobalEh'],
    acceptableAnswers: [],
    sourceUrl: 'https://example.com/source',
    sourceName: 'Example Source',
    status: 'approved',
    aiAnalysis: null,
    createdAt: new Date('2026-04-25T00:00:00.000Z'),
    updatedAt: new Date('2026-04-25T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  mockCreate.mockReset();
});

describe('batchFactCheck', () => {
  it('sends the expanded quality-control prompt payload to OpenAI', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              results: [{ id: 'q1', verdict: 'pass', confidence: 96, reason: 'Looks good.' }],
            }),
          },
        },
      ],
    });

    await batchFactCheck([
      makeQuestion({
        id: 'q1',
        category: 'Geography',
        difficulty: 'Hard',
        question: 'What is the capital of Kazakhstan?',
        answer: 'Astana',
        explanation: 'Astana is the capital of Kazakhstan.',
        pillar: 'GlobalEh',
        tags: ['Global', 'Geography', 'GlobalEh'],
        sourceUrl: 'https://www.britannica.com/place/Astana',
        sourceName: 'Britannica',
      }),
    ]);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const request = mockCreate.mock.calls[0][0];
    expect(request.model).toBe('gpt-4o');
    expect(request.response_format).toEqual({ type: 'json_object' });
    expect(request.messages[0].content).toContain('quality-control assistant');
    expect(request.messages[1].content).toContain('Modern Trivia Quality Control reviewer');
    expect(request.messages[1].content).toContain('"category": "Geography"');
    expect(request.messages[1].content).toContain('"difficulty": "Hard"');
    expect(request.messages[1].content).toContain('"pillar": "GlobalEh"');
    expect(request.messages[1].content).toContain('"sourceName": "Britannica"');
  });

  it('preserves parsed verdicts from the existing fact-check report contract', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              results: [
                {
                  id: 'q1',
                  verdict: 'fail',
                  confidence: 88,
                  reason: 'Answer leaks into the prompt.',
                },
              ],
            }),
          },
        },
      ],
    });

    const report = await batchFactCheck([
      makeQuestion({
        id: 'q1',
        question: 'Which planet, Mars, is the Red Planet?',
        answer: 'Mars',
      }),
    ]);

    expect(report).toEqual({
      totalChecked: 1,
      results: [
        {
          questionId: 'q1',
          verdict: 'fail',
          confidence: 88,
          reason: 'Answer leaks into the prompt.',
        },
      ],
    });
  });

  it('keeps the missing-model-result fallback as a low-confidence flag', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ results: [] }) } }],
    });

    const report = await batchFactCheck([
      makeQuestion({ id: 'q1', question: 'What is the capital of France?', answer: 'Paris' }),
    ]);

    expect(report.results).toEqual([
      {
        questionId: 'q1',
        verdict: 'flag',
        confidence: 0,
        reason: 'No verdict returned by fact-checker.',
      },
    ]);
  });

  it('uses one captured review date across all batches', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-31T23:59:59.000Z'));
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ results: [] }) } }],
    });

    try {
      const questions = Array.from({ length: 51 }, (_, index) =>
        makeQuestion({
          id: `q${index + 1}`,
          question: `Question ${index + 1}?`,
          answer: `Answer ${index + 1}`,
        })
      );

      await batchFactCheck(questions);

      expect(mockCreate).toHaveBeenCalledTimes(2);
      for (const call of mockCreate.mock.calls) {
        const prompt = call[0].messages[1].content as string;
        expect(prompt).toContain('Review date: 2026-05-31');
        expect(prompt).toContain('FreshPrints freshness cutoff: 2026-02-28');
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
