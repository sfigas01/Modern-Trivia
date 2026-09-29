import { describe, expect, it } from 'vitest';
import { buildReport, renderMarkdown } from '../../scripts/content-sweep';
import { auditQuestionQuality } from './question-quality-audit';
import { emptyDuplicateCounts, type DuplicateMatch } from '../../shared/models/quality-sweep';

describe('content-sweep semantic findings', () => {
  it.each([
    ['answer_conflict', 'high', 'Potential answer conflict'],
    ['review_required', 'medium', 'human review required'],
    ['semantic_duplicate', 'medium', 'Possible semantic duplicate'],
    ['exact', 'high', 'Possible exact duplicate'],
  ] as const)(
    'classifies %s on both questions without leaking answers',
    (matchType, severity, description) => {
      const questions = ['a', 'b'].map((id) => ({
        id,
        category: 'Culture',
        difficulty: 'Easy',
        question: 'Synthetic question?',
        answer: `Secretanswer${id}`,
        acceptableAnswers: [],
        explanation: '',
        pillar: 'GlobalEh',
        tags: [],
        sourceUrl: null,
        sourceName: null,
        status: 'approved',
        createdAt: '2026-01-01',
      }));
      const counts = emptyDuplicateCounts();
      counts[matchType] = 1;
      const match: DuplicateMatch = {
        questionIdA: 'a',
        questionIdB: 'b',
        matchType,
        similarityScore: 0.9,
        questionTextA: 'Synthetic question?',
        questionTextB: 'Synthetic question?',
        answerA: 'Secretanswera',
        answerB: 'Secretanswerb',
        aiReasoning: 'Secretanswera and Secretanswerb need comparison.',
      };
      const report = buildReport({
        prodUrl: 'https://example.invalid',
        durationSeconds: 1,
        questions,
        newFindings: [],
        options: { skipFactCheck: true, skipDuplicates: false },
        sweep: {
          generatedAt: '2026-01-01',
          totalQuestions: 2,
          audit: auditQuestionQuality([]),
          duplicates: {
            totalPairsChecked: 1,
            duplicatesFound: [match],
            duplicatesByType: counts,
            status: 'complete',
          },
          factCheck: null,
          recommendations: [],
        },
      });
      expect(report.buckets['needs-review']).toHaveLength(2);
      for (const entry of report.buckets['needs-review']) {
        expect(entry.findings[0].severity).toBe(severity);
        expect(entry.findings[0].description).toContain(description);
        if (matchType === 'answer_conflict')
          expect(entry.findings[0].description).not.toContain('duplicate');
      }
      const markdown = renderMarkdown(report);
      const serialized = JSON.stringify(report) + markdown;
      expect(serialized).not.toContain('Secretanswera');
      expect(serialized).not.toContain('Secretanswerb');
      if (matchType === 'answer_conflict')
        expect(markdown).toContain('1 high-severity answer conflicts');
      if (matchType === 'review_required') expect(markdown).toContain('1 review required');
    }
  );
});
