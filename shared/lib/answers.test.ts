import { describe, it, expect } from 'vitest';
import { normalize, verifyAttempt, pointsFor, QUESTIONS_PER_TEAM_ROTATION } from './answers';
import type { Question } from './answers';

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    category: 'Science',
    difficulty: 'Medium',
    question: 'What is H2O?',
    answer: 'Water',
    explanation: 'H2O is the chemical formula for water.',
    pillar: 'GlobalEh',
    tags: [],
    ...overrides,
  };
}

describe('normalize', () => {
  it('lowercases input', () => {
    expect(normalize('Hello World')).toBe('hello world');
  });

  it('removes punctuation', () => {
    expect(normalize('Hello, World!')).toBe('hello world');
  });

  it('removes articles', () => {
    expect(normalize('The quick brown fox')).toBe('quick brown fox');
    expect(normalize('A dog and an cat')).toBe('dog and cat');
  });

  it('converts number words to digits', () => {
    expect(normalize('one two three')).toBe('1 2 3');
    expect(normalize('zero nine')).toBe('0 9');
  });

  it('collapses extra whitespace', () => {
    expect(normalize('  hello   world  ')).toBe('hello world');
  });

  it('handles mixed cases', () => {
    expect(normalize('The One Ring')).toBe('1 ring');
  });
});

describe('verifyAttempt', () => {
  it('returns CORRECT for exact match', () => {
    const q = makeQuestion({ answer: 'Water', difficulty: 'Easy' });
    const result = verifyAttempt('Water', q);
    expect(result.verdict).toBe('CORRECT');
    expect(result.points).toBe(1);
  });

  it('returns CORRECT case-insensitively', () => {
    const q = makeQuestion({ answer: 'water', difficulty: 'Easy' });
    expect(verifyAttempt('WATER', q).verdict).toBe('CORRECT');
  });

  it('returns CORRECT for acceptable answer exact match', () => {
    const q = makeQuestion({ answer: 'H2O', acceptableAnswers: ['Water', 'water'] });
    expect(verifyAttempt('Water', q).verdict).toBe('CORRECT');
  });

  it('returns CORRECT for fuzzy match above threshold', () => {
    const q = makeQuestion({ answer: 'Niagara Falls', difficulty: 'Easy' });
    expect(verifyAttempt('Niagra Falls', q).verdict).toBe('CORRECT');
  });

  it('returns INCORRECT for fuzzy match below threshold', () => {
    const q = makeQuestion({ answer: 'Niagara Falls', difficulty: 'Easy' });
    expect(verifyAttempt('Rocky Mountains', q).verdict).toBe('INCORRECT');
  });

  it('returns INCORRECT for wrong answer', () => {
    const q = makeQuestion({ answer: 'Water', difficulty: 'Medium' });
    const result = verifyAttempt('Fire', q);
    expect(result.verdict).toBe('INCORRECT');
    expect(result.points).toBe(-2);
  });

  it('awards Easy ±1 points', () => {
    const q = makeQuestion({ answer: 'Water', difficulty: 'Easy' });
    expect(verifyAttempt('Water', q).points).toBe(1);
    expect(verifyAttempt('Fire', q).points).toBe(-1);
  });

  it('awards Medium ±2 points', () => {
    const q = makeQuestion({ answer: 'Water', difficulty: 'Medium' });
    expect(verifyAttempt('Water', q).points).toBe(2);
    expect(verifyAttempt('Fire', q).points).toBe(-2);
  });

  it('awards Hard ±3 points', () => {
    const q = makeQuestion({ answer: 'Water', difficulty: 'Hard' });
    expect(verifyAttempt('Water', q).points).toBe(3);
    expect(verifyAttempt('Fire', q).points).toBe(-3);
  });

  it('returns CORRECT for fuzzy match on acceptable answer variant', () => {
    const q = makeQuestion({ answer: 'H2O', acceptableAnswers: ['dihydrogen monoxide'] });
    expect(verifyAttempt('dihydrogen monooxide', q).verdict).toBe('CORRECT');
  });

  it('skips fuzzy check for inputs of 2 chars or fewer', () => {
    const q = makeQuestion({ answer: 'Go', difficulty: 'Easy' });
    expect(verifyAttempt('Go', q).verdict).toBe('CORRECT');
    expect(verifyAttempt('Go', q).points).toBe(1);
  });
});

describe('pointsFor', () => {
  it('returns 1 for Easy', () => {
    expect(pointsFor('Easy')).toBe(1);
  });

  it('returns 2 for Medium', () => {
    expect(pointsFor('Medium')).toBe(2);
  });

  it('returns 3 for Hard', () => {
    expect(pointsFor('Hard')).toBe(3);
  });
});

describe('QUESTIONS_PER_TEAM_ROTATION', () => {
  it('equals 4', () => {
    expect(QUESTIONS_PER_TEAM_ROTATION).toBe(4);
  });
});
