import { describe, expect, it, vi } from 'vitest';

import {
  bootstrapThemePreviewScheduler,
  createPostgresThemePreviewRecoveryRepository,
  createThemePreviewPlannedWorker,
  type ThemePreviewSchedulerDependencies,
} from './theme-preview-scheduler';

const previewEnv = {
  NODE_ENV: 'production',
  RAILWAY_ENVIRONMENT_NAME: 'preview',
  THEME_PREVIEW_SCHEDULER_ENABLED: 'true',
  THEME_PREVIEW_SCHEDULER_INTERVAL_MS: '1000',
  THEME_PREVIEW_SCHEDULER_QUEUE_LIMIT: '4',
  THEME_PREVIEW_SCHEDULER_SCAN_LIMIT: '4',
  THEME_PREVIEW_WORKER_LEASE_MS: '180000',
  THEME_PREVIEW_MAX_CALLBACK_MS: '120000',
  VITE_THEME_ROUNDS: 'true',
  THEME_LIVE_GENERATION: 'true',
  THEME_BUDGET_CURRENCY: 'USD',
  THEME_BUDGET_POLICY_VERSION: 'test-v1',
  THEME_ACCOUNT_DAILY_BUDGET_MICROS: '1000',
  THEME_ACCOUNT_ROLLING_7D_BUDGET_MICROS: '2000',
  THEME_GLOBAL_DAILY_BUDGET_MICROS: '3000',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function dependencies(
  overrides: Partial<ThemePreviewSchedulerDependencies> = {}
): ThemePreviewSchedulerDependencies {
  return {
    env: previewEnv,
    readRuntimeControl: async () => ({ enabled: true }),
    recoveryRepository: { scanRecoverableJobIds: async () => [] },
    createRuntime: ({ maxCallbackMs }) => ({ maxCallbackMs, run: async () => undefined }),
    ...overrides,
  };
}

describe('planned preview worker', () => {
  it('loads and binds each recovered job to its own immutable plan', async () => {
    const loadedPlan = {
      planVersion: 'plan-v1',
      planHash: 'a'.repeat(64),
      holdUntil: new Date('2026-11-01T00:00:00Z'),
      plan: { contractVersion: 'theme-preview-runtime-plan-v1', mode: 'offline_fixture' },
    } as never;
    const loadPlan = vi.fn(async () => loadedPlan);
    const run = vi.fn(async () => 'ready');
    const createRuntime = vi.fn(() => ({ run }));
    const worker = createThemePreviewPlannedWorker({
      maxCallbackMs: 120_000,
      loadPlan,
      createRuntime,
    });

    await expect(worker.run('job-a')).resolves.toBe('ready');
    expect(loadPlan).toHaveBeenCalledWith('job-a');
    expect(createRuntime).toHaveBeenCalledWith({ jobId: 'job-a', loadedPlan });
    expect(run).toHaveBeenCalledWith('job-a');
  });
});

describe('theme preview scheduler bootstrap', () => {
  it('scans only durable runnable preview jobs in stable order', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'job-a' }, { id: 'job-b' }] }));
    const repository = createPostgresThemePreviewRecoveryRepository({ query } as never);
    await expect(repository.scanRecoverableJobIds({ limit: 4 })).resolves.toEqual([
      'job-a',
      'job-b',
    ]);
    const [sql, parameters] = query.mock.calls[0];
    expect(sql).toContain("job.last_failure->>'retryable' = 'true'");
    expect(sql).toContain('job.lease_expires_at <= clock_timestamp()');
    expect(sql).toContain('job.plan_json IS NOT NULL');
    expect(sql).toContain('ORDER BY job.created_at, job.id');
    expect(parameters[0]).toBe(4);
    await expect(repository.scanRecoverableJobIds({ limit: 0 })).rejects.toThrow(
      'invalid_theme_preview_recovery_limit'
    );
  });

  it('fails closed for production, missing preview gate, and invalid limits before runtime construction', async () => {
    const createRuntime = vi.fn(({ maxCallbackMs }: { maxCallbackMs: number }) => ({
      maxCallbackMs,
      run: async () => undefined,
    }));
    const readRuntimeControl = vi.fn(async () => ({ enabled: true }));
    const setInterval = vi.fn(() => 1 as unknown as ReturnType<typeof globalThis.setInterval>);
    const base = dependencies({ createRuntime, readRuntimeControl, setInterval });

    const production = await bootstrapThemePreviewScheduler({
      ...base,
      env: { ...previewEnv, RAILWAY_ENVIRONMENT_NAME: 'production' },
    });
    const unset = await bootstrapThemePreviewScheduler({
      ...base,
      env: { ...previewEnv, RAILWAY_ENVIRONMENT_NAME: undefined },
    });
    const invalid = await bootstrapThemePreviewScheduler({
      ...base,
      env: { ...previewEnv, THEME_PREVIEW_SCHEDULER_QUEUE_LIMIT: '0' },
    });

    expect(production).toMatchObject({ started: false, code: 'scheduler_disabled' });
    expect(unset).toMatchObject({ started: false, code: 'scheduler_disabled' });
    expect(invalid).toMatchObject({ started: false, code: 'scheduler_invalid_config' });
    expect(readRuntimeControl).not.toHaveBeenCalled();
    expect(createRuntime).not.toHaveBeenCalled();
    expect(setInterval).not.toHaveBeenCalled();
  });

  it('accepts Railway preview with NODE_ENV production and rejects unsafe lease bounds', async () => {
    const createRuntime = vi.fn(({ maxCallbackMs }: { maxCallbackMs: number }) => ({
      maxCallbackMs,
      run: async () => undefined,
    }));
    const valid = await bootstrapThemePreviewScheduler(dependencies({ createRuntime }));
    expect(valid.started).toBe(true);
    expect(createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ leaseDurationMs: 180000, maxCallbackMs: 120000 })
    );
    if (valid.started) await valid.stop();

    const invalid = await bootstrapThemePreviewScheduler({
      ...dependencies({ createRuntime }),
      env: {
        ...previewEnv,
        THEME_PREVIEW_WORKER_LEASE_MS: '120000',
        THEME_PREVIEW_MAX_CALLBACK_MS: '120000',
      },
    });
    expect(invalid).toMatchObject({ started: false, code: 'scheduler_invalid_config' });

    const overstated = await bootstrapThemePreviewScheduler(
      dependencies({
        createRuntime: () => ({ maxCallbackMs: 120001, run: async () => undefined }),
      })
    );
    expect(overstated).toMatchObject({ started: false, code: 'scheduler_start_failed' });
  });

  it('checks the database control before constructing the runtime or starting a timer', async () => {
    const calls: string[] = [];
    const result = await bootstrapThemePreviewScheduler(
      dependencies({
        readRuntimeControl: async () => {
          calls.push('control');
          return { enabled: false };
        },
        createRuntime: () => {
          calls.push('runtime');
          return { maxCallbackMs: 120000, run: async () => undefined };
        },
        setInterval: () => {
          calls.push('timer');
          return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
        },
      })
    );

    expect(result).toMatchObject({ started: false, code: 'runtime_control_disabled' });
    expect(calls).toEqual(['control']);
  });

  it('returns only a stable code when runtime construction fails', async () => {
    const setInterval = vi.fn(() => 1 as unknown as ReturnType<typeof globalThis.setInterval>);
    const reports: string[] = [];
    const result = await bootstrapThemePreviewScheduler(
      dependencies({
        createRuntime: () => {
          throw new Error('sensitive provider or theme detail');
        },
        reportCode: (code) => reports.push(code),
        setInterval,
      })
    );

    expect(result).toEqual({ started: false, code: 'scheduler_start_failed' });
    expect(reports).toEqual(['scheduler_start_failed']);
    expect(setInterval).not.toHaveBeenCalled();
  });

  it('serializes worker runs, coalesces duplicates, bounds recovery and drops queued work on stop', async () => {
    let active = 0;
    let maxActive = 0;
    const started: string[] = [];
    const finished: string[] = [];
    const firstRun = deferred<void>();
    const reports: string[] = [];
    let scannedLimit = 0;
    let timerCallback: (() => void) | undefined;
    let timerCleared = false;

    const result = await bootstrapThemePreviewScheduler(
      dependencies({
        env: { ...previewEnv, THEME_PREVIEW_SCHEDULER_QUEUE_LIMIT: '2' },
        recoveryRepository: {
          scanRecoverableJobIds: async ({ limit }) => {
            scannedLimit = limit;
            return ['job-b', 'job-a', 'job-a', 'job-c'];
          },
        },
        createRuntime: () => ({
          maxCallbackMs: 120000,
          run: async (jobId) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            started.push(jobId);
            if (jobId === 'job-a') await firstRun.promise;
            finished.push(jobId);
            active -= 1;
          },
        }),
        reportCode: (code) => reports.push(code),
        setInterval: (callback) => {
          timerCallback = callback;
          return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
        },
        clearInterval: () => {
          timerCleared = true;
        },
      })
    );

    expect(result.started).toBe(true);
    if (!result.started) return;
    expect(scannedLimit).toBe(4);
    expect(started).toEqual(['job-a']);
    await result.run('job-a');
    await result.run('job-c');
    expect(reports).toContain('scheduler_queue_full');

    const stopping = result.stop();
    timerCallback?.();
    expect(timerCleared).toBe(true);
    firstRun.resolve();
    await stopping;

    expect(started).toEqual(['job-a']);
    expect(finished).toEqual(['job-a']);
    expect(maxActive).toBe(1);
    await result.run('job-d');
  });

  it('rechecks database control before a queued job actually starts', async () => {
    let enabled = true;
    const first = deferred<void>();
    const disabledReported = deferred<void>();
    const started: string[] = [];
    const reports: string[] = [];
    const result = await bootstrapThemePreviewScheduler(
      dependencies({
        readRuntimeControl: async () => ({ enabled }),
        recoveryRepository: { scanRecoverableJobIds: async () => ['job-a', 'job-b'] },
        createRuntime: () => ({
          maxCallbackMs: 120000,
          run: async (jobId) => {
            started.push(jobId);
            if (jobId === 'job-a') await first.promise;
          },
        }),
        reportCode: (code) => {
          reports.push(code);
          if (code === 'runtime_control_disabled') disabledReported.resolve();
        },
      })
    );
    expect(result.started).toBe(true);
    if (!result.started) return;
    expect(started).toEqual(['job-a']);
    enabled = false;
    first.resolve();
    await disabledReported.promise;
    await result.stop();
    expect(started).toEqual(['job-a']);
    expect(reports).toContain('runtime_control_disabled');
  });

  it('does not enqueue results from a recovery scan that finishes after stop begins', async () => {
    const scan = deferred<readonly string[]>();
    let scans = 0;
    let timerCallback: (() => void) | undefined;
    const run = vi.fn(async () => undefined);
    const result = await bootstrapThemePreviewScheduler(
      dependencies({
        recoveryRepository: {
          scanRecoverableJobIds: async () => {
            scans += 1;
            return scans === 1 ? [] : scan.promise;
          },
        },
        createRuntime: () => ({ maxCallbackMs: 120000, run }),
        setInterval: (callback) => {
          timerCallback = callback;
          return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
        },
      })
    );

    expect(result.started).toBe(true);
    if (!result.started) return;
    timerCallback?.();
    const stopping = result.stop();
    scan.resolve(['late-job']);
    await stopping;
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
  });
});
