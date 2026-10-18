import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  createThemeBudgetGateway,
  ThemeBudgetError,
  type ThemeBudgetDispatch,
  type ThemeBudgetOperation,
  type ThemeBudgetOutcome,
  type ThemeBudgetRecord,
} from './theme-budget';
import { createPostgresThemeEvidencePersistenceRepository } from './theme-evidence-persistence';
import { createPostgresThemeFactDerivationRepository } from './theme-fact-derivation';
import { createPostgresThemeFactReviewRepository } from './theme-fact-review';
import { createPostgresThemeLifecycleRepository } from './theme-lifecycle';
import type { ThemeLifecycleRepository } from './theme-lifecycle';
import type { ThemeProviderMetadata } from './theme-provider-adapters';
import {
  createThemePreparationWorker,
  ThemePreparationWorkerError,
  type ThemePreparationWorkerDependencies,
} from './theme-preparation-worker';
import { createPostgresThemeQuestionApprovalRepository } from './theme-question-approval';
import { createPostgresThemeQuestionEvidenceReviewRepository } from './theme-question-evidence-review';
import { createPostgresThemeQuestionGenerationRepository } from './theme-question-generation';
import { createPostgresThemeQuestionRepairOrchestrator } from './theme-question-repair';
import type { ThemeQuestionQaDependencies } from './theme-question-qa';
import { createPostgresThemeRuntimeRepository } from './theme-runtime-repository';
import type { ThemeRuntimeBudgetConfig } from './theme-runtime-config';
import { themeRuntimeBudgetPolicyFingerprint } from './theme-runtime-config';
import { createPostgresThemeSourceRegistryRepository } from './theme-source-registry';

type FactReviewConfig = Parameters<typeof createPostgresThemeFactReviewRepository>[1];
type QuestionGenerationConfig = Parameters<
  typeof createPostgresThemeQuestionGenerationRepository
>[1];
type EvidenceReviewConfig = Parameters<
  typeof createPostgresThemeQuestionEvidenceReviewRepository
>[1];
type ApprovalConfig = Parameters<typeof createPostgresThemeQuestionApprovalRepository>[1];

export type ThemeSourceFirstRepositoryConfig = Readonly<{
  factReview: FactReviewConfig;
  questionGeneration: QuestionGenerationConfig;
  evidenceReview: EvidenceReviewConfig;
  approval: ApprovalConfig;
  repairQa: ThemeQuestionQaDependencies;
}>;

/** Existing S2-S10 repositories, assembled once so every stage shares one policy set. */
export function createPostgresThemeSourceFirstRepositories(
  pool: Pool,
  config: ThemeSourceFirstRepositoryConfig,
  now: () => Date = () => new Date()
) {
  const evidencePersistence = createPostgresThemeEvidencePersistenceRepository(pool);
  const factDerivation = createPostgresThemeFactDerivationRepository(pool, now);
  const factReview = createPostgresThemeFactReviewRepository(pool, config.factReview, now);
  const questionGeneration = createPostgresThemeQuestionGenerationRepository(
    pool,
    config.questionGeneration,
    now
  );
  const evidenceReview = createPostgresThemeQuestionEvidenceReviewRepository(
    pool,
    config.evidenceReview,
    now
  );
  const questionApproval = createPostgresThemeQuestionApprovalRepository(pool, config.approval);
  const questionRepair = createPostgresThemeQuestionRepairOrchestrator(pool, {
    generation: questionGeneration,
    evidenceReview,
    loadParentContext: (request) => evidenceReview.qaContext(request),
    qa: config.repairQa,
  });

  return Object.freeze({
    sourceRegistry: createPostgresThemeSourceRegistryRepository(pool),
    evidencePersistence,
    factDerivation,
    factReview,
    questionGeneration,
    evidenceReview,
    questionRepair,
    questionApproval,
  });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export type ThemeBudgetedProviderRequest<T> = Readonly<{
  jobId: string;
  claimToken: string;
  stableKey: string;
  operation: ThemeBudgetOperation;
  provider: string;
  model: string;
  request: unknown;
  reservedCostMicros: number;
  candidateSlots: number;
  holdExpiresAt: Date;
  invoke: () => Promise<{
    outcome: ThemeBudgetOutcome;
    value: T;
    metadata?: ThemeProviderMetadata;
  }>;
}>;

type BudgetGateway = ReturnType<typeof createThemeBudgetGateway>;
export type ThemeProviderMetadataRecorder = (
  db: PoolClient,
  record: ThemeBudgetRecord,
  metadata: ThemeProviderMetadata
) => Promise<void>;

function workerBudgetError(error: unknown): ThemePreparationWorkerError {
  if (!(error instanceof ThemeBudgetError))
    return new ThemePreparationWorkerError('preparation_failed', false);
  if (error.code === 'budget_exhausted')
    // Stage repositories register their stable attempt before invoking the
    // transport. A denied callback becomes a terminal attempt, so this job
    // cannot safely retry later under the same identity.
    return new ThemePreparationWorkerError('budget_exhausted', false);
  if (error.code === 'runtime_disabled' || error.code === 'runtime_unavailable')
    return new ThemePreparationWorkerError('runtime_unavailable', false);
  if (error.code === 'candidate_ceiling')
    return new ThemePreparationWorkerError('candidate_ceiling', false);
  if (error.code === 'provider_outcome_unknown' || error.code === 'commit_unknown')
    return new ThemePreparationWorkerError('provider_outcome_unknown', false);
  return new ThemePreparationWorkerError('preparation_failed', false);
}

/**
 * Wraps exactly one physical model request. A completed repository attempt must
 * replay before reaching this callback; a budget replay has no provider value,
 * so it fails closed instead of issuing a second request.
 */
export function createBudgetedThemeProvider(
  gateway: BudgetGateway,
  budget: ThemeRuntimeBudgetConfig,
  recordProviderMetadata: ThemeProviderMetadataRecorder
) {
  const policyFingerprint = themeRuntimeBudgetPolicyFingerprint(budget);
  return async function dispatch<T>(input: ThemeBudgetedProviderRequest<T>): Promise<T> {
    const stableKeyHash = fingerprint(input.stableKey).slice(0, 32);
    const request: ThemeBudgetDispatch = {
      jobId: input.jobId,
      claimToken: input.claimToken,
      dispatchKey: `theme:${input.jobId}:${input.operation}:${stableKeyHash}`,
      requestFingerprint: fingerprint(input.request),
      policyFingerprint,
      operation: input.operation,
      provider: input.provider,
      model: input.model,
      reservedCostMicros: input.reservedCostMicros,
      candidateSlots: input.candidateSlots,
      limits: {
        globalDailyMicros: budget.globalDailyMicros,
        accountDailyMicros: budget.accountDailyMicros,
        accountRolling168hMicros: budget.accountRollingSevenDayMicros,
      },
      holdExpiresAt: input.holdExpiresAt,
    };
    try {
      const result = await gateway.dispatch(request, input.invoke, (db, record, metadata) =>
        recordProviderMetadata(db, record, metadata)
      );
      if (result.record.replay)
        throw new ThemePreparationWorkerError('provider_outcome_unknown', false);
      if (result.record.status !== 'succeeded')
        // The stage repository has already persisted this terminal outcome
        // under a stable attempt identity. Re-running the worker would only
        // replay the same failure and can never make progress.
        throw new ThemePreparationWorkerError('preparation_failed', false);
      if (result.value === undefined)
        throw new ThemePreparationWorkerError('provider_outcome_unknown', false);
      return result.value;
    } catch (error) {
      if (error instanceof ThemePreparationWorkerError) throw error;
      throw workerBudgetError(error);
    }
  };
}

type WorkerPipeline = Omit<
  ThemePreparationWorkerDependencies,
  | 'lifecycle'
  | 'assertDispatchesSettled'
  | 'recordPause'
  | 'reserveApproved'
  | 'leaseDurationMs'
  | 'claimToken'
  | 'now'
>;

export type ThemeRuntimeCompositionContext = Readonly<{
  repositories: ReturnType<typeof createPostgresThemeSourceFirstRepositories>;
  dispatchProvider: ReturnType<typeof createBudgetedThemeProvider>;
}>;

export type ThemeRuntimeCompositionOptions = Readonly<{
  pool: Pool;
  budget: ThemeRuntimeBudgetConfig;
  recordProviderMetadata: ThemeProviderMetadataRecorder;
  repositories: ThemeSourceFirstRepositoryConfig;
  buildPipeline(context: ThemeRuntimeCompositionContext): WorkerPipeline;
  leaseDurationMs?: number;
  claimToken?: () => string;
  now?: () => Date;
}>;

type RuntimeRepository = Pick<
  ThemePreparationWorkerDependencies,
  'assertDispatchesSettled' | 'recordPause' | 'reserveApproved'
>;

export type ThemePreparationRuntimeOptions = Readonly<{
  lifecycle: ThemeLifecycleRepository;
  runtime: RuntimeRepository;
  budgetGateway: BudgetGateway;
  budget: ThemeRuntimeBudgetConfig;
  recordProviderMetadata: ThemeProviderMetadataRecorder;
  repositories: ReturnType<typeof createPostgresThemeSourceFirstRepositories>;
  buildPipeline(context: ThemeRuntimeCompositionContext): WorkerPipeline;
  leaseDurationMs?: number;
  claimToken?: () => string;
  now?: () => Date;
}>;

/** Dependency-injected form used by the offline composition proof. */
export function createThemePreparationRuntime(options: ThemePreparationRuntimeOptions) {
  const now = options.now ?? (() => new Date());
  const dispatchProvider = createBudgetedThemeProvider(
    options.budgetGateway,
    options.budget,
    options.recordProviderMetadata
  );
  const pipeline = options.buildPipeline(
    Object.freeze({ repositories: options.repositories, dispatchProvider })
  );
  return createThemePreparationWorker({
    ...pipeline,
    ...options.runtime,
    lifecycle: options.lifecycle,
    leaseDurationMs: options.leaseDurationMs,
    claimToken: options.claimToken,
    now,
  });
}

/**
 * Dormant S11C composition. Callers still decide how work is scheduled; this
 * factory registers no route, timer, queue, provider credential, or feature flag.
 */
export function createPostgresThemePreparationRuntime(options: ThemeRuntimeCompositionOptions) {
  const now = options.now ?? (() => new Date());
  const lifecycle = createPostgresThemeLifecycleRepository(options.pool);
  const repositories = createPostgresThemeSourceFirstRepositories(
    options.pool,
    options.repositories,
    now
  );
  const runtime = createPostgresThemeRuntimeRepository(options.pool, {
    now,
    validateApprovalEvidence: (request, db, at) =>
      repositories.evidenceReview.qaContext(request, db, at, true),
  });
  return createThemePreparationRuntime({
    lifecycle,
    runtime,
    budgetGateway: createThemeBudgetGateway(options.pool),
    budget: options.budget,
    recordProviderMetadata: options.recordProviderMetadata,
    repositories,
    buildPipeline: options.buildPipeline,
    leaseDurationMs: options.leaseDurationMs,
    claimToken: options.claimToken,
    now,
  });
}
