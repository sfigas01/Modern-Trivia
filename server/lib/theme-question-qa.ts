import { createHash } from 'node:crypto';

import type { Question } from '@shared/models/questions';
import { questionContentSnapshotSchema } from '@shared/models/theme-evidence';
import { z } from 'zod';

import type { DetectDuplicatesOptions } from './duplicate-detector';
import { hashQuestionSnapshot } from './theme-evidence-eligibility';
import type { ThemeQuestionQaContext } from './theme-question-evidence-review';
import { auditQuestionQuality } from './question-quality-audit';
import type { FactCheckReport } from './verifier';
import type { DuplicateDetectionReport } from '@shared/models/quality-sweep';

export const THEME_QUESTION_QA_POLICY_VERSION = 'theme-question-qa-v1' as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z
  .object({
    candidateId: z.string().uuid(),
    questionRevisionId: z.string().uuid(),
    questionContentHash: sha256Schema,
  })
  .strict();
const sourceSchema = z
  .object({
    documentId: z.string().uuid(),
    url: z.string().url(),
    name: z.string().trim().min(1).max(255),
  })
  .strict();
const contextSchema = requestSchema
  .extend({
    question: questionContentSnapshotSchema,
    evidenceAttemptId: z.string().uuid(),
    evidenceReviewId: z.string().uuid(),
    evidenceFingerprint: sha256Schema,
    source: sourceSchema,
  })
  .strict();
const corpusSchema = z
  .object({
    revision: z.string().trim().min(1).max(255),
    questions: z.array(
      z
        .object({
          id: z.string().trim().min(1).max(255),
          question: z.string().trim().min(1).max(4_000),
          answer: z.string().trim().min(1).max(1_000),
        })
        .strict()
    ),
  })
  .strict();

export type ThemeQuestionQaRequest = z.infer<typeof requestSchema>;
export type ThemeQuestionQaStage =
  | 'input'
  | 'evidence'
  | 'static'
  | 'quality'
  | 'semantic'
  | 'recheck';
export type ThemeQuestionQaReason =
  | 'passed'
  | 'invalid_context'
  | 'evidence_ineligible'
  | 'static_finding'
  | 'quality_incomplete'
  | 'quality_adverse'
  | 'invalid_corpus'
  | 'semantic_incomplete'
  | 'semantic_match'
  | 'context_changed'
  | 'corpus_changed'
  | 'dependency_failure';

export type ThemeQuestionQaDecision = Readonly<{
  status: 'passed' | 'withheld';
  candidateId: string;
  questionRevisionId: string;
  questionContentHash: string;
  evidenceAttemptId: string | null;
  evidenceReviewId: string | null;
  evidenceFingerprint: string | null;
  corpusRevision: string | null;
  corpusHash: string | null;
  policyVersion: typeof THEME_QUESTION_QA_POLICY_VERSION;
  evaluatedAt: string;
  stage: ThemeQuestionQaStage;
  reason: ThemeQuestionQaReason;
}>;

export class ThemeQuestionQaError extends Error {
  constructor(public readonly code: 'invalid_request' | 'invalid_configuration') {
    super(code);
    this.name = 'ThemeQuestionQaError';
  }
}

type CorpusQuestion = z.infer<typeof corpusSchema>['questions'][number];
export type ThemeQuestionQaDependencies = Readonly<{
  loadContext: (request: ThemeQuestionQaRequest) => Promise<ThemeQuestionQaContext>;
  loadCorpus: () => Promise<{ revision: string; questions: CorpusQuestion[] }>;
  checkQuality: (questions: Question[]) => Promise<FactCheckReport>;
  detectDuplicates: (
    questions: Question[],
    options: DetectDuplicatesOptions
  ) => Promise<DuplicateDetectionReport>;
  now?: () => Date;
}>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function hashCorpus(questions: CorpusQuestion[]): string {
  return hash(
    [...questions]
      .map(({ id, question, answer }) => ({ id, question, answer }))
      .sort((left, right) => left.id.localeCompare(right.id))
  );
}

function sameContext(left: ThemeQuestionQaContext, right: ThemeQuestionQaContext): boolean {
  return canonical(left) === canonical(right);
}

function asQuestion(context: ThemeQuestionQaContext, at: Date): Question {
  return {
    id: context.candidateId,
    ...structuredClone(context.question),
    sourceUrl: context.source.url,
    sourceName: context.source.name,
    status: 'pending',
    origin: 'player_ai',
    aiAnalysis: null,
    createdAt: new Date(at),
    updatedAt: new Date(at),
  };
}

export async function runThemeQuestionQa(
  rawRequest: ThemeQuestionQaRequest,
  dependencies: ThemeQuestionQaDependencies
): Promise<ThemeQuestionQaDecision> {
  const parsedRequest = requestSchema.safeParse(rawRequest);
  if (!parsedRequest.success) throw new ThemeQuestionQaError('invalid_request');
  if (
    !dependencies ||
    typeof dependencies.loadContext !== 'function' ||
    typeof dependencies.loadCorpus !== 'function' ||
    typeof dependencies.checkQuality !== 'function' ||
    typeof dependencies.detectDuplicates !== 'function' ||
    (dependencies.now !== undefined && typeof dependencies.now !== 'function')
  )
    throw new ThemeQuestionQaError('invalid_configuration');

  const request = parsedRequest.data;
  const now = dependencies.now ?? (() => new Date());
  const evaluatedAt = now();
  if (!Number.isFinite(evaluatedAt.valueOf()))
    throw new ThemeQuestionQaError('invalid_configuration');
  const base = {
    candidateId: request.candidateId,
    questionRevisionId: request.questionRevisionId,
    questionContentHash: request.questionContentHash,
    evidenceAttemptId: null,
    evidenceReviewId: null,
    evidenceFingerprint: null,
    corpusRevision: null,
    corpusHash: null,
    policyVersion: THEME_QUESTION_QA_POLICY_VERSION,
    evaluatedAt: evaluatedAt.toISOString(),
  } as const;
  const withheld = (
    stage: ThemeQuestionQaStage,
    reason: ThemeQuestionQaReason,
    values: Partial<ThemeQuestionQaDecision> = {}
  ): ThemeQuestionQaDecision => ({ ...base, ...values, status: 'withheld', stage, reason });

  let context: ThemeQuestionQaContext;
  try {
    const parsed = contextSchema.safeParse(
      await dependencies.loadContext(structuredClone(request))
    );
    if (!parsed.success) return withheld('evidence', 'invalid_context');
    context = parsed.data;
  } catch {
    return withheld('evidence', 'evidence_ineligible');
  }
  const evidence = {
    evidenceAttemptId: context.evidenceAttemptId,
    evidenceReviewId: context.evidenceReviewId,
    evidenceFingerprint: context.evidenceFingerprint,
  };
  if (
    context.candidateId !== request.candidateId ||
    context.questionRevisionId !== request.questionRevisionId ||
    context.questionContentHash !== request.questionContentHash ||
    hashQuestionSnapshot(context.question) !== request.questionContentHash
  )
    return withheld('evidence', 'invalid_context', evidence);

  const question = asQuestion(context, evaluatedAt);
  const audit = auditQuestionQuality([structuredClone(question)]);
  if (audit.findings.length > 0) return withheld('static', 'static_finding', evidence);

  let quality: FactCheckReport;
  try {
    quality = await dependencies.checkQuality([structuredClone(question)]);
  } catch {
    return withheld('quality', 'dependency_failure', evidence);
  }
  const matching = Array.isArray(quality?.results)
    ? quality.results.filter((result) => result?.questionId === request.candidateId)
    : [];
  if (quality?.totalChecked !== 1 || quality?.results?.length !== 1 || matching.length !== 1)
    return withheld('quality', 'quality_incomplete', evidence);
  const verdict = matching[0];
  if (verdict.verdict !== 'pass' || verdict.coherence !== 'pass' || verdict.obviousness !== 'pass')
    return withheld('quality', 'quality_adverse', evidence);

  let corpus: z.infer<typeof corpusSchema>;
  try {
    const parsed = corpusSchema.safeParse(await dependencies.loadCorpus());
    if (!parsed.success) return withheld('semantic', 'invalid_corpus', evidence);
    corpus = parsed.data;
  } catch {
    return withheld('semantic', 'dependency_failure', evidence);
  }
  const ids = new Set(corpus.questions.map((item) => item.id));
  if (ids.size !== corpus.questions.length || ids.has(request.candidateId))
    return withheld('semantic', 'invalid_corpus', evidence);
  const corpusHash = hashCorpus(corpus.questions);
  const corpusValues = { corpusRevision: corpus.revision, corpusHash };
  const semanticInput = [
    ...corpus.questions.map((item) => ({
      ...item,
      ...question,
      id: item.id,
      question: item.question,
      answer: item.answer,
    })),
    structuredClone(question),
  ];
  let semantic: DuplicateDetectionReport;
  try {
    semantic = await dependencies.detectDuplicates(semanticInput, {
      scopeIds: new Set([request.candidateId]),
      cache: null,
      persistIds: new Set<string>(),
    });
  } catch {
    return withheld('semantic', 'dependency_failure', { ...evidence, ...corpusValues });
  }
  if (
    semantic?.status !== 'complete' ||
    semantic.failedPairs !== 0 ||
    semantic.totalPairsChecked !== corpus.questions.length ||
    !Array.isArray(semantic.duplicatesFound)
  )
    return withheld('semantic', 'semantic_incomplete', { ...evidence, ...corpusValues });
  const matchTypeNames = [
    'exact',
    'near_duplicate',
    'conceptual',
    'semantic_duplicate',
    'answer_conflict',
    'review_required',
  ] as const;
  const matchTypes = new Set<string>(matchTypeNames);
  const duplicateCounts = semantic.duplicatesByType as unknown;
  const countsAreValid =
    duplicateCounts !== null &&
    typeof duplicateCounts === 'object' &&
    Object.keys(duplicateCounts).length === matchTypeNames.length &&
    matchTypeNames.every((matchType) => {
      const count = (duplicateCounts as Record<string, unknown>)[matchType];
      return Number.isInteger(count) && Number(count) >= 0;
    });
  const matchesAreValid = (semantic.duplicatesFound as unknown[]).every(
    (match) =>
      match !== null &&
      typeof match === 'object' &&
      typeof (match as { questionIdA?: unknown }).questionIdA === 'string' &&
      typeof (match as { questionIdB?: unknown }).questionIdB === 'string' &&
      matchTypes.has(String((match as { matchType?: unknown }).matchType)) &&
      Number.isFinite((match as { similarityScore?: unknown }).similarityScore)
  );
  if (!countsAreValid || !matchesAreValid)
    return withheld('semantic', 'semantic_incomplete', { ...evidence, ...corpusValues });
  const observedCounts = Object.fromEntries(matchTypeNames.map((matchType) => [matchType, 0]));
  for (const match of semantic.duplicatesFound)
    observedCounts[match.matchType] = (observedCounts[match.matchType] ?? 0) + 1;
  if (
    matchTypeNames.some(
      (matchType) =>
        observedCounts[matchType] !== (duplicateCounts as Record<string, number>)[matchType]
    )
  )
    return withheld('semantic', 'semantic_incomplete', { ...evidence, ...corpusValues });
  if (
    semantic.duplicatesFound.length > 0 &&
    semantic.duplicatesFound.every(
      (match) =>
        match.questionIdA === request.candidateId || match.questionIdB === request.candidateId
    )
  )
    return withheld('semantic', 'semantic_match', { ...evidence, ...corpusValues });
  if (semantic.duplicatesFound.length > 0)
    return withheld('semantic', 'semantic_incomplete', { ...evidence, ...corpusValues });

  let finalContext: ThemeQuestionQaContext;
  let finalCorpus: z.infer<typeof corpusSchema>;
  try {
    const parsedContext = contextSchema.safeParse(
      await dependencies.loadContext(structuredClone(request))
    );
    if (!parsedContext.success)
      return withheld('recheck', 'context_changed', {
        ...evidence,
        ...corpusValues,
      });
    finalContext = parsedContext.data;
    const parsedCorpus = corpusSchema.safeParse(await dependencies.loadCorpus());
    if (!parsedCorpus.success)
      return withheld('recheck', 'corpus_changed', {
        ...evidence,
        ...corpusValues,
      });
    finalCorpus = parsedCorpus.data;
  } catch {
    return withheld('recheck', 'dependency_failure', { ...evidence, ...corpusValues });
  }
  if (!sameContext(context, finalContext))
    return withheld('recheck', 'context_changed', { ...evidence, ...corpusValues });
  if (finalCorpus.revision !== corpus.revision || hashCorpus(finalCorpus.questions) !== corpusHash)
    return withheld('recheck', 'corpus_changed', { ...evidence, ...corpusValues });

  return {
    ...base,
    ...evidence,
    ...corpusValues,
    status: 'passed',
    stage: 'recheck',
    reason: 'passed',
  };
}
