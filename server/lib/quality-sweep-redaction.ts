import type { QuestionQualityAuditReport } from './question-quality-audit';
import type { DuplicateDetectionReport } from './duplicate-detector';
import type { FactCheckReport } from './verifier';

/** Whitelist report fields: even question text and proposed fixes can disclose answers. */
export function redactSweepDetails(
  audit: QuestionQualityAuditReport,
  duplicates: DuplicateDetectionReport | null,
  facts: FactCheckReport | null
) {
  return {
    staticAudit: {
      ...audit,
      findings: audit.findings.map((f) => ({
        questionId: f.questionId,
        questionIndex: f.questionIndex,
        severity: f.severity,
        rule: f.rule,
        message: '[redacted]',
      })),
    },
    duplicates: duplicates && {
      ...duplicates,
      duplicatesFound: duplicates.duplicatesFound.map((m) => ({
        questionIdA: m.questionIdA,
        questionIdB: m.questionIdB,
        matchType: m.matchType,
        similarityScore: m.similarityScore,
        findingKey: m.findingKey,
        questionTextA: '[redacted]',
        questionTextB: '[redacted]',
        answerA: '[redacted]',
        answerB: '[redacted]',
        aiReasoning: '[redacted]',
      })),
    },
    factCheck: facts && {
      totalChecked: facts.totalChecked,
      results: facts.results.map((r) => ({
        questionId: r.questionId,
        verdict: r.verdict,
        coherence: r.coherence,
        obviousness: r.obviousness,
        confidence: r.confidence,
        reason: '[redacted]',
        suggestedDifficulty: r.suggestedDifficulty,
      })),
    },
  };
}
