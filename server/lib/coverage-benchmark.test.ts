import { describe, expect, it } from 'vitest';

import {
  DIVERSITY_THRESHOLD,
  runCoverageBenchmark,
  scorePillarDistribution,
  scoreSubtopicDiversity,
  validateCoverageCases,
  type CoverageBenchmarkCase,
  type CoverageBenchmarkQuestion,
} from './coverage-benchmark';

function q(id: string, question: string, pillar = 'GlobalEh'): CoverageBenchmarkQuestion {
  return { id, question, pillar };
}

describe('scoreSubtopicDiversity', () => {
  it('treats an empty batch as fully diverse', () => {
    const result = scoreSubtopicDiversity([]);
    expect(result.diversityRatio).toBe(1);
    expect(result.totalQuestions).toBe(0);
  });

  it('gives a single question a diversity ratio of 1', () => {
    const result = scoreSubtopicDiversity([q('q1', 'What year did the Summit Series happen?')]);
    expect(result.diversityRatio).toBe(1);
    expect(result.distinctSubtopicCount).toBe(1);
  });

  it('scores clearly distinct questions as fully diverse with no collisions', () => {
    const result = scoreSubtopicDiversity([
      q('q1', 'What year did the 1972 Summit Series take place?'),
      q('q2', 'Which city is home to the Hockey Hall of Fame?'),
      q('q3', 'What Canadian province produces the most maple syrup?'),
      q('q4', 'Who composed the Canadian national anthem?'),
    ]);
    expect(result.diversityRatio).toBe(1);
    expect(result.duplicatePairs).toEqual([]);
  });

  it('clusters near-paraphrases of the same fact into one subtopic', () => {
    const result = scoreSubtopicDiversity([
      q('q1', 'Which player holds the record for most career NHL goals?'),
      q('q2', 'Who holds the record for the most career goals in NHL history?'),
      q('q3', 'What player has scored the most career goals in the NHL?'),
    ]);
    expect(result.distinctSubtopicCount).toBe(1);
    expect(result.diversityRatio).toBeCloseTo(1 / 3);
    expect(result.duplicatePairs.length).toBeGreaterThan(0);
  });

  it('mixes clustered duplicates with genuinely distinct questions', () => {
    const result = scoreSubtopicDiversity([
      q('q1', 'Which player holds the record for most career NHL goals?'),
      q('q2', 'Who holds the record for the most career goals in NHL history?'),
      q('q3', 'In what year did the Toronto Maple Leafs last win the Stanley Cup?'),
      q('q4', 'Which arena did the Montreal Canadiens play in before the Bell Centre?'),
    ]);
    // q1/q2 collapse into one cluster; q3 and q4 are each their own.
    expect(result.distinctSubtopicCount).toBe(3);
    expect(result.diversityRatio).toBeCloseTo(3 / 4);
  });
});

describe('scorePillarDistribution', () => {
  it('reports every strategy pillar even when a batch has zero questions in it', () => {
    const result = scorePillarDistribution([q('q1', 'A question?', 'GlobalEh')]);
    const pillars = result.map((r) => r.pillar).sort();
    expect(pillars).toEqual(['FreshPrints', 'GlobalEh', 'GreatOutdoors', 'TimeCapsule'].sort());
  });

  it('flags a pillar as within tolerance when it matches its CONTENT_STRATEGY.md target', () => {
    const questions = [
      ...Array.from({ length: 3 }, (_, i) =>
        q(`tc${i}`, `TimeCapsule question ${i}?`, 'TimeCapsule')
      ),
      ...Array.from({ length: 3 }, (_, i) => q(`ge${i}`, `GlobalEh question ${i}?`, 'GlobalEh')),
      ...Array.from({ length: 3 }, (_, i) =>
        q(`fp${i}`, `FreshPrints question ${i}?`, 'FreshPrints')
      ),
      q('go0', 'GreatOutdoors question?', 'GreatOutdoors'),
    ];
    const result = scorePillarDistribution(questions);
    for (const entry of result) {
      expect(entry.withinTolerance).toBe(true);
    }
  });

  it('flags a pillar as out of tolerance when a batch is entirely one pillar', () => {
    const questions = Array.from({ length: 5 }, (_, i) =>
      q(`ge${i}`, `Question ${i}?`, 'GlobalEh')
    );
    const result = scorePillarDistribution(questions);
    const globalEh = result.find((r) => r.pillar === 'GlobalEh');
    const greatOutdoors = result.find((r) => r.pillar === 'GreatOutdoors');
    expect(globalEh?.withinTolerance).toBe(false);
    expect(greatOutdoors?.withinTolerance).toBe(false);
  });
});

describe('runCoverageBenchmark', () => {
  const diverseCase: CoverageBenchmarkCase = {
    id: 'diverse-hockey-batch',
    topic: 'Hockey',
    expectDiverse: true,
    questions: [
      q('q1', 'What year did the 1972 Summit Series take place?'),
      q('q2', 'Which city is home to the Hockey Hall of Fame?'),
      q('q3', 'Who holds the NHL record for most career goals?'),
      q('q4', 'What Canadian province is credited with the origin of ice hockey?'),
    ],
  };

  const meanRevertedCase: CoverageBenchmarkCase = {
    id: 'mean-reverted-hockey-batch',
    topic: 'Hockey',
    expectDiverse: false,
    questions: [
      q('q1', 'Which player holds the record for most career NHL goals?'),
      q('q2', 'Who holds the record for the most career goals in NHL history?'),
      q('q3', 'What player has scored the most career goals in the NHL?'),
      q('q4', 'Which NHL player has the highest career goal total?'),
    ],
  };

  it('agrees with a positive control (diverse batch)', () => {
    const report = runCoverageBenchmark([diverseCase]);
    expect(report.cases[0].detectedDiverse).toBe(true);
    expect(report.cases[0].agrees).toBe(true);
    expect(report.overallAccuracy).toBe(1);
  });

  it('agrees with a negative control (mean-reverted batch)', () => {
    const report = runCoverageBenchmark([meanRevertedCase]);
    expect(report.cases[0].detectedDiverse).toBe(false);
    expect(report.cases[0].agrees).toBe(true);
    expect(report.overallAccuracy).toBe(1);
  });

  it('scores overall accuracy across a mix of controls', () => {
    const report = runCoverageBenchmark([diverseCase, meanRevertedCase]);
    expect(report.totalCases).toBe(2);
    expect(report.agreementCount).toBe(2);
    expect(report.overallAccuracy).toBe(1);
  });

  it('flags disagreement when a batch does not match its expected label', () => {
    const mislabeled: CoverageBenchmarkCase = { ...meanRevertedCase, expectDiverse: true };
    const report = runCoverageBenchmark([mislabeled]);
    expect(report.cases[0].agrees).toBe(false);
    expect(report.overallAccuracy).toBe(0);
  });

  it('uses the documented diversity threshold as the diverse/not-diverse cutoff', () => {
    expect(DIVERSITY_THRESHOLD).toBeGreaterThan(0);
    expect(DIVERSITY_THRESHOLD).toBeLessThanOrEqual(1);
  });
});

describe('validateCoverageCases', () => {
  it('accepts well-formed cases', () => {
    expect(
      validateCoverageCases([
        { id: 'c1', topic: 'Hockey', expectDiverse: true, questions: [q('q1', 'A question?')] },
      ])
    ).toEqual([]);
  });

  it('flags a missing id', () => {
    const problems = validateCoverageCases([
      { id: '', topic: 'Hockey', expectDiverse: true, questions: [q('q1', 'A question?')] },
    ]);
    expect(problems).toContain('A case is missing an id.');
  });

  it('flags a duplicate id', () => {
    const problems = validateCoverageCases([
      { id: 'c1', topic: 'Hockey', expectDiverse: true, questions: [q('q1', 'A question?')] },
      { id: 'c1', topic: 'Hockey', expectDiverse: false, questions: [q('q2', 'Another one?')] },
    ]);
    expect(problems).toContain('Duplicate case id: c1');
  });

  it('flags a case with no questions', () => {
    const problems = validateCoverageCases([
      { id: 'c1', topic: 'Hockey', expectDiverse: true, questions: [] },
    ]);
    expect(problems).toContain('Case c1: must include at least one question.');
  });
});
