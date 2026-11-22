import { describe, expect, it } from 'vitest';

import {
  buildThemeHumanEvaluationReport,
  type ThemeHumanEvaluationRow,
} from './theme-human-evaluation';

const base: ThemeHumanEvaluationRow = {
  jobId: '11111111-1111-4111-8111-111111111111',
  slotKey: 'proposal:001',
  slotOrdinal: 1,
  targetDifficulty: 'Easy',
  proposalStatus: 'proposed',
  proposal: { status: 'proposed' },
  canonicalFactKey: `fact-scope-v1:${'a'.repeat(64)}`,
  fact: { statement: 'Mount Etna is in Sicily.', canonicalAnswer: 'Sicily' },
  factReview: { aggregateVerdict: 'pass', dimensions: {} },
  generationStatus: 'persisted',
  writerOutput: {
    status: 'candidate',
    question: 'On which island is Mount Etna located?',
    answer: 'Sicily',
  },
  candidateId: '22222222-2222-4222-8222-222222222222',
  candidateStatus: 'pending',
  question: { question: 'On which island is Mount Etna located?', answer: 'Sicily' },
  qaReview: { status: 'withheld', stage: 'quality', reason: 'quality_adverse' },
  evidenceReview: { verdict: 'pass', dimensions: [] },
  sources: [{ url: 'https://en.wikipedia.org/wiki/Mount_Etna', passage: 'Mount Etna...' }],
  approved: false,
  repairedFromCandidateId: null,
  rewrite: null,
};

describe('owner-attended theme human evaluation report', () => {
  it('keeps the complete Q&A and recommends repair for an adverse player review', () => {
    const report = buildThemeHumanEvaluationReport([base]);

    expect(report).toMatchObject({
      answerRedacted: false,
      previewOnly: true,
      items: [
        {
          question: { answer: 'Sicily' },
          sources: [{ url: 'https://en.wikipedia.org/wiki/Mount_Etna' }],
          machineRecommendation: { label: 'repair', reason: 'quality_adverse' },
          ownerFeedback: { label: null, notes: '' },
        },
      ],
    });
  });

  it('distinguishes proposal declines and completed approvals', () => {
    const report = buildThemeHumanEvaluationReport([
      { ...base, approved: true },
      {
        ...base,
        slotKey: 'proposal:002',
        slotOrdinal: 2,
        proposalStatus: 'withheld',
        generationStatus: null,
        candidateId: null,
        candidateStatus: null,
        question: null,
        qaReview: null,
        evidenceReview: null,
      },
    ]);

    expect(report.items.map((item) => item.machineRecommendation.label)).toEqual([
      'approve',
      'reject',
    ]);
  });
});
