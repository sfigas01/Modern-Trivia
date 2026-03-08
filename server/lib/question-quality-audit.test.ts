import { describe, expect, it } from 'vitest';

import { auditQuestionQuality, formatQuestionQualitySummary } from './question-quality-audit';

describe('auditQuestionQuality', () => {
  it('detects high-severity issues like answer leakage and duplicate ids', () => {
    const report = auditQuestionQuality([
      {
        id: 'q1',
        category: 'History',
        difficulty: 'Easy',
        question: 'Who was the first Prime Minister of Canada?',
        answer: 'Sir John A. Macdonald',
        explanation: 'Sir John A. Macdonald became the first Prime Minister in 1867.',
        tags: ['CA', 'History', 'TimeCapsule'],
        sourceUrl: 'https://example.com/source',
      },
      {
        id: 'q1',
        category: 'Music',
        difficulty: 'Easy',
        question: 'What Canadian musician is known as Oscar Peterson?',
        answer: 'Oscar Peterson',
        explanation: 'Oscar Peterson was a Canadian jazz pianist.',
        tags: ['CA', 'Music', 'TimeCapsule'],
        sourceUrl: 'https://example.com/source-2',
      },
    ]);

    expect(
      report.findings.some(
        (finding) => finding.rule === 'duplicate_question_id' && finding.questionId === 'q1'
      )
    ).toBe(true);
    expect(
      report.findings.some(
        (finding) => finding.rule === 'answer_leakage' && finding.questionIndex === 2
      )
    ).toBe(true);
    expect(report.findingsBySeverity.high).toBeGreaterThan(0);
  });

  it('flags ambiguous prompts and answer-type mismatches as medium severity', () => {
    const report = auditQuestionQuality([
      {
        id: 'q2',
        category: 'General Knowledge',
        difficulty: 'Medium',
        question: 'What is the best dessert in the world?',
        answer: 'Ice cream',
        explanation: 'Dessert preferences vary by person and region.',
        tags: ['Global', 'General Knowledge', 'GlobalEh'],
        sourceName: 'Editorial',
      },
      {
        id: 'q3',
        category: 'Geography',
        difficulty: 'Medium',
        question: 'Name two oceans that border Canada.',
        answer: 'Atlantic',
        explanation: 'Canada touches the Atlantic, Pacific, and Arctic oceans.',
        tags: ['CA', 'Geography', 'GlobalEh'],
        sourceName: 'Atlas',
      },
      {
        id: 'q4',
        category: 'History',
        difficulty: 'Easy',
        question: 'In what year did Canada become a country?',
        answer: 'Confederation era',
        explanation: 'Canada became a country in 1867.',
        tags: ['CA', 'History', 'TimeCapsule'],
        sourceName: 'History text',
      },
    ]);

    expect(report.findings.some((finding) => finding.rule === 'subjective_prompt')).toBe(true);
    expect(report.findings.some((finding) => finding.rule === 'multi_answer_mismatch')).toBe(true);
    expect(report.findings.some((finding) => finding.rule === 'answer_type_mismatch')).toBe(true);
    expect(report.findingsBySeverity.medium).toBeGreaterThanOrEqual(3);
  });

  it('returns a concise human-readable summary', () => {
    const report = auditQuestionQuality([
      {
        id: 'q5',
        category: 'Science',
        difficulty: 'Medium',
        question: 'What does DNA stand for?',
        answer: 'Deoxyribonucleic acid',
        explanation: 'DNA stands for deoxyribonucleic acid.',
        tags: ['Global', 'Science', 'GlobalEh'],
        sourceName: 'Biology textbook',
      },
    ]);

    const summary = formatQuestionQualitySummary(report);
    expect(summary).toContain('Questions scanned: 1');
    expect(summary).toContain('Findings: 0');
  });
});
