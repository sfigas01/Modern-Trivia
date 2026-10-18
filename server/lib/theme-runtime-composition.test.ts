import { describe, expect, it, vi } from 'vitest';

import {
  createBudgetedThemeProvider,
  type ThemeBudgetedProviderRequest,
} from './theme-runtime-composition';
import { ThemeBudgetError, createThemeBudgetGateway } from './theme-budget';

const JOB = '00000000-0000-4000-8000-000000000001';
const HOLD = new Date('2026-10-13T00:00:00Z');
const budget = {
  currency: 'USD' as const,
  policyVersion: 'test-v1',
  accountDailyMicros: 10_000,
  accountRollingSevenDayMicros: 50_000,
  globalDailyMicros: 100_000,
};
const discardProviderMetadata = vi.fn(async () => undefined);

function request(
  invoke = vi.fn(async () => ({
    outcome: { status: 'succeeded' as const, actualCostMicros: 75 },
    value: { answer: 42 },
  }))
): ThemeBudgetedProviderRequest<{ answer: number }> {
  return {
    jobId: JOB,
    claimToken: 'claim',
    stableKey: 'item-1:writer-v1',
    operation: 'generate',
    provider: 'offline-provider',
    model: 'fixture-model',
    request: { prompt: 'write one question', temperature: 0 },
    reservedCostMicros: 100,
    candidateSlots: 1,
    holdExpiresAt: HOLD,
    invoke,
  };
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: 'attempt',
    allocationId: 'allocation',
    ownerUserId: 'owner',
    status: 'succeeded' as const,
    reservedCostMicros: 100,
    actualCostMicros: 75,
    overrun: false,
    replay: false,
    ...overrides,
  };
}

describe('theme runtime composition', () => {
  it('binds a stable request identity and explicit limits around one provider call', async () => {
    const dispatch = vi.fn(async (_input, invoke) => ({
      record: record(),
      value: (await invoke()).value,
    }));
    const gateway = { dispatch } as unknown as ReturnType<typeof createThemeBudgetGateway>;
    const input = request();

    await expect(
      createBudgetedThemeProvider(gateway, budget, discardProviderMetadata)(input)
    ).resolves.toEqual({
      answer: 42,
    });
    expect(input.invoke).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
    const durable = dispatch.mock.calls[0][0];
    expect(durable).toMatchObject({
      jobId: JOB,
      claimToken: 'claim',
      operation: 'generate',
      provider: 'offline-provider',
      model: 'fixture-model',
      reservedCostMicros: 100,
      candidateSlots: 1,
      limits: {
        accountDailyMicros: 10_000,
        accountRolling168hMicros: 50_000,
        globalDailyMicros: 100_000,
      },
      holdExpiresAt: HOLD,
    });
    expect(durable.dispatchKey).toMatch(new RegExp(`^theme:${JOB}:generate:[a-f0-9]{32}$`));
    expect(durable.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(durable.policyFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('forwards settled provider metadata to the required recorder seam', async () => {
    const metadata = {
      providerRequestId: 'resp_123',
      returnedModel: 'fixture-model-2026-10-01',
      latencyMs: 12,
    };
    const dispatch = vi.fn(async (_input, invoke) => ({
      record: record(),
      value: (await invoke()).value,
      metadata,
    }));
    const gateway = { dispatch } as unknown as ReturnType<typeof createThemeBudgetGateway>;
    const recorder = vi.fn(async () => undefined);

    await createBudgetedThemeProvider(gateway, budget, recorder)(request());

    expect(recorder).toHaveBeenCalledOnce();
    expect(recorder).toHaveBeenCalledWith(record(), metadata);
  });

  it('fails closed when a durable budget replay reaches the provider boundary', async () => {
    const invoke = vi.fn();
    const gateway = {
      dispatch: vi.fn(async () => ({ record: record({ replay: true }), value: undefined })),
    } as unknown as ReturnType<typeof createThemeBudgetGateway>;

    await expect(
      createBudgetedThemeProvider(gateway, budget, discardProviderMetadata)(request(invoke))
    ).rejects.toMatchObject({ code: 'provider_outcome_unknown', retryable: false });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not call a provider after budget or candidate admission is denied', async () => {
    for (const code of ['budget_exhausted', 'candidate_ceiling'] as const) {
      const invoke = vi.fn();
      const gateway = {
        dispatch: vi.fn(async () => {
          throw new ThemeBudgetError(code, code);
        }),
      } as unknown as ReturnType<typeof createThemeBudgetGateway>;

      await expect(
        createBudgetedThemeProvider(gateway, budget, discardProviderMetadata)(request(invoke))
      ).rejects.toMatchObject({ code });
      expect(invoke).not.toHaveBeenCalled();
    }
  });

  it.each(['runtime_disabled', 'runtime_unavailable'] as const)(
    'maps %s to a terminal unavailable worker result',
    async (code) => {
      const invoke = vi.fn();
      const gateway = {
        dispatch: vi.fn(async () => {
          throw new ThemeBudgetError(code, code);
        }),
      } as unknown as ReturnType<typeof createThemeBudgetGateway>;

      await expect(
        createBudgetedThemeProvider(gateway, budget, discardProviderMetadata)(request(invoke))
      ).rejects.toMatchObject({ code: 'runtime_unavailable', retryable: false });
      expect(invoke).not.toHaveBeenCalled();
    }
  );

  it('turns an ambiguous physical dispatch into a non-retryable worker pause', async () => {
    const gateway = {
      dispatch: vi.fn(async () => {
        throw new ThemeBudgetError('provider_outcome_unknown', 'unknown');
      }),
    } as unknown as ReturnType<typeof createThemeBudgetGateway>;

    await expect(
      createBudgetedThemeProvider(gateway, budget, discardProviderMetadata)(request())
    ).rejects.toMatchObject({ code: 'provider_outcome_unknown', retryable: false });
  });

  it('treats a settled provider failure as terminal for its durable attempt', async () => {
    const gateway = {
      dispatch: vi.fn(async () => ({
        record: record({ status: 'failed', actualCostMicros: 0 }),
        value: { answer: 42 },
      })),
    } as unknown as ReturnType<typeof createThemeBudgetGateway>;

    await expect(
      createBudgetedThemeProvider(gateway, budget, discardProviderMetadata)(request())
    ).rejects.toMatchObject({ code: 'preparation_failed', retryable: false });
  });

  it('does not relabel a settled failure with no provider value as unknown', async () => {
    const gateway = {
      dispatch: vi.fn(async () => ({
        record: record({ status: 'failed', actualCostMicros: 25 }),
        value: undefined,
      })),
    } as unknown as ReturnType<typeof createThemeBudgetGateway>;

    await expect(
      createBudgetedThemeProvider(gateway, budget, discardProviderMetadata)(request())
    ).rejects.toMatchObject({ code: 'preparation_failed', retryable: false });
  });
});
