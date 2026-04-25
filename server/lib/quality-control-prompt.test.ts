import { describe, expect, it } from 'vitest';

import type { Question } from '@shared/models/questions';
import { buildQualityControlPrompt } from './quality-control-prompt';

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

describe('buildQualityControlPrompt', () => {
  it('includes the Modern Trivia editorial rubric and review freshness window', () => {
    const prompt = buildQualityControlPrompt(
      [makeQuestion({ id: 'q1', question: 'What is the capital of France?' })],
      new Date('2026-04-25T00:00:00.000Z')
    );

    expect(prompt).toContain('Modern Trivia Quality Control reviewer');
    expect(prompt).toContain('Review date: 2026-04-25');
    expect(prompt).toContain('FreshPrints freshness cutoff: 2026-01-25');
    expect(prompt).toContain('Answer leakage');
    expect(prompt).toContain('GlobalEh');
    expect(prompt).toContain('FreshPrints');
  });

  it('serializes the expanded question metadata needed for semantic QA', () => {
    const prompt = buildQualityControlPrompt([
      makeQuestion({
        id: 'metadata-1',
        category: 'Geography',
        difficulty: 'Easy',
        question: 'Which Canadian city hosts the Calgary Stampede?',
        answer: 'Calgary',
        explanation: 'The Calgary Stampede is hosted in Calgary.',
        pillar: 'GreatOutdoors',
        tags: ['CA', 'Geography', 'GreatOutdoors'],
        sourceUrl: 'https://www.thecanadianencyclopedia.ca/en/article/calgary-stampede',
        sourceName: 'The Canadian Encyclopedia',
      }),
    ]);

    expect(prompt).toContain('"category": "Geography"');
    expect(prompt).toContain('"difficulty": "Easy"');
    expect(prompt).toContain('"pillar": "GreatOutdoors"');
    expect(prompt).toContain('"tags"');
    expect(prompt).toContain('"sourceUrl"');
    expect(prompt).toContain('"sourceName"');
  });

  it('covers the five STE-29 known-bad prompt scenarios', () => {
    const prompt = buildQualityControlPrompt(
      [
        makeQuestion({
          id: 'embedded-answer',
          question: 'What city, Calgary, hosts the Calgary Stampede?',
          answer: 'Calgary',
        }),
        makeQuestion({
          id: 'us-centric-globaleh',
          category: 'Geography',
          question: 'What is the capital of Iowa?',
          answer: 'Des Moines',
          pillar: 'GlobalEh',
          tags: ['US', 'Geography', 'GlobalEh'],
        }),
        makeQuestion({
          id: 'wrong-difficulty',
          difficulty: 'Easy',
          question: 'Which enzyme catalyzes the rate-limiting step of glycolysis?',
          answer: 'Phosphofructokinase-1',
        }),
        makeQuestion({
          id: 'typo',
          question: 'Which planett is known as the Red Planet?',
          answer: 'Mars',
        }),
        makeQuestion({
          id: 'stale-freshprints',
          question: 'Which app topped download charts during the 2020 lockdowns?',
          answer: 'Zoom',
          pillar: 'FreshPrints',
          tags: ['Global', 'Technology', 'FreshPrints'],
        }),
      ],
      new Date('2026-04-25T00:00:00.000Z')
    );

    expect(prompt).toContain('embedded-answer');
    expect(prompt).toContain('us-centric-globaleh');
    expect(prompt).toContain('wrong-difficulty');
    expect(prompt).toContain('typo');
    expect(prompt).toContain('stale-freshprints');
    expect(prompt).toContain('answer or a distinctive answer keyword');
    expect(prompt).toContain('not US-centric');
    expect(prompt).toContain('Difficulty');
    expect(prompt).toContain('misspellings');
    expect(prompt).toContain('older than the cutoff');
  });
});
