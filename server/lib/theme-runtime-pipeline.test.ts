import { describe, expect, it, vi } from 'vitest';

import type { ThemeJobRecord } from './theme-lifecycle';
import { ThemePreparationWorkerError } from './theme-preparation-worker';
import { createThemeBudgetGateway } from './theme-budget';
import type { ThemeLifecycleRepository } from './theme-lifecycle';
import {
  createThemePreparationRuntime,
  type ThemeRuntimeCompositionContext,
} from './theme-runtime-composition';
import {
  createThemeRuntimePipeline,
  themeRuntimeItemId,
  type ThemeRuntimePipelineOptions,
} from './theme-runtime-pipeline';

vi.mock('./theme-source-retrieval', () => ({
  retrieveThemeSource: vi.fn(async () => ({ ok: true, value: { body: Buffer.from('source') } })),
}));
vi.mock('./theme-source-extraction', () => ({
  extractThemeSource: vi.fn(() => ({ ok: true, passages: [{ text: 'source' }] })),
}));

const job = { id: '11111111-1111-4111-8111-111111111111', leaseOwner: 'claim' } as ThemeJobRecord;
const item = {
  key: 'first',
  ordinal: 1,
  requestedUrl: 'https://example.org/facts',
  title: 'Facts',
  language: 'en',
  canonicalFactKey: 'first-fact',
  expectedLatestFactRevision: 0,
};
const hash = 'a'.repeat(64);

function runnableJob(status: ThemeJobRecord['status'] = 'queued'): ThemeJobRecord {
  const at = new Date('2026-10-13T00:00:00Z');
  return {
    id: job.id,
    gameId: '22222222-2222-4222-8222-222222222222',
    contractVersion: 'theme-reliability-v1',
    stableKey: 'runtime-proof',
    status,
    publicStage: status === 'queued' ? 'waiting' : status,
    candidateCeiling: 50,
    candidatesUsed: 0,
    readyCount: 0,
    themedReadyCount: 0,
    relatedReadyCount: 0,
    lastFailure: null,
    leaseOwner: status === 'queued' ? null : 'claim',
    leaseExpiresAt: new Date(at.valueOf() + 60_000),
    startedAt: null,
    completedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

function fixture() {
  const captures = new Map<string, string[]>();
  const attempts = new Map<string, unknown>();
  const questions = new Map<string, { questionRevisionId: string; questionContentHash: string }>();
  const physical = vi.fn(async (input) => ({
    value: input,
    outcome: { status: 'succeeded', actualCostMicros: 1 },
  }));
  const provider = {
    provider: 'offline',
    model: 'deterministic',
    requestIdentity: { prompt: 'fixture' },
    reservedCostMicros: 1,
    invoke: physical,
  };
  const call = async (key: string, callback: (input: never) => unknown, result: unknown) => {
    if (attempts.has(key)) return attempts.get(key);
    await callback({ fixture: key } as never);
    attempts.set(key, result);
    return result;
  };
  const repositories = {
    sourceRegistry: {
      get: vi.fn(async () => ({
        manifest: {
          entries: [
            {
              id: 'fixture',
              publisherId: 'fixture',
              publisherName: 'Fixture',
              originGroup: 'fixture',
              sourceClass: 'primary_record',
              scope: { topics: [], languages: ['en'], geographies: [], temporal: null },
              origins: [
                { origin: 'https://example.org', paths: [{ kind: 'exact', path: '/facts' }] },
              ],
            },
          ],
          sourcePolicyVersion: 'v1',
          contractVersion: 'theme-source-registry-v1',
        },
        hash,
      })),
    },
    evidencePersistence: {
      persistCapture: vi.fn(async (request) => {
        captures.set(request.documentId, ['passage']);
        return { documentId: request.documentId, passageIds: ['passage'], created: true };
      }),
    },
    factDerivation: {
      deriveAndPersist: vi.fn(async (request, callback) =>
        call(request.provenance.attemptId, callback, {
          status: 'proposed',
          contentHash: hash,
          policySatisfied: true,
          persistence: { factId: 'fact', revisionId: request.revisionId },
        })
      ),
    },
    factReview: {
      review: vi.fn(async (request, callback) =>
        call(request.attemptId, callback, { status: 'reviewed', verdict: 'pass' })
      ),
    },
    questionGeneration: {
      generate: vi.fn(async (request, callback) => {
        const result = await call(request.attemptId, callback, {
          status: 'persisted',
          candidateId: request.candidateId,
        });
        questions.set(request.candidateId, {
          questionRevisionId: request.questionRevisionId,
          questionContentHash: hash,
        });
        return result;
      }),
    },
    evidenceReview: {
      review: vi.fn(async (request, callback) =>
        call(request.attemptId, callback, { status: 'reviewed', verdict: 'pass' })
      ),
    },
    questionApproval: {
      approve: vi.fn(async (request) => ({
        status: 'approved',
        libraryQuestionId: request.libraryQuestionId,
      })),
    },
    questionRepair: { repair: vi.fn() },
  };
  const dispatchProvider = vi.fn(async (request) => (await request.invoke()).value);
  const context = { repositories, dispatchProvider } as unknown as ThemeRuntimeCompositionContext;
  const options = {
    planVersion: 'plan-v1',
    holdExpiresAt: new Date('2026-10-13T00:00:00Z'),
    items: [item],
    preflight: async () => ({ ok: true, requiredThemed: 1, work: [{ key: item.key }] }),
    checkpoints: {
      capture: async (id) => captures.get(id) ?? null,
      factReviewHash: async () => hash,
      question: async (id) => questions.get(id) ?? null,
      repairOrdinal: async () => 2,
    },
    derivation: { policy: { sourcePolicyVersion: 'v1' }, provenance: { attemptId: 'ignored' } },
    providers: {
      proposer: provider,
      factReviewer: provider,
      writer: provider,
      evidenceReviewer: provider,
      repairer: provider,
    },
    qaMode: 'offline',
    retrieval: { transport: async () => ({}), lookup: async () => [] },
  } as unknown as ThemeRuntimePipelineOptions;
  return { options, context, repositories, physical, dispatchProvider };
}

describe('concrete dormant theme pipeline', () => {
  it('runs worker, concrete pipeline, budget boundary, approval and reservation together', async () => {
    const f = fixture();
    let current = runnableJob();
    const lifecycle = {
      getJob: vi.fn(async () => current),
      acquireLease: vi.fn(async () => {
        current = { ...current, leaseOwner: 'claim' };
        return current;
      }),
      transitionJob: vi.fn(async (input) => {
        current = {
          ...current,
          status: input.status,
          publicStage: input.publicStage,
          leaseOwner: input.claimToken,
        };
        return current;
      }),
      renewLease: vi.fn(async () => current),
      releaseLease: vi.fn(async () => true),
    } as unknown as ThemeLifecycleRepository;
    const reserveApproved = vi.fn(async () => ({ ready: true }));
    const runtime = {
      assertDispatchesSettled: vi.fn(async () => undefined),
      recordPause: vi.fn(async () => true),
      reserveApproved,
    };
    const dispatch = vi.fn(async (_request, invoke) => ({
      record: {
        attemptId: 'attempt',
        allocationId: 'allocation',
        ownerUserId: 'owner',
        status: 'succeeded' as const,
        reservedCostMicros: 1,
        actualCostMicros: 1,
        overrun: false,
        replay: false,
      },
      value: (await invoke()).value,
    }));
    const worker = createThemePreparationRuntime({
      lifecycle,
      runtime,
      budgetGateway: { dispatch } as unknown as ReturnType<typeof createThemeBudgetGateway>,
      budget: {
        currency: 'USD',
        policyVersion: 'offline-v1',
        accountDailyMicros: 100,
        accountRollingSevenDayMicros: 500,
        globalDailyMicros: 1_000,
      },
      recordProviderMetadata: vi.fn(async () => undefined),
      repositories: f.repositories as unknown as Parameters<
        typeof createThemePreparationRuntime
      >[0]['repositories'],
      buildPipeline: (context) => createThemeRuntimePipeline(context, f.options),
      claimToken: () => 'claim',
      now: () => new Date('2026-10-13T00:00:00Z'),
    });

    await expect(worker.run(job.id)).resolves.toEqual({
      status: 'ready',
      jobId: job.id,
      approved: 1,
    });
    expect(dispatch).toHaveBeenCalledTimes(4);
    expect(f.physical).toHaveBeenCalledTimes(4);
    expect(reserveApproved).toHaveBeenCalledWith(expect.objectContaining({ status: 'reserving' }), [
      expect.objectContaining({ itemKey: item.key }),
    ]);
    expect(current.status).toBe('ready');
  });

  it('composes capture, fact review, generation, evidence review and S10 approval', async () => {
    const f = fixture();
    const pipeline = createThemeRuntimePipeline(f.context, f.options);
    expect(await pipeline.preflight(job)).toMatchObject({ ok: true });
    await pipeline.research(job, [item]);
    await pipeline.retrieve(job, [item]);
    await pipeline.extract(job, [item]);
    const generated = await pipeline.generate(job, item);
    const reviewed = await pipeline.review(job, generated);
    expect(reviewed.verdict).toBe('pass');
    expect(await pipeline.approve(job, reviewed)).toEqual({
      status: 'approved',
      approval: {
        ...reviewed,
        questionId: themeRuntimeItemId(
          job.id,
          'plan-v1',
          item.key,
          `library-question:${generated.candidateId}`
        ),
      },
    });
    expect(f.repositories.evidencePersistence.persistCapture).toHaveBeenCalledOnce();
    expect(f.dispatchProvider.mock.calls.map(([request]) => request.operation)).toEqual([
      'extract_fact',
      'review',
      'generate',
      'review',
    ]);
    expect(f.dispatchProvider.mock.calls.map(([request]) => request.candidateSlots)).toEqual([
      0, 0, 1, 0,
    ]);
    expect(f.physical).toHaveBeenCalledTimes(4);
  });

  it('recreates the pipeline after generation and replays durable attempts without physical calls', async () => {
    const f = fixture();
    let pipeline = createThemeRuntimePipeline(f.context, f.options);
    await pipeline.retrieve(job, [item]);
    await pipeline.extract(job, [item]);
    const beforeCrash = await pipeline.generate(job, item);
    expect(f.physical).toHaveBeenCalledTimes(3);
    pipeline = createThemeRuntimePipeline(f.context, f.options);
    await pipeline.retrieve(job, [item]);
    await pipeline.extract(job, [item]);
    expect(await pipeline.generate(job, item)).toEqual(beforeCrash);
    expect(f.physical).toHaveBeenCalledTimes(3);
    expect((await pipeline.review(job, beforeCrash)).verdict).toBe('pass');
    expect(f.physical).toHaveBeenCalledTimes(4);
    expect(f.repositories.evidencePersistence.persistCapture).toHaveBeenCalledOnce();
  });

  it.each(['budget_exhausted', 'provider_outcome_unknown'] as const)(
    'preserves terminal %s when a repository swallows its callback failure',
    async (code) => {
      const f = fixture();
      f.dispatchProvider.mockImplementation(async () => {
        throw new ThemePreparationWorkerError(code, true);
      });
      f.repositories.factDerivation.deriveAndPersist.mockImplementation(
        async (_request, callback) => {
          try {
            await callback([]);
          } catch {
            /* repository persists its terminal outcome */
          }
          return { status: 'insufficient_evidence' };
        }
      );
      const pipeline = createThemeRuntimePipeline(f.context, f.options);
      await pipeline.retrieve(job, [item]);
      await expect(pipeline.extract(job, [item])).rejects.toMatchObject({ code, retryable: false });
      expect(f.physical).not.toHaveBeenCalled();
      expect(f.repositories.factReview.review).not.toHaveBeenCalled();
      expect(f.repositories.questionApproval.approve).not.toHaveBeenCalled();
    }
  );

  it('runs one bounded S9 repair only for an exact repairable S10 decision', async () => {
    const f = fixture();
    const pipeline = createThemeRuntimePipeline(f.context, f.options);
    await pipeline.retrieve(job, [item]);
    const candidate = await pipeline.generate(job, item);
    const reviewed = await pipeline.review(job, candidate);
    const qa = {
      status: 'withheld',
      candidateId: candidate.candidateId,
      questionRevisionId: themeRuntimeItemId(job.id, 'plan-v1', item.key, 'question-revision'),
      questionContentHash: hash,
      evidenceAttemptId: themeRuntimeItemId(
        job.id,
        'plan-v1',
        item.key,
        `question-review:${candidate.candidateId}`
      ),
      evidenceReviewId: 'review-id',
      evidenceFingerprint: hash,
      corpusRevision: null,
      corpusHash: null,
      policyVersion: 'theme-question-qa-v1',
      evaluatedAt: '2026-10-12T00:00:00.000Z',
      stage: 'quality',
      reason: 'quality_adverse',
    };
    f.repositories.questionApproval.approve.mockImplementation(
      async () => ({ status: 'withheld', reason: 'qa_withheld', qa }) as never
    );
    f.repositories.questionRepair.repair.mockImplementation(async (request, repairer, reviewer) => {
      await repairer({ fixture: 'repair' });
      await reviewer({ fixture: 'review-repair' });
      return { status: 'passed', candidateId: request.generation.candidateId };
    });
    expect(await pipeline.approve(job, reviewed)).toEqual({
      status: 'withheld',
      repairEligible: true,
    });
    expect(await pipeline.repair!(job, reviewed)).toEqual({
      status: 'repaired',
      candidate: {
        itemKey: item.key,
        candidateId: themeRuntimeItemId(job.id, 'plan-v1', item.key, 'repair-candidate'),
        verdict: 'pass',
      },
    });
    const request = f.repositories.questionRepair.repair.mock.calls[0][0];
    expect(request.generation.ordinal).toBe(2);
    expect(request.generation.repairOf).toMatchObject({
      parentCandidateId: candidate.candidateId,
      evidenceReviewAttemptId: themeRuntimeItemId(job.id, 'plan-v1', item.key, 'repair-review'),
      failureStage: 'quality',
      failureReason: 'quality_adverse',
    });
    expect(request.generation.repairOf.evidenceReviewAttemptId).not.toBe(qa.evidenceAttemptId);
    expect(
      f.dispatchProvider.mock.calls
        .slice(-2)
        .map(([input]) => [input.operation, input.candidateSlots])
    ).toEqual([
      ['repair', 1],
      ['review', 0],
    ]);
    f.repositories.questionApproval.approve.mockImplementation(
      async () =>
        ({
          status: 'withheld',
          reason: 'qa_withheld',
          qa: { ...qa, stage: 'semantic', reason: 'semantic_match' },
        }) as never
    );
    expect(await pipeline.repair!(job, reviewed)).toEqual({ status: 'withheld' });
    expect(f.repositories.questionRepair.repair).toHaveBeenCalledOnce();
  });

  it('rejects live QA mode and implicit retrieval network access', () => {
    const f = fixture();
    expect(() =>
      createThemeRuntimePipeline(f.context, {
        ...f.options,
        qaMode: 'live',
      } as unknown as ThemeRuntimePipelineOptions)
    ).toThrow('runtime_unavailable');
    expect(() => createThemeRuntimePipeline(f.context, { ...f.options, retrieval: {} })).toThrow(
      'runtime_unavailable'
    );
  });

  it('withholds a missing current question binding and never calls approval', async () => {
    const f = fixture();
    const pipeline = createThemeRuntimePipeline(f.context, f.options);
    await expect(
      pipeline.approve(job, { itemKey: item.key, candidateId: 'missing', verdict: 'pass' })
    ).rejects.toMatchObject({ code: 'source_ineligible' });
    expect(f.repositories.questionApproval.approve).not.toHaveBeenCalled();
  });
});
