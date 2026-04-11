// Shared types for the Quality Sweep API contract.
// These mirror the server-side types from question-quality-audit.ts,
// duplicate-detector.ts, and verifier.ts so the frontend can consume them.

// --- Static audit types ---

export type QuestionQualitySeverity = 'high' | 'medium' | 'low';

export type QuestionQualityRule =
  | 'missing_required_field'
  | 'duplicate_question_id'
  | 'invalid_difficulty'
  | 'missing_required_tags'
  | 'category_tag_mismatch'
  | 'answer_leakage'
  | 'subjective_prompt'
  | 'ambiguous_prompt_format'
  | 'multi_answer_mismatch'
  | 'answer_type_mismatch'
  | 'potentially_incorrect_or_unverifiable'
  | 'missing_source_metadata';

export interface QuestionQualityFinding {
  questionId: string;
  questionIndex: number;
  severity: QuestionQualitySeverity;
  rule: QuestionQualityRule;
  message: string;
}

export interface QuestionQualityAuditReport {
  generatedAt: string;
  totalQuestions: number;
  totalFindings: number;
  flaggedQuestionCount: number;
  findingsBySeverity: Record<QuestionQualitySeverity, number>;
  findingsByRule: Record<QuestionQualityRule, number>;
  findings: QuestionQualityFinding[];
}

// --- Duplicate detection types ---

export interface DuplicateMatch {
  questionIdA: string;
  questionIdB: string;
  matchType: 'exact' | 'near_duplicate' | 'conceptual';
  similarityScore: number;
  questionTextA: string;
  questionTextB: string;
  answerA: string;
  answerB: string;
  aiReasoning?: string;
}

export interface DuplicateDetectionReport {
  totalPairsChecked: number;
  duplicatesFound: DuplicateMatch[];
  duplicatesByType: Record<DuplicateMatch['matchType'], number>;
}

// --- Fact-check types ---

export interface FactCheckVerdict {
  questionId: string;
  verdict: 'pass' | 'flag' | 'fail';
  confidence: number;
  reason: string;
}

export interface FactCheckReport {
  totalChecked: number;
  results: FactCheckVerdict[];
}

// --- Quality sweep API contract ---

export interface QualitySweepRequest {
  skipFactCheck?: boolean;
  skipDuplicates?: boolean;
}

export interface QualitySweepReport {
  generatedAt: string;
  totalQuestions: number;
  audit: QuestionQualityAuditReport;
  duplicates: DuplicateDetectionReport | null;
  factCheck: FactCheckReport | null;
  recommendations: string[];
}

// --- Dismissals API ---

export type QualityFindingType = 'static' | 'duplicate' | 'fact_check';

export interface DismissFindingRequest {
  questionId: string;
  findingType: QualityFindingType;
  findingKey: string;
  reason?: string;
}

export interface DismissFindingResponse {
  id: string;
}

// Build the stable per-pair key used for duplicate dismissals.
// Sorting ensures the same key regardless of (A, B) order.
export function duplicatePairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}::${idB}` : `${idB}::${idA}`;
}

export const FACT_CHECK_FINDING_KEY = 'fact_check';
