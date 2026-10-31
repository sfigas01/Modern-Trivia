import type { Pool } from 'pg';
import { z } from 'zod';

export const THEME_RUNTIME_EVALUATION_VERSION = 'theme-runtime-evaluation-v1' as const;

const uuid = z.string().uuid();
const jobStatus = z.enum([
  'queued',
  'researching',
  'retrieving',
  'extracting',
  'writing',
  'reviewing',
  'qa',
  'semantic_check',
  'reserving',
  'ready',
  'shortfall',
  'waiting',
  'completed',
  'failed',
  'canceled',
  'expired',
]);
const attemptOperation = z.enum([
  'research',
  'retrieve',
  'extract_fact',
  'generate',
  'review',
  'repair',
  'embed',
  'semantic_check',
]);
const attemptStatus = z.enum([
  'reserved',
  'dispatched',
  'succeeded',
  'failed',
  'unknown',
  'canceled',
]);
const candidateStatus = z.enum([
  'pending',
  'reviewing',
  'accepted',
  'rejected',
  'duplicate',
  'superseded',
]);

const jobRowSchema = z.object({
  jobId: uuid,
  status: jobStatus,
  candidateCeiling: z.number().int().nonnegative(),
  candidatesUsed: z.number().int().nonnegative(),
  readyCount: z.number().int().nonnegative(),
  themedReadyCount: z.number().int().nonnegative(),
  relatedReadyCount: z.number().int().nonnegative(),
});
const attemptRowSchema = z.object({
  jobId: uuid,
  operation: attemptOperation,
  status: attemptStatus,
  reservedCostMicros: z.number().int().nonnegative(),
  actualCostMicros: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  metadataPresent: z.boolean(),
});
const candidateRowSchema = z.object({
  jobId: uuid,
  status: candidateStatus,
  count: z.number().int().nonnegative(),
});
const approvalRowSchema = z.object({ jobId: uuid, count: z.number().int().nonnegative() });
const exposureRowSchema = z.object({
  jobId: uuid,
  unresolvedReservedMicros: z.number().int().nonnegative(),
});

export type ThemeRuntimeEvaluationRows = Readonly<{
  jobs: readonly z.infer<typeof jobRowSchema>[];
  attempts: readonly z.infer<typeof attemptRowSchema>[];
  candidates: readonly z.infer<typeof candidateRowSchema>[];
  approvals: readonly z.infer<typeof approvalRowSchema>[];
  exposures: readonly z.infer<typeof exposureRowSchema>[];
}>;

export type ThemeRuntimeEvaluationRepository = Readonly<{
  load(jobIds: readonly string[]): Promise<ThemeRuntimeEvaluationRows>;
}>;

function countBy<T extends string>(values: readonly T[]): Record<string, number> {
  const counts: Record<string, number> = Object.create(null);
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))
  );
}

function percentile(values: readonly number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)] ?? null;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Builds an answer-redacted operational report from allowlisted numeric and
 * enum fields. Question text, answers, evidence, prompts, provider payloads,
 * failure text and theme labels cannot enter this boundary.
 */
export function buildThemeRuntimeEvaluationReport(raw: ThemeRuntimeEvaluationRows) {
  const rows = {
    jobs: jobRowSchema.array().parse(raw.jobs),
    attempts: attemptRowSchema.array().parse(raw.attempts),
    candidates: candidateRowSchema.array().parse(raw.candidates),
    approvals: approvalRowSchema.array().parse(raw.approvals),
    exposures: exposureRowSchema.array().parse(raw.exposures),
  };
  const jobs = [...rows.jobs].sort((left, right) => left.jobId.localeCompare(right.jobId));
  const attemptsByJob = new Map<string, typeof rows.attempts>();
  for (const job of jobs)
    attemptsByJob.set(
      job.jobId,
      rows.attempts.filter((attempt) => attempt.jobId === job.jobId)
    );
  const candidateCounts = new Map<string, Record<string, number>>();
  for (const row of rows.candidates) {
    const counts = candidateCounts.get(row.jobId) ?? Object.create(null);
    counts[row.status] = (counts[row.status] ?? 0) + row.count;
    candidateCounts.set(row.jobId, counts);
  }
  const approvals = new Map(rows.approvals.map((row) => [row.jobId, row.count]));
  const exposures = new Map(rows.exposures.map((row) => [row.jobId, row.unresolvedReservedMicros]));
  const reportJobs = jobs.map((job) => {
    const attempts = attemptsByJob.get(job.jobId) ?? [];
    const latencies = attempts.flatMap((attempt) =>
      attempt.latencyMs === null ? [] : [attempt.latencyMs]
    );
    return {
      jobId: job.jobId,
      status: job.status,
      candidateCeiling: job.candidateCeiling,
      candidatesUsed: job.candidatesUsed,
      readyCount: job.readyCount,
      themedReadyCount: job.themedReadyCount,
      relatedReadyCount: job.relatedReadyCount,
      candidateOutcomes: Object.fromEntries(
        Object.entries(candidateCounts.get(job.jobId) ?? {}).sort(([left], [right]) =>
          left.localeCompare(right)
        )
      ),
      approvals: approvals.get(job.jobId) ?? 0,
      attempts: attempts.length,
      attemptStatuses: countBy(attempts.map((attempt) => attempt.status)),
      operations: countBy(attempts.map((attempt) => attempt.operation)),
      actualCostMicros: sum(attempts.map((attempt) => attempt.actualCostMicros)),
      unresolvedReservedMicros: exposures.get(job.jobId) ?? 0,
      inputTokens: sum(attempts.map((attempt) => attempt.inputTokens ?? 0)),
      outputTokens: sum(attempts.map((attempt) => attempt.outputTokens ?? 0)),
      missingMetadata: attempts.filter((attempt) => !attempt.metadataPresent).length,
      latencyMs: {
        samples: latencies.length,
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        max: latencies.length ? Math.max(...latencies) : null,
      },
    };
  });
  const allAttempts = rows.attempts;
  const allLatencies = allAttempts.flatMap((attempt) =>
    attempt.latencyMs === null ? [] : [attempt.latencyMs]
  );
  return {
    schemaVersion: THEME_RUNTIME_EVALUATION_VERSION,
    answerRedacted: true as const,
    factualAccuracyClaimed: false as const,
    denominators: {
      jobs: reportJobs.length,
      candidates: sum(rows.candidates.map((row) => row.count)),
      attempts: allAttempts.length,
      approvals: sum(rows.approvals.map((row) => row.count)),
    },
    jobStatuses: countBy(jobs.map((job) => job.status)),
    attemptStatuses: countBy(allAttempts.map((attempt) => attempt.status)),
    operations: countBy(allAttempts.map((attempt) => attempt.operation)),
    actualCostMicros: sum(allAttempts.map((attempt) => attempt.actualCostMicros)),
    unresolvedReservedMicros: sum(rows.exposures.map((row) => row.unresolvedReservedMicros)),
    inputTokens: sum(allAttempts.map((attempt) => attempt.inputTokens ?? 0)),
    outputTokens: sum(allAttempts.map((attempt) => attempt.outputTokens ?? 0)),
    missingMetadata: allAttempts.filter((attempt) => !attempt.metadataPresent).length,
    latencyMs: {
      samples: allLatencies.length,
      p50: percentile(allLatencies, 0.5),
      p95: percentile(allLatencies, 0.95),
      max: allLatencies.length ? Math.max(...allLatencies) : null,
    },
    jobs: reportJobs,
  };
}

function validateJobIds(jobIds: readonly string[]): string[] {
  const parsed = z.array(uuid).min(1).max(100).safeParse(jobIds);
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length)
    throw new Error('Evaluation requires 1-100 distinct job UUIDs');
  return parsed.data;
}

export function createPostgresThemeRuntimeEvaluationRepository(
  pool: Pick<Pool, 'connect'>
): ThemeRuntimeEvaluationRepository {
  return {
    async load(rawJobIds) {
      const jobIds = validateJobIds(rawJobIds);
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const [jobs, attempts, candidates, approvals, exposures] = await Promise.all([
          client.query<{
            job_id: string;
            status: string;
            candidate_ceiling: number;
            candidates_used: number;
            ready_count: number;
            themed_ready_count: number;
            related_ready_count: number;
          }>(
            `SELECT id AS job_id,status,candidate_ceiling,candidates_used,ready_count,
                  themed_ready_count,related_ready_count
             FROM theme_preparation_jobs WHERE id = ANY($1::uuid[]) ORDER BY id`,
            [jobIds]
          ),
          client.query<{
            job_id: string;
            operation: string;
            status: string;
            reserved_cost_micros: number;
            actual_cost_micros: number;
            input_tokens: number | null;
            output_tokens: number | null;
            latency_ms: number | null;
            metadata_present: boolean;
          }>(
            `SELECT attempt.job_id,attempt.operation,attempt.status,attempt.reserved_cost_micros,
                  attempt.actual_cost_micros,attempt.input_tokens,attempt.output_tokens,
                  metadata.latency_ms,(metadata.attempt_id IS NOT NULL) AS metadata_present
             FROM theme_job_attempts attempt
             LEFT JOIN theme_job_attempt_provider_metadata metadata ON metadata.attempt_id=attempt.id
            WHERE attempt.job_id = ANY($1::uuid[])
            ORDER BY attempt.job_id,attempt.sequence`,
            [jobIds]
          ),
          client.query<{ job_id: string; status: string; count: string }>(
            `SELECT job_id,status,count(*)::text AS count FROM theme_candidates
            WHERE job_id = ANY($1::uuid[]) GROUP BY job_id,status ORDER BY job_id,status`,
            [jobIds]
          ),
          client.query<{ job_id: string; count: string }>(
            `SELECT candidate.job_id,count(*)::text AS count
             FROM theme_question_approvals approval
             JOIN theme_candidates candidate ON candidate.id=approval.candidate_id
            WHERE candidate.job_id = ANY($1::uuid[]) GROUP BY candidate.job_id ORDER BY candidate.job_id`,
            [jobIds]
          ),
          client.query<{ job_id: string; unresolved_reserved_micros: string }>(
            `SELECT job_id,
                  COALESCE(sum(GREATEST(reserved_micros-settled_micros,0)) FILTER
                    (WHERE status IN ('reserved','partially_settled','unknown')),0)::text
                    AS unresolved_reserved_micros
             FROM theme_budget_allocations WHERE job_id = ANY($1::uuid[])
            GROUP BY job_id ORDER BY job_id`,
            [jobIds]
          ),
        ]);
        if (jobs.rows.length !== jobIds.length)
          throw new Error('One or more evaluation jobs do not exist');
        const rows = {
          jobs: jobs.rows.map((row) => ({
            jobId: row.job_id,
            status: row.status as z.infer<typeof jobStatus>,
            candidateCeiling: row.candidate_ceiling,
            candidatesUsed: row.candidates_used,
            readyCount: row.ready_count,
            themedReadyCount: row.themed_ready_count,
            relatedReadyCount: row.related_ready_count,
          })),
          attempts: attempts.rows.map((row) => ({
            jobId: row.job_id,
            operation: row.operation as z.infer<typeof attemptOperation>,
            status: row.status as z.infer<typeof attemptStatus>,
            reservedCostMicros: row.reserved_cost_micros,
            actualCostMicros: row.actual_cost_micros,
            inputTokens: row.input_tokens,
            outputTokens: row.output_tokens,
            latencyMs: row.latency_ms,
            metadataPresent: row.metadata_present,
          })),
          candidates: candidates.rows.map((row) => ({
            jobId: row.job_id,
            status: row.status as z.infer<typeof candidateStatus>,
            count: Number(row.count),
          })),
          approvals: approvals.rows.map((row) => ({ jobId: row.job_id, count: Number(row.count) })),
          exposures: exposures.rows.map((row) => ({
            jobId: row.job_id,
            unresolvedReservedMicros: Number(row.unresolved_reserved_micros),
          })),
        };
        await client.query('COMMIT');
        return rows;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
