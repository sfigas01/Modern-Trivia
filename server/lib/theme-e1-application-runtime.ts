import type { Pool } from 'pg';

import { themeLiveRuntimePlanV2Schema } from './theme-runtime-plan';
import {
  readThemeRuntimeConfiguration,
  themeRuntimeBudgetPolicyFingerprint,
} from './theme-runtime-config';
import {
  bootstrapOpenAIThemePreviewRuntime,
  createThemeOpenAIClient,
} from './theme-openai-preview-runtime';
import type { ThemePreviewSchedulerCode } from './theme-preview-scheduler';
import {
  createThemeE1PreviewPipelineBuilder,
  createThemeGameplayPreviewPipelineBuilder,
  createThemeE1RepositoryConfig,
} from './theme-e1-preview-pipeline';
import { THEME_E1_BUNDLE_VERSION } from './theme-e1-provider-bundle';
import { THEME_E1_MAX_PIPELINE_CALLBACK_MS, assertThemeE1PlanPolicy } from './theme-e1-plan-policy';
import {
  assertThemeGameplayPlanPolicy,
  createPostgresThemeGameplayPlanner,
  THEME_GAMEPLAY_PLAN_VERSION,
} from './theme-gameplay-plan';

export type ThemeE1ApplicationRuntimeOptions = Readonly<{
  pool: Pool;
  env?: NodeJS.ProcessEnv;
  reportCode?(code: ThemePreviewSchedulerCode): void;
}>;

/** The E1 calibration key is isolated from every existing AI-powered feature. */
export function readThemeE1ApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const apiKey = env.THEME_E1_OPENAI_API_KEY?.trim();
  if (!apiKey) throw new TypeError('theme_e1_api_key_missing');
  return apiKey;
}

/**
 * Application seam for Railway preview. All static scheduler and durable
 * runtime-control gates run before a plan-bound repository or OpenAI client can
 * be built. The credential is read only inside the scheduler's lazy client
 * callback, immediately before a gated job would construct its pipeline.
 */
export async function bootstrapThemeE1ApplicationRuntime(
  options: ThemeE1ApplicationRuntimeOptions
) {
  const env = options.env ?? process.env;
  const runtime = readThemeRuntimeConfiguration(env);
  const expectedBudgetPolicyFingerprint = runtime.enabled
    ? themeRuntimeBudgetPolicyFingerprint(runtime.budget)
    : 'disabled';
  const planner =
    env.RAILWAY_ENVIRONMENT_NAME === 'preview' &&
    env.THEME_LIVE_GENERATION === 'true' &&
    runtime.enabled
      ? createPostgresThemeGameplayPlanner(options.pool, {
          budgetPolicyFingerprint: expectedBudgetPolicyFingerprint,
        })
      : undefined;
  const preparePlan = planner
    ? async (jobId: string) => {
        const result = await options.pool.query<{ plan_version: string | null }>(
          'SELECT plan_version FROM theme_preparation_jobs WHERE id=$1',
          [jobId]
        );
        if (result.rows[0]?.plan_version === null) await planner.prepare(jobId);
      }
    : undefined;
  const scheduler = await bootstrapOpenAIThemePreviewRuntime({
    pool: options.pool,
    env,
    repositories: (loadedPlan) => {
      const parsed = themeLiveRuntimePlanV2Schema.parse(loadedPlan.plan);
      const plan =
        loadedPlan.planVersion === THEME_E1_BUNDLE_VERSION
          ? assertThemeE1PlanPolicy(parsed)
          : loadedPlan.planVersion === THEME_GAMEPLAY_PLAN_VERSION
            ? assertThemeGameplayPlanPolicy(parsed)
            : (() => {
                throw new TypeError('theme_runtime_bundle_mismatch');
              })();
      if (plan.budgetPolicyFingerprint !== expectedBudgetPolicyFingerprint)
        throw new TypeError('theme_e1_budget_policy_mismatch');
      return createThemeE1RepositoryConfig(plan);
    },
    buildPipeline: (input) =>
      (input.loadedPlan.planVersion === THEME_GAMEPLAY_PLAN_VERSION
        ? createThemeGameplayPreviewPipelineBuilder
        : createThemeE1PreviewPipelineBuilder)({
        pool: options.pool,
        expectedBudgetPolicyFingerprint,
      })(input),
    pipelineMaxCallbackMs: THEME_E1_MAX_PIPELINE_CALLBACK_MS,
    preparePlan,
    reportCode: options.reportCode,
    createClient: () =>
      createThemeOpenAIClient({
        apiKey: readThemeE1ApiKey(env),
        baseURL: env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      }),
  });
  return { ...scheduler, planner: preparePlan ? { prepare: preparePlan } : undefined };
}
