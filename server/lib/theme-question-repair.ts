import type { Pool } from 'pg';
import { z } from 'zod';

import type {
  ThemeQuestionGenerationDecision,
  ThemeQuestionGenerationRequest,
  ThemeQuestionWriterInput,
  ThemeQuestionWriterOutput,
} from '@shared/models/theme-question-generation';
import { themeQuestionGenerationRequestSchema } from '@shared/models/theme-question-generation';
import type {
  ThemeQuestionEvidenceReviewer,
  ThemeQuestionEvidenceReviewResult,
  ThemeQuestionQaContext,
} from './theme-question-evidence-review';
import type { ThemeQuestionQaDecision, ThemeQuestionQaDependencies } from './theme-question-qa';
import { THEME_QUESTION_QA_POLICY_VERSION, runThemeQuestionQa } from './theme-question-qa';

const uuid = z.string().uuid();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const repairableParentDecisionSchema = z
  .object({
    status: z.literal('withheld'),
    candidateId: uuid,
    questionRevisionId: uuid,
    questionContentHash: sha,
    evidenceAttemptId: uuid,
    evidenceReviewId: uuid,
    evidenceFingerprint: sha,
    corpusRevision: z.null(),
    corpusHash: z.null(),
    policyVersion: z.literal(THEME_QUESTION_QA_POLICY_VERSION),
    evaluatedAt: z.string().datetime(),
    stage: z.enum(['static', 'quality']),
    reason: z.enum(['static_finding', 'quality_adverse']),
  })
  .strict()
  .refine(
    (value) =>
      (value.stage === 'static' && value.reason === 'static_finding') ||
      (value.stage === 'quality' && value.reason === 'quality_adverse')
  );
const requestSchema = z
  .object({
    generation: themeQuestionGenerationRequestSchema.refine(
      (value) => value.repairOf !== undefined
    ),
    parentQaDecision: repairableParentDecisionSchema,
  })
  .strict();

const storedOutcomeSchema = z
  .object({
    generation_attempt_id: uuid,
    parent_candidate_id: uuid,
    candidate_id: uuid.nullable(),
    question_revision_id: uuid.nullable(),
    question_content_hash: sha.nullable(),
    status: z.enum(['passed', 'withheld', 'declined', 'invalid_output', 'failed', 'ineligible']),
    stage: z.enum(['generation', 'evidence', 'qa']),
    reason: z.string().trim().min(1).max(64),
    evidence_review_attempt_id: uuid.nullable(),
    evidence_review_id: uuid.nullable(),
    evidence_fingerprint: sha.nullable(),
    qa_policy_version: z.string().trim().min(1).max(255).nullable(),
    qa_evaluated_at: z.union([z.date(), z.string().datetime()]).nullable(),
    corpus_revision: z.string().trim().min(1).max(255).nullable(),
    corpus_hash: sha.nullable(),
  })
  .strict();

export type ThemeQuestionRepairerInput = Readonly<{
  parentQuestion: ThemeQuestionQaContext['question'];
  failure: { stage: 'static' | 'quality'; reason: 'static_finding' | 'quality_adverse' };
  generation: ThemeQuestionWriterInput;
}>;
export type ThemeQuestionRepairer = (
  input: ThemeQuestionRepairerInput
) => Promise<ThemeQuestionWriterOutput> | ThemeQuestionWriterOutput;
type ThemeQuestionWriter = (
  input: ThemeQuestionWriterInput
) => Promise<ThemeQuestionWriterOutput> | ThemeQuestionWriterOutput;

export type ThemeQuestionRepairDecision = Readonly<{
  status: 'passed' | 'withheld' | 'declined' | 'invalid_output' | 'failed' | 'ineligible';
  stage: 'generation' | 'evidence' | 'qa';
  reason: string;
  generationAttemptId: string;
  parentCandidateId: string;
  candidateId: string | null;
  questionRevisionId: string | null;
  questionContentHash: string | null;
  evidenceReviewAttemptId: string | null;
  evidenceReviewId: string | null;
  evidenceFingerprint: string | null;
  qaPolicyVersion: string | null;
  qaEvaluatedAt: string | null;
  corpusRevision: string | null;
  corpusHash: string | null;
}>;

export type ThemeQuestionRepairDependencies = Readonly<{
  generation: {
    generate(
      request: ThemeQuestionGenerationRequest,
      writer: ThemeQuestionWriter
    ): Promise<ThemeQuestionGenerationDecision>;
  };
  evidenceReview: {
    review(
      request: {
        attemptId: string;
        candidateId: string;
        questionRevisionId: string;
        questionContentHash: string;
      },
      reviewer: ThemeQuestionEvidenceReviewer
    ): Promise<ThemeQuestionEvidenceReviewResult>;
  };
  loadParentContext(request: {
    candidateId: string;
    questionRevisionId: string;
    questionContentHash: string;
  }): Promise<ThemeQuestionQaContext>;
  qa: ThemeQuestionQaDependencies;
}>;

export class ThemeQuestionRepairError extends Error {
  constructor(
    public readonly code:
      | 'invalid_request'
      | 'invalid_configuration'
      | 'parent_not_repairable'
      | 'attempt_unresolved'
      | 'attempt_conflict'
      | 'storage_failure'
      | 'storage_unknown_outcome'
  ) {
    super(code);
    this.name = 'ThemeQuestionRepairError';
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function projectStored(row: z.infer<typeof storedOutcomeSchema>): ThemeQuestionRepairDecision {
  return {
    status: row.status,
    stage: row.stage,
    reason: row.reason,
    generationAttemptId: row.generation_attempt_id,
    parentCandidateId: row.parent_candidate_id,
    candidateId: row.candidate_id,
    questionRevisionId: row.question_revision_id,
    questionContentHash: row.question_content_hash,
    evidenceReviewAttemptId: row.evidence_review_attempt_id,
    evidenceReviewId: row.evidence_review_id,
    evidenceFingerprint: row.evidence_fingerprint,
    qaPolicyVersion: row.qa_policy_version,
    qaEvaluatedAt:
      row.qa_evaluated_at === null ? null : new Date(row.qa_evaluated_at).toISOString(),
    corpusRevision: row.corpus_revision,
    corpusHash: row.corpus_hash,
  };
}

function validateParentDecision(
  decision: ThemeQuestionQaDecision,
  repair: NonNullable<ThemeQuestionGenerationRequest['repairOf']>,
  context: ThemeQuestionQaContext
): boolean {
  return (
    decision.status === 'withheld' &&
    decision.candidateId === repair.parentCandidateId &&
    decision.questionRevisionId === repair.parentQuestionRevisionId &&
    decision.questionContentHash === repair.parentQuestionContentHash &&
    decision.stage === repair.failureStage &&
    decision.reason === repair.failureReason &&
    decision.policyVersion === THEME_QUESTION_QA_POLICY_VERSION &&
    decision.evidenceAttemptId === context.evidenceAttemptId &&
    decision.evidenceReviewId === context.evidenceReviewId &&
    decision.evidenceFingerprint === context.evidenceFingerprint &&
    decision.corpusRevision === null &&
    decision.corpusHash === null
  );
}

function matchesEvidenceReview(
  context: Pick<ThemeQuestionQaContext, 'evidenceAttemptId' | 'evidenceReviewId'>,
  attemptId: string,
  reviewId: string
): boolean {
  return context.evidenceAttemptId === attemptId && context.evidenceReviewId === reviewId;
}

export function createPostgresThemeQuestionRepairOrchestrator(
  pool: Pool,
  dependencies: ThemeQuestionRepairDependencies
) {
  if (
    !pool ||
    !dependencies ||
    typeof dependencies.generation?.generate !== 'function' ||
    typeof dependencies.evidenceReview?.review !== 'function' ||
    typeof dependencies.loadParentContext !== 'function' ||
    typeof dependencies.qa?.loadContext !== 'function'
  )
    throw new ThemeQuestionRepairError('invalid_configuration');

  async function readOutcome(attemptId: string): Promise<ThemeQuestionRepairDecision | null> {
    let result;
    try {
      result = await pool.query(
        'SELECT generation_attempt_id,parent_candidate_id,candidate_id,question_revision_id,question_content_hash,status,stage,reason,evidence_review_attempt_id,evidence_review_id,evidence_fingerprint,qa_policy_version,qa_evaluated_at,corpus_revision,corpus_hash FROM theme_question_repair_outcomes WHERE generation_attempt_id = $1',
        [attemptId]
      );
    } catch {
      throw new ThemeQuestionRepairError('storage_failure');
    }
    if (!result.rows[0]) return null;
    const parsed = storedOutcomeSchema.safeParse(result.rows[0]);
    if (!parsed.success) throw new ThemeQuestionRepairError('storage_failure');
    return projectStored(parsed.data);
  }

  async function attemptExists(attemptId: string): Promise<boolean> {
    try {
      const result = await pool.query(
        'SELECT id FROM theme_question_generation_attempts WHERE id = $1',
        [attemptId]
      );
      return Boolean(result.rowCount);
    } catch {
      throw new ThemeQuestionRepairError('storage_failure');
    }
  }

  async function persist(
    decision: ThemeQuestionRepairDecision
  ): Promise<ThemeQuestionRepairDecision> {
    try {
      await pool.query(
        `INSERT INTO theme_question_repair_outcomes
         (generation_attempt_id,parent_candidate_id,candidate_id,question_revision_id,
          question_content_hash,status,stage,reason,evidence_review_attempt_id,evidence_review_id,
          evidence_fingerprint,qa_policy_version,qa_evaluated_at,corpus_revision,corpus_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          decision.generationAttemptId,
          decision.parentCandidateId,
          decision.candidateId,
          decision.questionRevisionId,
          decision.questionContentHash,
          decision.status,
          decision.stage,
          decision.reason,
          decision.evidenceReviewAttemptId,
          decision.evidenceReviewId,
          decision.evidenceFingerprint,
          decision.qaPolicyVersion,
          decision.qaEvaluatedAt,
          decision.corpusRevision,
          decision.corpusHash,
        ]
      );
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        const existing = await readOutcome(decision.generationAttemptId);
        if (existing && same(existing, decision)) return existing;
        throw new ThemeQuestionRepairError('attempt_conflict');
      }
      throw new ThemeQuestionRepairError('storage_unknown_outcome');
    }
    const stored = await readOutcome(decision.generationAttemptId);
    if (!stored || !same(stored, decision))
      throw new ThemeQuestionRepairError('storage_unknown_outcome');
    return stored;
  }

  return {
    async repair(
      rawRequest: {
        generation: ThemeQuestionGenerationRequest;
        parentQaDecision: ThemeQuestionQaDecision;
      },
      repairer: ThemeQuestionRepairer,
      reviewer: ThemeQuestionEvidenceReviewer
    ): Promise<ThemeQuestionRepairDecision> {
      const parsed = requestSchema.safeParse(rawRequest);
      if (!parsed.success || typeof repairer !== 'function' || typeof reviewer !== 'function')
        throw new ThemeQuestionRepairError('invalid_request');
      const request = parsed.data;
      const repair = request.generation.repairOf;
      if (!repair) throw new ThemeQuestionRepairError('invalid_request');

      const completed = await readOutcome(request.generation.attemptId);
      if (completed) {
        let dispatched = false;
        const replay = await dependencies.generation.generate(request.generation, async () => {
          dispatched = true;
          return { status: 'declined' };
        });
        if (dispatched) throw new ThemeQuestionRepairError('attempt_conflict');
        if (
          completed.candidateId !== (replay.status === 'persisted' ? replay.candidateId : null) ||
          completed.questionRevisionId !==
            (replay.status === 'persisted' ? replay.questionRevisionId : null) ||
          completed.questionContentHash !==
            (replay.status === 'persisted' ? replay.contentHash : null)
        )
          throw new ThemeQuestionRepairError('storage_failure');
        return completed;
      }
      if (await attemptExists(request.generation.attemptId))
        throw new ThemeQuestionRepairError('attempt_unresolved');

      let parent = await dependencies.loadParentContext({
        candidateId: repair.parentCandidateId,
        questionRevisionId: repair.parentQuestionRevisionId,
        questionContentHash: repair.parentQuestionContentHash,
      });
      if (!validateParentDecision(request.parentQaDecision, repair, parent))
        throw new ThemeQuestionRepairError('parent_not_repairable');

      let dispatched = false;
      const generated = await dependencies.generation.generate(
        request.generation,
        async (input) => {
          dispatched = true;
          const current = await dependencies.loadParentContext({
            candidateId: repair.parentCandidateId,
            questionRevisionId: repair.parentQuestionRevisionId,
            questionContentHash: repair.parentQuestionContentHash,
          });
          if (!same(parent, current)) throw new Error('parent_context_changed');
          parent = current;
          return repairer({
            parentQuestion: structuredClone(parent.question),
            failure: { stage: repair.failureStage, reason: repair.failureReason },
            generation: structuredClone(input),
          });
        }
      );
      if (!dispatched) {
        const replayed = await readOutcome(request.generation.attemptId);
        if (!replayed) throw new ThemeQuestionRepairError('attempt_unresolved');
        if (
          replayed.candidateId !==
            (generated.status === 'persisted' ? generated.candidateId : null) ||
          replayed.questionRevisionId !==
            (generated.status === 'persisted' ? generated.questionRevisionId : null) ||
          replayed.questionContentHash !==
            (generated.status === 'persisted' ? generated.contentHash : null)
        )
          throw new ThemeQuestionRepairError('storage_failure');
        return replayed;
      }
      if (generated.status !== 'persisted')
        return persist({
          status: generated.status,
          stage: 'generation',
          reason: generated.failureCode,
          generationAttemptId: request.generation.attemptId,
          parentCandidateId: repair.parentCandidateId,
          candidateId: null,
          questionRevisionId: null,
          questionContentHash: null,
          evidenceReviewAttemptId: null,
          evidenceReviewId: null,
          evidenceFingerprint: null,
          qaPolicyVersion: null,
          qaEvaluatedAt: null,
          corpusRevision: null,
          corpusHash: null,
        });

      const childRequest = {
        attemptId: repair.evidenceReviewAttemptId,
        candidateId: generated.candidateId,
        questionRevisionId: generated.questionRevisionId,
        questionContentHash: generated.contentHash,
      };
      const evidence = await dependencies.evidenceReview.review(childRequest, reviewer);
      if (evidence.status !== 'reviewed' || evidence.verdict !== 'pass')
        return persist({
          status: 'withheld',
          stage: 'evidence',
          reason:
            evidence.status === 'reviewed' ? `evidence_${evidence.verdict}` : evidence.failureCode,
          generationAttemptId: request.generation.attemptId,
          parentCandidateId: repair.parentCandidateId,
          candidateId: generated.candidateId,
          questionRevisionId: generated.questionRevisionId,
          questionContentHash: generated.contentHash,
          evidenceReviewAttemptId: repair.evidenceReviewAttemptId,
          evidenceReviewId: evidence.status === 'reviewed' ? evidence.reviewId : null,
          evidenceFingerprint: null,
          qaPolicyVersion: null,
          qaEvaluatedAt: null,
          corpusRevision: null,
          corpusHash: null,
        });

      let currentEvidence: ThemeQuestionQaContext | null = null;
      try {
        currentEvidence = await dependencies.qa.loadContext({
          candidateId: generated.candidateId,
          questionRevisionId: generated.questionRevisionId,
          questionContentHash: generated.contentHash,
        });
      } catch {
        // The evidence-change branch below records a safe terminal result.
      }
      if (
        !currentEvidence ||
        !matchesEvidenceReview(currentEvidence, repair.evidenceReviewAttemptId, evidence.reviewId)
      )
        return persist({
          status: 'withheld',
          stage: 'evidence',
          reason: 'evidence_changed',
          generationAttemptId: request.generation.attemptId,
          parentCandidateId: repair.parentCandidateId,
          candidateId: generated.candidateId,
          questionRevisionId: generated.questionRevisionId,
          questionContentHash: generated.contentHash,
          evidenceReviewAttemptId: repair.evidenceReviewAttemptId,
          evidenceReviewId: evidence.reviewId,
          evidenceFingerprint: null,
          qaPolicyVersion: null,
          qaEvaluatedAt: null,
          corpusRevision: null,
          corpusHash: null,
        });

      const qa = await runThemeQuestionQa(
        {
          candidateId: generated.candidateId,
          questionRevisionId: generated.questionRevisionId,
          questionContentHash: generated.contentHash,
        },
        dependencies.qa
      );
      if (
        qa.evidenceAttemptId !== repair.evidenceReviewAttemptId ||
        qa.evidenceReviewId !== evidence.reviewId ||
        qa.evidenceFingerprint === null
      )
        return persist({
          status: 'withheld',
          stage: 'evidence',
          reason: 'evidence_changed',
          generationAttemptId: request.generation.attemptId,
          parentCandidateId: repair.parentCandidateId,
          candidateId: generated.candidateId,
          questionRevisionId: generated.questionRevisionId,
          questionContentHash: generated.contentHash,
          evidenceReviewAttemptId: repair.evidenceReviewAttemptId,
          evidenceReviewId: evidence.reviewId,
          evidenceFingerprint: null,
          qaPolicyVersion: null,
          qaEvaluatedAt: null,
          corpusRevision: null,
          corpusHash: null,
        });
      return persist({
        status: qa.status === 'passed' ? 'passed' : 'withheld',
        stage: 'qa',
        reason: qa.reason,
        generationAttemptId: request.generation.attemptId,
        parentCandidateId: repair.parentCandidateId,
        candidateId: generated.candidateId,
        questionRevisionId: generated.questionRevisionId,
        questionContentHash: generated.contentHash,
        evidenceReviewAttemptId: repair.evidenceReviewAttemptId,
        evidenceReviewId: evidence.reviewId,
        evidenceFingerprint: qa.evidenceFingerprint,
        qaPolicyVersion: qa.policyVersion,
        qaEvaluatedAt: qa.evaluatedAt,
        corpusRevision: qa.corpusRevision,
        corpusHash: qa.corpusHash,
      });
    },
  };
}
