import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import {
  THEME_E1_CLAIM_EVIDENCE_POLICY,
  THEME_E1_DISCOVERY_POLICY,
  THEME_E1_JOB_COUNT,
  THEME_E1_MINIMUM_HOLD_MS,
  THEME_E1_SLOTS_PER_JOB,
  THEME_E1_SOURCE_REGISTRY,
  THEME_E1_SOURCE_REGISTRY_HASH,
  THEME_E1_TOTAL_SLOTS,
  assertThemeE1PlanPolicy,
} from './theme-e1-plan-policy';
import { THEME_E1_BUNDLE_VERSION } from './theme-e1-provider-bundle';
import { THEME_BUDGET_LOCK_SQL, THEME_RUNTIME_CONTROL_ID } from './theme-runtime-control';
import {
  createThemeLiveRuntimePlanWithProposalSlots,
  createThemeRuntimePlanRepository,
  hashThemeRuntimePlan,
  type ThemeLiveRuntimePlanV2,
} from './theme-runtime-plan';
import type { ThemeRuntimeBudgetConfig } from './theme-runtime-config';
import { themeRuntimeBudgetPolicyFingerprint } from './theme-runtime-config';
import { createPostgresThemeSourceRegistryRepository } from './theme-source-registry';
import {
  discoverWikipediaSources,
  type WikipediaDiscoveryResult,
} from './theme-wikipedia-discovery';

const jobIdSchema = z.string().uuid();
const ELIGIBLE_JOB_STATUSES = new Set(['queued', 'waiting']);

export class ThemeE1PlanPreparationError extends Error {
  constructor(
    public readonly code:
      | 'invalid_job_selection'
      | 'runtime_control_enabled'
      | 'job_ineligible'
      | 'job_state_changed'
      | 'discovery_failed'
      | 'persistence_failed'
  ) {
    super(code);
    this.name = 'ThemeE1PlanPreparationError';
  }
}

export type ThemeE1PreparationJob = Readonly<{
  jobId: string;
  status: string;
  gameStatus: string;
  theme: string;
  generationOwnerUserId: string | null;
  candidateCeiling: number;
  candidatesUsed: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  expiresAt: Date;
  planVersion: string | null;
}>;

export type ThemeE1PreparationQueue = Readonly<{
  recoverablePlannedJobs: number;
  eligibleUnplannedJobs: number;
}>;

export type ThemeE1PreparedPlan = Readonly<{
  job: ThemeE1PreparationJob;
  plan: ThemeLiveRuntimePlanV2;
  holdUntil: Date;
  planHash: string;
}>;

export interface ThemeE1PlanPreparationRepository {
  load(
    jobIds: readonly string[],
    now: Date
  ): Promise<{
    jobs: readonly ThemeE1PreparationJob[];
    queue: ThemeE1PreparationQueue;
  }>;
  apply(plans: readonly ThemeE1PreparedPlan[], now: Date): Promise<readonly boolean[]>;
}

export type ThemeE1PlanPreparationReport = Readonly<{
  schemaVersion: 'theme-e1-plan-preparation-report-v1';
  answerRedacted: true;
  providerCallsAuthorized: false;
  mode: 'dry_run' | 'applied';
  bundleVersion: typeof THEME_E1_BUNDLE_VERSION;
  sourcePolicyVersion: string;
  budgetPolicyFingerprint: string;
  totalJobs: typeof THEME_E1_JOB_COUNT;
  totalProposalSlots: typeof THEME_E1_TOTAL_SLOTS;
  queueBefore: ThemeE1PreparationQueue;
  jobs: readonly Readonly<{
    jobId: string;
    sourceCount: number;
    proposalSlots: typeof THEME_E1_SLOTS_PER_JOB;
    planHash: string;
    replay: boolean;
  }>[];
}>;

type JobRow = QueryResultRow & {
  job_id: string;
  status: string;
  game_status: string;
  theme: string;
  generation_owner_user_id: string | null;
  candidate_ceiling: number;
  candidates_used: number;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  expires_at: Date;
  plan_version: string | null;
};

function parseJobIds(jobIds: readonly string[]): string[] {
  const parsed = jobIds.map((jobId) => jobIdSchema.safeParse(jobId));
  if (
    parsed.length !== THEME_E1_JOB_COUNT ||
    parsed.some((result) => !result.success) ||
    new Set(jobIds).size !== jobIds.length
  )
    throw new ThemeE1PlanPreparationError('invalid_job_selection');
  return parsed.map((result) => result.data as string);
}

function mapJob(row: JobRow): ThemeE1PreparationJob {
  return {
    jobId: row.job_id,
    status: row.status,
    gameStatus: row.game_status,
    theme: row.theme,
    generationOwnerUserId: row.generation_owner_user_id,
    candidateCeiling: row.candidate_ceiling,
    candidatesUsed: row.candidates_used,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    expiresAt: row.expires_at,
    planVersion: row.plan_version,
  };
}

function validateJobs(
  requestedIds: readonly string[],
  rows: readonly JobRow[],
  now: Date
): ThemeE1PreparationJob[] {
  const byId = new Map(rows.map((row) => [row.job_id, mapJob(row)]));
  const jobs = requestedIds.map((jobId) => byId.get(jobId));
  if (
    jobs.some(
      (job) =>
        !job ||
        !job.generationOwnerUserId ||
        !ELIGIBLE_JOB_STATUSES.has(job.status) ||
        job.gameStatus !== 'waiting' ||
        job.candidateCeiling < THEME_E1_SLOTS_PER_JOB ||
        job.candidatesUsed !== 0 ||
        job.leaseOwner !== null ||
        job.leaseExpiresAt !== null ||
        job.expiresAt.getTime() < now.getTime() + THEME_E1_MINIMUM_HOLD_MS ||
        (job.planVersion !== null && job.planVersion !== THEME_E1_BUNDLE_VERSION)
    )
  )
    throw new ThemeE1PlanPreparationError('job_ineligible');
  return jobs as ThemeE1PreparationJob[];
}

function sameJob(left: ThemeE1PreparationJob, right: ThemeE1PreparationJob): boolean {
  return (
    left.jobId === right.jobId &&
    left.status === right.status &&
    left.gameStatus === right.gameStatus &&
    left.theme === right.theme &&
    left.generationOwnerUserId === right.generationOwnerUserId &&
    left.candidateCeiling === right.candidateCeiling &&
    left.candidatesUsed === right.candidatesUsed &&
    left.leaseOwner === right.leaseOwner &&
    left.leaseExpiresAt?.getTime() === right.leaseExpiresAt?.getTime() &&
    left.expiresAt.getTime() === right.expiresAt.getTime() &&
    left.planVersion === right.planVersion
  );
}

async function assertControlDisabled(db: Pick<PoolClient, 'query'>, lock: boolean): Promise<void> {
  const result = await db.query<{ enabled: boolean }>(
    `SELECT enabled FROM theme_runtime_control WHERE singleton_id=$1${lock ? ' FOR UPDATE' : ''}`,
    [THEME_RUNTIME_CONTROL_ID]
  );
  if (result.rows.length !== 1 || result.rows[0]?.enabled !== false)
    throw new ThemeE1PlanPreparationError('runtime_control_enabled');
}

async function selectJobs(
  db: Pick<PoolClient, 'query'>,
  jobIds: readonly string[],
  lock: boolean
): Promise<JobRow[]> {
  const result = await db.query<JobRow>(
    `SELECT job.id AS job_id,job.status,game.status AS game_status,game.theme,
            game.generation_owner_user_id,
            job.candidate_ceiling,job.candidates_used,job.lease_owner,job.lease_expires_at,game.expires_at,
            job.plan_version
       FROM theme_preparation_jobs job
       JOIN theme_game_sessions game ON game.id=job.game_id
      WHERE job.id=ANY($1::uuid[])
      ORDER BY job.id${lock ? ' FOR UPDATE OF job,game' : ''}`,
    [jobIds]
  );
  return result.rows;
}

async function selectQueue(db: Pick<PoolClient, 'query'>): Promise<ThemeE1PreparationQueue> {
  const result = await db.query<{
    recoverable_planned_jobs: string | number;
    eligible_unplanned_jobs: string | number;
  }>(
    `SELECT
       count(*) FILTER (WHERE job.status IN ('queued','waiting') AND job.plan_json IS NOT NULL
         AND (job.lease_owner IS NULL OR job.lease_expires_at <= clock_timestamp()))
         AS recoverable_planned_jobs,
       count(*) FILTER (WHERE job.status IN ('queued','waiting') AND job.plan_json IS NULL
         AND job.candidates_used=0 AND job.lease_owner IS NULL
         AND game.status='waiting' AND game.generation_owner_user_id IS NOT NULL)
         AS eligible_unplanned_jobs
     FROM theme_preparation_jobs job
     JOIN theme_game_sessions game ON game.id=job.game_id
     WHERE game.status NOT IN ('completed','failed','abandoned','expired')
       AND game.expires_at > clock_timestamp()`
  );
  const row = result.rows[0];
  return {
    recoverablePlannedJobs: Number(row?.recoverable_planned_jobs ?? 0),
    eligibleUnplannedJobs: Number(row?.eligible_unplanned_jobs ?? 0),
  };
}

export function createPostgresThemeE1PlanPreparationRepository(
  pool: Pool
): ThemeE1PlanPreparationRepository {
  return {
    async load(jobIds, now) {
      const ids = parseJobIds(jobIds);
      const db = await pool.connect();
      try {
        await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await assertControlDisabled(db, false);
        const jobs = validateJobs(ids, await selectJobs(db, ids, false), now);
        const queue = await selectQueue(db);
        await db.query('COMMIT');
        return { jobs, queue };
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      } finally {
        db.release();
      }
    },

    async apply(plans, now) {
      const ids = parseJobIds(plans.map((plan) => plan.job.jobId));
      const db = await pool.connect();
      try {
        await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await db.query(THEME_BUDGET_LOCK_SQL);
        await assertControlDisabled(db, true);
        const current = validateJobs(ids, await selectJobs(db, ids, true), now);
        if (current.some((job, index) => !sameJob(job, plans[index].job)))
          throw new ThemeE1PlanPreparationError('job_state_changed');

        const transactionalPool = db as unknown as Pool;
        await createPostgresThemeSourceRegistryRepository(transactionalPool).append(
          THEME_E1_SOURCE_REGISTRY
        );
        const planRepository = createThemeRuntimePlanRepository(transactionalPool);
        const replay: boolean[] = [];
        for (const prepared of plans) {
          const attached = await planRepository.attach(prepared.job.jobId, {
            planVersion: THEME_E1_BUNDLE_VERSION,
            plan: prepared.plan,
            holdUntil: prepared.holdUntil,
          });
          replay.push(attached.replay);
        }
        await db.query('COMMIT');
        return replay;
      } catch (error) {
        try {
          await db.query('ROLLBACK');
        } catch {
          // Preserve the original preflight or persistence failure.
        }
        if (error instanceof ThemeE1PlanPreparationError) throw error;
        throw new ThemeE1PlanPreparationError('persistence_failed');
      } finally {
        db.release();
      }
    },
  };
}

export async function prepareThemeE1Plans(input: {
  repository: ThemeE1PlanPreparationRepository;
  jobIds: readonly string[];
  budget: ThemeRuntimeBudgetConfig;
  apply?: boolean;
  now?: Date;
  discover?: typeof discoverWikipediaSources;
}): Promise<ThemeE1PlanPreparationReport> {
  const jobIds = parseJobIds(input.jobIds);
  const now = input.now ?? new Date();
  const snapshot = await input.repository.load(jobIds, now);
  const budgetPolicyFingerprint = themeRuntimeBudgetPolicyFingerprint(input.budget);
  const discover = input.discover ?? discoverWikipediaSources;
  const prepared: ThemeE1PreparedPlan[] = [];

  for (const job of snapshot.jobs) {
    let discovery: WikipediaDiscoveryResult;
    try {
      discovery = await discover(
        { theme: job.theme, policy: THEME_E1_DISCOVERY_POLICY },
        {
          registry: {
            manifest: THEME_E1_SOURCE_REGISTRY,
            hash: THEME_E1_SOURCE_REGISTRY_HASH,
          },
        }
      );
    } catch {
      throw new ThemeE1PlanPreparationError('discovery_failed');
    }
    if (!discovery.ok) throw new ThemeE1PlanPreparationError('discovery_failed');
    const plan = assertThemeE1PlanPolicy(
      createThemeLiveRuntimePlanWithProposalSlots({
        discovery: discovery.value,
        claimEvidencePolicy: THEME_E1_CLAIM_EVIDENCE_POLICY,
        budgetPolicyFingerprint,
        totalSlots: THEME_E1_SLOTS_PER_JOB,
        maximumSlotsPerSource: THEME_E1_SLOTS_PER_JOB,
      })
    );
    const holdUntil = new Date(job.expiresAt);
    prepared.push({
      job,
      plan,
      holdUntil,
      planHash: hashThemeRuntimePlan({
        planVersion: THEME_E1_BUNDLE_VERSION,
        plan,
        holdUntil,
      }),
    });
  }

  // Discovery can take time. Recheck eligibility against the current clock at
  // the write boundary instead of reusing the earlier read-snapshot time.
  const applyNow = input.now ?? new Date();
  const replays = input.apply
    ? await input.repository.apply(prepared, applyNow)
    : prepared.map(() => false);
  return {
    schemaVersion: 'theme-e1-plan-preparation-report-v1',
    answerRedacted: true,
    providerCallsAuthorized: false,
    mode: input.apply ? 'applied' : 'dry_run',
    bundleVersion: THEME_E1_BUNDLE_VERSION,
    sourcePolicyVersion: THEME_E1_SOURCE_REGISTRY.sourcePolicyVersion,
    budgetPolicyFingerprint,
    totalJobs: THEME_E1_JOB_COUNT,
    totalProposalSlots: THEME_E1_TOTAL_SLOTS,
    queueBefore: snapshot.queue,
    jobs: prepared.map((value, index) => ({
      jobId: value.job.jobId,
      sourceCount: value.plan.sources.length,
      proposalSlots: THEME_E1_SLOTS_PER_JOB,
      planHash: value.planHash,
      replay: replays[index] ?? false,
    })),
  };
}
