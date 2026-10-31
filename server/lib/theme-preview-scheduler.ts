import type { Pool } from 'pg';

import { readThemeRuntimeConfiguration } from './theme-runtime-config';

/**
 * Preview-only bootstrap for the durable themed preparation worker.
 *
 * This module deliberately knows nothing about providers, questions, themes, or
 * lease mutation. The worker is the authority for claiming and releasing jobs.
 */

export type ThemePreviewSchedulerCode =
  | 'scheduler_disabled'
  | 'scheduler_invalid_config'
  | 'runtime_control_disabled'
  | 'runtime_control_unavailable'
  | 'scheduler_queue_full'
  | 'scheduler_recovery_failed'
  | 'scheduler_worker_failed'
  | 'scheduler_start_failed';

export type ThemePreviewSchedulerStart =
  | Readonly<{ started: false; code: ThemePreviewSchedulerCode }>
  | Readonly<{
      started: true;
      run(jobId: string): Promise<void>;
      recover(): Promise<void>;
      stop(): Promise<void>;
    }>;

type PreviewWorker = Readonly<{
  /** Actual worst-case duration of one callback, including composite QA. */
  maxCallbackMs: number;
  run(jobId: string): Promise<unknown>;
}>;

export interface ThemePreviewRecoveryRepository {
  /** Return at most `limit` IDs in a stable order, without claiming their leases. */
  scanRecoverableJobIds(input: Readonly<{ limit: number }>): Promise<readonly string[]>;
}

const RECOVERABLE_JOB_STATUSES = [
  'queued',
  'waiting',
  'researching',
  'retrieving',
  'extracting',
  'writing',
  'reviewing',
  'qa',
  'semantic_check',
  'reserving',
] as const;
const TERMINAL_GAME_STATUSES = ['completed', 'failed', 'abandoned', 'expired'] as const;

/** Reads durable runnable jobs without claiming; worker leases remain authoritative. */
export function createPostgresThemePreviewRecoveryRepository(
  pool: Pick<Pool, 'query'>
): ThemePreviewRecoveryRepository {
  return Object.freeze({
    async scanRecoverableJobIds({ limit }: Readonly<{ limit: number }>) {
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SCAN_LIMIT)
        throw new TypeError('invalid_theme_preview_recovery_limit');
      const result = await pool.query<{ id: string }>(
        `SELECT job.id
           FROM theme_preparation_jobs job
           JOIN theme_game_sessions game ON game.id = job.game_id
          WHERE job.status = ANY($2::varchar[])
            AND game.status <> ALL($3::varchar[])
            AND game.expires_at > clock_timestamp()
            AND job.plan_json IS NOT NULL
            AND (job.last_failure IS NULL OR job.last_failure->>'retryable' = 'true')
            AND (job.lease_owner IS NULL OR job.lease_expires_at <= clock_timestamp())
          ORDER BY job.created_at, job.id
          LIMIT $1`,
        [limit, RECOVERABLE_JOB_STATUSES, TERMINAL_GAME_STATUSES]
      );
      return result.rows.map((row) => row.id);
    },
  });
}

export interface ThemePreviewSchedulerDependencies {
  env?: NodeJS.ProcessEnv;
  /** Durable database control check. This is called before createRuntime. */
  readRuntimeControl(): Promise<Readonly<{ enabled: boolean }>>;
  recoveryRepository: ThemePreviewRecoveryRepository;
  /** Construct the runtime only after both gates have passed. */
  createRuntime(
    config: Readonly<{ leaseDurationMs: number; maxCallbackMs: number; shouldStop: () => boolean }>
  ): PreviewWorker;
  reportCode?(code: ThemePreviewSchedulerCode): void;
  setInterval?: (callback: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
}

type SchedulerConfig = Readonly<{
  intervalMs: number;
  queueLimit: number;
  scanLimit: number;
  leaseDurationMs: number;
  maxCallbackMs: number;
}>;

const MAX_INTERVAL_MS = 60 * 60 * 1000;
const MAX_QUEUE_LIMIT = 500;
const MAX_SCAN_LIMIT = 500;

function positiveInteger(value: string | undefined, maximum: number): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : undefined;
}

function readConfig(env: NodeJS.ProcessEnv): SchedulerConfig | undefined {
  if (env.RAILWAY_ENVIRONMENT_NAME !== 'preview' || env.THEME_PREVIEW_SCHEDULER_ENABLED !== 'true')
    return undefined;

  const intervalMs = positiveInteger(env.THEME_PREVIEW_SCHEDULER_INTERVAL_MS, MAX_INTERVAL_MS);
  const queueLimit = positiveInteger(env.THEME_PREVIEW_SCHEDULER_QUEUE_LIMIT, MAX_QUEUE_LIMIT);
  const scanLimit = positiveInteger(env.THEME_PREVIEW_SCHEDULER_SCAN_LIMIT, MAX_SCAN_LIMIT);
  const leaseDurationMs = positiveInteger(env.THEME_PREVIEW_WORKER_LEASE_MS, MAX_INTERVAL_MS);
  const maxCallbackMs = positiveInteger(env.THEME_PREVIEW_MAX_CALLBACK_MS, MAX_INTERVAL_MS);
  if (
    !intervalMs ||
    !queueLimit ||
    !scanLimit ||
    !leaseDurationMs ||
    !maxCallbackMs ||
    leaseDurationMs <= maxCallbackMs
  )
    return undefined;
  return { intervalMs, queueLimit, scanLimit, leaseDurationMs, maxCallbackMs };
}

/**
 * Validates all static gates first, checks the durable kill switch, then builds
 * and starts one preview worker with serialized, bounded recovery dispatch.
 */
export async function bootstrapThemePreviewScheduler(
  dependencies: ThemePreviewSchedulerDependencies
): Promise<ThemePreviewSchedulerStart> {
  const reportCode = (code: ThemePreviewSchedulerCode): void => {
    try {
      dependencies.reportCode?.(code);
    } catch {
      // Reporting is best-effort and may never expose arbitrary thrown text.
    }
  };
  const env = dependencies.env ?? process.env;
  if (
    env.RAILWAY_ENVIRONMENT_NAME !== 'preview' ||
    env.THEME_PREVIEW_SCHEDULER_ENABLED !== 'true'
  ) {
    reportCode('scheduler_disabled');
    return { started: false, code: 'scheduler_disabled' };
  }

  const config = readConfig(env);
  if (!config || !readThemeRuntimeConfiguration(env).enabled) {
    reportCode('scheduler_invalid_config');
    return { started: false, code: 'scheduler_invalid_config' };
  }

  let control: Readonly<{ enabled: boolean }>;
  try {
    control = await dependencies.readRuntimeControl();
  } catch {
    reportCode('runtime_control_unavailable');
    return { started: false, code: 'runtime_control_unavailable' };
  }
  if (control.enabled !== true) {
    reportCode('runtime_control_disabled');
    return { started: false, code: 'runtime_control_disabled' };
  }

  let stopping = false;
  let stopped = false;

  // Do not construct provider/runtime composition until the durable control is on.
  let worker: PreviewWorker;
  try {
    worker = dependencies.createRuntime({
      leaseDurationMs: config.leaseDurationMs,
      maxCallbackMs: config.maxCallbackMs,
      shouldStop: () => stopping || stopped,
    });
    if (
      !Number.isInteger(worker.maxCallbackMs) ||
      worker.maxCallbackMs < 1 ||
      worker.maxCallbackMs > config.maxCallbackMs ||
      worker.maxCallbackMs >= config.leaseDurationMs
    )
      throw new TypeError('invalid_theme_preview_worker_deadline');
  } catch {
    reportCode('scheduler_start_failed');
    return { started: false, code: 'scheduler_start_failed' };
  }
  const pending: string[] = [];
  const known = new Set<string>();
  let active = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pumpPromise: Promise<void> | undefined;
  let recoveryPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  const startInterval = dependencies.setInterval ?? setInterval;
  const cancelInterval = dependencies.clearInterval ?? clearInterval;

  const checkControl = async (): Promise<'enabled' | 'disabled' | 'unavailable'> => {
    try {
      return (await dependencies.readRuntimeControl()).enabled === true ? 'enabled' : 'disabled';
    } catch {
      reportCode('runtime_control_unavailable');
      return 'unavailable';
    }
  };

  const pump = (): Promise<void> => {
    if (pumpPromise) return pumpPromise;
    active = true;
    pumpPromise = (async () => {
      while (pending.length > 0) {
        const jobId = pending.shift()!;
        try {
          const control = await checkControl();
          if (control !== 'enabled') {
            if (control === 'disabled') reportCode('runtime_control_disabled');
            continue;
          }
          if (stopping || stopped) continue;
          await worker.run(jobId);
        } catch {
          reportCode('scheduler_worker_failed');
        } finally {
          known.delete(jobId);
        }
      }
    })().finally(() => {
      active = false;
      pumpPromise = undefined;
      // A synchronous enqueue may have arrived as the prior pump was closing.
      if (pending.length > 0) void pump();
    });
    return pumpPromise;
  };

  const enqueue = (jobId: string): boolean => {
    if (stopping || stopped || typeof jobId !== 'string' || jobId.length === 0) return false;
    if (known.has(jobId)) return true;
    if (pending.length + (active ? 1 : 0) >= config.queueLimit) {
      reportCode('scheduler_queue_full');
      return false;
    }
    known.add(jobId);
    pending.push(jobId);
    void pump();
    return true;
  };

  const recover = (): Promise<void> => {
    if (stopping || stopped) return Promise.resolve();
    if (recoveryPromise) return recoveryPromise;
    recoveryPromise = (async () => {
      try {
        const control = await checkControl();
        if (control !== 'enabled') {
          if (control === 'disabled') reportCode('runtime_control_disabled');
          return;
        }
        const scanned = await dependencies.recoveryRepository.scanRecoverableJobIds({
          limit: config.scanLimit,
        });
        if (stopping || stopped) return;
        // Sorting and deduplication make scheduling stable even if an injected
        // repository returns ties or repeats. Never accept more than scanLimit.
        const ids = Array.from(
          new Set(scanned.filter((id) => typeof id === 'string' && id.length > 0))
        )
          .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
          .slice(0, config.scanLimit);
        for (const jobId of ids) enqueue(jobId);
      } catch {
        reportCode('scheduler_recovery_failed');
      }
    })().finally(() => {
      recoveryPromise = undefined;
    });
    return recoveryPromise;
  };

  const run = async (jobId: string): Promise<void> => {
    if (stopping || stopped) return;
    const control = await checkControl();
    if (control !== 'enabled') {
      if (control === 'disabled') reportCode('runtime_control_disabled');
      return;
    }
    enqueue(jobId);
  };

  try {
    timer = startInterval(() => {
      if (stopping || stopped) return;
      void recover();
    }, config.intervalMs);
  } catch {
    reportCode('scheduler_start_failed');
    return { started: false, code: 'scheduler_start_failed' };
  }

  // Startup recovery uses the same bounded scan and queue as periodic recovery.
  await recover();

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopping = true;
    if (timer !== undefined) {
      try {
        cancelInterval(timer);
      } catch {
        reportCode('scheduler_start_failed');
      }
    }
    timer = undefined;
    stopPromise = (async () => {
      // Recovery already in progress checks the stopping flag before enqueueing.
      // Drop queued work so shutdown cannot begin another paid callback; the
      // durable scan will recover it in the next process.
      for (const jobId of pending) known.delete(jobId);
      pending.length = 0;
      if (recoveryPromise) await recoveryPromise;
      while (pumpPromise) await pumpPromise;
      stopped = true;
    })();
    return stopPromise;
  };

  return { started: true, run, recover, stop };
}
