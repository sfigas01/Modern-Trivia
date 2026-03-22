type RawTriviaQuestion = {
  id?: unknown;
  category?: unknown;
  difficulty?: unknown;
  question?: unknown;
  answer?: unknown;
  acceptableAnswers?: unknown;
  explanation?: unknown;
  tags?: unknown;
  sourceUrl?: unknown;
  sourceName?: unknown;
};

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

const REGION_TAGS = new Set(['CA', 'US', 'Global']);
const PILLAR_TAGS = new Set(['TimeCapsule', 'GlobalEh', 'FreshPrints', 'GreatOutdoors']);
const DIFFICULTY_LEVELS = new Set(['Easy', 'Medium', 'Hard']);
const SEVERITY_ORDER: Record<QuestionQualitySeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const NUMBER_WORD_PATTERN =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\b/i;

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsCandidate(haystack: string, candidate: string): boolean {
  if (candidate.includes(' ')) {
    return haystack.includes(candidate);
  }

  return new RegExp(`\\b${escapeRegex(candidate)}\\b`, 'i').test(haystack);
}

function isLeakCandidate(candidate: string): boolean {
  if (!candidate) {
    return false;
  }

  if (/^\d+$/.test(candidate)) {
    return candidate.length >= 3;
  }

  return candidate.length >= 4;
}

function answerLooksNumeric(answer: string): boolean {
  const normalized = answer.toLowerCase();
  return /\d/.test(normalized) || NUMBER_WORD_PATTERN.test(normalized);
}

function isNumericQuestion(question: string): boolean {
  const hasNumericPhrase =
    /\b(what year|which year|in what year|how many|how much|how old)\b/i.test(question);
  const hasTemporalWhenLead =
    /^\s*when\s+(was|were|did|is|are|do|does|has|have|had|will|would|can|could)\b/i.test(question);

  return hasNumericPhrase || hasTemporalWhenLead;
}

function isPersonQuestion(question: string): boolean {
  return /^\s*who\b/i.test(question);
}

function isLocationQuestion(question: string): boolean {
  return /\b(where|which city|which country|which province|which state|which continent)\b/i.test(
    question
  );
}

function expectedMultipleAnswers(question: string): boolean {
  return /\b(name|list|give)\s+(two|three|four|five|\d+)\b/i.test(question);
}

function answerLooksMultiValue(answer: string): boolean {
  return /,|\band\b|&|\//i.test(answer);
}

function hasAmbiguousFormat(question: string): boolean {
  const asksChoiceWithoutOptions =
    /\b(which of the following|all of the following|true or false)\b/i.test(question) &&
    !/\b[a-d][\)\.]|(?:^|\s)-\s|\n-\s/i.test(question);

  return asksChoiceWithoutOptions;
}

function hasSubjectiveWording(question: string): boolean {
  return /\b(best|greatest|favorite|favourite|worst|coolest|most (important|beautiful|popular|iconic|influential))\b/i.test(
    question
  );
}

function buildQuestionId(rawId: string, questionIndex: number): string {
  return rawId || `index-${questionIndex}`;
}

function pushFinding(
  findings: QuestionQualityFinding[],
  questionId: string,
  questionIndex: number,
  severity: QuestionQualitySeverity,
  rule: QuestionQualityRule,
  message: string
) {
  findings.push({
    questionId,
    questionIndex,
    severity,
    rule,
    message,
  });
}

export function auditQuestionQuality(questions: RawTriviaQuestion[]): QuestionQualityAuditReport {
  const findings: QuestionQualityFinding[] = [];
  const idToIndex = new Map<string, number>();

  for (let i = 0; i < questions.length; i++) {
    const questionIndex = i + 1;
    const row = questions[i];

    const id = asString(row.id);
    const category = asString(row.category);
    const difficulty = asString(row.difficulty);
    const questionText = asString(row.question);
    const answer = asString(row.answer);
    const explanation = asString(row.explanation);
    const tags = asStringArray(row.tags);
    const acceptableAnswers = asStringArray(row.acceptableAnswers);
    const sourceUrl = asString(row.sourceUrl);
    const sourceName = asString(row.sourceName);

    const questionId = buildQuestionId(id, questionIndex);

    if (!id) {
      pushFinding(
        findings,
        questionId,
        questionIndex,
        'high',
        'missing_required_field',
        'Missing required field: id.'
      );
    } else {
      const firstSeenAt = idToIndex.get(id);
      if (firstSeenAt !== undefined) {
        pushFinding(
          findings,
          questionId,
          questionIndex,
          'high',
          'duplicate_question_id',
          `Duplicate question id "${id}". First seen at index ${firstSeenAt}.`
        );
      } else {
        idToIndex.set(id, questionIndex);
      }
    }

    const requiredTextFields: Array<{ field: string; value: string }> = [
      { field: 'category', value: category },
      { field: 'difficulty', value: difficulty },
      { field: 'question', value: questionText },
      { field: 'answer', value: answer },
      { field: 'explanation', value: explanation },
    ];

    for (const field of requiredTextFields) {
      if (!field.value) {
        pushFinding(
          findings,
          questionId,
          questionIndex,
          'high',
          'missing_required_field',
          `Missing required field: ${field.field}.`
        );
      }
    }

    if (!DIFFICULTY_LEVELS.has(difficulty)) {
      pushFinding(
        findings,
        questionId,
        questionIndex,
        'high',
        'invalid_difficulty',
        `Difficulty "${difficulty || '(empty)'}" is not one of Easy, Medium, Hard.`
      );
    }

    if (tags.length === 0) {
      pushFinding(
        findings,
        questionId,
        questionIndex,
        'high',
        'missing_required_tags',
        'Missing tags array or no non-empty tags.'
      );
    } else {
      const hasRegionTag = tags.some((tag) => REGION_TAGS.has(tag));
      const hasPillarTag = tags.some((tag) => PILLAR_TAGS.has(tag));
      const hasCategoryTag = category ? tags.includes(category) : false;

      if (!hasRegionTag || !hasPillarTag) {
        pushFinding(
          findings,
          questionId,
          questionIndex,
          'medium',
          'missing_required_tags',
          'Tags should include both a region tag (CA/US/Global) and a pillar tag.'
        );
      }

      if (category && !hasCategoryTag) {
        pushFinding(
          findings,
          questionId,
          questionIndex,
          'medium',
          'category_tag_mismatch',
          `Category "${category}" is not present in tags.`
        );
      }
    }

    const normalizedQuestion = normalize(questionText);
    const answerCandidates = [answer, ...acceptableAnswers]
      .map((entry) => normalize(entry))
      .filter((entry) => isLeakCandidate(entry));

    for (const candidate of answerCandidates) {
      if (normalizedQuestion && containsCandidate(normalizedQuestion, candidate)) {
        pushFinding(
          findings,
          questionId,
          questionIndex,
          'high',
          'answer_leakage',
          `Answer candidate "${candidate}" appears in the question text.`
        );
      }
    }

    if (hasSubjectiveWording(questionText)) {
      pushFinding(
        findings,
        questionId,
        questionIndex,
        'medium',
        'subjective_prompt',
        'Question uses subjective wording that may not have a single correct answer.'
      );
    }

    if (hasAmbiguousFormat(questionText)) {
      pushFinding(
        findings,
        questionId,
        questionIndex,
        'medium',
        'ambiguous_prompt_format',
        'Question implies multiple-choice format without visible answer options.'
      );
    }

    if (expectedMultipleAnswers(questionText) && !answerLooksMultiValue(answer)) {
      pushFinding(
        findings,
        questionId,
        questionIndex,
        'medium',
        'multi_answer_mismatch',
        'Question requests multiple answers but the stored answer appears to be single-valued.'
      );
    }

    if (questionText && answer) {
      if (isNumericQuestion(questionText) && !answerLooksNumeric(answer)) {
        pushFinding(
          findings,
          questionId,
          questionIndex,
          'medium',
          'answer_type_mismatch',
          'Question appears to require a numeric/date answer, but answer is not numeric-like.'
        );
      }

      if (isPersonQuestion(questionText) && answerLooksNumeric(answer)) {
        pushFinding(
          findings,
          questionId,
          questionIndex,
          'medium',
          'answer_type_mismatch',
          'Question asks for a person, but answer appears numeric.'
        );
      }

      if (isLocationQuestion(questionText) && answerLooksNumeric(answer)) {
        pushFinding(
          findings,
          questionId,
          questionIndex,
          'medium',
          'answer_type_mismatch',
          'Question asks for a location, but answer appears numeric.'
        );
      }
    }

    const normalizedExplanation = normalize(explanation);
    const longAnswerCandidates = [answer, ...acceptableAnswers]
      .map((entry) => normalize(entry))
      .filter((entry) => entry.length >= 4);
    const hasExplanationAlignment =
      longAnswerCandidates.length === 0 ||
      longAnswerCandidates.some((candidate) => containsCandidate(normalizedExplanation, candidate));

    if (explanation && !hasExplanationAlignment && !sourceUrl && !sourceName) {
      pushFinding(
        findings,
        questionId,
        questionIndex,
        'medium',
        'potentially_incorrect_or_unverifiable',
        'Explanation does not reference the answer and there is no source metadata to verify it.'
      );
    }

    if (!sourceUrl || !sourceName) {
      const missingFields = [!sourceUrl && 'sourceUrl', !sourceName && 'sourceName']
        .filter(Boolean)
        .join(' and ');
      pushFinding(
        findings,
        questionId,
        questionIndex,
        'medium',
        'missing_source_metadata',
        `Missing ${missingFields}: every question must include a verifiable source URL and source name.`
      );
    }
  }

  findings.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) {
      return bySeverity;
    }

    const byQuestion = a.questionIndex - b.questionIndex;
    if (byQuestion !== 0) {
      return byQuestion;
    }

    return a.rule.localeCompare(b.rule);
  });

  const findingsBySeverity: Record<QuestionQualitySeverity, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };
  const findingsByRule: Record<QuestionQualityRule, number> = {
    missing_required_field: 0,
    duplicate_question_id: 0,
    invalid_difficulty: 0,
    missing_required_tags: 0,
    category_tag_mismatch: 0,
    answer_leakage: 0,
    subjective_prompt: 0,
    ambiguous_prompt_format: 0,
    multi_answer_mismatch: 0,
    answer_type_mismatch: 0,
    potentially_incorrect_or_unverifiable: 0,
    missing_source_metadata: 0,
  };

  for (const finding of findings) {
    findingsBySeverity[finding.severity] += 1;
    findingsByRule[finding.rule] += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    totalQuestions: questions.length,
    totalFindings: findings.length,
    flaggedQuestionCount: new Set(findings.map((finding) => finding.questionId)).size,
    findingsBySeverity,
    findingsByRule,
    findings,
  };
}

export function formatQuestionQualitySummary(report: QuestionQualityAuditReport): string {
  return [
    `Questions scanned: ${report.totalQuestions}`,
    `Flagged questions: ${report.flaggedQuestionCount}`,
    `Findings: ${report.totalFindings} (high: ${report.findingsBySeverity.high}, medium: ${report.findingsBySeverity.medium}, low: ${report.findingsBySeverity.low})`,
  ].join('\n');
}
