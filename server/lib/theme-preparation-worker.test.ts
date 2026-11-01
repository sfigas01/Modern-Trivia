import { describe, expect, it, vi } from 'vitest';

import type { ThemeJobRecord, ThemeLifecycleRepository } from './theme-lifecycle';
import {
  createThemePreparationWorker,
  ThemePreparationWorkerError,
  type ThemePreparationWorkerDependencies,
} from './theme-preparation-worker';

const JOB_ID = '00000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-11T16:00:00.000Z');

function job(status: ThemeJobRecord['status'] = 'waiting'): ThemeJobRecord {
  return {
    id: JOB_ID,
    contractVersion: 'theme-reliability-v1',
    gameId: '00000000-0000-4000-8000-000000000002',
    stableKey: 'theme-game:test:prepare-v1',
    status,
    publicStage: status === 'waiting' ? 'paused' : 'waiting',
    candidateCeiling: 50,
    candidatesUsed: 0,
    readyCount: 0,
    themedReadyCount: 0,
    relatedReadyCount: 0,
    lastFailure: null,
    leaseOwner: 'claim',
    leaseExpiresAt: new Date(NOW.getTime() + 60_000),
    startedAt: NOW,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function harness(
  overrides: Partial<ThemePreparationWorkerDependencies> = {},
  initialStatus: ThemeJobRecord['status'] = 'waiting'
) {
  let current = job(initialStatus);
  const transitions: string[] = [];
  const lifecycle: ThemeLifecycleRepository = {
    createGameWithRosterAndJob: vi.fn(),
    getGame: vi.fn(),
    getJob: vi.fn(async () => current),
    isGameAvailable: vi.fn(async () => true),
    acquireLease: vi.fn(async () => current),
    renewLease: vi.fn(async () => current),
    releaseLease: vi.fn(async () => ({ ...current, leaseOwner: null, leaseExpiresAt: null })),
    transitionJob: vi.fn(async (input) => {
      if (current.status !== input.expectedStatus) return null;
      transitions.push(input.status);
      current = { ...current, status: input.status, publicStage: input.publicStage };
      return current;
    }),
    terminalizeJob: vi.fn(),
  };
  const calls: string[] = [];
  const dependencies: ThemePreparationWorkerDependencies = {
    lifecycle,
    preflight: vi.fn(async () => ({
      ok: true as const,
      requiredThemed: 1,
      work: [{ key: 'fact-1' }],
    })),
    research: vi.fn(async (stageJob, work) => {
      calls.push(`research:${stageJob.status}:${work.map((item) => item.key).join(',')}`);
    }),
    retrieve: vi.fn(async (stageJob, work) => {
      calls.push(`retrieve:${stageJob.status}:${work.map((item) => item.key).join(',')}`);
    }),
    extract: vi.fn(async (stageJob, work) => {
      calls.push(`extract:${stageJob.status}:${work.map((item) => item.key).join(',')}`);
    }),
    generate: vi.fn(async (_job, item) => {
      calls.push(`generate:${item.key}`);
      return { itemKey: item.key, candidateId: 'candidate-1' };
    }),
    review: vi.fn(async (_job, candidate) => {
      calls.push(`review:${candidate.candidateId}`);
      return { ...candidate, verdict: 'pass' as const };
    }),
    approve: vi.fn(async (_job, candidate) => {
      calls.push(`approve:${candidate.candidateId}`);
      return {
        status: 'approved' as const,
        approval: { ...candidate, questionId: 'question-1' },
      };
    }),
    assertDispatchesSettled: vi.fn(async () => undefined),
    reserveApproved: vi.fn(async (_job, approved) => {
      calls.push(`reserve:${approved.length}`);
      return { ready: true };
    }),
    recordPause: vi.fn(async (input) => {
      if (current.status !== input.expectedStatus) return false;
      current = {
        ...current,
        lastFailure: {
          code: 'generation_failed',
          message: input.code,
          retryable: input.retryable,
        },
      };
      return true;
    }),
    now: () => NOW,
    claimToken: () => 'claim',
    ...overrides,
  };
  return {
    worker: createThemePreparationWorker(dependencies),
    dependencies,
    lifecycle,
    transitions,
    calls,
  };
}

describe('theme preparation worker', () => {
  it('runs the existing source-first stages in order and stops at ready', async () => {
    const h = harness();
    await expect(h.worker.run(JOB_ID)).resolves.toEqual({
      status: 'ready',
      jobId: JOB_ID,
      approved: 1,
    });
    expect(h.calls).toEqual([
      'research:researching:fact-1',
      'retrieve:retrieving:fact-1',
      'extract:extracting:fact-1',
      'generate:fact-1',
      'review:candidate-1',
      'approve:candidate-1',
      'reserve:1',
    ]);
    expect(h.transitions).toEqual([
      'researching',
      'retrieving',
      'extracting',
      'writing',
      'reviewing',
      'qa',
      'semantic_check',
      'reserving',
      'ready',
    ]);
  });

  it('makes no paid-stage call when backups or runtime policy fail preflight', async () => {
    const h = harness({
      preflight: vi.fn(async () => ({ ok: false, code: 'inventory_shortfall' })),
    });
    await expect(h.worker.run(JOB_ID)).resolves.toEqual({
      status: 'paused',
      jobId: JOB_ID,
      code: 'inventory_shortfall',
    });
    expect(h.dependencies.research).not.toHaveBeenCalled();
    expect(h.dependencies.retrieve).not.toHaveBeenCalled();
    expect(h.dependencies.extract).not.toHaveBeenCalled();
    expect(h.dependencies.generate).not.toHaveBeenCalled();
    expect(h.dependencies.recordPause).toHaveBeenCalledWith({
      jobId: JOB_ID,
      claimToken: 'claim',
      expectedStatus: 'waiting',
      code: 'inventory_shortfall',
      retryable: false,
    });
    expect(h.transitions).toContain('failed');
  });

  it('runs each source callback after its stage transition with immutable preflight work', async () => {
    const events: string[] = [];
    const h = harness({
      assertDispatchesSettled: vi.fn(async () => {
        events.push('settled');
      }),
      research: vi.fn(async (stageJob) => {
        events.push(stageJob.status);
      }),
      retrieve: vi.fn(async (stageJob) => {
        events.push(stageJob.status);
      }),
      extract: vi.fn(async (stageJob) => {
        events.push(stageJob.status);
      }),
    });
    await h.worker.run(JOB_ID);

    for (const [index, [callback, status]] of [
      [h.dependencies.research, 'researching'],
      [h.dependencies.retrieve, 'retrieving'],
      [h.dependencies.extract, 'extracting'],
    ].entries()) {
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ status }), [
        { key: 'fact-1' },
      ]);
      const work = vi.mocked(callback).mock.calls[0][1];
      expect(Object.isFrozen(work)).toBe(true);
      expect(Object.isFrozen(work[0])).toBe(true);
      expect(h.lifecycle.renewLease.mock.invocationCallOrder[index]).toBeLessThan(
        vi.mocked(callback).mock.invocationCallOrder[0]
      );
    }
    expect(events.slice(0, 7)).toEqual([
      'settled',
      'researching',
      'settled',
      'retrieving',
      'settled',
      'extracting',
      'settled',
    ]);
    expect(h.lifecycle.renewLease).toHaveBeenCalledTimes(7);
  });

  it('pauses at a failed source stage without starting later stages', async () => {
    const h = harness({
      research: vi.fn(async () => {
        throw new Error('source research failed');
      }),
    });

    await expect(h.worker.run(JOB_ID)).resolves.toMatchObject({
      status: 'paused',
      code: 'preparation_failed',
    });
    expect(h.dependencies.research).toHaveBeenCalledTimes(1);
    expect(h.dependencies.retrieve).not.toHaveBeenCalled();
    expect(h.dependencies.extract).not.toHaveBeenCalled();
    expect(h.dependencies.generate).not.toHaveBeenCalled();
  });

  it('settles the active callback then cooperatively pauses before starting another', async () => {
    let stopping = false;
    const h = harness({
      shouldStop: () => stopping,
      research: vi.fn(async () => {
        stopping = true;
      }),
    });

    await expect(h.worker.run(JOB_ID)).resolves.toEqual({
      status: 'paused',
      jobId: JOB_ID,
      code: 'runtime_unavailable',
    });
    expect(h.dependencies.research).toHaveBeenCalledTimes(1);
    expect(h.dependencies.assertDispatchesSettled).toHaveBeenCalledTimes(2);
    expect(h.dependencies.retrieve).not.toHaveBeenCalled();
    expect(h.dependencies.recordPause).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'runtime_unavailable', retryable: true })
    );
    expect(h.lifecycle.releaseLease).toHaveBeenCalled();
  });

  it('renews the lease between source items', async () => {
    const h = harness({
      preflight: vi.fn(async () => ({
        ok: true,
        requiredThemed: 1,
        work: [{ key: 'fact-1' }, { key: 'fact-2' }],
      })),
    });
    await h.worker.run(JOB_ID);
    expect(h.dependencies.research).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: 'researching' }),
      [{ key: 'fact-1' }]
    );
    expect(h.dependencies.research).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: 'researching' }),
      [{ key: 'fact-2' }]
    );
    expect(h.dependencies.retrieve).toHaveBeenCalledTimes(2);
    expect(h.dependencies.extract).toHaveBeenCalledTimes(2);
  });

  it('pauses after a monetary unknown instead of continuing to another stage', async () => {
    const h = harness({
      assertDispatchesSettled: vi.fn(async () => {
        throw new ThemePreparationWorkerError('provider_outcome_unknown', false);
      }),
    });
    await expect(h.worker.run(JOB_ID)).resolves.toMatchObject({
      status: 'paused',
      code: 'provider_outcome_unknown',
    });
    expect(h.dependencies.review).not.toHaveBeenCalled();
    expect(h.dependencies.approve).not.toHaveBeenCalled();
  });

  it('uses one bounded repair only when approval explicitly permits it', async () => {
    const approve = vi
      .fn()
      .mockResolvedValueOnce({ status: 'withheld', repairEligible: true })
      .mockResolvedValueOnce({
        status: 'approved',
        approval: { itemKey: 'fact-1', candidateId: 'candidate-repair', questionId: 'question-1' },
      });
    const repair = vi.fn(async () => ({
      status: 'repaired' as const,
      candidate: { itemKey: 'fact-1', candidateId: 'candidate-repair', verdict: 'pass' as const },
    }));
    const h = harness({ approve, repair });
    await expect(h.worker.run(JOB_ID)).resolves.toMatchObject({ status: 'ready' });
    expect(repair).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledTimes(2);
  });

  it('does not start a second worker when the lease is unavailable', async () => {
    const h = harness();
    vi.mocked(h.lifecycle.acquireLease).mockResolvedValueOnce(null);
    await expect(h.worker.run(JOB_ID)).resolves.toEqual({
      status: 'ignored',
      jobId: JOB_ID,
      reason: 'lease_unavailable',
    });
    expect(h.dependencies.preflight).not.toHaveBeenCalled();
  });

  it('revalidates eligibility after acquiring the lease', async () => {
    const h = harness();
    vi.mocked(h.lifecycle.acquireLease).mockResolvedValueOnce(job('ready'));
    await expect(h.worker.run(JOB_ID)).resolves.toEqual({
      status: 'ignored',
      jobId: JOB_ID,
      reason: 'not_runnable',
    });
    expect(h.lifecycle.releaseLease).toHaveBeenCalledWith({
      jobId: JOB_ID,
      claimToken: 'claim',
      now: NOW,
    });
    expect(h.dependencies.preflight).not.toHaveBeenCalled();
  });

  it('stops after lease loss and never reserves or activates gameplay', async () => {
    const h = harness();
    vi.mocked(h.lifecycle.renewLease).mockResolvedValueOnce(null);
    await expect(h.worker.run(JOB_ID)).resolves.toMatchObject({
      status: 'paused',
      code: 'preparation_failed',
    });
    expect(h.dependencies.generate).not.toHaveBeenCalled();
    expect(h.dependencies.reserveApproved).not.toHaveBeenCalled();
  });

  it('recovers an expired active-stage lease through durable repository replay', async () => {
    const h = harness({}, 'writing');
    await expect(h.worker.run(JOB_ID)).resolves.toMatchObject({ status: 'ready' });
    expect(h.transitions.slice(0, 2)).toEqual(['waiting', 'researching']);
    expect(h.dependencies.research).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'researching' }),
      [{ key: 'fact-1' }]
    );
    expect(h.dependencies.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'retrieving' }),
      [{ key: 'fact-1' }]
    );
    expect(h.dependencies.extract).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'extracting' }),
      [{ key: 'fact-1' }]
    );
    expect(h.dependencies.generate).toHaveBeenCalledTimes(1);
  });

  it('checks unresolved dispatches before the first paid callback', async () => {
    const h = harness({
      assertDispatchesSettled: vi.fn(async () => {
        throw new ThemePreparationWorkerError('provider_outcome_unknown', false);
      }),
    });
    await expect(h.worker.run(JOB_ID)).resolves.toMatchObject({
      status: 'paused',
      code: 'provider_outcome_unknown',
    });
    expect(h.dependencies.generate).not.toHaveBeenCalled();
    expect(h.dependencies.research).not.toHaveBeenCalled();
    expect(h.dependencies.retrieve).not.toHaveBeenCalled();
    expect(h.dependencies.extract).not.toHaveBeenCalled();
  });

  it('does not resume a durable nonretryable pause', async () => {
    const h = harness({}, 'waiting');
    vi.mocked(h.lifecycle.getJob).mockResolvedValueOnce({
      ...job('waiting'),
      lastFailure: { code: 'generation_failed', message: 'manual review', retryable: false },
    });
    await expect(h.worker.run(JOB_ID)).resolves.toEqual({
      status: 'ignored',
      jobId: JOB_ID,
      reason: 'not_runnable',
    });
    expect(h.lifecycle.acquireLease).not.toHaveBeenCalled();
  });

  it('cannot record a pause after losing the fenced lease', async () => {
    const h = harness({ recordPause: vi.fn(async () => false) });
    vi.mocked(h.lifecycle.renewLease).mockResolvedValueOnce(null);
    await expect(h.worker.run(JOB_ID)).resolves.toEqual({
      status: 'ignored',
      jobId: JOB_ID,
      reason: 'lease_unavailable',
    });
  });
});
