import { describe, expect, it } from 'vitest';

import { selectTopicContext } from './topic-context';
import type { Question } from '@shared/models/questions';

type ContextInput = Pick<Question, 'id' | 'question' | 'answer' | 'pillar'>;

function makeQuestion(overrides: Partial<ContextInput> & Pick<ContextInput, 'id'>): ContextInput {
  return {
    question: 'Default question?',
    answer: 'Default answer',
    pillar: 'GlobalEh',
    ...overrides,
  };
}

describe('selectTopicContext', () => {
  it('returns an empty list when there are no existing questions', () => {
    const result = selectTopicContext({ topic: 'Hockey', pillar: 'TimeCapsule', existing: [] });
    expect(result).toEqual([]);
  });

  it('returns an empty list when maxExamples is zero', () => {
    const result = selectTopicContext({
      topic: 'Hockey',
      pillar: 'TimeCapsule',
      existing: [makeQuestion({ id: 'q1' })],
      maxExamples: 0,
    });
    expect(result).toEqual([]);
  });

  it('prefers same-pillar questions over other-pillar questions', () => {
    const existing: ContextInput[] = [
      makeQuestion({ id: 'q1', pillar: 'GlobalEh', question: 'Hockey question one?' }),
      makeQuestion({ id: 'q2', pillar: 'GlobalEh', question: 'Hockey question two?' }),
      makeQuestion({ id: 'q3', pillar: 'TimeCapsule', question: 'Hockey question three?' }),
    ];

    const result = selectTopicContext({
      topic: 'Hockey',
      pillar: 'GlobalEh',
      existing,
      maxExamples: 2,
    });

    expect(result).toHaveLength(2);
    // Both samples should be from same-pillar items
    const resultQuestions = result.map((r) => r.question);
    expect(resultQuestions).toContain('Hockey question one?');
    expect(resultQuestions).toContain('Hockey question two?');
    expect(resultQuestions).not.toContain('Hockey question three?');
  });

  it('tops up from other pillars when same-pillar count is below maxExamples', () => {
    const existing: ContextInput[] = [
      makeQuestion({ id: 'q1', pillar: 'GlobalEh', question: 'Hockey legends?' }),
      makeQuestion({ id: 'q2', pillar: 'TimeCapsule', question: 'Hockey scandals?' }),
      makeQuestion({ id: 'q3', pillar: 'FreshPrints', question: 'Hockey trivia?' }),
    ];

    const result = selectTopicContext({
      topic: 'Hockey',
      pillar: 'GlobalEh',
      existing,
      maxExamples: 3,
    });

    expect(result).toHaveLength(3);
  });

  it('caps results at maxExamples', () => {
    const existing: ContextInput[] = Array.from({ length: 50 }, (_, i) =>
      makeQuestion({ id: `q${i}`, question: `Question about ${i}?`, pillar: 'GlobalEh' })
    );

    const result = selectTopicContext({
      topic: 'Question',
      pillar: 'GlobalEh',
      existing,
      maxExamples: 30,
    });

    expect(result).toHaveLength(30);
  });

  it('uses default maxExamples of 30 when not specified', () => {
    const existing: ContextInput[] = Array.from({ length: 100 }, (_, i) =>
      makeQuestion({ id: `q${i}`, question: `Question about ${i}?`, pillar: 'GlobalEh' })
    );

    const result = selectTopicContext({
      topic: 'Question',
      pillar: 'GlobalEh',
      existing,
    });

    expect(result).toHaveLength(30);
  });

  it('ranks more topic-similar questions higher than less similar ones', () => {
    const existing: ContextInput[] = [
      makeQuestion({
        id: 'q1',
        pillar: 'GlobalEh',
        question: 'What is the deepest ocean trench in the world?',
      }),
      makeQuestion({
        id: 'q2',
        pillar: 'GlobalEh',
        question: 'Canadian hockey legends of the 1990s?',
      }),
      makeQuestion({
        id: 'q3',
        pillar: 'GlobalEh',
        question: 'Who coached the most Stanley Cup wins in hockey history?',
      }),
    ];

    const result = selectTopicContext({
      topic: 'Canadian Hockey',
      pillar: 'GlobalEh',
      existing,
      maxExamples: 2,
    });

    // The two hockey questions should rank above the ocean trench question
    expect(result).toHaveLength(2);
    const resultQuestions = result.map((r) => r.question);
    expect(resultQuestions).not.toContain('What is the deepest ocean trench in the world?');
  });

  it('returns only question and answer fields (no leakage of id or pillar)', () => {
    const existing: ContextInput[] = [
      makeQuestion({ id: 'q1', pillar: 'GlobalEh', question: 'Q?', answer: 'A' }),
    ];

    const result = selectTopicContext({
      topic: 'Test',
      pillar: 'GlobalEh',
      existing,
    });

    expect(result).toEqual([{ question: 'Q?', answer: 'A' }]);
    expect(result[0]).not.toHaveProperty('id');
    expect(result[0]).not.toHaveProperty('pillar');
  });
});
