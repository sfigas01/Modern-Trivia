import pg from 'pg';

import {
  ThemeE1PlanPreparationError,
  createPostgresThemeE1PlanPreparationRepository,
  prepareThemeE1Plans,
} from '../server/lib/theme-e1-plan-preparation';
import { themeRuntimeBudgetConfigSchema } from '../server/lib/theme-runtime-config';

function values(name: string): string[] {
  return process.argv.flatMap((value, index) =>
    value === name && process.argv[index + 1] ? [process.argv[index + 1]] : []
  );
}

function validArguments(): boolean {
  const argumentsOnly = process.argv.slice(2);
  for (let index = 0; index < argumentsOnly.length; index++) {
    const value = argumentsOnly[index];
    if (value === '--apply') continue;
    if (value === '--job' && argumentsOnly[index + 1]) {
      index += 1;
      continue;
    }
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  if (!validArguments()) throw new ThemeE1PlanPreparationError('invalid_job_selection');
  if (process.env.THEME_EVALUATION_ENVIRONMENT !== 'preview')
    throw new ThemeE1PlanPreparationError('job_ineligible');
  const connectionString = process.env.THEME_EVALUATION_DATABASE_URL;
  if (!connectionString) throw new ThemeE1PlanPreparationError('job_ineligible');
  const budget = themeRuntimeBudgetConfigSchema.parse({
    currency: process.env.THEME_BUDGET_CURRENCY,
    policyVersion: process.env.THEME_BUDGET_POLICY_VERSION,
    accountDailyMicros: process.env.THEME_ACCOUNT_DAILY_BUDGET_MICROS,
    accountRollingSevenDayMicros: process.env.THEME_ACCOUNT_ROLLING_7D_BUDGET_MICROS,
    globalDailyMicros: process.env.THEME_GLOBAL_DAILY_BUDGET_MICROS,
  });
  const pool = new pg.Pool({ connectionString, max: 2 });
  try {
    const report = await prepareThemeE1Plans({
      repository: createPostgresThemeE1PlanPreparationRepository(pool),
      jobIds: values('--job'),
      budget,
      apply: process.argv.includes('--apply'),
    });
    console.log(JSON.stringify(report));
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(
    JSON.stringify({
      error:
        error instanceof ThemeE1PlanPreparationError
          ? error.code
          : error instanceof Error && error.name === 'ZodError'
            ? 'invalid_budget_configuration'
            : 'unexpected_failure',
    })
  );
  process.exitCode = 1;
}
