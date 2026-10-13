import type { Pool, PoolClient } from 'pg';

import {
  THEME_RELIABILITY_CONTRACT_VERSION,
  questionContentSnapshotSchema,
} from '@shared/models/theme-evidence';
import type { InternalThemeFailure } from '@shared/models/theme';

import { hashQuestionSnapshot } from './theme-evidence-eligibility';
import { THEME_QUESTION_QA_POLICY_VERSION } from './theme-question-qa';
import type { ThemePreparationWorkerDependencies } from './theme-preparation-worker';
import { ThemePreparationWorkerError } from './theme-preparation-worker';

type RuntimeRepository = Pick<
  ThemePreparationWorkerDependencies,
  'assertDispatchesSettled' | 'recordPause' | 'reserveApproved'
>;

const TERMINAL_GAMES = ['completed', 'failed', 'abandoned', 'expired'];
const FAILURE_CODES: Record<
  Parameters<RuntimeRepository['recordPause']>[0]['code'],
  InternalThemeFailure['code']
> = {
  runtime_unavailable: 'internal_error',
  inventory_shortfall: 'inventory_shortfall',
  budget_exhausted: 'budget_unavailable',
  provider_outcome_unknown: 'provider_unknown_outcome',
  candidate_ceiling: 'candidate_limit_exhausted',
  source_ineligible: 'source_unavailable',
  preparation_failed: 'internal_error',
};

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function shortfall(): never {
  throw new ThemePreparationWorkerError('inventory_shortfall', false);
}

/** The worker's durable SQL boundary. It does not change room/gameplay state. */
export function createPostgresThemeRuntimeRepository(
  pool: Pool,
  options: Readonly<{
    now?: () => Date;
    validateApprovalEvidence?: (
      request: {
        candidateId: string;
        questionRevisionId: string;
        questionContentHash: string;
      },
      db: PoolClient,
      at: Date
    ) => Promise<{
      evidenceAttemptId: string;
      evidenceReviewId: string;
      evidenceFingerprint: string;
    }>;
  }> = {}
): RuntimeRepository {
  const now = options.now ?? (() => new Date());
  return {
    async assertDispatchesSettled(jobId) {
      const rows = await pool.query<{
        attempt_status: string;
        allocation_status: string | null;
        allocation_id: string | null;
        allocation_job_id: string | null;
      }>(
        `SELECT attempt.status AS attempt_status, attempt.allocation_id,
                allocation.status AS allocation_status, allocation.job_id AS allocation_job_id
           FROM theme_job_attempts attempt
           LEFT JOIN theme_budget_allocations allocation ON allocation.id = attempt.allocation_id
          WHERE attempt.job_id = $1`,
        [jobId]
      );
      for (const row of rows.rows) {
        if (
          row.attempt_status === 'unknown' ||
          row.allocation_status === 'unknown' ||
          (row.allocation_id !== null && row.allocation_status === null) ||
          (row.allocation_job_id !== null && row.allocation_job_id !== jobId)
        )
          throw new ThemePreparationWorkerError('provider_outcome_unknown', false);
        if (
          !['succeeded', 'failed', 'canceled'].includes(row.attempt_status) ||
          (row.allocation_status !== null &&
            !['settled', 'released', 'expired'].includes(row.allocation_status)) ||
          (row.allocation_id === null && row.allocation_status !== null)
        )
          throw new ThemePreparationWorkerError('preparation_failed', false);
      }
      // An allocation without an attempt is also unresolved. Reconciled, settled
      // allocations are harmless but all live/unknown holds fail closed.
      const allocations = await pool.query<{ status: string }>(
        `SELECT allocation.status FROM theme_budget_allocations allocation
          WHERE allocation.job_id = $1
            AND NOT EXISTS (SELECT 1 FROM theme_job_attempts attempt
                             WHERE attempt.allocation_id = allocation.id)`,
        [jobId]
      );
      for (const row of allocations.rows) {
        if (row.status === 'unknown')
          throw new ThemePreparationWorkerError('provider_outcome_unknown', false);
        if (!['settled', 'released', 'expired'].includes(row.status))
          throw new ThemePreparationWorkerError('preparation_failed', false);
      }
    },

    async recordPause(input) {
      const failure: InternalThemeFailure = {
        contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
        code: FAILURE_CODES[input.code],
        retryable: input.retryable,
        operation: null,
        provider: null,
        httpStatus: null,
        candidateOrdinal: null,
      };
      const result = await pool.query(
        `UPDATE theme_preparation_jobs AS job
            SET last_failure = $4::jsonb, updated_at = clock_timestamp()
           FROM theme_game_sessions AS game
          WHERE job.id = $1 AND game.id = job.game_id
            AND job.lease_owner = $2 AND job.lease_expires_at > clock_timestamp()
            AND job.status = $3
            AND game.status <> ALL($5::varchar[]) AND game.expires_at > clock_timestamp()
        RETURNING job.id`,
        [
          input.jobId,
          input.claimToken,
          input.expectedStatus,
          JSON.stringify(failure),
          TERMINAL_GAMES,
        ]
      );
      return result.rowCount === 1;
    },

    async reserveApproved(job, approved) {
      // Conflicts deliberately throw: transaction() rolls back the entire batch.
      return transaction(pool, async (db) => {
        const state = await db.query<{
          job_id: string;
          job_status: string;
          lease_owner: string | null;
          lease_expires_at: Date | null;
          game_id: string;
          game_status: string;
          game_expires_at: Date;
          roster_locked_at: Date | null;
          player_count: number;
          themed_target: number;
          related_target: number;
          corpus_revision: number;
          history_revision: number;
        }>(
          `SELECT job.id AS job_id, job.status AS job_status, job.lease_owner,
                  job.lease_expires_at, game.id AS game_id, game.status AS game_status,
                  game.expires_at AS game_expires_at, game.roster_locked_at,
                  game.player_count,
                  COALESCE(game.accepted_themed_target, game.themed_question_target) AS themed_target,
                  COALESCE(game.accepted_related_target, game.related_question_target) AS related_target,
                  game.corpus_revision, game.history_revision
             FROM theme_preparation_jobs job
             JOIN theme_game_sessions game ON game.id = job.game_id
            WHERE job.id = $1 FOR UPDATE OF job, game`,
          [job.id]
        );
        const current = state.rows[0];
        const at = now();
        if (
          !current ||
          current.game_id !== job.gameId ||
          current.job_status !== 'reserving' ||
          current.lease_owner !== job.leaseOwner ||
          !current.lease_owner ||
          !current.lease_expires_at ||
          current.lease_expires_at <= at ||
          TERMINAL_GAMES.includes(current.game_status) ||
          ['ready', 'active'].includes(current.game_status) ||
          current.game_expires_at <= at ||
          !current.roster_locked_at
        )
          shortfall();
        if (approved.length !== current.themed_target || approved.length < 1) shortfall();

        const roster = await db.query<{ identity_id: string }>(
          `SELECT identity_id FROM theme_game_participants
            WHERE game_id = $1 AND left_at IS NULL ORDER BY identity_id FOR UPDATE`,
          [job.gameId]
        );
        const identities = roster.rows.map((row) => row.identity_id);
        if (
          identities.length !== current.player_count ||
          new Set(identities).size !== identities.length
        )
          shortfall();
        await db.query(
          `SELECT id FROM theme_participant_identities WHERE id = ANY($1::uuid[])
            ORDER BY CASE kind WHEN 'account' THEN 0 ELSE 1 END, id FOR UPDATE`,
          [identities]
        );
        const subjectsResult = await db.query<{ id: string }>(
          `WITH RECURSIVE subjects(id) AS (
             SELECT unnest($1::uuid[])
             UNION
             SELECT link.source_identity_id FROM subjects
             JOIN theme_identity_links link ON link.target_identity_id = subjects.id
           ) SELECT id FROM subjects ORDER BY id`,
          [identities]
        );
        const subjects = subjectsResult.rows.map((row) => row.id);
        if (subjects.length < identities.length) shortfall();
        await db.query(
          `SELECT id FROM theme_participant_identities WHERE id = ANY($1::uuid[])
            ORDER BY id FOR UPDATE`,
          [subjects]
        );
        const backups = await db.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM theme_question_reservations
            WHERE game_id = $1 AND job_id = $2 AND role = 'related_backup'
              AND status = 'held' AND released_at IS NULL AND expires_at > $3`,
          [job.gameId, job.id, at]
        );
        if (Number(backups.rows[0]?.count) !== current.related_target) shortfall();

        const existing = await db.query<{
          id: string;
          job_id: string;
          question_id: string;
          question_revision_id: string;
          fact_id: string;
          fact_revision_id: string;
          corpus_revision: number;
          history_revision: number;
          status: string;
          released_at: Date | null;
          expires_at: Date;
        }>(
          `SELECT * FROM theme_question_reservations
            WHERE game_id = $1 AND role = 'theme' ORDER BY question_id FOR UPDATE`,
          [job.gameId]
        );
        if (existing.rows.length !== 0 && existing.rows.length !== approved.length) shortfall();
        if (
          new Set(approved.map((item) => item.itemKey)).size !== approved.length ||
          new Set(approved.map((item) => item.candidateId)).size !== approved.length ||
          new Set(approved.map((item) => item.questionId)).size !== approved.length
        )
          shortfall();

        const expected = new Map<string, (typeof existing.rows)[number]>();
        for (const row of existing.rows) expected.set(row.question_id, row);
        const selectedFacts = new Set<string>();
        const validatedEvidence: Array<{
          request: {
            candidateId: string;
            questionRevisionId: string;
            questionContentHash: string;
          };
          expected: {
            evidenceAttemptId: string;
            evidenceReviewId: string;
            evidenceFingerprint: string;
          };
        }> = [];
        for (const item of approved) {
          const binding = await db.query<{ fact_id: string; fact_revision_id: string }>(
            `SELECT fact_id,fact_revision_id FROM theme_candidates
              WHERE id=$1 AND job_id=$2 AND status='accepted'`,
            [item.candidateId, job.id]
          );
          if (!binding.rows[0] || binding.rows.length !== 1) shortfall();
          // Match the fact -> revision -> candidate root order used by S7-S10.
          await db.query('SELECT id FROM theme_facts WHERE id = $1 FOR UPDATE', [
            binding.rows[0].fact_id,
          ]);
          await db.query('SELECT id FROM theme_fact_revisions WHERE id = $1 FOR UPDATE', [
            binding.rows[0].fact_revision_id,
          ]);
          await db.query('SELECT id FROM theme_candidates WHERE id = $1 FOR UPDATE', [
            item.candidateId,
          ]);
          const eligibilityAt = (await db.query<{ at: Date }>('SELECT clock_timestamp() AS at'))
            .rows[0]?.at;
          if (
            !(eligibilityAt instanceof Date) ||
            current.lease_expires_at <= eligibilityAt ||
            current.game_expires_at <= eligibilityAt
          )
            shortfall();
          const approval = await db.query<{
            fact_id: string;
            fact_revision_id: string;
            library_revision_id: string;
            question_id: string;
            question_content_hash: string;
            content: { themeSlug: string };
            category: string;
            difficulty: string;
            question: string;
            answer: string;
            acceptable_answers: string[];
            explanation: string;
            pillar: string;
            tags: string[];
            question_revision_id: string;
            evidence_attempt_id: string;
            evidence_review_id: string;
            evidence_fingerprint: string;
          }>(
            `SELECT candidate.fact_id, candidate.fact_revision_id,
                    approval.library_revision_id, approval.library_question_id AS question_id,
                    approval.question_revision_id, approval.question_content_hash,
                    approval.evidence_attempt_id, approval.evidence_review_id,
                    approval.evidence_fingerprint, library_revision.content,
                    question.category, question.difficulty, question.question, question.answer,
                    question.acceptable_answers, question.explanation, question.pillar, question.tags
               FROM theme_question_approvals approval
               JOIN theme_candidates candidate ON candidate.id = approval.candidate_id
               JOIN theme_fact_revisions fact_revision ON fact_revision.id = candidate.fact_revision_id
               JOIN theme_question_revisions library_revision ON library_revision.id = approval.library_revision_id
               JOIN questions question ON question.id = approval.library_question_id
              WHERE approval.candidate_id = $1 AND approval.library_question_id = $2
                AND candidate.job_id = $3 AND candidate.status = 'accepted'
                AND approval.qa_policy_version = $5
                AND question.status = 'approved'
                AND library_revision.question_id = question.id
                AND library_revision.content_hash = approval.question_content_hash
                AND candidate.fact_id = fact_revision.fact_id
                AND (NOT fact_revision.time_sensitive OR fact_revision.valid_until > $4)
                AND fact_revision.revision = (SELECT max(revision) FROM theme_fact_revisions
                                               WHERE fact_id = candidate.fact_id)
                AND library_revision.revision = (SELECT max(revision) FROM theme_question_revisions
                                                   WHERE question_id = question.id)
              FOR SHARE OF approval, library_revision, question`,
            [
              item.candidateId,
              item.questionId,
              job.id,
              eligibilityAt,
              THEME_QUESTION_QA_POLICY_VERSION,
            ]
          );
          const row = approval.rows[0];
          if (!row || approval.rows.length !== 1 || selectedFacts.has(row.fact_id)) shortfall();
          try {
            const snapshot = questionContentSnapshotSchema.parse({
              themeSlug: row.content.themeSlug,
              category: row.category,
              difficulty: row.difficulty,
              question: row.question,
              answer: row.answer,
              acceptableAnswers: row.acceptable_answers ?? [],
              explanation: row.explanation,
              pillar: row.pillar,
              tags: row.tags ?? [],
            });
            if (hashQuestionSnapshot(snapshot) !== row.question_content_hash) shortfall();
          } catch {
            shortfall();
          }
          if (!options.validateApprovalEvidence) shortfall();
          try {
            const request = {
              candidateId: item.candidateId,
              questionRevisionId: row.question_revision_id,
              questionContentHash: row.question_content_hash,
            };
            const context = await options.validateApprovalEvidence(request, db, eligibilityAt);
            if (
              context.evidenceAttemptId !== row.evidence_attempt_id ||
              context.evidenceReviewId !== row.evidence_review_id ||
              context.evidenceFingerprint !== row.evidence_fingerprint
            )
              shortfall();
            validatedEvidence.push({
              request,
              expected: {
                evidenceAttemptId: row.evidence_attempt_id,
                evidenceReviewId: row.evidence_review_id,
                evidenceFingerprint: row.evidence_fingerprint,
              },
            });
          } catch {
            shortfall();
          }
          selectedFacts.add(row.fact_id);
          const replay = expected.get(item.questionId);
          if (existing.rows.length) {
            if (
              !replay ||
              replay.job_id !== job.id ||
              replay.question_revision_id !== row.library_revision_id ||
              replay.fact_id !== row.fact_id ||
              replay.fact_revision_id !== row.fact_revision_id ||
              replay.status !== 'held' ||
              replay.released_at !== null ||
              replay.expires_at <= eligibilityAt ||
              replay.corpus_revision !== current.corpus_revision ||
              replay.history_revision !== current.history_revision
            )
              shortfall();
          } else {
            const history = await db.query(
              `WITH last_games AS (
                 SELECT DISTINCT game_id FROM (
                   SELECT game_id, row_number() OVER
                     (PARTITION BY identity_id ORDER BY max(displayed_at) DESC, game_id) AS ordinal
                     FROM theme_question_exposures WHERE identity_id = ANY($1::uuid[])
                     GROUP BY identity_id, game_id
                 ) recent WHERE ordinal <= 5
               ) SELECT 1 FROM theme_question_exposures
                  WHERE identity_id = ANY($1::uuid[]) AND (question_id = $2 OR fact_id = $3)
                    AND (displayed_at > $4::timestamptz - interval '30 days'
                      OR game_id IN (SELECT game_id FROM last_games))
               UNION ALL
               SELECT 1 FROM seen_questions seen
               JOIN theme_participant_identities identity ON identity.account_user_id = seen.user_id
               LEFT JOIN theme_question_approvals prior ON prior.library_question_id = seen.question_id
               LEFT JOIN theme_candidates prior_candidate ON prior_candidate.id = prior.candidate_id
               WHERE identity.id = ANY($1::uuid[]) AND seen.seen_at > $4::timestamptz - interval '30 days'
                 AND (seen.question_id = $2 OR prior_candidate.fact_id = $3)
               LIMIT 1`,
              [subjects, item.questionId, row.fact_id, eligibilityAt]
            );
            if (history.rowCount) shortfall();
            const conflict = await db.query(
              `SELECT 1 FROM theme_reservation_participants
                WHERE identity_id = ANY($1::uuid[]) AND fact_id = $2 AND released_at IS NULL LIMIT 1`,
              [subjects, row.fact_id]
            );
            if (conflict.rowCount) shortfall();
            const inserted = await db.query<{ id: string }>(
              `INSERT INTO theme_question_reservations
                 (game_id,job_id,question_id,question_revision_id,fact_id,fact_revision_id,
                  role,corpus_revision,history_revision,expires_at)
               VALUES ($1,$2,$3,$4,$5,$6,'theme',$7,$8,$9) RETURNING id`,
              [
                job.gameId,
                job.id,
                item.questionId,
                row.library_revision_id,
                row.fact_id,
                row.fact_revision_id,
                current.corpus_revision,
                current.history_revision,
                current.game_expires_at,
              ]
            );
            if (inserted.rowCount !== 1) shortfall();
            for (const identityId of subjects)
              await db.query(
                `INSERT INTO theme_reservation_participants
                   (reservation_id,identity_id,fact_id) VALUES ($1,$2,$3)`,
                [inserted.rows[0].id, identityId, row.fact_id]
              );
          }
        }
        if (existing.rows.length) {
          const coverage = await db.query<{
            reservation_id: string;
            identity_id: string;
            fact_id: string;
          }>(
            `SELECT participant.reservation_id, participant.identity_id, participant.fact_id
               FROM theme_reservation_participants participant
               JOIN theme_question_reservations reservation ON reservation.id = participant.reservation_id
              WHERE reservation.game_id = $1 AND reservation.role = 'theme'
                AND participant.released_at IS NULL`,
            [job.gameId]
          );
          const expectedCoverage = new Set(
            existing.rows.flatMap((reservation) =>
              subjects.map((identityId) => `${reservation.id}:${identityId}:${reservation.fact_id}`)
            )
          );
          if (
            coverage.rows.length !== expectedCoverage.size ||
            coverage.rows.some(
              (row) =>
                !expectedCoverage.delete(`${row.reservation_id}:${row.identity_id}:${row.fact_id}`)
            ) ||
            expectedCoverage.size
          )
            shortfall();
        }
        const commitAt = (await db.query<{ at: Date }>('SELECT clock_timestamp() AS at')).rows[0]
          ?.at;
        if (
          !(commitAt instanceof Date) ||
          current.lease_expires_at <= commitAt ||
          current.game_expires_at <= commitAt
        )
          shortfall();
        for (const binding of validatedEvidence) {
          try {
            const context = await options.validateApprovalEvidence!(binding.request, db, commitAt);
            if (
              context.evidenceAttemptId !== binding.expected.evidenceAttemptId ||
              context.evidenceReviewId !== binding.expected.evidenceReviewId ||
              context.evidenceFingerprint !== binding.expected.evidenceFingerprint
            )
              shortfall();
          } catch {
            shortfall();
          }
        }
        const counts = await db.query<{ themed: string; related: string }>(
          `SELECT count(*) FILTER (WHERE role = 'theme')::text AS themed,
                  count(*) FILTER (WHERE role = 'related_backup')::text AS related
             FROM theme_question_reservations
            WHERE game_id = $1 AND status = 'held' AND released_at IS NULL AND expires_at > $2`,
          [job.gameId, commitAt]
        );
        if (
          Number(counts.rows[0]?.themed) !== current.themed_target ||
          Number(counts.rows[0]?.related) !== current.related_target
        )
          shortfall();
        const updated = await db.query(
          `UPDATE theme_preparation_jobs
              SET themed_ready_count = $3, related_ready_count = $4,
                  ready_count = $3 + $4, last_failure = NULL,
                  updated_at = clock_timestamp()
            WHERE id = $1 AND lease_owner = $2 AND status = 'reserving'
              AND lease_expires_at > clock_timestamp()
          RETURNING id`,
          [job.id, job.leaseOwner, current.themed_target, current.related_target]
        );
        if (updated.rowCount !== 1) shortfall();
        return { ready: true };
      });
    },
  };
}
