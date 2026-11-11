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
  gameId: string;
  roomId: string;
  status: string;
  gameStatus: string;
  roomStatus: string;
  roomPhase: string;
  theme: string;
  generationOwnerUserId: string | null;
  candidateCeiling: number;
  candidatesUsed: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  gameExpiresAt: Date;
  roomExpiresAt: Date;
  planVersion: string | null;
  planHoldUntil: Date | null;
  lastFailureCode: string | null;
  activeReservationCount: number;
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
    holdUntil: string;
    planHash: string;
    replay: boolean;
    promotedFromShortfall: boolean;
  }>[];
}>;

type JobRow = QueryResultRow & {
  job_id: string;
  game_id: string;
  room_id: string;
  status: string;
  game_status: string;
  room_status: string;
  room_phase: string;
  theme: string;
  generation_owner_user_id: string | null;
  candidate_ceiling: number;
  candidates_used: number;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  game_expires_at: Date;
  room_expires_at: Date;
  plan_version: string | null;
  plan_hold_until: Date | null;
  last_failure_code: string | null;
  active_reservation_count: string | number;
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
    gameId: row.game_id,
    roomId: row.room_id,
    status: row.status,
    gameStatus: row.game_status,
    roomStatus: row.room_status,
    roomPhase: row.room_phase,
    theme: row.theme,
    generationOwnerUserId: row.generation_owner_user_id,
    candidateCeiling: row.candidate_ceiling,
    candidatesUsed: row.candidates_used,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    gameExpiresAt: row.game_expires_at,
    roomExpiresAt: row.room_expires_at,
    planVersion: row.plan_version,
    planHoldUntil: row.plan_hold_until,
    lastFailureCode: row.last_failure_code ?? null,
    activeReservationCount: Number(row.active_reservation_count ?? 0),
  };
}

function isEligibleJobStatus(job: ThemeE1PreparationJob): boolean {
  if (ELIGIBLE_JOB_STATUSES.has(job.status)) return true;
  return (
    job.status === 'shortfall' &&
    job.planVersion === null &&
    job.planHoldUntil === null &&
    job.lastFailureCode === 'inventory_shortfall' &&
    job.activeReservationCount === 0
  );
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
        !isEligibleJobStatus(job) ||
        job.gameStatus !== 'waiting' ||
        job.roomStatus !== 'lobby' ||
        job.roomPhase !== 'LOBBY' ||
        job.candidateCeiling < THEME_E1_SLOTS_PER_JOB ||
        job.candidatesUsed !== 0 ||
        job.leaseOwner !== null ||
        job.leaseExpiresAt !== null ||
        job.gameExpiresAt.getTime() <= now.getTime() ||
        job.roomExpiresAt.getTime() <= now.getTime() ||
        (job.planVersion === null) !== (job.planHoldUntil === null) ||
        (job.planHoldUntil !== null && job.planHoldUntil.getTime() <= now.getTime()) ||
        (job.planVersion !== null && job.planVersion !== THEME_E1_BUNDLE_VERSION)
    )
  )
    throw new ThemeE1PlanPreparationError('job_ineligible');
  const validated = jobs as ThemeE1PreparationJob[];
  const planned = validated.filter((job) => job.planVersion !== null);
  if (
    (planned.length !== 0 && planned.length !== THEME_E1_JOB_COUNT) ||
    (planned.length === THEME_E1_JOB_COUNT &&
      planned.some((job) => job.planHoldUntil?.getTime() !== planned[0]?.planHoldUntil?.getTime()))
  )
    throw new ThemeE1PlanPreparationError('job_ineligible');
  return validated;
}

function sameJob(left: ThemeE1PreparationJob, right: ThemeE1PreparationJob): boolean {
  return (
    left.jobId === right.jobId &&
    left.gameId === right.gameId &&
    left.roomId === right.roomId &&
    left.status === right.status &&
    left.gameStatus === right.gameStatus &&
    left.roomStatus === right.roomStatus &&
    left.roomPhase === right.roomPhase &&
    left.theme === right.theme &&
    left.generationOwnerUserId === right.generationOwnerUserId &&
    left.candidateCeiling === right.candidateCeiling &&
    left.candidatesUsed === right.candidatesUsed &&
    left.leaseOwner === right.leaseOwner &&
    left.leaseExpiresAt?.getTime() === right.leaseExpiresAt?.getTime() &&
    left.gameExpiresAt.getTime() === right.gameExpiresAt.getTime() &&
    left.roomExpiresAt.getTime() === right.roomExpiresAt.getTime() &&
    left.planVersion === right.planVersion &&
    left.planHoldUntil?.getTime() === right.planHoldUntil?.getTime() &&
    left.lastFailureCode === right.lastFailureCode &&
    left.activeReservationCount === right.activeReservationCount
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
    `SELECT job.id AS job_id,game.id AS game_id,room.id AS room_id,
            job.status,game.status AS game_status,room.status AS room_status,room.phase AS room_phase,game.theme,
            game.generation_owner_user_id,
            job.candidate_ceiling,job.candidates_used,job.lease_owner,job.lease_expires_at,
            game.expires_at AS game_expires_at,room.expires_at AS room_expires_at,
            job.plan_version,job.plan_hold_until,job.last_failure->>'code' AS last_failure_code,
            (SELECT count(*) FROM theme_question_reservations reservation
              WHERE reservation.game_id=game.id
                AND reservation.status IN ('held','selected','displayed')) AS active_reservation_count
       FROM theme_preparation_jobs job
       JOIN theme_game_sessions game ON game.id=job.game_id
       JOIN rooms room ON room.id=game.room_id AND room.theme_preparation_game_id=game.id
      WHERE job.id=ANY($1::uuid[])
      ORDER BY job.id${lock ? ' FOR UPDATE OF job,game,room' : ''}`,
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
       count(*) FILTER (WHERE
         (job.status IN ('queued','waiting') OR
           (job.status='shortfall' AND job.last_failure->>'code'='inventory_shortfall'
             AND NOT EXISTS (SELECT 1 FROM theme_question_reservations reservation
               WHERE reservation.game_id=game.id
                 AND reservation.status IN ('held','selected','displayed'))))
         AND job.plan_json IS NULL
         AND job.candidates_used=0 AND job.lease_owner IS NULL
         AND game.status='waiting' AND game.generation_owner_user_id IS NOT NULL)
         AS eligible_unplanned_jobs
     FROM theme_preparation_jobs job
     JOIN theme_game_sessions game ON game.id=job.game_id
     JOIN rooms room ON room.id=game.room_id AND room.theme_preparation_game_id=game.id
     WHERE game.status NOT IN ('completed','failed','abandoned','expired')
       AND game.expires_at > clock_timestamp()
       AND room.status='lobby' AND room.phase='LOBBY' AND room.expires_at > clock_timestamp()`
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

        const holdUntil = plans[0]?.holdUntil;
        if (
          !holdUntil ||
          plans.some((prepared) => prepared.holdUntil.getTime() !== holdUntil.getTime())
        )
          throw new ThemeE1PlanPreparationError('job_state_changed');
        const roomExtension = await db.query<{ id: string }>(
          `UPDATE rooms
              SET expires_at=GREATEST(expires_at,$2),updated_at=clock_timestamp()
            WHERE id=ANY($1::uuid[])
              AND status='lobby' AND phase='LOBBY' AND expires_at>clock_timestamp()
            RETURNING id`,
          [current.map((job) => job.roomId), holdUntil]
        );
        const gameExtension = await db.query<{ id: string }>(
          `UPDATE theme_game_sessions
              SET expires_at=GREATEST(expires_at,$2),updated_at=clock_timestamp()
            WHERE id=ANY($1::uuid[])
              AND status='waiting' AND expires_at>clock_timestamp()
            RETURNING id`,
          [current.map((job) => job.gameId), holdUntil]
        );
        if (
          roomExtension.rowCount !== THEME_E1_JOB_COUNT ||
          gameExtension.rowCount !== THEME_E1_JOB_COUNT
        )
          throw new ThemeE1PlanPreparationError('job_state_changed');

        const shortfallIds = current
          .filter((job) => job.status === 'shortfall')
          .map((job) => job.jobId);
        if (shortfallIds.length) {
          const promotion = await db.query<{ id: string }>(
            `UPDATE theme_preparation_jobs AS job
                SET status='waiting',public_stage='paused',last_failure=NULL,
                    updated_at=clock_timestamp()
              WHERE job.id=ANY($1::uuid[]) AND job.status='shortfall'
                AND job.candidates_used=0 AND job.lease_owner IS NULL
                AND job.lease_expires_at IS NULL AND job.plan_version IS NULL
                AND job.plan_hash IS NULL AND job.plan_json IS NULL
                AND job.plan_hold_until IS NULL
                AND job.last_failure->>'code'='inventory_shortfall'
                AND NOT EXISTS (SELECT 1 FROM theme_question_reservations reservation
                  WHERE reservation.game_id=job.game_id
                    AND reservation.status IN ('held','selected','displayed'))
              RETURNING job.id`,
            [shortfallIds]
          );
          if (promotion.rowCount !== shortfallIds.length)
            throw new ThemeE1PlanPreparationError('job_state_changed');
        }

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
  const discovered: Pick<ThemeE1PreparedPlan, 'job' | 'plan'>[] = [];

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
    discovered.push({ job, plan });
  }

  // Discovery can take time, so the full evaluation hold starts at the
  // preparation boundary rather than at the earlier read snapshot.
  const applyNow = input.now ?? new Date();
  const holdUntil =
    snapshot.jobs[0]?.planHoldUntil ?? new Date(applyNow.getTime() + THEME_E1_MINIMUM_HOLD_MS);
  const prepared: ThemeE1PreparedPlan[] = discovered.map(({ job, plan }) => ({
    job,
    plan,
    holdUntil,
    planHash: hashThemeRuntimePlan({
      planVersion: THEME_E1_BUNDLE_VERSION,
      plan,
      holdUntil,
    }),
  }));
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
      holdUntil: value.holdUntil.toISOString(),
      planHash: value.planHash,
      replay: replays[index] ?? false,
      promotedFromShortfall: value.job.status === 'shortfall',
    })),
  };
}
