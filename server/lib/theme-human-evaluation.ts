import type { Pool } from 'pg';
import { z } from 'zod';

export const THEME_HUMAN_EVALUATION_VERSION = 'theme-human-evaluation-v1' as const;
export const THEME_OWNER_FEEDBACK_LABELS = ['approve', 'repair', 'reject', 'investigate'] as const;

const uuid = z.string().uuid();
const rowSchema = z
  .object({
    jobId: uuid,
    slotKey: z.string().min(1),
    slotOrdinal: z.number().int().positive(),
    proposalStatus: z.string().nullable(),
    proposal: z.unknown().nullable(),
    canonicalFactKey: z.string().nullable(),
    fact: z.unknown().nullable(),
    factReview: z.unknown().nullable(),
    generationStatus: z.string().nullable(),
    writerOutput: z.unknown().nullable(),
    candidateId: uuid.nullable(),
    candidateStatus: z.string().nullable(),
    question: z.unknown().nullable(),
    qaReview: z.unknown().nullable(),
    evidenceReview: z.unknown().nullable(),
    sources: z.array(z.unknown()),
    approved: z.boolean(),
    repairedFromCandidateId: uuid.nullable(),
    rewrite: z.unknown().nullable(),
  })
  .strict();
export type ThemeHumanEvaluationRow = z.infer<typeof rowSchema>;

function recommendation(row: ThemeHumanEvaluationRow) {
  if (row.approved) return { label: 'approve' as const, reason: 'all_gates_passed' };
  const rewrite = row.rewrite as Record<string, unknown> | null;
  if (rewrite?.approved === true)
    return { label: 'approve' as const, reason: 'bounded_rewrite_passed' };
  if (row.proposalStatus === 'withheld')
    return { label: 'reject' as const, reason: 'proposal_declined' };
  const factReview = row.factReview as Record<string, unknown> | null;
  if (factReview && factReview.aggregateVerdict !== 'pass')
    return { label: 'investigate' as const, reason: 'fact_review_adverse' };
  if (row.generationStatus === 'declined')
    return { label: 'reject' as const, reason: 'writer_declined' };
  const evidence = row.evidenceReview as Record<string, unknown> | null;
  if (evidence && evidence.verdict !== 'pass')
    return { label: 'investigate' as const, reason: 'fact_check_adverse' };
  const qa = row.qaReview as Record<string, unknown> | null;
  if (qa?.status === 'withheld') {
    const repairable = qa.stage === 'static' || qa.stage === 'quality';
    return {
      label: repairable ? ('repair' as const) : ('investigate' as const),
      reason: String(qa.reason ?? 'player_review_withheld'),
    };
  }
  return { label: 'investigate' as const, reason: 'review_incomplete' };
}

export function buildThemeHumanEvaluationReport(rawRows: readonly ThemeHumanEvaluationRow[]) {
  const rows = rowSchema.array().parse(rawRows);
  return {
    schemaVersion: THEME_HUMAN_EVALUATION_VERSION,
    answerRedacted: false as const,
    previewOnly: true as const,
    factualAccuracyClaimed: false as const,
    ownerFeedbackLabels: THEME_OWNER_FEEDBACK_LABELS,
    instructions:
      'For each item, set ownerFeedback.label to approve, repair, reject, or investigate and add notes. Feedback updates policy, prompts, and regression fixtures; it does not automatically train a model.',
    items: rows
      .map((row) => ({
        ...row,
        machineRecommendation: recommendation(row),
        ownerFeedback: { label: null, notes: '' },
      }))
      .sort(
        (left, right) =>
          left.jobId.localeCompare(right.jobId) || left.slotOrdinal - right.slotOrdinal
      ),
  };
}

function validateJobIds(jobIds: readonly string[]): string[] {
  const parsed = z.array(uuid).min(1).max(100).safeParse(jobIds);
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length)
    throw new Error('Human evaluation requires 1-100 distinct job UUIDs');
  return parsed.data;
}

export function createPostgresThemeHumanEvaluationRepository(pool: Pick<Pool, 'connect'>) {
  return {
    async load(rawJobIds: readonly string[]): Promise<ThemeHumanEvaluationRow[]> {
      const jobIds = validateJobIds(rawJobIds);
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const jobs = await client.query<{ id: string }>(
          'SELECT id FROM theme_preparation_jobs WHERE id = ANY($1::uuid[]) ORDER BY id',
          [jobIds]
        );
        if (jobs.rows.length !== jobIds.length)
          throw new Error('One or more human-evaluation jobs do not exist');
        const result = await client.query<Record<string, unknown>>(
          `SELECT slot.job_id AS "jobId", slot.slot_key AS "slotKey",
                  slot.slot_ordinal AS "slotOrdinal", proposal.status AS "proposalStatus",
                  proposal.outcome_snapshot AS proposal,
                  proposal.canonical_fact_key AS "canonicalFactKey",
                  CASE WHEN revision.id IS NULL THEN NULL ELSE jsonb_build_object(
                    'statement',revision.statement,'scope',revision.scope,
                    'canonicalAnswer',revision.canonical_answer,
                    'supportedAliases',revision.supported_aliases,
                    'timeSensitive',revision.time_sensitive) END AS fact,
                  CASE WHEN fact_review.attempt_id IS NULL THEN NULL ELSE jsonb_build_object(
                    'status',fact_review.status,'aggregateVerdict',fact_review.aggregate_verdict,
                    'dimensions',fact_review.dimensions,'failureCode',fact_review.failure_code) END
                    AS "factReview",
                  generation.status AS "generationStatus", generation.writer_output AS "writerOutput",
                  candidate.id AS "candidateId", candidate.status AS "candidateStatus",
                  candidate.content AS question, candidate.qa_review AS "qaReview",
                  CASE WHEN evidence.outcome_attempt_id IS NULL THEN NULL ELSE jsonb_build_object(
                    'status',evidence.outcome_status,'verdict',evidence.verdict,
                    'dimensions',evidence.dimension_results,'failureCode',evidence.failure_code,
                    'reviewedAt',evidence.reviewed_at) END AS "evidenceReview",
                  COALESCE(source.sources,slot_source.sources,'[]'::jsonb) AS sources,
                  (approval.id IS NOT NULL) AS approved,
                  candidate.parent_candidate_id AS "repairedFromCandidateId",
                  rewrite.value AS rewrite
             FROM theme_proposal_slots slot
             JOIN theme_preparation_jobs job ON job.id=slot.job_id
             LEFT JOIN theme_proposal_slot_outcomes proposal
               ON proposal.job_id=slot.job_id AND proposal.slot_key=slot.slot_key
             LEFT JOIN theme_facts fact_identity
               ON fact_identity.canonical_key=proposal.canonical_fact_key
             LEFT JOIN LATERAL (
               SELECT * FROM theme_fact_revisions candidate_revision
                WHERE candidate_revision.fact_id=fact_identity.id
                ORDER BY candidate_revision.revision DESC LIMIT 1
             ) revision ON TRUE
             LEFT JOIN LATERAL (
               SELECT outcome.* FROM theme_fact_review_attempts attempt
               JOIN theme_fact_review_outcomes outcome ON outcome.attempt_id=attempt.id
                WHERE attempt.fact_revision_id=revision.id
                ORDER BY attempt.review_sequence DESC LIMIT 1
             ) fact_review ON TRUE
             LEFT JOIN LATERAL (
               SELECT outcome.* FROM theme_question_generation_attempts attempt
               JOIN theme_question_generation_outcomes outcome ON outcome.attempt_id=attempt.id
                WHERE attempt.job_id=slot.job_id AND attempt.fact_revision_id=revision.id
                  AND attempt.ordinal=slot.slot_ordinal
                  AND attempt.parent_candidate_id IS NULL
                ORDER BY attempt.created_at DESC LIMIT 1
             ) generation ON TRUE
             LEFT JOIN theme_candidates candidate ON candidate.id=generation.candidate_id
             LEFT JOIN LATERAL (
               SELECT outcome.attempt_id AS outcome_attempt_id,
                      outcome.status AS outcome_status,outcome.failure_code,review.*
                 FROM theme_question_evidence_review_attempts attempt
               JOIN theme_question_evidence_review_outcomes outcome ON outcome.attempt_id=attempt.id
               LEFT JOIN theme_evidence_reviews review ON review.id=outcome.review_id
                WHERE attempt.candidate_id=candidate.id
                ORDER BY attempt.review_sequence DESC LIMIT 1
             ) evidence ON TRUE
             LEFT JOIN theme_question_approvals approval ON approval.candidate_id=candidate.id
             LEFT JOIN LATERAL (
               SELECT jsonb_build_object(
                 'generationStatus',repair_outcome.status,
                 'writerOutput',repair_outcome.writer_output,
                 'candidateId',repair_candidate.id,
                 'candidateStatus',repair_candidate.status,
                 'question',repair_candidate.content,
                 'qaReview',repair_candidate.qa_review,
                 'evidenceReview',CASE WHEN repair_evidence.outcome_attempt_id IS NULL THEN NULL ELSE
                   jsonb_build_object('status',repair_evidence.outcome_status,
                     'verdict',repair_evidence.verdict,
                     'dimensions',repair_evidence.dimension_results,
                     'failureCode',repair_evidence.failure_code,
                     'reviewedAt',repair_evidence.reviewed_at) END,
                 'approved',(repair_approval.id IS NOT NULL)) AS value
                 FROM theme_question_generation_attempts repair_attempt
                 JOIN theme_question_generation_outcomes repair_outcome
                   ON repair_outcome.attempt_id=repair_attempt.id
                 LEFT JOIN theme_candidates repair_candidate
                   ON repair_candidate.id=repair_outcome.candidate_id
                 LEFT JOIN theme_question_approvals repair_approval
                   ON repair_approval.candidate_id=repair_candidate.id
                 LEFT JOIN LATERAL (
                   SELECT outcome.attempt_id AS outcome_attempt_id,
                          outcome.status AS outcome_status,outcome.failure_code,review.*
                     FROM theme_question_evidence_review_attempts attempt
                   JOIN theme_question_evidence_review_outcomes outcome
                     ON outcome.attempt_id=attempt.id
                   LEFT JOIN theme_evidence_reviews review ON review.id=outcome.review_id
                    WHERE attempt.candidate_id=repair_candidate.id
                    ORDER BY attempt.review_sequence DESC LIMIT 1
                 ) repair_evidence ON TRUE
                WHERE repair_attempt.parent_candidate_id=candidate.id
                ORDER BY repair_attempt.created_at DESC LIMIT 1
             ) rewrite ON TRUE
             LEFT JOIN LATERAL (
               SELECT jsonb_agg(jsonb_build_object(
                 'url',document.canonical_url,'title',document.title,
                 'publisher',document.publisher,'passageId',passage.id,
                 'locator',passage.locator,'passage',passage.passage_text,
                 'supportKind',binding.support_kind)
                 ORDER BY passage.ordinal) AS sources
                 FROM theme_fact_evidence_passages binding
                 JOIN theme_evidence_passages passage ON passage.id=binding.passage_id
                 JOIN theme_evidence_documents document ON document.id=passage.document_id
                WHERE binding.fact_revision_id=revision.id
             ) source ON TRUE
             LEFT JOIN LATERAL (
               SELECT jsonb_agg(jsonb_build_object(
                 'url',document.canonical_url,'title',document.title,
                 'publisher',document.publisher,'passageId',passage.id,
                 'locator',passage.locator,'passage',passage.passage_text,
                 'supportKind','proposal_context') ORDER BY passage.ordinal) AS sources
                 FROM jsonb_array_elements(job.plan_json->'sources') planned_source
                 JOIN LATERAL (
                   SELECT * FROM theme_evidence_documents candidate_document
                    WHERE candidate_document.canonical_url=planned_source->>'canonicalUrl'
                      AND candidate_document.source_policy_version=
                        job.plan_json->>'sourcePolicyVersion'
                    ORDER BY candidate_document.retrieved_at DESC LIMIT 1
                 ) document ON TRUE
                 JOIN theme_evidence_passages passage ON passage.document_id=document.id
                WHERE planned_source->>'key'=slot.source_key
             ) slot_source ON TRUE
            WHERE slot.job_id=ANY($1::uuid[])
            ORDER BY slot.job_id,slot.slot_ordinal`,
          [jobIds]
        );
        await client.query('COMMIT');
        return rowSchema.array().parse(result.rows);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
