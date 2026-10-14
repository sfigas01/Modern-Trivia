import { createHash } from 'node:crypto';

import type { Pool } from 'pg';

import { resolveThemeSourceUrl } from '@shared/models/theme-source-registry';
import type { ThemeQuestionGenerationRequest } from '@shared/models/theme-question-generation';
import type { ThemeBudgetOperation, ThemeBudgetOutcome } from './theme-budget';
import type { ThemeFactDerivationRequest, ThemeFactProposer } from './theme-fact-derivation';
import type { ThemeFactReviewer } from './theme-fact-review';
import type { ThemeJobRecord } from './theme-lifecycle';
import {
  ThemePreparationWorkerError,
  type ThemeGeneratedCandidate,
  type ThemePreparationWorkerDependencies,
} from './theme-preparation-worker';
import type { ThemeQuestionEvidenceReviewer } from './theme-question-evidence-review';
import type { ThemeQuestionWriter } from './theme-question-generation';
import type { ThemeQuestionRepairer } from './theme-question-repair';
import type { ThemeRuntimeCompositionContext } from './theme-runtime-composition';
import { extractThemeSource } from './theme-source-extraction';
import { retrieveThemeSource, type RetrievedThemeSource } from './theme-source-retrieval';

/** Stable identities survive process replacement; the plan version must be immutable. */
export function themeRuntimeItemId(jobId: string, planVersion: string, key: string, stage: string) {
  const bytes = createHash('sha256')
    .update(JSON.stringify([jobId, planVersion, key, stage]))
    .digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type ThemeRuntimeSourceItem = Readonly<{
  key: string;
  ordinal: number;
  requestedUrl: string;
  title: string;
  language: string;
  canonicalFactKey: string;
  expectedLatestFactRevision: number;
}>;

export interface ThemeRuntimeCheckpoints {
  capture(documentId: string): Promise<readonly string[] | null>;
  factReviewHash(attemptId: string): Promise<string | null>;
  question(candidateId: string): Promise<{
    questionRevisionId: string;
    questionContentHash: string;
  } | null>;
  repairOrdinal(
    jobId: string,
    repairCandidateId: string,
    candidateCeiling: number
  ): Promise<number | null>;
}

/** Reads identifiers only. Existing repositories revalidate provenance and current eligibility. */
export function createPostgresThemeRuntimeCheckpoints(pool: Pool): ThemeRuntimeCheckpoints {
  return {
    async capture(documentId) {
      const result = await pool.query(
        `SELECT p.id FROM theme_evidence_documents d
         JOIN theme_evidence_passages p ON p.document_id = d.id
         WHERE d.id = $1 ORDER BY p.ordinal`,
        [documentId]
      );
      return result.rows.length ? result.rows.map((row) => String(row.id)) : null;
    },
    async factReviewHash(attemptId) {
      const result = await pool.query(
        `SELECT output_hash FROM theme_fact_review_outcomes
         WHERE attempt_id = $1 AND status = 'reviewed' AND aggregate_verdict = 'pass'`,
        [attemptId]
      );
      return result.rows[0]?.output_hash ?? null;
    },
    async question(candidateId) {
      const result = await pool.query(
        `SELECT q.id, q.content_hash FROM theme_candidates c
         JOIN theme_question_revisions q ON q.candidate_id = c.id AND q.revision = c.revision
         WHERE c.id = $1 AND q.content_hash = c.content_hash`,
        [candidateId]
      );
      const row = result.rows[0];
      return row ? { questionRevisionId: row.id, questionContentHash: row.content_hash } : null;
    },
    async repairOrdinal(jobId, repairCandidateId, candidateCeiling) {
      const prior = await pool.query(
        `SELECT ordinal FROM theme_question_generation_attempts
         WHERE job_id=$1 AND candidate_id=$2`,
        [jobId, repairCandidateId]
      );
      if (prior.rows[0]) return Number(prior.rows[0].ordinal);
      const latest = await pool.query(
        `SELECT COALESCE(max(ordinal),0)::integer AS ordinal
         FROM theme_question_generation_attempts WHERE job_id=$1`,
        [jobId]
      );
      const ordinal = Number(latest.rows[0]?.ordinal ?? 0) + 1;
      return ordinal <= candidateCeiling ? ordinal : null;
    },
  };
}

type Provider<Input, Output> = Readonly<{
  provider: string;
  model: string;
  /** Complete immutable prompt/parameter identity, included in the dispatch fingerprint. */
  requestIdentity: unknown;
  reservedCostMicros: number;
  invoke(input: Input): Promise<{ value: Output; outcome: ThemeBudgetOutcome }>;
}>;
type Input<F> = F extends (input: infer I) => unknown ? I : never;
type Output<F> = F extends (...args: never[]) => infer O ? Awaited<O> : never;
type Pipeline = Pick<
  ThemePreparationWorkerDependencies,
  'preflight' | 'research' | 'retrieve' | 'extract' | 'generate' | 'review' | 'approve' | 'repair'
>;

export type ThemeRuntimePipelineOptions = Readonly<{
  /** The plan and this version must be persisted by the caller before starting the job. */
  planVersion: string;
  /** Durable plan deadline used in every budget replay; never derive this from process time. */
  holdExpiresAt: Date;
  items: readonly ThemeRuntimeSourceItem[];
  preflight: ThemePreparationWorkerDependencies['preflight'];
  checkpoints: ThemeRuntimeCheckpoints;
  derivation: Omit<
    ThemeFactDerivationRequest,
    'canonicalKey' | 'revisionId' | 'expectedLatestRevision' | 'passageIds'
  >;
  providers: {
    proposer: Provider<Input<ThemeFactProposer>, Output<ThemeFactProposer>>;
    factReviewer: Provider<Input<ThemeFactReviewer>, Output<ThemeFactReviewer>>;
    writer: Provider<Input<ThemeQuestionWriter>, Output<ThemeQuestionWriter>>;
    evidenceReviewer: Provider<
      Input<ThemeQuestionEvidenceReviewer>,
      Output<ThemeQuestionEvidenceReviewer>
    >;
    repairer: Provider<Input<ThemeQuestionRepairer>, Output<ThemeQuestionRepairer>>;
  };
  /** S10/S9 QA dependencies must be deterministic and perform zero physical provider calls. */
  qaMode: 'offline';
  /** Explicit injected source transport; there is no implicit network client in this factory. */
  retrieval: Omit<Parameters<typeof retrieveThemeSource>[1], 'registry'>;
}>;

/** Concrete dormant S3-S10 mappings. Live QA/embedding transports require a later budgeted seam. */
export function createThemeRuntimePipeline(
  context: ThemeRuntimeCompositionContext,
  options: ThemeRuntimePipelineOptions
): Pipeline {
  if (
    options.qaMode !== 'offline' ||
    !options.planVersion ||
    !(options.holdExpiresAt instanceof Date) ||
    !Number.isFinite(options.holdExpiresAt.valueOf()) ||
    !options.retrieval.transport ||
    !options.retrieval.lookup ||
    !options.items.length ||
    new Set(options.items.map((item) => item.key)).size !== options.items.length ||
    new Set(options.items.map((item) => item.ordinal)).size !== options.items.length
  )
    throw new ThemePreparationWorkerError('runtime_unavailable', false);
  const { repositories: repos } = context;
  const items = structuredClone(options.items);
  const derivation = structuredClone(options.derivation);
  const snapshotProvider = <I, O>(provider: Provider<I, O>): Provider<I, O> =>
    Object.freeze({ ...provider, requestIdentity: structuredClone(provider.requestIdentity) });
  const providers = {
    proposer: snapshotProvider(options.providers.proposer),
    factReviewer: snapshotProvider(options.providers.factReviewer),
    writer: snapshotProvider(options.providers.writer),
    evidenceReviewer: snapshotProvider(options.providers.evidenceReviewer),
    repairer: snapshotProvider(options.providers.repairer),
  };
  const retrieved = new Map<string, RetrievedThemeSource>();
  const itemFor = (key: string) => {
    const item = items.find((entry) => entry.key === key);
    if (!item) throw new ThemePreparationWorkerError('source_ineligible', false);
    return item;
  };
  const id = (job: ThemeJobRecord, item: ThemeRuntimeSourceItem, stage: string) =>
    themeRuntimeItemId(job.id, options.planVersion, item.key, stage);
  async function dispatch<I, O>(
    job: ThemeJobRecord,
    item: ThemeRuntimeSourceItem,
    stage: string,
    operation: ThemeBudgetOperation,
    provider: Provider<I, O>,
    input: I,
    candidateSlots = 0
  ): Promise<O> {
    if (!job.leaseOwner) throw new ThemePreparationWorkerError('preparation_failed', false);
    try {
      return await context.dispatchProvider({
        jobId: job.id,
        claimToken: job.leaseOwner,
        stableKey: id(job, item, stage),
        operation,
        provider: provider.provider,
        model: provider.model,
        request: { input, identity: structuredClone(provider.requestIdentity) },
        reservedCostMicros: provider.reservedCostMicros,
        candidateSlots,
        holdExpiresAt: options.holdExpiresAt,
        invoke: () => provider.invoke(input),
      });
    } catch (error) {
      // Repository attempts register before dispatch. Retrying a denied callback
      // under the same identity cannot safely create a new attempt.
      if (
        error instanceof ThemePreparationWorkerError &&
        (error.code === 'budget_exhausted' || error.code === 'provider_outcome_unknown')
      )
        throw new ThemePreparationWorkerError(error.code, false);
      throw error;
    }
  }
  async function withProvider<I, O, R>(
    operation: (callback: (input: I) => Promise<O>) => Promise<R>,
    callback: (input: I) => Promise<O>
  ): Promise<R> {
    let providerFailure: unknown;
    try {
      const result = await operation(async (input) => {
        try {
          return await callback(input);
        } catch (error) {
          providerFailure = error;
          throw error;
        }
      });
      if (providerFailure) throw providerFailure;
      return result;
    } catch (error) {
      throw providerFailure ?? error;
    }
  }
  async function capture(job: ThemeJobRecord, item: ThemeRuntimeSourceItem) {
    const documentId = id(job, item, 'document');
    const prior = await options.checkpoints.capture(documentId);
    if (prior) return prior;
    const source = retrieved.get(documentId);
    if (!source) throw new ThemePreparationWorkerError('source_ineligible', false);
    const extraction = extractThemeSource(source);
    if (!extraction.ok) throw new ThemePreparationWorkerError('source_ineligible', false);
    const result = await repos.evidencePersistence.persistCapture({
      documentId,
      source,
      extraction,
      metadata: { title: item.title, language: item.language },
    });
    return result.passageIds;
  }
  async function fact(job: ThemeJobRecord, item: ThemeRuntimeSourceItem) {
    const passageIds = await capture(job, item);
    const derivationAttemptId = id(job, item, 'derive');
    const result = await withProvider<
      Input<ThemeFactProposer>,
      Output<ThemeFactProposer>,
      Awaited<ReturnType<typeof repos.factDerivation.deriveAndPersist>>
    >(
      (callback) =>
        repos.factDerivation.deriveAndPersist(
          {
            ...derivation,
            canonicalKey: item.canonicalFactKey,
            revisionId: id(job, item, 'fact-revision'),
            expectedLatestRevision: item.expectedLatestFactRevision,
            passageIds: [...passageIds],
            provenance: { ...derivation.provenance, attemptId: derivationAttemptId },
          },
          callback
        ),
      (input) => dispatch(job, item, 'derive', 'extract_fact', providers.proposer, input)
    );
    if (result.status !== 'proposed' || !result.persistence || !result.policySatisfied)
      throw new ThemePreparationWorkerError('source_ineligible', false);
    const reviewAttemptId = id(job, item, 'fact-review');
    const review = await withProvider<
      Input<ThemeFactReviewer>,
      Output<ThemeFactReviewer>,
      Awaited<ReturnType<typeof repos.factReview.review>>
    >(
      (callback) =>
        repos.factReview.review(
          {
            attemptId: reviewAttemptId,
            derivationAttemptId,
            factRevisionId: result.persistence!.revisionId,
          },
          callback
        ),
      (input) => dispatch(job, item, 'fact-review', 'review', providers.factReviewer, input)
    );
    if (review.status !== 'reviewed' || review.verdict !== 'pass')
      throw new ThemePreparationWorkerError('source_ineligible', false);
    const reviewHash = await options.checkpoints.factReviewHash(reviewAttemptId);
    if (!reviewHash) throw new ThemePreparationWorkerError('source_ineligible', false);
    return {
      factId: result.persistence.factId,
      factRevisionId: result.persistence.revisionId,
      factContentHash: result.contentHash,
      factReviewAttemptId: reviewAttemptId,
      factReviewOutputHash: reviewHash,
    };
  }
  async function generationRequest(
    job: ThemeJobRecord,
    item: ThemeRuntimeSourceItem
  ): Promise<ThemeQuestionGenerationRequest> {
    return {
      ...(await fact(job, item)),
      jobId: job.id,
      ordinal: item.ordinal,
      attemptId: id(job, item, 'generate'),
      candidateId: id(job, item, 'candidate'),
      questionRevisionId: id(job, item, 'question-revision'),
    };
  }
  async function binding(candidate: ThemeGeneratedCandidate) {
    const value = await options.checkpoints.question(candidate.candidateId);
    if (!value) throw new ThemePreparationWorkerError('source_ineligible', false);
    return { candidateId: candidate.candidateId, ...value };
  }
  async function approveRaw(job: ThemeJobRecord, candidate: ThemeGeneratedCandidate) {
    const item = itemFor(candidate.itemKey);
    return repos.questionApproval.approve({
      ...(await binding(candidate)),
      approvalId: id(job, item, `approval:${candidate.candidateId}`),
      libraryQuestionId: id(job, item, `library-question:${candidate.candidateId}`),
      libraryRevisionId: id(job, item, `library-revision:${candidate.candidateId}`),
    });
  }
  return {
    async preflight(job) {
      const result = await options.preflight(job);
      if (!result.ok) return result;
      if (
        result.work.length !== items.length ||
        result.work.some((item) => !items.some((entry) => entry.key === item.key))
      )
        return { ok: false, code: 'runtime_unavailable' };
      return result;
    },
    async research(job, work) {
      const registry = await repos.sourceRegistry.get(derivation.policy.sourcePolicyVersion);
      if (!registry) throw new ThemePreparationWorkerError('source_ineligible', false);
      for (const entry of work) {
        const item = itemFor(entry.key);
        const resolution = resolveThemeSourceUrl(registry.manifest, item.requestedUrl);
        if (resolution.status !== 'matched')
          throw new ThemePreparationWorkerError('source_ineligible', false);
      }
    },
    async retrieve(job, work) {
      for (const entry of work) {
        const item = itemFor(entry.key);
        const documentId = id(job, item, 'document');
        if (await options.checkpoints.capture(documentId)) continue;
        const result = await retrieveThemeSource(
          {
            requestedUrl: item.requestedUrl,
            sourcePolicyVersion: derivation.policy.sourcePolicyVersion,
          },
          { ...options.retrieval, registry: repos.sourceRegistry }
        );
        if (!result.ok)
          throw new ThemePreparationWorkerError('source_ineligible', result.failure.retryable);
        retrieved.set(documentId, result.value);
      }
    },
    async extract(job, work) {
      for (const entry of work) await fact(job, itemFor(entry.key));
    },
    async generate(job, entry) {
      const item = itemFor(entry.key);
      const request = await generationRequest(job, item);
      const result = await withProvider<
        Input<ThemeQuestionWriter>,
        Output<ThemeQuestionWriter>,
        Awaited<ReturnType<typeof repos.questionGeneration.generate>>
      >(
        (callback) => repos.questionGeneration.generate(request, callback),
        (input) => dispatch(job, item, 'generate', 'generate', providers.writer, input, 1)
      );
      if (result.status !== 'persisted')
        throw new ThemePreparationWorkerError('source_ineligible', false);
      return { itemKey: item.key, candidateId: result.candidateId };
    },
    async review(job, candidate) {
      const item = itemFor(candidate.itemKey);
      const question = await binding(candidate);
      const result = await withProvider<
        Input<ThemeQuestionEvidenceReviewer>,
        Output<ThemeQuestionEvidenceReviewer>,
        Awaited<ReturnType<typeof repos.evidenceReview.review>>
      >(
        (callback) =>
          repos.evidenceReview.review(
            { ...question, attemptId: id(job, item, `question-review:${candidate.candidateId}`) },
            callback
          ),
        (input) =>
          dispatch(
            job,
            item,
            `question-review:${candidate.candidateId}`,
            'review',
            providers.evidenceReviewer,
            input
          )
      );
      return { ...candidate, verdict: result.status === 'reviewed' ? result.verdict : 'fail' };
    },
    async approve(job, candidate) {
      const result = await approveRaw(job, candidate);
      if (result.status === 'approved')
        return {
          status: 'approved',
          approval: {
            ...candidate,
            questionId: result.libraryQuestionId,
          },
        };
      const qa = result.qa;
      return {
        status: 'withheld',
        repairEligible: Boolean(
          qa &&
          ((qa.stage === 'static' && qa.reason === 'static_finding') ||
            (qa.stage === 'quality' && qa.reason === 'quality_adverse'))
        ),
      };
    },
    async repair(job, candidate) {
      const item = itemFor(candidate.itemKey);
      const parent = await approveRaw(job, candidate);
      if (
        parent.status !== 'withheld' ||
        !parent.qa ||
        !(
          (parent.qa.stage === 'static' && parent.qa.reason === 'static_finding') ||
          (parent.qa.stage === 'quality' && parent.qa.reason === 'quality_adverse')
        ) ||
        !parent.qa.evidenceAttemptId
      )
        return { status: 'withheld' };
      const parentBinding = await binding(candidate);
      const request = await generationRequest(job, item);
      const repairOrdinal = await options.checkpoints.repairOrdinal(
        job.id,
        id(job, item, 'repair-candidate'),
        job.candidateCeiling
      );
      if (!repairOrdinal) throw new ThemePreparationWorkerError('candidate_ceiling', false);
      let providerFailure: unknown;
      const remember = async <T>(operation: () => Promise<T>) => {
        try {
          return await operation();
        } catch (error) {
          providerFailure = error;
          throw error;
        }
      };
      const repair = await repos.questionRepair
        .repair(
          {
            parentQaDecision: parent.qa,
            generation: {
              ...request,
              attemptId: id(job, item, 'repair'),
              ordinal: repairOrdinal,
              candidateId: id(job, item, 'repair-candidate'),
              questionRevisionId: id(job, item, 'repair-question-revision'),
              repairOf: {
                parentCandidateId: candidate.candidateId,
                parentQuestionRevisionId: parentBinding.questionRevisionId,
                parentQuestionContentHash: parentBinding.questionContentHash,
                evidenceReviewAttemptId: id(job, item, 'repair-review'),
                failureStage: parent.qa.stage,
                failureReason: parent.qa.reason,
              },
            },
          },
          (input) =>
            remember(() => dispatch(job, item, 'repair', 'repair', providers.repairer, input, 1)),
          (input) =>
            remember(() =>
              dispatch(job, item, 'repair-review', 'review', providers.evidenceReviewer, input)
            )
        )
        .catch((error: unknown) => {
          throw providerFailure ?? error;
        });
      if (providerFailure) throw providerFailure;
      return repair.status === 'passed' && repair.candidateId
        ? {
            status: 'repaired',
            candidate: { itemKey: item.key, candidateId: repair.candidateId, verdict: 'pass' },
          }
        : { status: 'withheld' };
    },
  };
}
