import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

import {
  RATING_COLUMNS,
  SpendLimitError,
  SpendTracker,
  buildBlindSheet,
  buildGroundedPrompt,
  buildJudgePrompt,
  cleanWikipediaExtract,
  cohenKappa,
  computeReport,
  extractUsage,
  failedPairs,
  mergeRetriedGeneration,
  normalizeGeneratedQuestion,
  parseCsv,
  parseJudgeResponse,
  parseRatingsCsv,
  priceForModel,
  renderReportMarkdown,
  runGeneration,
  shuffle,
  spearman,
  toCsv,
  wilsonInterval,
  type ArmOutput,
  type Candidate,
  type CandidatesFile,
  type EvalQuestion,
  type EvalTheme,
} from './question-eval';

const THEMES: EvalTheme[] = [
  { id: 'volcanoes', theme: 'Volcanoes', pillar: 'GlobalEh', kind: 'standard' },
  { id: 'raves', theme: 'Toronto raves', pillar: 'TimeCapsule', kind: 'niche' },
];

function makeQuestion(text: string, overrides: Partial<EvalQuestion> = {}): EvalQuestion {
  return {
    question: text,
    answer: `answer to ${text}`,
    acceptableAnswers: [],
    explanation: 'Because.',
    difficulty: 'Medium',
    category: 'Science & Nature',
    pillar: 'GlobalEh',
    region: 'Global',
    sourceUrl: 'https://en.wikipedia.org/wiki/Example',
    sourceName: 'Wikipedia',
    ...overrides,
  };
}

describe('spend tracking', () => {
  it('prices dated model snapshots by their alias', () => {
    expect(priceForModel('gpt-5.4-mini-2026-03-17')).toEqual(priceForModel('gpt-5.4-mini'));
    expect(priceForModel('gpt-5.4')).toBeNull();
  });

  it('accumulates cost and refuses requests once the cap is reached', () => {
    const tracker = new SpendTracker(0.01);
    tracker.assertWithinLimit();
    tracker.record('gpt-6.1-sol', 1_000, 1_000); // 0.0025 + 0.01 = 0.0125
    expect(tracker.totalUsd).toBeCloseTo(0.0125, 6);
    expect(() => tracker.assertWithinLimit()).toThrow(SpendLimitError);
  });

  it('reads usage from Chat Completions and Responses bodies', () => {
    expect(extractUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } })).toEqual({
      input: 10,
      output: 5,
    });
    expect(extractUsage({ usage: { input_tokens: 7, output_tokens: 3 } })).toEqual({
      input: 7,
      output: 3,
    });
    expect(extractUsage({ error: 'nope' })).toBeNull();
  });
});

describe('normalizeGeneratedQuestion', () => {
  it('keeps valid questions and maps category case-insensitively', () => {
    const q = normalizeGeneratedQuestion(
      {
        question: 'Q?',
        answer: 'A',
        difficulty: 'hard',
        category: 'sports',
        sourceUrl: 'https://en.wikipedia.org/wiki/X',
        tags: ['CA', 'GlobalEh'],
      },
      'GlobalEh'
    );
    expect(q).toMatchObject({
      difficulty: 'Hard',
      category: 'Sports',
      region: 'CA',
      sourceName: 'Wikipedia',
    });
  });

  it('rejects questions without an answer, difficulty or http source', () => {
    expect(
      normalizeGeneratedQuestion(
        { question: 'Q?', difficulty: 'Easy', sourceUrl: 'https://x' },
        'GlobalEh'
      )
    ).toBeNull();
    expect(
      normalizeGeneratedQuestion(
        { question: 'Q?', answer: 'A', difficulty: 'Tricky', sourceUrl: 'https://x' },
        'GlobalEh'
      )
    ).toBeNull();
    expect(
      normalizeGeneratedQuestion(
        { question: 'Q?', answer: 'A', difficulty: 'Easy', sourceUrl: 'none' },
        'GlobalEh'
      )
    ).toBeNull();
  });
});

describe('Wikipedia grounding helpers', () => {
  it('drops trailing reference sections and truncates on a line break', () => {
    const text = `Intro paragraph.\n\n\n\nHistory line one.\nHistory line two.\n\n== References ==\nRef 1`;
    expect(cleanWikipediaExtract(text, 1_000)).toBe(
      'Intro paragraph.\n\nHistory line one.\nHistory line two.'
    );
    expect(cleanWikipediaExtract(text, 40)).toBe('Intro paragraph.\n\nHistory line one.');
  });

  it('includes every article URL and the requested count in the prompt', () => {
    const prompt = buildGroundedPrompt(THEMES[0], 4, [
      { title: 'Volcano', url: 'https://en.wikipedia.org/wiki/Volcano', text: 'Lava.' },
      { title: 'Lava', url: 'https://en.wikipedia.org/wiki/Lava', text: 'Hot.' },
    ]);
    expect(prompt).toContain('exactly 4 trivia questions');
    expect(prompt).toContain('https://en.wikipedia.org/wiki/Volcano');
    expect(prompt).toContain('https://en.wikipedia.org/wiki/Lava');
  });
});

describe('CSV', () => {
  it('round-trips quotes, commas and newlines', () => {
    const rows = [
      ['item', 'question'],
      ['Q1', 'He said "hi", then\nleft'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('handles a BOM and LF-only line endings from spreadsheet exports', () => {
    expect(parseCsv('﻿a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('statistics', () => {
  it('computes a Wilson interval that stays inside [0, 1]', () => {
    const interval = wilsonInterval(10, 20)!;
    expect(interval.low).toBeCloseTo(0.299, 2);
    expect(interval.high).toBeCloseTo(0.701, 2);
    expect(wilsonInterval(0, 5)!.low).toBe(0);
    expect(wilsonInterval(0, 0)).toBeNull();
  });

  it("computes Cohen's kappa", () => {
    expect(
      cohenKappa([
        [true, true],
        [false, false],
        [true, true],
        [false, false],
      ])
    ).toBe(1);
    // observed 0.5, expected 0.5 -> 0
    expect(
      cohenKappa([
        [true, true],
        [true, false],
        [false, true],
        [false, false],
      ])
    ).toBe(0);
    expect(cohenKappa([])).toBeNull();
  });

  it('computes Spearman correlation with ties', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([3, 3, 3], [1, 2, 3])).toBeNull();
  });

  it('shuffles deterministically', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffle(items, 42)).toEqual(shuffle(items, 42));
    expect(shuffle(items, 42)).not.toEqual(items);
    expect([...shuffle(items, 42)].sort((a, b) => a - b)).toEqual(items);
  });
});

describe('judge response parsing', () => {
  it('accepts valid ratings and reports missing or invalid items', () => {
    const raw = JSON.stringify({
      ratings: [
        {
          item: 'Q1',
          correct: 'y',
          one_answer: 'y',
          fun: 4,
          difficulty: 'M',
          fits: 'y',
          verdict: 'keep',
          why: 'Good.',
        },
        {
          item: 'Q2',
          correct: 'maybe-ish',
          one_answer: 'y',
          fun: 9,
          difficulty: 'M',
          fits: 'y',
          verdict: 'keep',
        },
        {
          item: 'Q9',
          correct: 'y',
          one_answer: 'y',
          fun: 3,
          difficulty: 'E',
          fits: 'y',
          verdict: 'keep',
        },
      ],
    });
    const parsed = parseJudgeResponse(raw, ['Q1', 'Q2', 'Q3']);
    expect(parsed.ratings.get('Q1')).toMatchObject({
      fun: 4,
      verdict: 'keep',
      difficulty: 'Medium',
    });
    expect(parsed.ratings.has('Q9')).toBe(false);
    expect(parsed.problems.some((p) => p.startsWith('Q2:'))).toBe(true);
    expect(parsed.problems).toContain('Q3: missing from judge response');
  });

  it('reports non-JSON output instead of throwing', () => {
    expect(parseJudgeResponse('not json', ['Q1']).problems).toEqual([
      'judge response was not valid JSON',
    ]);
  });

  it('never shows the judge which group an item came from', () => {
    const prompt = buildJudgePrompt([
      { item: 'Q1', theme: 'Volcanoes', question: makeQuestion('What erupts?') },
    ]);
    expect(prompt).not.toMatch(/planted|library|arm|guardian/i);
  });
});

describe('fixture config', () => {
  it('references anchors that exist', () => {
    const config = JSON.parse(readFileSync('test/fixtures/question-eval/config.json', 'utf8'));
    const library = JSON.parse(readFileSync(config.libraryAnchors.source, 'utf8')) as Array<{
      id: string;
    }>;
    const cases = JSON.parse(readFileSync(config.plantedBad.source, 'utf8')) as Array<{
      id: string;
      expects: string[];
    }>;
    for (const id of config.libraryAnchors.ids)
      expect(
        library.some((q) => q.id === id),
        id
      ).toBe(true);
    for (const id of config.plantedBad.ids) {
      const found = cases.find((c) => c.id === id);
      expect(found, id).toBeDefined();
      expect(found!.expects.length, `${id} should be a known-bad case`).toBeGreaterThan(0);
    }
    expect(new Set(config.themes.map((t: EvalTheme) => t.id)).size).toBe(config.themes.length);
  });
});

/**
 * End-to-end stand-in run: fake generators, a blind sheet, an owner filling it in, a judge, and
 * the report. No network calls.
 */
describe('stand-in run', () => {
  async function standInRun() {
    let clock = 0;
    const tracker = new SpendTracker(5);
    const fakeArm =
      (arm: 'A' | 'B') =>
      async (theme: EvalTheme, count: number): Promise<ArmOutput> => {
        clock += 1_000;
        tracker.record('gpt-5.4-mini', 1_000, 500);
        if (arm === 'B' && theme.id === 'raves')
          throw new Error('no usable Wikipedia articles found');
        return {
          questions: Array.from({ length: count - (arm === 'A' ? 0 : 1) }, (_, i) => ({
            question: makeQuestion(`${arm} ${theme.id} ${i}`),
            guardian: {
              verdict: 'pass',
              coherence: 'pass',
              obviousness: 'pass',
              confidence: 90,
              highFindings: 0,
              repaired: false,
            },
          })),
          droppedByGate: arm === 'B' ? 1 : null,
          grounding:
            arm === 'B'
              ? [
                  {
                    title: 'Volcano',
                    url: 'https://en.wikipedia.org/wiki/Volcano',
                    characters: 100,
                  },
                ]
              : undefined,
        };
      };
    const generated = await runGeneration(
      THEMES,
      3,
      { generateArmA: fakeArm('A'), generateArmB: fakeArm('B'), now: () => clock },
      tracker
    );
    const anchors: Candidate[] = [
      {
        id: 'library-q1',
        group: 'library',
        themeId: null,
        theme: 'Science & Nature',
        question: makeQuestion('lib'),
        guardian: null,
      },
      {
        id: 'planted-bad1',
        group: 'planted',
        themeId: null,
        theme: 'Sports',
        question: makeQuestion('bad'),
        guardian: null,
      },
    ];
    const candidatesFile: CandidatesFile = {
      schemaVersion: 'question-eval-v1',
      runId: 'test-run',
      createdAt: '2026-11-22T00:00:00.000Z',
      generationModel: 'gpt-5.4-mini',
      questionsPerThemePerArm: 3,
      themes: THEMES,
      candidates: [...generated.candidates, ...anchors],
      stats: generated.stats,
      grounding: generated.grounding,
    };
    return { generated, candidatesFile, sheet: buildBlindSheet(candidatesFile.candidates, 7) };
  }

  it('records per-arm stats, keeps going after one arm fails, and hides groups in the sheet', async () => {
    const { generated, sheet } = await standInRun();
    expect(generated.stats).toHaveLength(4);
    const failed = generated.stats.find((s) => s.arm === 'B' && s.themeId === 'raves')!;
    expect(failed).toMatchObject({ delivered: 0, error: 'no usable Wikipedia articles found' });
    expect(failed.costUsd).toBeGreaterThan(0);
    // A: 3 + 3, B: 2 + 0, plus 2 anchors
    expect(Object.keys(sheet.key)).toHaveLength(10);
    const [header, ...rows] = parseCsv(sheet.csv);
    expect(header).toEqual(expect.arrayContaining([...RATING_COLUMNS]));
    expect(sheet.csv).not.toMatch(/planted|library|guardian/i);
    expect(rows.every((r) => RATING_COLUMNS.every((c) => r[header.indexOf(c)] === ''))).toBe(true);
  });

  it('stops the whole run when the spend cap is hit', async () => {
    const tracker = new SpendTracker(0.0001);
    const spend = async (): Promise<ArmOutput> => {
      tracker.assertWithinLimit();
      tracker.record('gpt-6.1-sol', 100_000, 0);
      return { questions: [], droppedByGate: null };
    };
    await expect(
      runGeneration(THEMES, 2, { generateArmA: spend, generateArmB: spend, now: () => 0 }, tracker)
    ).rejects.toThrow(SpendLimitError);
  });

  it('scores a filled-in sheet and a judge into a report', async () => {
    const { candidatesFile, sheet } = await standInRun();
    const [header, ...rows] = parseCsv(sheet.csv);
    const col = (name: string) => header.indexOf(name);
    const judgeRatings = new Map();
    rows.forEach((row, index) => {
      const group = sheet.key[row[col('item')]].group;
      if (index === 0) return; // leave one unrated
      const keep = group === 'A' || group === 'library';
      Object.assign(row, {
        [col('correct')]: group === 'planted' ? 'n' : 'y',
        [col('one_answer')]: 'y',
        [col('fun')]: group === 'A' ? '4' : '2',
        [col('difficulty')]: 'M',
        [col('fits')]: 'y',
        [col('verdict')]: keep ? 'keep' : 'drop',
        [col('why')]: 'test',
      });
      judgeRatings.set(row[col('item')], {
        correct: 'y',
        oneAnswer: 'y',
        fun: group === 'A' ? 5 : 1,
        difficulty: 'Medium',
        fits: 'y',
        verdict: group === 'planted' ? 'keep' : keep ? 'keep' : 'drop',
        why: 'judge reason',
      });
    });
    const ratings = parseRatingsCsv(toCsv([header, ...rows]), sheet.key);
    expect(ratings.unrated).toHaveLength(1);
    expect(ratings.errors).toEqual([]);

    const report = computeReport({
      candidatesFile,
      key: sheet.key,
      ratings,
      judge: { model: 'gpt-6.1-sol', ratings: judgeRatings },
    });
    const groupA = report.groups.find((g) => g.group === 'A')!;
    const armB = report.arms.find((a) => a.arm === 'B')!;
    expect(groupA.total).toBe(6);
    expect(groupA.keep).toBe(groupA.rated);
    expect(armB).toMatchObject({
      requested: 6,
      delivered: 2,
      errors: 1,
      droppedByGate: 1,
      kept: 0,
      costPerKeptUsd: null,
    });
    expect(report.judge!.plantedTotal).toBe(1);
    expect(report.judge!.plantedRejectedByJudge).toBe(0);
    expect(report.judge!.ownerIncorrect).toBeGreaterThanOrEqual(0);

    const markdown = renderReportMarkdown(report);
    expect(markdown).toContain('A: Guardian as is');
    expect(markdown).toContain('Unrated items (1)');
    // The report must not print question text.
    expect(markdown).not.toContain('A volcanoes 0');
  });

  it('retries only failed pairs and folds their earlier cost into the retry', async () => {
    const { candidatesFile } = await standInRun();
    expect(failedPairs(candidatesFile)).toEqual([{ arm: 'B', themeId: 'raves' }]);
    const tracker = new SpendTracker(5);
    const calls: string[] = [];
    const arm =
      (name: 'A' | 'B') =>
      async (theme: EvalTheme, count: number): Promise<ArmOutput> => {
        calls.push(`${name}:${theme.id}`);
        tracker.record('gpt-5.4-mini', 1_000, 0);
        return {
          questions: Array.from({ length: count }, (_, i) => ({
            question: makeQuestion(`retry ${i}`),
            guardian: null,
          })),
          droppedByGate: 0,
        };
      };
    const retried = await runGeneration(
      THEMES,
      3,
      { generateArmA: arm('A'), generateArmB: arm('B'), now: () => 0 },
      tracker,
      (a, themeId) => a === 'B' && themeId === 'raves'
    );
    expect(calls).toEqual(['B:raves']);
    const oldCost = candidatesFile.stats.find(
      (s) => s.arm === 'B' && s.themeId === 'raves'
    )!.costUsd;
    const merged = mergeRetriedGeneration(candidatesFile, retried);
    expect(failedPairs(merged)).toEqual([]);
    expect(merged.stats).toHaveLength(4);
    const raves = merged.stats.find((s) => s.arm === 'B' && s.themeId === 'raves')!;
    expect(raves.delivered).toBe(3);
    expect(raves.costUsd).toBeCloseTo(oldCost + 0.00075, 8);
    expect(merged.candidates.filter((c) => c.group === 'B' && c.themeId === 'raves')).toHaveLength(
      3
    );
    // Untouched pairs and anchors survive.
    expect(merged.candidates.filter((c) => c.group === 'A')).toHaveLength(6);
    expect(merged.candidates.filter((c) => c.group === 'library')).toHaveLength(1);
  });

  it('reports invalid rating cells instead of guessing', async () => {
    const { sheet } = await standInRun();
    const [header, first] = parseCsv(sheet.csv);
    first[header.indexOf('correct')] = 'probably';
    first[header.indexOf('fun')] = '7';
    const parsed = parseRatingsCsv(toCsv([header, first]), sheet.key);
    expect(parsed.ratings.size).toBe(0);
    expect(parsed.errors[0]).toMatch(/correct must be y, n or u; .*fun must be 1-5/);
  });
});
