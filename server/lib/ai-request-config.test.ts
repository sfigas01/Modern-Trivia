import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Question } from '@shared/models/questions';
import type { QuestionQualityFinding } from './question-quality-audit';

const { mockCreate, mockBatchFactCheck } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockBatchFactCheck: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

vi.mock('./verifier', () => ({
  batchFactCheck: mockBatchFactCheck,
}));

import { analyzeDispute } from './ai';
import { getAiFieldFix } from './field-fix';
import { generateQuestions } from './guardian';
import { enrichSubjectiveFindings } from './subjectivity-enricher';

const miniConfig = {
  model: 'gpt-5.4-mini',
  reasoning_effort: 'none',
};

function expectMiniRequest(request: Record<string, unknown>, tokenCap?: number): void {
  expect(request).toEqual(expect.objectContaining(miniConfig));
  expect(request).not.toHaveProperty('max_tokens');
  expect(request).not.toHaveProperty('temperature');
  if (tokenCap !== undefined) {
    expect(request.max_completion_tokens).toBe(tokenCap);
  }
}

function generatedQuestion(question = 'Which city is the capital of France?') {
  return {
    category: 'History & Geography',
    difficulty: 'Easy',
    question,
    answer: 'Paris',
    acceptableAnswers: ['Paris'],
    explanation: 'Paris is the capital and largest city of France.',
    pillar: 'GlobalEh',
    tags: ['Global', 'GlobalEh', 'History & Geography'],
    sourceUrl: 'https://www.britannica.com/place/Paris',
    sourceName: 'Britannica',
    status: 'pending',
  };
}

beforeEach(() => {
  mockCreate.mockReset();
  mockBatchFactCheck.mockReset();
});

describe('AI request configuration', () => {
  it('uses GPT-5.4 mini-compatible parameters for field fixes', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'Paris' } }] });

    await getAiFieldFix(
      {
        id: 'q1',
        category: 'History & Geography',
        difficulty: 'Easy',
        question: 'Which city is the capital of France?',
        answer: 'Paris',
        explanation: 'Paris is the capital of France.',
        pillar: 'GlobalEh',
        tags: ['Global'],
        sourceUrl: 'https://www.britannica.com/place/Paris',
        sourceName: 'Britannica',
      },
      'answer'
    );

    expectMiniRequest(mockCreate.mock.calls[0][0], 512);
  });

  it('uses GPT-5.4 mini-compatible parameters for subjectivity enrichment', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              results: [
                {
                  questionId: 'q1',
                  subjectivePart: 'best',
                  proposedQuestion: 'Which film won the 2025 Academy Award for Best Picture?',
                },
              ],
            }),
          },
        },
      ],
    });
    const findings: QuestionQualityFinding[] = [
      {
        questionId: 'q1',
        questionIndex: 0,
        severity: 'medium',
        rule: 'subjective_prompt',
        message: 'Subjective wording.',
      },
    ];

    await enrichSubjectiveFindings(findings, [
      {
        ...generatedQuestion('What was the best film of 2025?'),
        id: 'q1',
        status: 'approved',
        aiAnalysis: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Question,
    ]);

    expectMiniRequest(mockCreate.mock.calls[0][0]);
  });

  it('uses the configured mini request for generation and repair with existing caps', async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ questions: [generatedQuestion()] }) } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(generatedQuestion()) } }],
      });
    mockBatchFactCheck
      .mockImplementationOnce(async (questions: Question[]) => ({
        totalChecked: questions.length,
        results: questions.map((question) => ({
          questionId: question.id,
          verdict: 'fail',
          coherence: 'pass',
          obviousness: 'pass',
          confidence: 90,
          reason: 'Force one repair request.',
        })),
      }))
      .mockImplementationOnce(async (questions: Question[]) => ({
        totalChecked: questions.length,
        results: questions.map((question) => ({
          questionId: question.id,
          verdict: 'pass',
          coherence: 'pass',
          obviousness: 'pass',
          confidence: 90,
          reason: 'Repaired.',
        })),
      }));

    await generateQuestions('France', 1, 'GlobalEh');

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expectMiniRequest(mockCreate.mock.calls[0][0], 4096);
    expectMiniRequest(mockCreate.mock.calls[1][0], 1024);
  });

  it('keeps dispute analysis on GPT-4o', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: 'INCORRECT',
              confidence: 95,
              reasoning: 'The original answer is correct.',
              sources: [],
            }),
          },
        },
      ],
    });

    await analyzeDispute('What is 2 + 2?', '4', '5', 'I disagree');

    expect(mockCreate.mock.calls[0][0]).toEqual(
      expect.objectContaining({ model: 'gpt-4o', max_tokens: 1024 })
    );
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('reasoning_effort');
  });
});