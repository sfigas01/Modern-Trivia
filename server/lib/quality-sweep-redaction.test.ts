import { expect, it } from 'vitest';
import { emptyDuplicateCounts } from '@shared/models/quality-sweep';
import { redactSweepDetails } from './quality-sweep-redaction';
it('removes answers from question text, findings, fixes and model reasoning while preserving actionable IDs and status', () => {
  const secret = 'SPOILER_ANSWER';
  const redacted = redactSweepDetails(
    {
      generatedAt: '',
      totalQuestions: 2,
      totalFindings: 1,
      flaggedQuestionCount: 1,
      findingsBySeverity: { high: 1, medium: 0, low: 0 },
      findingsByRule: {},
      findings: [
        {
          questionId: 'a',
          questionIndex: 0,
          severity: 'high',
          rule: 'answer_leakage',
          message: secret,
          proposedFix: { answer: secret },
        },
      ],
    },
    {
      totalPairsChecked: 1,
      status: 'incomplete',
      failedPairs: 1,
      duplicatesByType: emptyDuplicateCounts(),
      duplicatesFound: [
        {
          questionIdA: 'a',
          questionIdB: 'b',
          matchType: 'answer_conflict',
          similarityScore: 1,
          questionTextA: secret,
          questionTextB: secret,
          answerA: secret,
          answerB: secret,
          aiReasoning: secret,
        },
      ],
    },
    {
      totalChecked: 1,
      results: [
        {
          questionId: 'a',
          verdict: 'fail',
          coherence: 'fail',
          obviousness: 'pass',
          confidence: 1,
          reason: secret,
          suggestedQuestion: secret,
        },
      ],
    }
  );
  expect(JSON.stringify(redacted)).not.toContain(secret);
  expect(redacted.duplicates).toMatchObject({ status: 'incomplete', failedPairs: 1 });
  expect(redacted.duplicates!.duplicatesFound[0]).toMatchObject({
    questionIdA: 'a',
    matchType: 'answer_conflict',
  });
});
