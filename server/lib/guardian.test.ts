import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FactCheckReport, FactCheckVerdict } from './verifier';

const mockCreate = vi.hoisted(() => vi.fn());
const mockAuditQuestionQuality = vi.hoisted(() => vi.fn());
const mockBatchFactCheck = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

// question-quality-audit and verifier are exercised by their own test suites — mocked here so
// these tests isolate guardian.ts's own coverage-planning and prompt-wiring logic.
vi.mock('./question-quality-audit', () => ({
  auditQuestionQuality: mockAuditQuestionQuality,
}));

vi.mock('./verifier', () => ({
  batchFactCheck: mockBatchFactCheck,
}));

import { computeStrategyQuotas, generateQuestions, STRATEGY_PILLAR_TARGETS } from './guardian';

function passingFactCheck(ids: string[]): FactCheckReport {
  const results: FactCheckVerdict[] = ids.map((id) => ({
    questionId: id,
    verdict: 'pass',
    coherence: 'pass',
    obviousness: 'pass',
    confidence: 90,
    reason: 'Looks good.',
  }));
  return { totalChecked: ids.length, results };
}

function coveragePlanResponse(cells: { subtopic: string; angle: string }[]) {
  return { choices: [{ message: { content: JSON.stringify({ cells }) } }] };
}

function generationResponse(questions: Array<{ id: string; question: string; answer: string }>) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            questions: questions.map((q) => ({
              id: q.id,
              category: 'Sports',
              difficulty: 'Medium',
              question: q.question,
              answer: q.answer,
              acceptableAnswers: [],
              explanation: `${q.answer} is correct.`,
              pillar: 'GlobalEh',
              tags: ['Global', 'GlobalEh', 'Sports'],
              sourceUrl: 'https://example.com/source',
              sourceName: 'Example Source',
              status: 'pending',
            })),
          }),
        },
      },
    ],
  };
}

beforeEach(() => {
  mockCreate.mockReset();
  mockAuditQuestionQuality.mockReset();
  mockBatchFactCheck.mockReset();
  mockAuditQuestionQuality.mockReturnValue({
    generatedAt: new Date().toISOString(),
    totalQuestions: 0,
    totalFindings: 0,
    flaggedQuestionCount: 0,
    findingsBySeverity: { high: 0, medium: 0, low: 0 },
    findingsByRule: {},
    findings: [],
  });
});

describe('generateQuestions — coverage planning', () => {
  it('plans a coverage cell per requested question and assigns them in the generation prompt', async () => {
    mockCreate
      .mockResolvedValueOnce(
        coveragePlanResponse([
          { subtopic: '1972 Summit Series', angle: 'origin' },
          { subtopic: 'Wayne Gretzky', angle: 'record' },
        ])
      )
      .mockResolvedValueOnce(
        generationResponse([
          { id: 'q1', question: 'What year did the Summit Series happen?', answer: '1972' },
          { id: 'q2', question: "What is Gretzky's goal record?", answer: '894' },
        ])
      );
    mockBatchFactCheck.mockResolvedValue(passingFactCheck(['q1', 'q2']));

    const result = await generateQuestions('Hockey', 2, 'GlobalEh', []);

    expect(result).toHaveLength(2);
    expect(mockCreate).toHaveBeenCalledTimes(2);

    const planPrompt = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(planPrompt).toContain('Plan coverage');
    expect(planPrompt).toContain('who, what, when, where, record, origin, connection');

    const generationPrompt = mockCreate.mock.calls[1][0].messages[1].content as string;
    expect(generationPrompt).toContain('1972 Summit Series');
    expect(generationPrompt).toContain('origin');
    expect(generationPrompt).toContain('Wayne Gretzky');
    expect(generationPrompt).toContain('record');
    expect(generationPrompt).toContain('Coverage plan');
  });

  it('diffs the coverage plan against existing examples for the topic', async () => {
    mockCreate
      .mockResolvedValueOnce(coveragePlanResponse([{ subtopic: 'Sidney Crosby', angle: 'who' }]))
      .mockResolvedValueOnce(
        generationResponse([{ id: 'q1', question: 'Who is Sidney Crosby?', answer: 'A player' }])
      );
    mockBatchFactCheck.mockResolvedValue(passingFactCheck(['q1']));

    await generateQuestions('Hockey', 1, 'GlobalEh', [
      { question: 'Who scored the most NHL goals?', answer: 'Wayne Gretzky' },
    ]);

    const planPrompt = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(planPrompt).toContain('Who scored the most NHL goals?');
    expect(planPrompt).toContain('do not repeat their subtopic + angle combination');
  });

  it('falls back to angle rotation when coverage planning fails, and still generates the batch', async () => {
    mockCreate
      .mockRejectedValueOnce(new Error('planning boom'))
      .mockResolvedValueOnce(
        generationResponse([{ id: 'q1', question: 'A hockey question?', answer: 'An answer' }])
      );
    mockBatchFactCheck.mockResolvedValue(passingFactCheck(['q1']));

    const result = await generateQuestions('Hockey', 1, 'GlobalEh', []);

    expect(result).toHaveLength(1);
    const generationPrompt = mockCreate.mock.calls[1][0].messages[1].content as string;
    // Fallback plan uses the topic itself as the subtopic with a rotating angle.
    expect(generationPrompt).toContain('Subtopic: "Hockey"');
  });

  it('falls back to angle rotation when the plan returns no usable cells', async () => {
    mockCreate
      .mockResolvedValueOnce(coveragePlanResponse([]))
      .mockResolvedValueOnce(
        generationResponse([{ id: 'q1', question: 'A hockey question?', answer: 'An answer' }])
      );
    mockBatchFactCheck.mockResolvedValue(passingFactCheck(['q1']));

    const result = await generateQuestions('Hockey', 1, 'GlobalEh', []);

    expect(result).toHaveLength(1);
    const generationPrompt = mockCreate.mock.calls[1][0].messages[1].content as string;
    expect(generationPrompt).toContain('Subtopic: "Hockey"');
  });

  it('tops up a short coverage plan with fallback cells rather than under-generating', async () => {
    mockCreate
      .mockResolvedValueOnce(coveragePlanResponse([{ subtopic: 'Sidney Crosby', angle: 'who' }]))
      .mockResolvedValueOnce(
        generationResponse([
          { id: 'q1', question: 'Q1?', answer: 'A1' },
          { id: 'q2', question: 'Q2?', answer: 'A2' },
        ])
      );
    mockBatchFactCheck.mockResolvedValue(passingFactCheck(['q1', 'q2']));

    const result = await generateQuestions('Hockey', 2, 'GlobalEh', []);

    expect(result).toHaveLength(2);
    const generationPrompt = mockCreate.mock.calls[1][0].messages[1].content as string;
    expect(generationPrompt).toContain('Sidney Crosby');
    expect(generationPrompt).toContain('Subtopic: "Hockey"'); // padded fallback cell
  });
});

describe('generateQuestions — obviousness guardrail (STE-247)', () => {
  it('runs the STE-247 obviousness check on the full batch and repairs a batch obviousness failure', async () => {
    mockCreate
      .mockResolvedValueOnce(coveragePlanResponse([{ subtopic: 'Maple Leafs', angle: 'who' }]))
      .mockResolvedValueOnce(
        generationResponse([
          { id: 'q1', question: 'Which NHL team is known as the Maple Leafs?', answer: 'Toronto' },
        ])
      )
      // Repair call — repairQuestion expects a single question object, not the batch envelope.
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                id: 'q1-repaired',
                category: 'Sports',
                difficulty: 'Medium',
                question: 'In what year did the Maple Leafs last win the Stanley Cup?',
                answer: '1967',
                acceptableAnswers: [],
                explanation: '1967 is correct.',
                pillar: 'GlobalEh',
                tags: ['Global', 'GlobalEh', 'Sports'],
                sourceUrl: 'https://example.com/source',
                sourceName: 'Example Source',
                status: 'pending',
              }),
            },
          },
        ],
      });

    mockBatchFactCheck
      .mockResolvedValueOnce({
        totalChecked: 1,
        results: [
          {
            questionId: 'q1',
            verdict: 'fail',
            coherence: 'pass',
            obviousness: 'fail',
            confidence: 90,
            reason: 'The nickname hands over the answer.',
          },
        ],
      })
      .mockResolvedValueOnce(passingFactCheck(['q1-repaired']));

    const result = await generateQuestions('Hockey', 1, 'GlobalEh', []);

    expect(mockBatchFactCheck).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe('In what year did the Maple Leafs last win the Stanley Cup?');
  });
});

describe('computeStrategyQuotas', () => {
  it('matches the CONTENT_STRATEGY.md 30/30/25/15 split for an empty pool', () => {
    const quotas = computeStrategyQuotas({}, 20);
    const byPillar = Object.fromEntries(quotas.map((q) => [q.pillar, q.count]));

    expect(byPillar).toEqual({
      TimeCapsule: 6,
      GlobalEh: 6,
      FreshPrints: 5,
      GreatOutdoors: 3,
    });
    expect(quotas.reduce((sum, q) => sum + q.count, 0)).toBe(20);
  });

  it('boosts under-represented pillars relative to their strategy target', () => {
    // Pool is almost entirely GlobalEh — GlobalEh is already far over its 30% target share,
    // so a fresh Mixed batch should allocate it little to nothing.
    const quotas = computeStrategyQuotas(
      { GlobalEh: 97, TimeCapsule: 1, FreshPrints: 1, GreatOutdoors: 1 },
      20
    );
    const byPillar = Object.fromEntries(quotas.map((q) => [q.pillar, q.count]));

    expect(byPillar.GlobalEh ?? 0).toBeLessThan(6);
    expect(byPillar.GreatOutdoors).toBeGreaterThan(3);
    expect(quotas.reduce((sum, q) => sum + q.count, 0)).toBe(20);
  });

  it('always allocates every requested slot, never over- or under-counting', () => {
    for (const count of [1, 2, 3, 7, 13, 20]) {
      const quotas = computeStrategyQuotas({ TimeCapsule: 5, GlobalEh: 40 }, count);
      expect(quotas.reduce((sum, q) => sum + q.count, 0)).toBe(count);
      for (const quota of quotas) {
        expect(Object.keys(STRATEGY_PILLAR_TARGETS)).toContain(quota.pillar);
      }
    }
  });
});
