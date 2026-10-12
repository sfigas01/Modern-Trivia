import { z } from 'zod';
import { createHash } from 'node:crypto';

const positiveMicros = z.coerce.number().int().positive().safe();

export const themeRuntimeBudgetConfigSchema = z
  .object({
    currency: z.literal('USD'),
    policyVersion: z.string().trim().min(1).max(255),
    accountDailyMicros: positiveMicros,
    accountRollingSevenDayMicros: positiveMicros,
    globalDailyMicros: positiveMicros,
  })
  .strict()
  .superRefine((config, context) => {
    if (config.accountDailyMicros > config.accountRollingSevenDayMicros) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accountDailyMicros'],
        message: 'The account daily cap cannot exceed the rolling seven-day cap',
      });
    }
    if (config.accountDailyMicros > config.globalDailyMicros) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accountDailyMicros'],
        message: 'The account daily cap cannot exceed the global daily cap',
      });
    }
  });

export type ThemeRuntimeBudgetConfig = z.infer<typeof themeRuntimeBudgetConfigSchema>;

export function themeRuntimeBudgetPolicyFingerprint(config: ThemeRuntimeBudgetConfig): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        config.policyVersion,
        config.currency,
        config.accountDailyMicros,
        config.accountRollingSevenDayMicros,
        config.globalDailyMicros,
      ])
    )
    .digest('hex');
}

export type ThemeRuntimeConfiguration =
  | Readonly<{ enabled: false; reason: 'flags_disabled' | 'budget_configuration_missing' }>
  | Readonly<{ enabled: true; budget: ThemeRuntimeBudgetConfig }>;

/**
 * Paid themed work is fail-closed. There are deliberately no default prices or
 * limits: the owner must configure measured caps before a provider can run.
 */
export function readThemeRuntimeConfiguration(
  env: NodeJS.ProcessEnv = process.env
): ThemeRuntimeConfiguration {
  if (env.VITE_THEME_ROUNDS !== 'true' || env.THEME_LIVE_GENERATION !== 'true') {
    return { enabled: false, reason: 'flags_disabled' };
  }

  const parsed = themeRuntimeBudgetConfigSchema.safeParse({
    currency: env.THEME_BUDGET_CURRENCY,
    policyVersion: env.THEME_BUDGET_POLICY_VERSION,
    accountDailyMicros: env.THEME_ACCOUNT_DAILY_BUDGET_MICROS,
    accountRollingSevenDayMicros: env.THEME_ACCOUNT_ROLLING_7D_BUDGET_MICROS,
    globalDailyMicros: env.THEME_GLOBAL_DAILY_BUDGET_MICROS,
  });
  return parsed.success
    ? { enabled: true, budget: parsed.data }
    : { enabled: false, reason: 'budget_configuration_missing' };
}
