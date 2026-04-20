import { describe, expect, it } from 'vitest';

import { insertDisputeSchema, insertQuestionSchema } from './schema';

const validDisputePayload = {
  questionId: 'q-1',
  questionText: 'What is the capital of Canada?',
  correctAnswer: 'Ottawa',
  teamName: 'Alpha',
  submittedAnswer: 'Toronto',
  teamExplanation: 'The clue made Toronto sound acceptable.',
};

const validQuestionPayload = {
  id: 'q-test',
  category: 'History',
  difficulty: 'Medium',
  question: 'Which civilization built Machu Picchu?',
  answer: 'Inca Empire',
  explanation: 'Machu Picchu was built by the Inca Empire in the 15th century.',
  pillar: 'TimeCapsule',
};

describe('insertDisputeSchema', () => {
  it('accepts a valid dispute payload', () => {
    expect(insertDisputeSchema.parse(validDisputePayload)).toEqual(validDisputePayload);
  });

  it('rejects a payload missing a required field', () => {
    const result = insertDisputeSchema.safeParse({
      ...validDisputePayload,
      teamExplanation: undefined,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'teamExplanation')).toBe(
      true
    );
  });
});

describe('insertQuestionSchema', () => {
  it('accepts a valid question and applies insert defaults', () => {
    expect(insertQuestionSchema.parse(validQuestionPayload)).toMatchObject({
      ...validQuestionPayload,
      acceptableAnswers: [],
      status: 'approved',
      tags: [],
    });
  });

  it.each([
    ['difficulty', 'Impossible'],
    ['pillar', 'WrongPillar'],
    ['status', 'archived'],
  ])('rejects an invalid %s value', (field, value) => {
    const result = insertQuestionSchema.safeParse({
      ...validQuestionPayload,
      [field]: value,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === field)).toBe(true);
  });
});
