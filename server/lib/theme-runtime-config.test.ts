import { describe, expect, it } from 'vitest';

import {
  readThemeRuntimeConfiguration,
  themeRuntimeBudgetPolicyFingerprint,
} from './theme-runtime-config';

const complete = {
  VITE_THEME_ROUNDS: 'true',
  THEME_LIVE_GENERATION: 'true',
  THEME_BUDGET_CURRENCY: 'USD',
  THEME_BUDGET_POLICY_VERSION: 'pricing-v1',
  THEME_ACCOUNT_DAILY_BUDGET_MICROS: '100000',
  THEME_ACCOUNT_ROLLING_7D_BUDGET_MICROS: '300000',
  THEME_GLOBAL_DAILY_BUDGET_MICROS: '500000',
};

describe('theme runtime configuration', () => {
  it('stays disabled unless both feature flags are explicit', () => {
    expect(readThemeRuntimeConfiguration({ ...complete, THEME_LIVE_GENERATION: 'false' })).toEqual({
      enabled: false,
      reason: 'flags_disabled',
    });
    expect(readThemeRuntimeConfiguration({ ...complete, VITE_THEME_ROUNDS: undefined })).toEqual({
      enabled: false,
      reason: 'flags_disabled',
    });
  });

  it('fails closed when a cap or policy value is absent or invalid', () => {
    expect(
      readThemeRuntimeConfiguration({ ...complete, THEME_GLOBAL_DAILY_BUDGET_MICROS: undefined })
    ).toEqual({ enabled: false, reason: 'budget_configuration_missing' });
    expect(
      readThemeRuntimeConfiguration({ ...complete, THEME_ACCOUNT_DAILY_BUDGET_MICROS: '500001' })
    ).toEqual({ enabled: false, reason: 'budget_configuration_missing' });
    expect(
      readThemeRuntimeConfiguration({ ...complete, THEME_ACCOUNT_DAILY_BUDGET_MICROS: '1.5' })
    ).toEqual({ enabled: false, reason: 'budget_configuration_missing' });
  });

  it('returns only explicit safe integer limits', () => {
    const result = readThemeRuntimeConfiguration(complete);
    expect(result).toEqual({
      enabled: true,
      budget: {
        currency: 'USD',
        policyVersion: 'pricing-v1',
        accountDailyMicros: 100000,
        accountRollingSevenDayMicros: 300000,
        globalDailyMicros: 500000,
      },
    });
    if (result.enabled)
      expect(themeRuntimeBudgetPolicyFingerprint(result.budget)).toMatch(/^[a-f0-9]{64}$/);
  });
});
