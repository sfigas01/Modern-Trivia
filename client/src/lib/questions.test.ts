import { describe, expect, it } from 'vitest';

import questions from './questions.json';

type QuestionRecord = {
  id: string;
  category: string;
  difficulty: string;
  question: string;
  answer: string;
  explanation: string;
  tags: string[];
};

const questionList = questions as QuestionRecord[];
const requiredTextFields = ['id', 'category', 'difficulty', 'question', 'answer', 'explanation'];
const validDifficulties = new Set(['Easy', 'Medium', 'Hard']);
const regionTags = new Set(['CA', 'US', 'Global']);
const pillarTags = new Set(['GlobalEh', 'FreshPrints', 'TimeCapsule', 'GreatOutdoors']);

function compactText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

describe('questions.json data integrity', () => {
  it('contains at least one question', () => {
    expect(questionList.length).toBeGreaterThan(0);
  });

  it('has required non-empty fields and tags for every question', () => {
    const violations = questionList.flatMap((question) => {
      const missingFields = requiredTextFields
        .filter((field) => {
          const value = question[field as keyof QuestionRecord];
          return typeof value !== 'string' || value.trim().length === 0;
        })
        .map((field) => `${question.id || '<missing id>'}: ${field}`);

      if (!Array.isArray(question.tags) || question.tags.length === 0) {
        missingFields.push(`${question.id || '<missing id>'}: tags`);
      }

      return missingFields;
    });

    expect(violations).toEqual([]);
  });

  it('uses supported difficulty values', () => {
    const invalidDifficulties = questionList
      .filter((question) => !validDifficulties.has(question.difficulty))
      .map((question) => `${question.id}: ${question.difficulty}`);

    expect(invalidDifficulties).toEqual([]);
  });

  it('normalizes category, region, and pillar tags', () => {
    const invalidTags = questionList.flatMap((question) => {
      const tags = new Set(question.tags);
      const violations: string[] = [];

      if (!tags.has(question.category)) {
        violations.push(`${question.id}: missing category tag ${question.category}`);
      }

      if (!question.tags.some((tag) => regionTags.has(tag))) {
        violations.push(`${question.id}: missing region tag`);
      }

      if (!question.tags.some((tag) => pillarTags.has(tag))) {
        violations.push(`${question.id}: missing pillar tag`);
      }

      return violations;
    });

    expect(invalidTags).toEqual([]);
  });

  it('has unique ids', () => {
    const seen = new Set<string>();
    const duplicates = questionList
      .filter((question) => {
        if (seen.has(question.id)) {
          return true;
        }

        seen.add(question.id);
        return false;
      })
      .map((question) => question.id);

    expect(duplicates).toEqual([]);
  });

  it('has unique normalized question and answer pairs', () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];

    for (const question of questionList) {
      const key = `${compactText(question.question)}::${compactText(question.answer)}`;
      const existingId = seen.get(key);

      if (existingId) {
        duplicates.push(`${existingId} / ${question.id}`);
        continue;
      }

      seen.set(key, question.id);
    }

    expect(duplicates).toEqual([]);
  });
});
