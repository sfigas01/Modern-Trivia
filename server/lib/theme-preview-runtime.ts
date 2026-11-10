import type { Pool } from 'pg';

import {
  bootstrapThemePreviewScheduler,
  createPostgresThemePreviewRecoveryRepository,
  createThemePreviewPlannedWorker,
  type ThemePreviewLoadedPlan,
  type ThemePreviewSchedulerCode,
  type ThemePreviewSchedulerStart,
} from './theme-preview-scheduler';
import {
  createPostgresThemePreparationRuntime,
  type ThemeRuntimeCompositionContext,
  type ThemeRuntimeCompositionOptions,
} from './theme-runtime-composition';
import { readThemeRuntimeConfiguration } from './theme-runtime-config';
import { createThemeRuntimeControl } from './theme-runtime-control';
import { createThemeRuntimePlanRepository } from './theme-runtime-plan';
import type { createThemeRuntimePipeline } from './theme-runtime-pipeline';

type RuntimePipeline = ReturnType<typeof createThemeRuntimePipeline>;

export type ThemePreviewRuntimePipelineBuilder = (
  input: Readonly<{
    jobId: string;
    loadedPlan: ThemePreviewLoadedPlan;
    context: ThemeRuntimeCompositionContext;
  }>
) => RuntimePipeline;

export type PostgresThemePreviewRuntimeOptions = Readonly<{
  pool: Pool;
  env?: NodeJS.ProcessEnv;
  repositories:
    | ThemeRuntimeCompositionOptions['repositories']
    | ((loadedPlan: ThemePreviewLoadedPlan) => ThemeRuntimeCompositionOptions['repositories']);
  buildPipeline: ThemePreviewRuntimePipelineBuilder;
  /** Independently calculated worst-case duration of one pipeline callback. */
  pipelineMaxCallbackMs: number;
  reportCode?(code: ThemePreviewSchedulerCode): void;
  claimToken?: () => string;
  now?: () => Date;
  setInterval?: (callback: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
}>;

/**
 * Composes the durable preview scheduler with one plan-bound worker per job.
 *
 * The scheduler performs every static and database gate before this factory can
 * construct source-first repositories or provider callbacks. The caller still
 * injects the concrete pipeline/providers, so this boundary reads no credential
 * and performs no provider request by itself.
 */
export async function bootstrapPostgresThemePreviewRuntime(
  options: PostgresThemePreviewRuntimeOptions
): Promise<ThemePreviewSchedulerStart> {
  const env = options.env ?? process.env;
  const configuration = readThemeRuntimeConfiguration(env);
  const control = createThemeRuntimeControl(options.pool);
  const plans = createThemeRuntimePlanRepository(options.pool);

  return bootstrapThemePreviewScheduler({
    env,
    readRuntimeControl: () => control.read(),
    recoveryRepository: createPostgresThemePreviewRecoveryRepository(options.pool),
    createRuntime: ({ leaseDurationMs, shouldStop }) => {
      if (!configuration.enabled) throw new TypeError('invalid_theme_preview_runtime_config');
      return createThemePreviewPlannedWorker({
        maxCallbackMs: options.pipelineMaxCallbackMs,
        loadPlan: (jobId) => plans.load(jobId),
        createRuntime: ({ jobId, loadedPlan }) =>
          createPostgresThemePreparationRuntime({
            pool: options.pool,
            budget: configuration.budget,
            repositories:
              typeof options.repositories === 'function'
                ? options.repositories(loadedPlan)
                : options.repositories,
            buildPipeline: (context) => options.buildPipeline({ jobId, loadedPlan, context }),
            leaseDurationMs,
            shouldStop,
            claimToken: options.claimToken,
            now: options.now,
          }),
      });
    },
    reportCode: options.reportCode,
    setInterval: options.setInterval,
    clearInterval: options.clearInterval,
  });
}
