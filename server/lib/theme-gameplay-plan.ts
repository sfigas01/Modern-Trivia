import type { Pool, PoolClient } from 'pg';

import {
  THEME_E1_CLAIM_EVIDENCE_POLICY,
  THEME_E1_SOURCE_POLICY_VERSION,
  THEME_E1_SOURCE_REGISTRY,
  THEME_E1_SOURCE_REGISTRY_HASH,
} from './theme-e1-plan-policy';
import {
  createThemeLiveRuntimeGameplayPlan,
  createThemeRuntimePlanRepository,
  type ThemeLiveRuntimePlanV2,
} from './theme-runtime-plan';
import { createPostgresThemeSourceRegistryRepository } from './theme-source-registry';
import {
  createWikipediaDiscoveryPolicy,
  discoverWikipediaSources,
  normalizeWikipediaTheme,
} from './theme-wikipedia-discovery';

export const THEME_GAMEPLAY_PLAN_VERSION = 'theme-gameplay-openai-2026-11-21-v2' as const;
export const THEME_GAMEPLAY_DISCOVERY_POLICY = createWikipediaDiscoveryPolicy({
  discoveryPolicyVersion: 'theme-gameplay-wikipedia-discovery-2026-11-15-v1',
  sourcePolicyVersion: THEME_E1_SOURCE_POLICY_VERSION,
  sourceRegistryHash: THEME_E1_SOURCE_REGISTRY_HASH,
  maximumResults: 8,
  minimumResults: 1,
});

const PLAN_HOLD_MS = 24 * 60 * 60 * 1_000;

type GameplayPlanRow = {
  job_id: string;
  game_id: string;
  room_id: string;
  job_status: string;
  game_status: string;
  room_status: string;
  room_phase: string;
  theme: string;
  related_categories: string[];
  candidate_ceiling: number;
  candidates_used: number;
  themed_target: number;
  related_target: number;
  related_ready: number;
  plan_version: string | null;
  lease_owner: string | null;
  game_expires_at: Date;
  room_expires_at: Date;
};

export type ThemeGameplayPlanResult = Readonly<{
  jobId: string;
  replay: boolean;
  planHash: string;
  themedSlots: number;
  relatedSlots: number;
}>;

export interface ThemeGameplayPlanner {
  prepare(jobId: string): Promise<ThemeGameplayPlanResult>;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertThemeGameplayPlanPolicy(input: unknown): ThemeLiveRuntimePlanV2 {
  const plan = input as ThemeLiveRuntimePlanV2;
  if (
    plan?.contractVersion !== 'theme-live-runtime-plan-v2' ||
    plan.sourcePolicyVersion !== THEME_E1_SOURCE_POLICY_VERSION ||
    plan.sourceRegistryHash !== THEME_E1_SOURCE_REGISTRY_HASH ||
    !same(plan.discoveryPolicy, THEME_GAMEPLAY_DISCOVERY_POLICY) ||
    !same(plan.claimEvidencePolicy, THEME_E1_CLAIM_EVIDENCE_POLICY) ||
    plan.proposalSlots.length !== plan.proposalSlotPolicy.totalSlots ||
    plan.proposalSlots.some(
      (slot) =>
        !slot.role ||
        !slot.topic ||
        !slot.targetDifficulty ||
        normalizeWikipediaTheme(slot.topic) !== slot.topic
    )
  )
    throw new TypeError('theme_gameplay_plan_policy_mismatch');
  return plan;
}

/** Allocate the 25% candidate margin across every non-empty deficit. */
export function allocateThemeGameplaySlots(input: {
  requiredThemed: number;
  requiredRelated: number;
  candidateCeiling: number;
  relatedCategories: readonly string[];
}): readonly Readonly<{ role: 'theme' | 'related_backup'; topic: string }>[] {
  const required = input.requiredThemed + input.requiredRelated;
  if (
    !Number.isInteger(input.requiredThemed) ||
    input.requiredThemed < 1 ||
    !Number.isInteger(input.requiredRelated) ||
    input.requiredRelated < 0 ||
    !Number.isInteger(input.candidateCeiling) ||
    input.candidateCeiling < required ||
    input.relatedCategories.length < 1
  )
    throw new TypeError('theme_gameplay_targets_invalid');
  let themedSlots =
    input.requiredRelated === 0
      ? input.candidateCeiling
      : Math.round((input.candidateCeiling * input.requiredThemed) / required);
  themedSlots = Math.max(
    input.requiredThemed,
    Math.min(input.candidateCeiling - input.requiredRelated, themedSlots)
  );
  const relatedSlots = input.candidateCeiling - themedSlots;
  const roles: Array<'theme' | 'related_backup'> = [];
  let themedRemaining = themedSlots;
  let relatedRemaining = relatedSlots;
  while (themedRemaining + relatedRemaining > 0) {
    const themedShare = themedRemaining / Math.max(1, themedSlots);
    const relatedShare = relatedRemaining / Math.max(1, relatedSlots);
    if (themedRemaining > 0 && (relatedRemaining === 0 || themedShare >= relatedShare)) {
      roles.push('theme');
      themedRemaining -= 1;
    } else {
      roles.push('related_backup');
      relatedRemaining -= 1;
    }
  }
  let relatedOrdinal = 0;
  return roles.map((role) => ({
    role,
    topic:
      role === 'theme'
        ? ''
        : input.relatedCategories[relatedOrdinal++ % input.relatedCategories.length],
  }));
}

async function loadJob(db: Pick<Pool | PoolClient, 'query'>, jobId: string, lock = false) {
  const result = await db.query<GameplayPlanRow>(
    `SELECT job.id AS job_id,game.id AS game_id,room.id AS room_id,
            job.status AS job_status,game.status AS game_status,
            room.status AS room_status,room.phase AS room_phase,
            game.theme,game.related_categories,job.candidate_ceiling,job.candidates_used,
            COALESCE(game.accepted_themed_target,game.themed_question_target)::integer AS themed_target,
            COALESCE(game.accepted_related_target,game.related_question_target)::integer AS related_target,
            job.related_ready_count::integer AS related_ready,job.plan_version,job.lease_owner,
            game.expires_at AS game_expires_at,room.expires_at AS room_expires_at
       FROM theme_preparation_jobs job
       JOIN theme_game_sessions game ON game.id=job.game_id
       JOIN rooms room ON room.id=game.room_id AND room.theme_preparation_game_id=game.id
      WHERE job.id=$1${lock ? ' FOR UPDATE OF job,game,room' : ''}`,
    [jobId]
  );
  return result.rows[0];
}

function validate(row: GameplayPlanRow | undefined) {
  if (
    !row ||
    !['queued', 'waiting'].includes(row.job_status) ||
    row.game_status !== 'waiting' ||
    row.room_status !== 'lobby' ||
    row.room_phase !== 'LOBBY' ||
    row.lease_owner !== null ||
    row.candidates_used !== 0 ||
    row.related_ready < 0 ||
    row.related_ready > row.related_target
  )
    throw new TypeError('theme_gameplay_job_ineligible');
  return row;
}

export function createPostgresThemeGameplayPlanner(
  pool: Pool,
  options: {
    budgetPolicyFingerprint: string;
    discover?: typeof discoverWikipediaSources;
    now?: () => Date;
  }
): ThemeGameplayPlanner {
  const discover = options.discover ?? discoverWikipediaSources;
  const now = options.now ?? (() => new Date());
  return Object.freeze({
    async prepare(jobId: string) {
      const snapshot = validate(await loadJob(pool, jobId));
      if (snapshot.plan_version) {
        if (snapshot.plan_version !== THEME_GAMEPLAY_PLAN_VERSION)
          throw new TypeError('theme_gameplay_plan_conflict');
        const loaded = await createThemeRuntimePlanRepository(pool).load(jobId);
        const plan = assertThemeGameplayPlanPolicy(loaded.plan);
        return {
          jobId,
          replay: true,
          planHash: loaded.planHash,
          themedSlots: plan.proposalSlots.filter((slot) => slot.role === 'theme').length,
          relatedSlots: plan.proposalSlots.filter((slot) => slot.role === 'related_backup').length,
        };
      }
      const discovery = await discover(
        { theme: snapshot.theme, policy: THEME_GAMEPLAY_DISCOVERY_POLICY },
        { registry: { manifest: THEME_E1_SOURCE_REGISTRY, hash: THEME_E1_SOURCE_REGISTRY_HASH } }
      );
      if (!discovery.ok) throw new TypeError('theme_gameplay_discovery_failed');
      const slotInputs = allocateThemeGameplaySlots({
        requiredThemed: snapshot.themed_target,
        requiredRelated: snapshot.related_target - snapshot.related_ready,
        candidateCeiling: snapshot.candidate_ceiling,
        relatedCategories: snapshot.related_categories,
      }).map((slot) => ({ ...slot, topic: slot.role === 'theme' ? snapshot.theme : slot.topic }));
      const plan = assertThemeGameplayPlanPolicy(
        createThemeLiveRuntimeGameplayPlan({
          discovery: discovery.value,
          claimEvidencePolicy: THEME_E1_CLAIM_EVIDENCE_POLICY,
          budgetPolicyFingerprint: options.budgetPolicyFingerprint,
          slots: slotInputs,
          maximumSlotsPerSource: Math.ceil(slotInputs.length / discovery.value.sources.length),
        })
      );
      const holdUntil = new Date(now().getTime() + PLAN_HOLD_MS);
      const db = await pool.connect();
      try {
        await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const current = validate(await loadJob(db, jobId, true));
        if (current.plan_version) {
          if (current.plan_version !== THEME_GAMEPLAY_PLAN_VERSION)
            throw new TypeError('theme_gameplay_plan_conflict');
          const loaded = await createThemeRuntimePlanRepository(db as unknown as Pool).load(jobId);
          const replayPlan = assertThemeGameplayPlanPolicy(loaded.plan);
          await db.query('COMMIT');
          return {
            jobId,
            replay: true,
            planHash: loaded.planHash,
            themedSlots: replayPlan.proposalSlots.filter((slot) => slot.role === 'theme').length,
            relatedSlots: replayPlan.proposalSlots.filter((slot) => slot.role === 'related_backup')
              .length,
          };
        }
        if (
          current.game_id !== snapshot.game_id ||
          current.theme !== snapshot.theme ||
          !same(current.related_categories, snapshot.related_categories) ||
          current.themed_target !== snapshot.themed_target ||
          current.related_target !== snapshot.related_target ||
          current.related_ready !== snapshot.related_ready ||
          current.candidate_ceiling !== snapshot.candidate_ceiling
        )
          throw new TypeError('theme_gameplay_job_changed');
        await createPostgresThemeSourceRegistryRepository(db as unknown as Pool).append(
          THEME_E1_SOURCE_REGISTRY
        );
        const roomHold = await db.query(
          `UPDATE rooms SET expires_at=GREATEST(expires_at,$2),updated_at=clock_timestamp()
            WHERE id=$1`,
          [current.room_id, holdUntil]
        );
        const gameHold = await db.query(
          `UPDATE theme_game_sessions SET expires_at=GREATEST(expires_at,$2),updated_at=clock_timestamp()
            WHERE id=$1`,
          [current.game_id, holdUntil]
        );
        if (roomHold.rowCount !== 1 || gameHold.rowCount !== 1)
          throw new TypeError('theme_gameplay_hold_failed');
        const attached = await createThemeRuntimePlanRepository(db as unknown as Pool).attach(
          jobId,
          {
            planVersion: THEME_GAMEPLAY_PLAN_VERSION,
            plan,
            holdUntil,
          }
        );
        await db.query('COMMIT');
        return {
          jobId,
          replay: attached.replay,
          planHash: attached.planHash,
          themedSlots: plan.proposalSlots.filter((slot) => slot.role === 'theme').length,
          relatedSlots: plan.proposalSlots.filter((slot) => slot.role === 'related_backup').length,
        };
      } catch (error) {
        try {
          await db.query('ROLLBACK');
        } catch {
          // Preserve the original planning failure.
        }
        throw error;
      } finally {
        db.release();
      }
    },
  });
}
