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
  createThemeE1RepositoryConfig,
} from './theme-e1-preview-pipeline';
import { THEME_E1_BUNDLE_VERSION } from './theme-e1-provider-bundle';

/**
 * Quality + at most nine bounded embedding batches + four semantic reviews +
 * one repair/evidence pass, each with a 30-second provider timeout, plus margin.
 */
export const THEME_E1_MAX_PIPELINE_CALLBACK_MS = 540_000;

export type ThemeE1ApplicationRuntimeOptions = Readonly<{
  pool: Pool;
  env?: NodeJS.ProcessEnv;
  reportCode?(code: ThemePreviewSchedulerCode): void;
}>;

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
  return bootstrapOpenAIThemePreviewRuntime({
    pool: options.pool,
    env,
    repositories: (loadedPlan) => {
      const plan = themeLiveRuntimePlanV2Schema.parse(loadedPlan.plan);
      if (loadedPlan.planVersion !== THEME_E1_BUNDLE_VERSION)
        throw new TypeError('theme_e1_bundle_mismatch');
      if (plan.budgetPolicyFingerprint !== expectedBudgetPolicyFingerprint)
        throw new TypeError('theme_e1_budget_policy_mismatch');
      return createThemeE1RepositoryConfig(plan);
    },
    buildPipeline: createThemeE1PreviewPipelineBuilder({
      pool: options.pool,
      expectedBudgetPolicyFingerprint,
    }),
    pipelineMaxCallbackMs: THEME_E1_MAX_PIPELINE_CALLBACK_MS,
    reportCode: options.reportCode,
    createClient: () =>
      createThemeOpenAIClient({
        apiKey: env.AI_INTEGRATIONS_OPENAI_API_KEY ?? '',
        baseURL: env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      }),
  });
}
