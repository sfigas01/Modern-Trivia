import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { insertQuestionSchema } from '@shared/models/questions';
import type { QuestionContentSnapshot } from '@shared/models/theme-evidence';
import { hashQuestionSnapshot } from './theme-evidence-eligibility';
import {
  createPostgresThemeQuestionEvidenceReviewRepository,
  type ThemeQuestionEvidenceReviewConfig,
  type ThemeQuestionQaContext,
} from './theme-question-evidence-review';
import {
  THEME_QUESTION_QA_POLICY_VERSION,
  hashThemeQuestionQaCorpus,
  runThemeQuestionQa,
  type ThemeQuestionQaDependencies,
  type ThemeQuestionQaDecision,
} from './theme-question-qa';

export const THEME_QUESTION_APPROVAL_VERSION = 'theme-question-approval-v1' as const;
const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const requestSchema = z
  .object({
    approvalId: uuid,
    candidateId: uuid,
    questionRevisionId: uuid,
    questionContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    libraryQuestionId: z.string().trim().min(1).max(255),
    libraryRevisionId: uuid,
  })
  .strict();
export type ThemeQuestionApprovalRequest = z.infer<typeof requestSchema>;
export type ThemeQuestionApprovalResult =
  | Readonly<{
      status: 'approved';
      approvalId: string;
      candidateId: string;
      libraryQuestionId: string;
      libraryRevisionId: string;
      approvedAt: string;
    }>
  | Readonly<{ status: 'withheld'; reason: string; qa?: ThemeQuestionQaDecision }>;
export type ThemeQuestionApprovalConfig = Readonly<{
  evidence: ThemeQuestionEvidenceReviewConfig;
  checkQuality: ThemeQuestionQaDependencies['checkQuality'];
  detectDuplicates: ThemeQuestionQaDependencies['detectDuplicates'];
  now?: () => Date;
}>;

export class ThemeQuestionApprovalError extends Error {
  constructor(
    public readonly code:
      | 'invalid_request'
      | 'invalid_configuration'
      | 'request_conflict'
      | 'storage_failure'
      | 'storage_unknown_outcome'
  ) {
    super(code);
    this.name = 'ThemeQuestionApprovalError';
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
type Corpus = Awaited<ReturnType<typeof loadCorpus>>;
async function loadCorpus(db: Pool | PoolClient) {
  // The caller never supplies comparison rows. Include every ordinary approved or
  // pending question, including player_ai rows, in both the QA and final recheck.
  const rows = await db.query(
    `SELECT * FROM questions WHERE status IN ('approved', 'pending') ORDER BY id`
  );
  const questions = rows.rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    question: String(row.question),
    answer: String(row.answer),
  }));
  const revision = hash(
    rows.rows.map((row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          value instanceof Date ? value.toISOString() : value,
        ])
      )
    )
  );
  return { revision, questions };
}
function approved(row: Record<string, unknown>): ThemeQuestionApprovalResult {
  return {
    status: 'approved',
    approvalId: String(row.id),
    candidateId: String(row.candidate_id),
    libraryQuestionId: String(row.library_question_id),
    libraryRevisionId: String(row.library_revision_id),
    approvedAt: new Date(row.approved_at as string | Date).toISOString(),
  };
}
function exactReplay(row: Record<string, unknown>, request: ThemeQuestionApprovalRequest) {
  if (
    row.id !== request.approvalId ||
    row.candidate_id !== request.candidateId ||
    row.question_revision_id !== request.questionRevisionId ||
    row.question_content_hash !== request.questionContentHash ||
    row.library_question_id !== request.libraryQuestionId ||
    row.library_revision_id !== request.libraryRevisionId
  )
    throw new ThemeQuestionApprovalError('request_conflict');
  return approved(row);
}
async function findPrior(db: Pool | PoolClient, request: ThemeQuestionApprovalRequest) {
  const rows = await db.query(
    `SELECT * FROM theme_question_approvals
     WHERE id = $1 OR candidate_id = $2 OR library_question_id = $3 OR library_revision_id = $4`,
    [request.approvalId, request.candidateId, request.libraryQuestionId, request.libraryRevisionId]
  );
  if (!rows.rows.length) return null;
  if (rows.rows.length !== 1) throw new ThemeQuestionApprovalError('request_conflict');
  return exactReplay(rows.rows[0] as Record<string, unknown>, request);
}
async function lockApprovalRoots(
  db: PoolClient,
  request: ThemeQuestionApprovalRequest
): Promise<boolean> {
  const identity = (
    await db.query('SELECT fact_id, fact_revision_id FROM theme_candidates WHERE id = $1', [
      request.candidateId,
    ])
  ).rows[0] as { fact_id?: string; fact_revision_id?: string } | undefined;
  if (!identity?.fact_id || !identity.fact_revision_id) return false;
  const fact = await db.query('SELECT id FROM theme_facts WHERE id = $1 FOR UPDATE', [
    identity.fact_id,
  ]);
  const factRevision = await db.query(
    'SELECT id FROM theme_fact_revisions WHERE id = $1 AND fact_id = $2 FOR UPDATE',
    [identity.fact_revision_id, identity.fact_id]
  );
  const candidate = await db.query('SELECT id FROM theme_candidates WHERE id = $1 FOR UPDATE', [
    request.candidateId,
  ]);
  const revision = await db.query(
    'SELECT id FROM theme_question_revisions WHERE id = $1 AND candidate_id = $2 FOR UPDATE',
    [request.questionRevisionId, request.candidateId]
  );
  return Boolean(fact.rowCount && factRevision.rowCount && candidate.rowCount && revision.rowCount);
}
async function lockAndVerify(
  db: PoolClient,
  request: ThemeQuestionApprovalRequest,
  context: Pick<
    ThemeQuestionQaContext,
    'evidenceAttemptId' | 'evidenceReviewId' | 'evidenceFingerprint'
  >
): Promise<{ generationAttemptId: string; content: QuestionContentSnapshot } | null> {
  // Stable lock order: candidate, candidate revision, generation attempt,
  // generation outcome, evidence attempt, evidence outcome, repair outcome.
  const candidate = (
    await db.query('SELECT * FROM theme_candidates WHERE id = $1 FOR UPDATE', [request.candidateId])
  ).rows[0];
  const revision = (
    await db.query('SELECT * FROM theme_question_revisions WHERE id = $1 FOR SHARE', [
      request.questionRevisionId,
    ])
  ).rows[0];
  const generation = (
    await db.query(
      'SELECT * FROM theme_question_generation_attempts WHERE candidate_id = $1 FOR SHARE',
      [request.candidateId]
    )
  ).rows[0];
  if (!candidate || !revision || !generation) return null;
  const outcome = (
    await db.query(
      'SELECT * FROM theme_question_generation_outcomes WHERE attempt_id = $1 FOR SHARE',
      [generation.id]
    )
  ).rows[0];
  const evidenceAttempt = (
    await db.query(
      'SELECT * FROM theme_question_evidence_review_attempts WHERE id = $1 FOR SHARE',
      [context.evidenceAttemptId]
    )
  ).rows[0];
  const evidenceOutcome = (
    await db.query(
      'SELECT * FROM theme_question_evidence_review_outcomes WHERE attempt_id = $1 FOR SHARE',
      [context.evidenceAttemptId]
    )
  ).rows[0];
  const evidenceReview = (
    await db.query('SELECT * FROM theme_evidence_reviews WHERE id = $1 FOR UPDATE', [
      context.evidenceReviewId,
    ])
  ).rows[0];
  const repair = (
    await db.query(
      'SELECT * FROM theme_question_repair_outcomes WHERE generation_attempt_id = $1 FOR SHARE',
      [generation.id]
    )
  ).rows[0];
  if (
    candidate.status !== 'pending' ||
    candidate.id !== request.candidateId ||
    candidate.content_hash !== request.questionContentHash ||
    revision.id !== request.questionRevisionId ||
    revision.candidate_id !== request.candidateId ||
    revision.question_id !== null ||
    revision.content_hash !== request.questionContentHash ||
    Number(revision.revision) !== Number(candidate.revision) ||
    canonical(candidate.content) !== canonical(revision.content) ||
    hashQuestionSnapshot(revision.content) !== request.questionContentHash ||
    generation.question_revision_id !== request.questionRevisionId ||
    generation.candidate_id !== request.candidateId ||
    generation.fact_id !== candidate.fact_id ||
    generation.fact_revision_id !== candidate.fact_revision_id ||
    outcome?.status !== 'persisted' ||
    outcome.question_content_hash !== request.questionContentHash ||
    evidenceAttempt?.candidate_id !== request.candidateId ||
    evidenceAttempt.question_revision_id !== request.questionRevisionId ||
    evidenceAttempt.question_content_hash !== request.questionContentHash ||
    evidenceOutcome?.status !== 'reviewed' ||
    evidenceOutcome.verdict !== 'pass' ||
    evidenceOutcome.review_id !== context.evidenceReviewId ||
    evidenceReview?.question_revision_id !== request.questionRevisionId ||
    evidenceReview.question_content_hash !== request.questionContentHash ||
    evidenceReview.verdict !== 'pass'
  )
    return null;
  if (generation.parent_candidate_id === null) {
    const claim = await db.query(
      'SELECT id FROM theme_question_generation_attempts WHERE parent_candidate_id = $1 LIMIT 1',
      [request.candidateId]
    );
    if (claim.rows.length) return null;
  } else if (
    repair?.status !== 'passed' ||
    repair.stage !== 'qa' ||
    repair.candidate_id !== request.candidateId ||
    repair.parent_candidate_id !== generation.parent_candidate_id ||
    repair.question_revision_id !== request.questionRevisionId ||
    repair.question_content_hash !== request.questionContentHash ||
    repair.evidence_review_attempt_id !== context.evidenceAttemptId ||
    repair.evidence_review_id !== context.evidenceReviewId ||
    repair.evidence_fingerprint !== context.evidenceFingerprint ||
    repair.qa_policy_version !== THEME_QUESTION_QA_POLICY_VERSION ||
    typeof repair.corpus_revision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(String(repair.corpus_hash))
  )
    return null;
  return { generationAttemptId: generation.id, content: revision.content };
}

export function createPostgresThemeQuestionApprovalRepository(
  pool: Pool,
  config: ThemeQuestionApprovalConfig
) {
  if (
    !pool ||
    typeof pool.connect !== 'function' ||
    !config ||
    typeof config.checkQuality !== 'function' ||
    typeof config.detectDuplicates !== 'function' ||
    (config.now !== undefined && typeof config.now !== 'function')
  )
    throw new ThemeQuestionApprovalError('invalid_configuration');
  const evidence = createPostgresThemeQuestionEvidenceReviewRepository(
    pool,
    config.evidence,
    config.now
  );
  return {
    async approve(rawRequest: ThemeQuestionApprovalRequest): Promise<ThemeQuestionApprovalResult> {
      const parsed = requestSchema.safeParse(rawRequest);
      if (!parsed.success) throw new ThemeQuestionApprovalError('invalid_request');
      const request = parsed.data;
      let prior: ThemeQuestionApprovalResult | null;
      try {
        prior = await findPrior(pool, request);
      } catch (error) {
        if (error instanceof ThemeQuestionApprovalError) throw error;
        throw new ThemeQuestionApprovalError('storage_failure');
      }
      if (prior) return prior;
      const qaRequest = {
        candidateId: request.candidateId,
        questionRevisionId: request.questionRevisionId,
        questionContentHash: request.questionContentHash,
      };
      let preliminaryContext: ThemeQuestionQaContext | null = null;
      const qa = await runThemeQuestionQa(qaRequest, {
        loadContext: async (input) => {
          const current = await evidence.qaContext(input);
          preliminaryContext = current;
          return current;
        },
        loadCorpus: () => loadCorpus(pool),
        checkQuality: config.checkQuality,
        detectDuplicates: config.detectDuplicates,
        now: config.now,
      });
      if (qa.status !== 'passed') {
        const completed = await findPrior(pool, request);
        return completed ?? { status: 'withheld', reason: qa.reason, qa };
      }
      if (!preliminaryContext) return { status: 'withheld', reason: 'invalid_qa_context' };
      let db: PoolClient;
      try {
        db = await pool.connect();
      } catch {
        throw new ThemeQuestionApprovalError('storage_failure');
      }
      let discard = false;
      try {
        await db.query('BEGIN');
        try {
          // Match the existing S7/S8a lock order. FOR UPDATE also blocks new
          // dependent provenance rows through their foreign-key KEY SHARE locks,
          // while unrelated facts remain free to progress.
          if (!(await lockApprovalRoots(db, request))) {
            await db.query('ROLLBACK');
            return { status: 'withheld', reason: 'provenance_changed' };
          }
          const replay = await findPrior(db, request);
          if (replay) {
            await db.query('COMMIT');
            return replay;
          }
          await db.query('LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE');
          const binding = await lockAndVerify(db, request, {
            evidenceAttemptId: qa.evidenceAttemptId!,
            evidenceReviewId: qa.evidenceReviewId!,
            evidenceFingerprint: qa.evidenceFingerprint!,
          });
          if (!binding) {
            await db.query('ROLLBACK');
            return { status: 'withheld', reason: 'provenance_changed' };
          }
          const at = new Date((await db.query('SELECT clock_timestamp() AS at')).rows[0].at);
          if (!Number.isFinite(at.valueOf()))
            throw new ThemeQuestionApprovalError('storage_failure');
          let context: ThemeQuestionQaContext;
          try {
            context = await evidence.qaContext(qaRequest, db, at);
          } catch {
            await db.query('ROLLBACK');
            return { status: 'withheld', reason: 'evidence_changed' };
          }
          const corpus: Corpus = await loadCorpus(db);
          if (
            canonical(context) !== canonical(preliminaryContext) ||
            context.evidenceAttemptId !== qa.evidenceAttemptId ||
            context.evidenceReviewId !== qa.evidenceReviewId ||
            context.evidenceFingerprint !== qa.evidenceFingerprint ||
            corpus.revision !== qa.corpusRevision ||
            hashThemeQuestionQaCorpus(corpus.questions) !== qa.corpusHash
          ) {
            await db.query('ROLLBACK');
            return { status: 'withheld', reason: 'recheck_changed' };
          }
          const content = binding.content;
          const aiAnalysis = {
            themeSlug: content.themeSlug,
            approvalId: request.approvalId,
            candidateId: request.candidateId,
            gate: {
              qaPolicyVersion: qa.policyVersion,
              qaEvaluatedAt: qa.evaluatedAt,
              evidenceAttemptId: qa.evidenceAttemptId,
              evidenceReviewId: qa.evidenceReviewId,
              corpusRevision: qa.corpusRevision,
            },
          };
          const mapped = insertQuestionSchema.safeParse({
            id: request.libraryQuestionId,
            question: content.question,
            answer: content.answer,
            acceptableAnswers: content.acceptableAnswers,
            explanation: content.explanation,
            category: content.category,
            difficulty: content.difficulty,
            pillar: content.pillar,
            tags: content.tags,
            sourceUrl: context.source.url,
            sourceName: context.source.name,
            status: 'approved',
            origin: 'player_ai',
            aiAnalysis,
          });
          if (!mapped.success) {
            await db.query('ROLLBACK');
            return { status: 'withheld', reason: 'invalid_pool_mapping' };
          }
          await db.query(
            `INSERT INTO questions
             (id, category, difficulty, question, answer, acceptable_answers, explanation, pillar,
              tags, source_url, source_name, status, origin, ai_analysis)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'approved','player_ai',$12)`,
            [
              request.libraryQuestionId,
              content.category,
              content.difficulty,
              content.question,
              content.answer,
              JSON.stringify(content.acceptableAnswers),
              content.explanation,
              content.pillar,
              JSON.stringify(content.tags),
              context.source.url,
              context.source.name,
              JSON.stringify(aiAnalysis),
            ]
          );
          await db.query(
            `INSERT INTO theme_question_revisions
             (id,contract_version,question_id,candidate_id,revision,content_hash,content)
             VALUES ($1,$2,$3,NULL,1,$4,$5)`,
            [
              request.libraryRevisionId,
              'theme-reliability-v1',
              request.libraryQuestionId,
              request.questionContentHash,
              JSON.stringify(content),
            ]
          );
          const inserted = await db.query(
            `INSERT INTO theme_question_approvals
             (id,contract_version,candidate_id,question_revision_id,question_content_hash,
              generation_attempt_id,evidence_attempt_id,evidence_review_id,evidence_fingerprint,
              qa_policy_version,qa_evaluated_at,corpus_revision,corpus_hash,
              library_question_id,library_revision_id,source_document_id,source_url,source_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
             RETURNING *`,
            [
              request.approvalId,
              THEME_QUESTION_APPROVAL_VERSION,
              request.candidateId,
              request.questionRevisionId,
              request.questionContentHash,
              binding.generationAttemptId,
              context.evidenceAttemptId,
              context.evidenceReviewId,
              context.evidenceFingerprint,
              qa.policyVersion,
              qa.evaluatedAt,
              qa.corpusRevision,
              qa.corpusHash,
              request.libraryQuestionId,
              request.libraryRevisionId,
              context.source.documentId,
              context.source.url,
              context.source.name,
            ]
          );
          const updated = await db.query(
            `UPDATE theme_candidates SET status = 'accepted'
             WHERE id = $1 AND status = 'pending' AND content_hash = $2`,
            [request.candidateId, request.questionContentHash]
          );
          if (updated.rowCount !== 1) throw new ThemeQuestionApprovalError('storage_failure');
          const result = approved(inserted.rows[0]);
          try {
            await db.query('COMMIT');
          } catch (error) {
            db.release(error instanceof Error ? error : new Error('commit failed'));
            discard = true;
            throw new ThemeQuestionApprovalError('storage_unknown_outcome');
          }
          return result;
        } catch (error) {
          if (!discard) await db.query('ROLLBACK');
          if (error instanceof ThemeQuestionApprovalError) throw error;
          throw new ThemeQuestionApprovalError('storage_failure');
        }
      } catch (error) {
        if (error instanceof ThemeQuestionApprovalError) throw error;
        throw new ThemeQuestionApprovalError('storage_failure');
      } finally {
        if (!discard) db.release();
      }
    },
  };
}
