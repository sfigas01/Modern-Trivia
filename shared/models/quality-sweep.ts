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
  proposedFix?: Record<string, unknown>;
}

export interface QuestionSnapshot {
  question: string;
  answer: string;
  tags: string[];
  category: string;
  pillar: string;
  hasSource: boolean;
  difficulty: string;
  sourceDomain: string | null;
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
  matchType:
    | 'exact'
    | 'near_duplicate'
    | 'conceptual'
    | 'semantic_duplicate'
    | 'answer_conflict'
    | 'review_required';
  /** Content-versioned dismissal identity; never expose the content itself in the key. */
  findingKey?: string;
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
  status?: 'complete' | 'incomplete';
  failedPairs?: number;
  failureReason?: string;
  /** Fixed, content-free category suitable for logs and retry diagnostics. */
  failureCategory?:
    | 'configuration'
    | 'authentication'
    | 'rate_limit'
    | 'provider'
    | 'invalid_response'
    | 'cache'
    | 'deadline'
    | 'capacity'
    | 'mixed'
    | 'unknown';
}

// --- Fact-check types ---

export interface FactCheckVerdict {
  questionId: string;
  verdict: 'pass' | 'flag' | 'fail';
  // Question–answer coherence (STE-246): 'fail' when the premise is wrong or the answer is not
  // the type the question asks for. A coherence failure always forces verdict to 'fail'.
  coherence: 'pass' | 'fail';
  // Obviousness (STE-247): 'fail' when the answer is derivable from the question text alone
  // (self-answering / trivially binary) or the stated difficulty is miscalibrated. An obviousness
  // failure always forces verdict to 'fail'.
  obviousness: 'pass' | 'fail';
  confidence: number;
  reason: string;
  // Proposed rewritten question — fits the answer with the false premise removed (coherence), or
  // a harder rephrasing/replacement that tests real knowledge (obviousness).
  suggestedQuestion?: string;
  // Recalibrated difficulty when obviousness fails due to a difficulty mislabel.
  suggestedDifficulty?: 'Easy' | 'Medium' | 'Hard';
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
  questionsById: Record<string, QuestionSnapshot>;
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

type StaticFindingKeySource = Pick<QuestionQualityFinding, 'questionId' | 'rule' | 'message'>;

// Build the stable per-finding key used for static audit dismissals.
// Include the message so repeated rules on the same question stay distinct.
export function buildStaticFindingKey(
  finding: Pick<QuestionQualityFinding, 'rule' | 'message'>
): string {
  return `${finding.rule}::${finding.message}`;
}

export function isStaticFindingDismissed(
  dismissedKeys: ReadonlySet<string>,
  finding: StaticFindingKeySource
): boolean {
  const currentKey = `${finding.questionId}::${buildStaticFindingKey(finding)}`;
  const legacyKey = `${finding.questionId}::${finding.rule}`;
  return dismissedKeys.has(currentKey) || dismissedKeys.has(legacyKey);
}

// Build the stable per-pair key used for duplicate dismissals.
// Sorting ensures the same key regardless of (A, B) order.
export function duplicatePairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}::${idB}` : `${idB}::${idA}`;
}

export const FACT_CHECK_FINDING_KEY = 'fact_check';

export function emptyDuplicateCounts(): DuplicateDetectionReport['duplicatesByType'] {
  return {
    exact: 0,
    near_duplicate: 0,
    conceptual: 0,
    semantic_duplicate: 0,
    answer_conflict: 0,
    review_required: 0,
  };
}

export function duplicateFindingKey(match: DuplicateMatch): string {
  return match.findingKey ?? duplicatePairKey(match.questionIdA, match.questionIdB);
}
