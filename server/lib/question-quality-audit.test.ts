import { describe, expect, it } from 'vitest';

import { buildStaticFindingKey, isStaticFindingDismissed } from '../../shared/models/quality-sweep';
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

  it('builds unique static finding keys for repeated rules on the same question', () => {
    const report = auditQuestionQuality([
      {
        id: 'required-fields-1',
        category: '',
        difficulty: '',
        question: 'Which Canadian city hosts the Calgary Stampede?',
        answer: '',
        explanation: '',
        tags: ['CA', 'General Knowledge', 'GlobalEh'],
        sourceUrl: 'https://example.com/source',
        sourceName: 'Example Source',
      },
    ]);

    const missingRequiredFindings = report.findings.filter(
      (finding) =>
        finding.questionId === 'required-fields-1' && finding.rule === 'missing_required_field'
    );
    const keys = missingRequiredFindings.map(buildStaticFindingKey);

    expect(missingRequiredFindings.length).toBeGreaterThan(1);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('missing_required_field::Missing required field: answer.');
  });

  it('still recognizes legacy rule-only static dismissal keys', () => {
    const report = auditQuestionQuality([
      {
        id: 'legacy-dismissal-1',
        category: '',
        difficulty: 'Easy',
        question: 'Which Canadian city hosts the Calgary Stampede?',
        answer: '',
        explanation: 'The Calgary Stampede is hosted in Calgary.',
        tags: ['CA', 'General Knowledge', 'GlobalEh'],
        sourceUrl: 'https://example.com/source',
        sourceName: 'Example Source',
      },
    ]);

    const finding = report.findings.find(
      (candidate) =>
        candidate.questionId === 'legacy-dismissal-1' &&
        candidate.rule === 'missing_required_field' &&
        candidate.message === 'Missing required field: answer.'
    );

    expect(finding).toBeDefined();
    if (!finding) {
      throw new Error('Expected missing required answer finding');
    }
    expect(
      isStaticFindingDismissed(new Set(['legacy-dismissal-1::missing_required_field']), finding)
    ).toBe(true);
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

  it('detects keyword leakage when a significant answer word appears in the question', () => {
    const report = auditQuestionQuality([
      {
        id: 'kw1',
        category: 'Geography',
        difficulty: 'Medium',
        question: 'What is the tallest peak, sometimes called Everest, in the Himalayas?',
        answer: 'Mount Everest',
        explanation: 'Mount Everest is the tallest peak at 8,849m.',
        tags: ['Global', 'Geography', 'GlobalEh'],
        sourceUrl: 'https://example.com/everest',
        sourceName: 'National Geographic',
      },
    ]);

    const leakFindings = report.findings.filter((f) => f.rule === 'answer_leakage');
    expect(leakFindings.length).toBeGreaterThanOrEqual(1);
    expect(leakFindings.some((f) => f.severity === 'medium' && f.message.includes('everest'))).toBe(
      true
    );
  });

  it('detects morphological leakage when question word shares a root with answer keyword', () => {
    const report = auditQuestionQuality([
      {
        id: 'morph1',
        category: 'Science',
        difficulty: 'Hard',
        question: 'Which process is photosynthetic in nature?',
        answer: 'Photosynthesis',
        explanation: 'Photosynthesis converts light into chemical energy.',
        tags: ['Global', 'Science', 'GlobalEh'],
        sourceUrl: 'https://example.com/bio',
        sourceName: 'Biology textbook',
      },
    ]);

    const leakFindings = report.findings.filter((f) => f.rule === 'answer_leakage');
    expect(leakFindings.length).toBeGreaterThanOrEqual(1);
    expect(
      leakFindings.some((f) => f.severity === 'low' && f.message.includes('shares a root'))
    ).toBe(true);
  });

  it('detects morphological leakage for confederation/confederated', () => {
    const report = auditQuestionQuality([
      {
        id: 'morph2',
        category: 'History',
        difficulty: 'Medium',
        question: 'When was Canada confederated into a single dominion?',
        answer: 'Confederation',
        explanation: 'Canadian Confederation occurred on July 1, 1867.',
        tags: ['CA', 'History', 'TimeCapsule'],
        sourceUrl: 'https://example.com/confederation',
        sourceName: 'Canadian Encyclopedia',
      },
    ]);

    const leakFindings = report.findings.filter((f) => f.rule === 'answer_leakage');
    expect(leakFindings.length).toBeGreaterThanOrEqual(1);
    expect(
      leakFindings.some((f) => f.severity === 'low' && f.message.includes('shares a root'))
    ).toBe(true);
  });

  it('does not flag stopwords as keyword leakage', () => {
    const report = auditQuestionQuality([
      {
        id: 'stop1',
        category: 'History',
        difficulty: 'Medium',
        question: 'What is the name of the ancient structure in China?',
        answer: 'The Great Wall',
        explanation: 'The Great Wall of China is over 13,000 miles long.',
        tags: ['Global', 'History', 'TimeCapsule'],
        sourceUrl: 'https://example.com/wall',
        sourceName: 'Encyclopedia',
      },
    ]);

    const leakFindings = report.findings.filter((f) => f.rule === 'answer_leakage');
    expect(
      leakFindings.some((f) => f.message.includes('"the"') || f.message.includes('"great"'))
    ).toBe(false);
  });

  it('does not double-report keyword leakage when full answer already matches', () => {
    const report = auditQuestionQuality([
      {
        id: 'dup1',
        category: 'Music',
        difficulty: 'Easy',
        question: 'What Canadian musician is known as Oscar Peterson?',
        answer: 'Oscar Peterson',
        explanation: 'Oscar Peterson was a Canadian jazz pianist.',
        tags: ['CA', 'Music', 'TimeCapsule'],
        sourceUrl: 'https://example.com/oscar',
        sourceName: 'Jazz Archive',
      },
    ]);

    const leakFindings = report.findings.filter((f) => f.rule === 'answer_leakage');
    expect(leakFindings.length).toBe(1);
    expect(leakFindings[0].severity).toBe('high');
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
        sourceUrl: 'https://example.com/biology',
      },
    ]);

    const summary = formatQuestionQualitySummary(report);
    expect(summary).toContain('Questions scanned: 1');
    expect(summary).toContain('Findings: 0');
  });
});
