import { randomUUID } from 'node:crypto';

import {
  publicStageForThemeJob,
  type ThemeJobRecord,
  type ThemeJobStatus,
  type ThemeLifecycleRepository,
} from './theme-lifecycle';

export type ThemePreparationWorkItem = Readonly<{ key: string }>;
export type ThemeGeneratedCandidate = Readonly<{ itemKey: string; candidateId: string }>;
export type ThemeReviewedCandidate = Readonly<{
  itemKey: string;
  candidateId: string;
  verdict: 'pass' | 'flag' | 'fail';
}>;
export type ThemeApprovedCandidate = Readonly<{
  itemKey: string;
  candidateId: string;
  questionId: string;
}>;

export type ThemeApprovalDecision =
  | Readonly<{ status: 'approved'; approval: ThemeApprovedCandidate }>
  | Readonly<{ status: 'withheld'; repairEligible: boolean }>;

export type ThemeRepairDecision =
  | Readonly<{ status: 'repaired'; candidate: ThemeReviewedCandidate }>
  | Readonly<{ status: 'withheld' }>;

export type ThemePreparationFailureCode =
  | 'runtime_unavailable'
  | 'inventory_shortfall'
  | 'budget_exhausted'
  | 'provider_outcome_unknown'
  | 'candidate_ceiling'
  | 'source_ineligible'
  | 'preparation_failed';

export type ThemePreparationWorkerResult =
  | Readonly<{ status: 'ready'; jobId: string; approved: number }>
  | Readonly<{ status: 'paused'; jobId: string; code: ThemePreparationFailureCode }>
  | Readonly<{ status: 'ignored'; jobId: string; reason: 'not_runnable' | 'lease_unavailable' }>;

export class ThemePreparationWorkerError extends Error {
  constructor(
    public readonly code: ThemePreparationFailureCode,
    public readonly retryable: boolean,
    message: string = code
  ) {
    super(message);
    this.name = 'ThemePreparationWorkerError';
  }
}

export interface ThemePreparationWorkerDependencies {
  lifecycle: ThemeLifecycleRepository;
  /** Validates complete S11A backups plus authoritative runtime policy. */
  preflight(
    job: ThemeJobRecord
  ): Promise<
    | Readonly<{ ok: true; requiredThemed: number; work: readonly ThemePreparationWorkItem[] }>
    | Readonly<{ ok: false; code: 'runtime_unavailable' | 'inventory_shortfall' }>
  >;
  /** Runs source research after recovery has resolved any earlier dispatch. */
  research(job: ThemeJobRecord, work: readonly ThemePreparationWorkItem[]): Promise<void>;
  /** Retrieves source material for the preflighted work. */
  retrieve(job: ThemeJobRecord, work: readonly ThemePreparationWorkItem[]): Promise<void>;
  /** Extracts usable facts from the retrieved source material. */
  extract(job: ThemeJobRecord, work: readonly ThemePreparationWorkItem[]): Promise<void>;
  generate(job: ThemeJobRecord, item: ThemePreparationWorkItem): Promise<ThemeGeneratedCandidate>;
  review(job: ThemeJobRecord, candidate: ThemeGeneratedCandidate): Promise<ThemeReviewedCandidate>;
  /** S10 owns the complete QA and semantic checks before approval. */
  approve(job: ThemeJobRecord, candidate: ThemeReviewedCandidate): Promise<ThemeApprovalDecision>;
  /** S9 is called only after S10 returns an explicitly repairable QA result. */
  repair?: (job: ThemeJobRecord, candidate: ThemeReviewedCandidate) => Promise<ThemeRepairDecision>;
  /** Verifies that no physical provider dispatch ended in an unresolved cost state. */
  assertDispatchesSettled(jobId: string): Promise<void>;
  /** Atomically binds the approved questions to the locked roster; never activates gameplay. */
  reserveApproved(
    job: ThemeJobRecord,
    approved: readonly ThemeApprovedCandidate[]
  ): Promise<{ ready: boolean }>;
  /** Persists failure metadata only while this worker still owns the expected state. */
  recordPause(input: {
    jobId: string;
    claimToken: string;
    expectedStatus: ThemeJobStatus;
    code: ThemePreparationFailureCode;
    retryable: boolean;
  }): Promise<boolean>;
  /** Cooperative process shutdown gate, checked between bounded callbacks. */
  shouldStop?: () => boolean;
  leaseDurationMs?: number;
  claimToken?: () => string;
  now?: () => Date;
}

const RUNNABLE = new Set<ThemeJobStatus>([
  'queued',
  'waiting',
  'researching',
  'retrieving',
  'extracting',
  'writing',
  'reviewing',
  'qa',
  'semantic_check',
  'reserving',
]);

export function createThemePreparationWorker(dependencies: ThemePreparationWorkerDependencies) {
  const leaseDurationMs = dependencies.leaseDurationMs ?? 30_000;
  const now = dependencies.now ?? (() => new Date());
  const claimToken = dependencies.claimToken ?? randomUUID;

  function assertContinuing(): void {
    let stopping = true;
    try {
      stopping = dependencies.shouldStop?.() ?? false;
    } catch {
      // A broken shutdown signal fails closed.
    }
    if (stopping) throw new ThemePreparationWorkerError('runtime_unavailable', true);
  }

  async function transition(
    job: ThemeJobRecord,
    claim: string,
    status: ThemeJobStatus
  ): Promise<ThemeJobRecord> {
    const changed = await dependencies.lifecycle.transitionJob({
      jobId: job.id,
      claimToken: claim,
      expectedStatus: job.status,
      status,
      publicStage: publicStageForThemeJob(status),
      now: now(),
    });
    if (!changed)
      throw new ThemePreparationWorkerError('preparation_failed', false, 'Worker lease was lost');
    return changed;
  }

  async function renew(job: ThemeJobRecord, claim: string): Promise<ThemeJobRecord> {
    const renewed = await dependencies.lifecycle.renewLease({
      jobId: job.id,
      claimToken: claim,
      leaseDurationMs,
      now: now(),
    });
    if (!renewed)
      throw new ThemePreparationWorkerError('preparation_failed', false, 'Worker lease was lost');
    return renewed;
  }

  async function pause(
    job: ThemeJobRecord,
    claim: string,
    error: ThemePreparationWorkerError
  ): Promise<ThemePreparationWorkerResult> {
    const recorded = await dependencies.recordPause({
      jobId: job.id,
      claimToken: claim,
      expectedStatus: job.status,
      code: error.code,
      retryable: error.retryable,
    });
    if (!recorded) return { status: 'ignored', jobId: job.id, reason: 'lease_unavailable' };
    const pausedStatus: ThemeJobStatus = error.retryable ? 'waiting' : 'failed';
    if (job.status !== pausedStatus) {
      const changed = await dependencies.lifecycle.transitionJob({
        jobId: job.id,
        claimToken: claim,
        expectedStatus: job.status,
        status: pausedStatus,
        publicStage: error.retryable ? 'paused' : 'failed',
        now: now(),
      });
      if (changed) job = changed;
    }
    await dependencies.lifecycle.releaseLease({ jobId: job.id, claimToken: claim, now: now() });
    return { status: 'paused', jobId: job.id, code: error.code };
  }

  return {
    async run(jobId: string): Promise<ThemePreparationWorkerResult> {
      const current = await dependencies.lifecycle.getJob(jobId);
      if (!current || !RUNNABLE.has(current.status))
        return { status: 'ignored', jobId, reason: 'not_runnable' };
      if (current.lastFailure && !current.lastFailure.retryable)
        return { status: 'ignored', jobId, reason: 'not_runnable' };

      const claim = claimToken();
      const leasedJob = await dependencies.lifecycle.acquireLease({
        jobId,
        claimToken: claim,
        leaseDurationMs,
        now: now(),
      });
      if (!leasedJob) return { status: 'ignored', jobId, reason: 'lease_unavailable' };
      let job: ThemeJobRecord = leasedJob;
      if (!RUNNABLE.has(job.status) || (job.lastFailure && !job.lastFailure.retryable)) {
        await dependencies.lifecycle.releaseLease({ jobId, claimToken: claim, now: now() });
        return { status: 'ignored', jobId, reason: 'not_runnable' };
      }

      try {
        assertContinuing();
        // A process may die after persisting an active stage. Once that lease
        // expires, normalize the durable job to waiting and replay the existing
        // repository attempts; their exact IDs prevent a second paid call.
        if (job.status !== 'waiting' && job.status !== 'queued') {
          job = await transition(job, claim, 'waiting');
        }
        const preflight = await dependencies.preflight(job);
        if (!preflight.ok) throw new ThemePreparationWorkerError(preflight.code, false);
        if (preflight.requiredThemed < 1 || preflight.work.length < preflight.requiredThemed)
          throw new ThemePreparationWorkerError('inventory_shortfall', false);

        // Recovery must resolve or reconcile an earlier physical dispatch
        // before another paid operation may begin.
        await dependencies.assertDispatchesSettled(job.id);

        const work = Object.freeze(
          preflight.work.map((item) => Object.freeze({ ...item }))
        ) as readonly ThemePreparationWorkItem[];
        const runSourceStage = async (
          status: 'researching' | 'retrieving' | 'extracting',
          callback: (
            stageJob: ThemeJobRecord,
            stageWork: readonly ThemePreparationWorkItem[]
          ) => Promise<void>
        ) => {
          assertContinuing();
          job = await transition(job, claim, status);
          for (const item of work) {
            job = await renew(job, claim);
            assertContinuing();
            const stageWork = Object.freeze([item]) as readonly ThemePreparationWorkItem[];
            await callback(job, stageWork);
            await dependencies.assertDispatchesSettled(job.id);
          }
        };

        await runSourceStage('researching', dependencies.research);
        await runSourceStage('retrieving', dependencies.retrieve);
        await runSourceStage('extracting', dependencies.extract);
        job = await transition(job, claim, 'writing');

        const generated: ThemeGeneratedCandidate[] = [];
        for (const item of preflight.work) {
          job = await renew(job, claim);
          assertContinuing();
          generated.push(await dependencies.generate(job, item));
          await dependencies.assertDispatchesSettled(job.id);
        }

        job = await transition(job, claim, 'reviewing');
        const reviewed: ThemeReviewedCandidate[] = [];
        for (const candidate of generated) {
          job = await renew(job, claim);
          assertContinuing();
          const result = await dependencies.review(job, candidate);
          await dependencies.assertDispatchesSettled(job.id);
          if (result.verdict === 'pass') reviewed.push(result);
        }

        job = await transition(job, claim, 'qa');
        const approved: ThemeApprovedCandidate[] = [];
        for (const candidate of reviewed) {
          job = await renew(job, claim);
          assertContinuing();
          let decision = await dependencies.approve(job, candidate);
          await dependencies.assertDispatchesSettled(job.id);
          if (decision.status === 'withheld' && decision.repairEligible && dependencies.repair) {
            job = await renew(job, claim);
            assertContinuing();
            const repaired = await dependencies.repair(job, candidate);
            await dependencies.assertDispatchesSettled(job.id);
            if (repaired.status === 'repaired') {
              job = await renew(job, claim);
              assertContinuing();
              decision = await dependencies.approve(job, repaired.candidate);
              await dependencies.assertDispatchesSettled(job.id);
            }
          }
          if (decision.status === 'approved') approved.push(decision.approval);
          if (approved.length === preflight.requiredThemed) break;
        }

        job = await transition(job, claim, 'semantic_check');
        if (approved.length < preflight.requiredThemed)
          throw new ThemePreparationWorkerError('inventory_shortfall', false);
        job = await transition(job, claim, 'reserving');
        job = await renew(job, claim);
        assertContinuing();
        const reservation = await dependencies.reserveApproved(job, approved);
        if (!reservation.ready) throw new ThemePreparationWorkerError('inventory_shortfall', false);
        job = await transition(job, claim, 'ready');
        await dependencies.lifecycle.releaseLease({ jobId, claimToken: claim, now: now() });
        return { status: 'ready', jobId, approved: approved.length };
      } catch (error) {
        const failure =
          error instanceof ThemePreparationWorkerError
            ? error
            : new ThemePreparationWorkerError('preparation_failed', true);
        return pause(job, claim, failure);
      }
    },
  };
}
