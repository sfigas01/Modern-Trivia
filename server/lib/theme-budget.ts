import type { Pool, PoolClient } from 'pg';

export type ThemeBudgetOperation =
  | 'research'
  | 'retrieve'
  | 'extract_fact'
  | 'generate'
  | 'review'
  | 'repair'
  | 'embed'
  | 'semantic_check';

export interface ThemeBudgetDispatch {
  jobId: string;
  /** Stable identity of one physical provider dispatch, unique across all jobs. */
  dispatchKey: string;
  /** SHA-256 of the exact provider request, including prompt and parameters. */
  requestFingerprint: string;
  /** SHA-256 of the trusted cap and pricing policy used for this reservation. */
  policyFingerprint: string;
  /** The active lifecycle lease. The owner is always derived from the game. */
  claimToken: string;
  operation: ThemeBudgetOperation;
  provider: string;
  model: string;
  reservedCostMicros: number;
  candidateSlots: number;
  /** Explicit administrator-supplied USD limits. No implicit numeric policy exists. */
  limits: {
    globalDailyMicros: number;
    accountDailyMicros: number;
    accountRolling168hMicros: number;
  };
  /** Review deadline only. Expiry never releases an unresolved provider hold. */
  holdExpiresAt: Date;
}

export interface ThemeBudgetOutcome {
  status: 'succeeded' | 'failed';
  actualCostMicros: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Safe machine code; never pass raw provider output or a secret-bearing error. */
  failureCode?: string;
}

export interface ThemeBudgetRecord {
  attemptId: string;
  allocationId: string;
  ownerUserId: string;
  status: 'dispatched' | 'succeeded' | 'failed' | 'unknown';
  reservedCostMicros: number;
  actualCostMicros: number;
  overrun: boolean;
  replay: boolean;
}

export class ThemeBudgetError extends Error {
  constructor(
    public readonly code:
      | 'invalid_request'
      | 'dispatch_conflict'
      | 'owner_missing'
      | 'lease_unavailable'
      | 'policy_conflict'
      | 'budget_exhausted'
      | 'candidate_ceiling'
      | 'overrun_anomaly'
      | 'provider_outcome_unknown'
      | 'commit_unknown',
    message: string
  ) {
    super(message);
    this.name = 'ThemeBudgetError';
  }
}

const operations = new Set<ThemeBudgetOperation>([
  'research',
  'retrieve',
  'extract_fact',
  'generate',
  'review',
  'repair',
  'embed',
  'semantic_check',
]);
const activeHoldStatuses = "'reserved','partially_settled','unknown'";
const intMax = 2_147_483_647;

function int(value: number, name: string, positive = false): void {
  if (!Number.isInteger(value) || value < (positive ? 1 : 0) || value > intMax)
    throw new ThemeBudgetError('invalid_request', `${name} must be a nonnegative 32-bit integer`);
}

function validate(input: ThemeBudgetDispatch): void {
  if (
    !/^[0-9a-f-]{36}$/i.test(input.jobId) ||
    !input.dispatchKey ||
    input.dispatchKey.length > 255 ||
    !/^[a-f0-9]{64}$/.test(input.requestFingerprint) ||
    !/^[a-f0-9]{64}$/.test(input.policyFingerprint) ||
    !input.claimToken ||
    input.claimToken.length > 255 ||
    !operations.has(input.operation) ||
    !input.provider ||
    input.provider.length > 255 ||
    !input.model ||
    input.model.length > 255 ||
    !(input.holdExpiresAt instanceof Date) ||
    !Number.isFinite(input.holdExpiresAt.getTime())
  )
    throw new ThemeBudgetError('invalid_request', 'Invalid durable dispatch identity or metadata');
  int(input.reservedCostMicros, 'reservedCostMicros', true);
  int(input.candidateSlots, 'candidateSlots');
  int(input.limits.globalDailyMicros, 'globalDailyMicros');
  int(input.limits.accountDailyMicros, 'accountDailyMicros');
  int(input.limits.accountRolling168hMicros, 'accountRolling168hMicros');
  if ((input.operation === 'generate' || input.operation === 'repair') !== input.candidateSlots > 0)
    throw new ThemeBudgetError(
      'invalid_request',
      'Only generation or repair consumes candidate slots'
    );
}

function validateOutcome(outcome: ThemeBudgetOutcome): void {
  if (outcome.status !== 'succeeded' && outcome.status !== 'failed')
    throw new ThemeBudgetError('invalid_request', 'Invalid settlement status');
  int(outcome.actualCostMicros, 'actualCostMicros');
  if (outcome.inputTokens !== undefined) int(outcome.inputTokens, 'inputTokens');
  if (outcome.outputTokens !== undefined) int(outcome.outputTokens, 'outputTokens');
  if (outcome.failureCode !== undefined && !/^[a-z][a-z0-9_]{0,63}$/.test(outcome.failureCode))
    throw new ThemeBudgetError('invalid_request', 'Invalid safe failure code');
}

async function lockedTransaction<T>(pool: Pool, work: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  let startedCommit = false;
  try {
    await db.query('BEGIN');
    // Every admission and settlement uses the same transaction-scoped lock.
    await db.query('SELECT pg_advisory_xact_lock(927421, 25011)');
    const value = await work(db);
    startedCommit = true;
    await db.query('COMMIT');
    return value;
  } catch (error) {
    try {
      await db.query('ROLLBACK');
    } catch {
      // A broken connection or an acknowledged COMMIT cannot be undone here.
    }
    if (startedCommit)
      throw new ThemeBudgetError(
        'commit_unknown',
        'Budget commit acknowledgement is ambiguous; provider dispatch is prohibited'
      );
    throw error;
  } finally {
    db.release();
  }
}

type AttemptRow = {
  id: string;
  allocation_id: string;
  job_id: string;
  provider_request_key: string;
  request_fingerprint: string | null;
  operation: ThemeBudgetOperation;
  provider: string;
  model: string;
  candidate_slots_consumed: number;
  reserved_cost_micros: number;
  actual_cost_micros: number;
  input_tokens: number | null;
  output_tokens: number | null;
  failure: { code?: string } | null;
  status: ThemeBudgetRecord['status'];
  owner_user_id: string;
  policy_fingerprint: string | null;
  expires_at: Date;
};

const attemptSql = `SELECT a.*,b.owner_user_id,b.policy_fingerprint,b.expires_at FROM theme_job_attempts a
  JOIN theme_budget_allocations b ON b.id=a.allocation_id
  WHERE a.provider_request_key=$1`;

function replay(input: ThemeBudgetDispatch, row: AttemptRow): ThemeBudgetRecord {
  if (
    row.job_id !== input.jobId ||
    row.provider_request_key !== input.dispatchKey ||
    row.request_fingerprint !== input.requestFingerprint ||
    row.policy_fingerprint !== input.policyFingerprint ||
    row.operation !== input.operation ||
    row.provider !== input.provider ||
    row.model !== input.model ||
    row.candidate_slots_consumed !== input.candidateSlots ||
    row.reserved_cost_micros !== input.reservedCostMicros ||
    row.expires_at.getTime() !== input.holdExpiresAt.getTime()
  )
    throw new ThemeBudgetError(
      'dispatch_conflict',
      'Dispatch key was already used for a different request'
    );
  return {
    attemptId: row.id,
    allocationId: row.allocation_id,
    ownerUserId: row.owner_user_id,
    status: row.status,
    reservedCostMicros: row.reserved_cost_micros,
    actualCostMicros: row.actual_cost_micros,
    overrun: row.actual_cost_micros > row.reserved_cost_micros,
    replay: true,
  };
}

function within(used: string, requested: number, limit: number): boolean {
  return BigInt(used) + BigInt(requested) <= BigInt(limit);
}

export function createThemeBudgetGateway(pool: Pool) {
  async function reserve(input: ThemeBudgetDispatch): Promise<ThemeBudgetRecord> {
    validate(input);
    return lockedTransaction(pool, async (db) => {
      const prior = await db.query<AttemptRow>(attemptSql, [input.dispatchKey]);
      if (prior.rows[0]) return replay(input, prior.rows[0]);

      const job = await db.query<{
        owner_user_id: string | null;
        candidates_used: number;
        candidate_ceiling: number;
      }>(
        `SELECT game.generation_owner_user_id AS owner_user_id,job.candidates_used,job.candidate_ceiling
         FROM theme_preparation_jobs job JOIN theme_game_sessions game ON game.id=job.game_id
         WHERE job.id=$1 AND job.lease_owner=$2 AND job.lease_expires_at > clock_timestamp()
           AND job.status NOT IN ('completed','failed','canceled','expired')
           AND game.status NOT IN ('completed','failed','abandoned','expired')
           AND game.expires_at > clock_timestamp()
         FOR UPDATE OF job,game`,
        [input.jobId, input.claimToken]
      );
      if (!job.rows[0])
        throw new ThemeBudgetError('lease_unavailable', 'An active preparation lease is required');
      const owner = job.rows[0]?.owner_user_id;
      if (!owner) throw new ThemeBudgetError('owner_missing', 'Generation owner is missing');
      const now = (await db.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0].now;
      if (input.holdExpiresAt <= now)
        throw new ThemeBudgetError('invalid_request', 'Hold review deadline must be in the future');
      const day = now.toISOString().slice(0, 10);
      await db.query(
        `INSERT INTO theme_daily_budgets
         (budget_date,currency,limit_micros,account_daily_limit_micros,account_rolling_limit_micros)
         VALUES($1,'USD',$2,$3,$4) ON CONFLICT (budget_date) DO NOTHING`,
        [
          day,
          input.limits.globalDailyMicros,
          input.limits.accountDailyMicros,
          input.limits.accountRolling168hMicros,
        ]
      );
      const policy = (
        await db.query<{
          currency: string;
          limit_micros: number;
          account_daily_limit_micros: number | null;
          account_rolling_limit_micros: number | null;
        }>('SELECT * FROM theme_daily_budgets WHERE budget_date=$1', [day])
      ).rows[0];
      if (
        policy.currency !== 'USD' ||
        policy.limit_micros !== input.limits.globalDailyMicros ||
        policy.account_daily_limit_micros !== input.limits.accountDailyMicros ||
        policy.account_rolling_limit_micros !== input.limits.accountRolling168hMicros
      )
        throw new ThemeBudgetError(
          'policy_conflict',
          'Daily budget policy differs from durable policy'
        );

      // An actual charge above reservation is recorded in full. It blocks all
      // subsequent dispatch until an operator reviews the anomaly.
      const usage = (
        await db.query<{
          global_day: string;
          account_day: string;
          account_rolling: string;
          overrun: boolean;
        }>(
          `SELECT
          COALESCE(SUM(CASE WHEN allocation.budget_date=$1 OR allocation.status IN (${activeHoldStatuses}) THEN
            CASE WHEN allocation.status IN (${activeHoldStatuses}) THEN GREATEST(allocation.reserved_micros,allocation.settled_micros)
                 ELSE allocation.settled_micros END ELSE 0 END),0)::text AS global_day,
          COALESCE(SUM(CASE WHEN allocation.owner_user_id=$2 AND (allocation.budget_date=$1 OR allocation.status IN (${activeHoldStatuses})) THEN
            CASE WHEN allocation.status IN (${activeHoldStatuses}) THEN GREATEST(allocation.reserved_micros,allocation.settled_micros)
                 ELSE allocation.settled_micros END ELSE 0 END),0)::text AS account_day,
          COALESCE(SUM(CASE WHEN allocation.owner_user_id=$2 AND
            (allocation.created_at > $3::timestamptz - interval '168 hours' OR allocation.status IN (${activeHoldStatuses})) THEN
            CASE WHEN allocation.status IN (${activeHoldStatuses}) THEN GREATEST(allocation.reserved_micros,allocation.settled_micros)
                 ELSE allocation.settled_micros END ELSE 0 END),0)::text AS account_rolling,
          COALESCE(bool_or(allocation.settled_micros > allocation.reserved_micros
            AND reconciliation.allocation_id IS NULL),false) AS overrun
         FROM theme_budget_allocations allocation
         LEFT JOIN theme_budget_reconciliations reconciliation
           ON reconciliation.allocation_id=allocation.id`,
          [day, owner, now]
        )
      ).rows[0];
      if (usage.overrun)
        throw new ThemeBudgetError('overrun_anomaly', 'A cost overrun requires review');
      if (
        !within(usage.global_day, input.reservedCostMicros, input.limits.globalDailyMicros) ||
        !within(usage.account_day, input.reservedCostMicros, input.limits.accountDailyMicros) ||
        !within(
          usage.account_rolling,
          input.reservedCostMicros,
          input.limits.accountRolling168hMicros
        )
      )
        throw new ThemeBudgetError('budget_exhausted', 'A durable budget limit would be exceeded');

      if (input.candidateSlots > 0) {
        const consumed = await db.query(
          `UPDATE theme_preparation_jobs SET candidates_used=candidates_used+$2,updated_at=$3
           WHERE id=$1 AND candidates_used+$2 <= candidate_ceiling RETURNING id`,
          [input.jobId, input.candidateSlots, now]
        );
        if (!consumed.rowCount)
          throw new ThemeBudgetError('candidate_ceiling', 'Candidate ceiling would be exceeded');
      }
      const allocation = (
        await db.query<{ id: string }>(
          `INSERT INTO theme_budget_allocations
         (budget_date,job_id,owner_user_id,policy_fingerprint,status,reserved_micros,expires_at,created_at,updated_at)
         VALUES($1,$2,$3,$4,'reserved',$5,$6,$7,$7) RETURNING id`,
          [
            day,
            input.jobId,
            owner,
            input.policyFingerprint,
            input.reservedCostMicros,
            input.holdExpiresAt,
            now,
          ]
        )
      ).rows[0];
      const attempt = (
        await db.query<{ id: string }>(
          `INSERT INTO theme_job_attempts
         (job_id,allocation_id,sequence,operation,status,provider,model,provider_request_key,
          request_fingerprint,candidate_slots_consumed,reserved_cost_micros,dispatched_at,created_at)
         VALUES($1,$2,(SELECT COALESCE(MAX(sequence),0)+1 FROM theme_job_attempts WHERE job_id=$1),
                $3,'dispatched',$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id`,
          [
            input.jobId,
            allocation.id,
            input.operation,
            input.provider,
            input.model,
            input.dispatchKey,
            input.requestFingerprint,
            input.candidateSlots,
            input.reservedCostMicros,
            now,
          ]
        )
      ).rows[0];
      return {
        attemptId: attempt.id,
        allocationId: allocation.id,
        ownerUserId: owner,
        status: 'dispatched' as const,
        reservedCostMicros: input.reservedCostMicros,
        actualCostMicros: 0,
        overrun: false,
        replay: false,
      };
    });
  }

  async function settle(
    input: ThemeBudgetDispatch,
    outcome: ThemeBudgetOutcome
  ): Promise<ThemeBudgetRecord> {
    validate(input);
    validateOutcome(outcome);
    return lockedTransaction(pool, async (db) => {
      const prior = await db.query<AttemptRow>(`${attemptSql} FOR UPDATE OF a,b`, [
        input.dispatchKey,
      ]);
      const row = prior.rows[0];
      if (!row) throw new ThemeBudgetError('invalid_request', 'No durable dispatch exists');
      const current = replay(input, row);
      if (row.status === 'succeeded' || row.status === 'failed') {
        if (
          row.status !== outcome.status ||
          row.actual_cost_micros !== outcome.actualCostMicros ||
          row.input_tokens !== (outcome.inputTokens ?? null) ||
          row.output_tokens !== (outcome.outputTokens ?? null) ||
          (row.failure?.code ?? null) !== (outcome.failureCode ?? null)
        )
          throw new ThemeBudgetError(
            'dispatch_conflict',
            'Conflicting settlement for a completed dispatch'
          );
        return current;
      }
      const failure = outcome.failureCode ? { code: outcome.failureCode } : null;
      await db.query(
        `UPDATE theme_job_attempts SET status=$2,actual_cost_micros=$3,input_tokens=$4,
         output_tokens=$5,failure=$6,completed_at=clock_timestamp() WHERE id=$1`,
        [
          row.id,
          outcome.status,
          outcome.actualCostMicros,
          outcome.inputTokens ?? null,
          outcome.outputTokens ?? null,
          failure,
        ]
      );
      await db.query(
        `UPDATE theme_budget_allocations SET status=$2,settled_micros=$3,updated_at=clock_timestamp()
         WHERE id=$1`,
        [
          row.allocation_id,
          outcome.actualCostMicros > 0 ? 'settled' : 'released',
          outcome.actualCostMicros,
        ]
      );
      return {
        ...current,
        status: outcome.status,
        actualCostMicros: outcome.actualCostMicros,
        overrun: outcome.actualCostMicros > row.reserved_cost_micros,
        replay: false,
      };
    });
  }

  async function markUnknown(input: ThemeBudgetDispatch): Promise<ThemeBudgetRecord> {
    validate(input);
    return lockedTransaction(pool, async (db) => {
      const prior = await db.query<AttemptRow>(`${attemptSql} FOR UPDATE OF a,b`, [
        input.dispatchKey,
      ]);
      const row = prior.rows[0];
      if (!row) throw new ThemeBudgetError('invalid_request', 'No durable dispatch exists');
      const current = replay(input, row);
      if (row.status === 'unknown') return current;
      if (row.status !== 'dispatched')
        throw new ThemeBudgetError('dispatch_conflict', 'Completed dispatch cannot become unknown');
      await db.query("UPDATE theme_job_attempts SET status='unknown' WHERE id=$1", [row.id]);
      await db.query(
        "UPDATE theme_budget_allocations SET status='unknown',updated_at=clock_timestamp() WHERE id=$1",
        [row.allocation_id]
      );
      return { ...current, status: 'unknown', replay: false };
    });
  }

  async function dispatch<T>(
    input: ThemeBudgetDispatch,
    provider: () => Promise<{ outcome: ThemeBudgetOutcome; value: T }>
  ): Promise<{ record: ThemeBudgetRecord; value?: T }> {
    const reservation = await reserve(input);
    if (reservation.replay) return { record: reservation };
    // reserve() committed and released its connection before invoking provider.
    let response: { outcome: ThemeBudgetOutcome; value: T };
    try {
      response = await provider();
    } catch {
      await markUnknown(input);
      throw new ThemeBudgetError(
        'provider_outcome_unknown',
        'Provider outcome is unknown; the full reservation remains held'
      );
    }
    return { record: await settle(input, response.outcome), value: response.value };
  }

  return { reserve, settle, markUnknown, dispatch };
}
