import { createHash, randomUUID } from 'node:crypto';

import type { Pool, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  createPostgresThemeQuestionGenerationRepository,
  projectThemeQuestionWriterOutput,
  runThemeQuestionGenerationTransaction,
  snapshotThemeQuestionWriterInput,
  ThemeQuestionGenerationError,
} from './theme-question-generation';
import { hashQuestionSnapshot } from './theme-evidence-eligibility';
import { hashThemeFactSnapshot } from './theme-fact-derivation';
import { hashThemeSourceRegistry } from './theme-source-registry';
import type { ThemeSourceRegistry } from '@shared/models/theme-source-registry';

const policy = {
  generationPolicyVersion: 'writer-v1',
  sourcePolicyVersion: 'sources-v1',
  extractorVersion: 'extractor-v1',
  allowedSourceClasses: ['primary_record'] as const,
  maxSourceAgeMs: 60_000,
  minimumOriginGroups: 1,
  category: 'History',
  difficulty: 'Medium' as const,
  pillar: 'Recall',
  tags: ['local-history'],
};

const writerInput = {
  contractVersion: 'theme-question-generation-v1' as const,
  fact: {
    id: '6899b1b5-e08e-49b7-9aca-4744e27b66ed',
    revisionId: 'dc363339-8ed5-456d-9b42-841b50c24528',
    contentHash: 'a'.repeat(64),
    statement: 'The event occurred in the city.',
    scope: { entity: 'event', relation: 'location' },
    canonicalAnswer: 'Halifax',
    supportedAliases: ['Halifax, Nova Scotia'],
  },
  evidence: [
    {
      passageId: '52ddf64e-1dd2-43ab-8122-4360f9a2d687',
      passageContentHash: 'b'.repeat(64),
      text: 'The record places the event in Halifax.',
      originGroup: 'archive-one',
      sourceClass: 'primary_record' as const,
      supportKind: 'supports' as const,
    },
  ],
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function sha(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function fakePool(query: (sql: string) => Promise<unknown> = async () => ({})) {
  const client = {
    query: vi.fn(async (sql: string) => query(sql)),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) };
  return { pool: pool as unknown as Pool, client };
}

function repositoryFixture() {
  const sourcePolicyVersion = 's7-test-source-policy';
  const extractorVersion = 's7-test-extractor';
  const nowMs = Date.parse('2026-09-28T12:00:00.123Z');
  const ids = {
    job: randomUUID(),
    game: randomUUID(),
    fact: randomUUID(),
    revision: randomUUID(),
    derivation: randomUUID(),
    review: randomUUID(),
    reviewExecution: randomUUID(),
    derivationExecution: randomUUID(),
    passage: randomUUID(),
    document: randomUUID(),
  };
  const registry: ThemeSourceRegistry = {
    contractVersion: 'theme-source-registry-v1',
    sourcePolicyVersion,
    entries: [
      {
        id: 'archive',
        publisherId: 'archive',
        publisherName: 'Archive',
        originGroup: 'archive-origin',
        sourceClass: 'primary_record',
        scope: { topics: [], languages: ['en'], geographies: [], temporal: null },
        origins: [
          { origin: 'https://archive.example.test', paths: [{ kind: 'subtree', path: '/' }] },
        ],
      },
    ],
  };
  const registryHash = hashThemeSourceRegistry(registry);
  const text = 'The fictional event occurred in 1901.';
  const passageHash = createHash('sha256').update(text).digest('hex');
  const retrievedAt = new Date(nowMs - 60_000);
  const sourceExpiry = new Date(nowMs + 2 * 60 * 60 * 1000);
  const factSnapshot = {
    statement: text,
    scope: {
      entity: 'fictional event',
      relation: 'year',
      time: '1901',
      geography: null,
      competitionOrDomain: null,
      qualifiers: [],
      asOf: null,
    },
    canonicalAnswer: '1901',
    supportedAliases: [],
    timeSensitive: false,
    validUntil: null,
  };
  const factHash = hashThemeFactSnapshot(factSnapshot as never);
  const documentSnapshot = {
    contractVersion: 'theme-reliability-v1',
    id: ids.document,
    requestedUrl: 'https://archive.example.test/record',
    finalUrl: 'https://archive.example.test/record',
    canonicalUrl: 'https://archive.example.test/record',
    publisherId: 'archive',
    sourceClass: 'primary_record',
    publisher: 'Archive',
    originGroup: 'archive-origin',
    sourcePolicyVersion,
    extractorVersion,
    title: 'Record',
    language: 'en',
    status: 'retrieved',
    contentHash: 'c'.repeat(64),
    retrievedAt: retrievedAt.toISOString(),
    publishedAt: null,
    sourceUpdatedAt: null,
    validUntil: sourceExpiry.toISOString(),
    httpStatus: 200,
    mediaType: 'text/plain',
  };
  const citation = {
    passageId: ids.passage,
    passageContentHash: passageHash,
    supportKind: 'supports',
  };
  const derivationPolicy = {
    sourcePolicyVersion,
    extractorVersion,
    allowedSourceClasses: ['primary_record'],
    maxSourceAgeMs: 4 * 60 * 60 * 1000,
    minimumOriginGroups: 1,
    timeSensitiveTtlMs: 60 * 60 * 1000,
  };
  const inputManifest = {
    passageIds: [ids.passage],
    policy: derivationPolicy,
    evidence: {
      passages: [
        {
          passageId: ids.passage,
          passageContentHash: passageHash,
          ordinal: 0,
          locator: 'record paragraph',
          document: documentSnapshot,
          registryBinding: { sourcePolicyVersion, registryHash, entryId: 'archive' },
          registry: {
            contractVersion: 'theme-source-registry-v1',
            sourcePolicyVersion,
            manifestHash: registryHash,
          },
        },
      ],
    },
  };
  const inputFingerprint = sha(inputManifest);
  const proposalSnapshot = {
    status: 'proposed',
    snapshot: factSnapshot,
    citations: [citation],
    supportOriginCount: 1,
    policySatisfied: true,
    persistence: null,
    contentHash: factHash,
  };
  const derivationRow = {
    id: ids.derivation,
    execution_id: ids.derivationExecution,
    producer_kind: 'model',
    producer_id: 'fact-producer',
    provider: 'provider-a',
    model: 'model-a',
    input_fingerprint: inputFingerprint,
    policy_snapshot: derivationPolicy,
    policy_hash: sha(derivationPolicy),
    input_manifest: inputManifest,
    outcome: 'persisted',
    proposal_snapshot: proposalSnapshot,
    derivation_output_hash: sha(proposalSnapshot),
    outcome_revision_id: ids.revision,
    fact_content_hash: factHash,
    bindings_fingerprint: sha([citation]),
  };
  const evidenceFingerprint = sha({
    inputFingerprint,
    fact: factSnapshot,
    edges: [{ passageId: ids.passage, supportKind: 'supports' }],
  });
  const reviewPolicy = {
    sourcePolicyVersion,
    extractorVersion,
    allowedSourceClasses: ['primary_record'],
    minimumOriginGroups: 1,
    maxSourceAgeMs: 4 * 60 * 60 * 1000,
    validForMs: 60 * 60 * 1000,
  };
  const reviewPromptText = 'Review the exact fact and all offered evidence.';
  const reviewInput = {
    contractVersion: 'theme-fact-review-v1',
    statement: factSnapshot.statement,
    scope: factSnapshot.scope,
    canonicalAnswer: factSnapshot.canonicalAnswer,
    supportedAliases: factSnapshot.supportedAliases,
    evidence: [
      {
        passageId: ids.passage,
        passageContentHash: passageHash,
        text,
        originGroup: 'archive-origin',
        supportKind: 'supports',
      },
    ],
  };
  const reviewDimensions = {
    entailment: {
      verdict: 'pass',
      reasons: ['supported'],
      passageRefs: [{ passageId: ids.passage, passageContentHash: passageHash }],
    },
    scope: {
      verdict: 'pass',
      reasons: ['scope_match'],
      passageRefs: [{ passageId: ids.passage, passageContentHash: passageHash }],
    },
    canonical_answer: {
      verdict: 'pass',
      reasons: ['answer_supported'],
      passageRefs: [{ passageId: ids.passage, passageContentHash: passageHash }],
    },
    aliases: { verdict: 'pass', reasons: ['no_aliases'], passageRefs: [] },
    conflict: {
      verdict: 'pass',
      reasons: ['no_conflict'],
      passageRefs: [{ passageId: ids.passage, passageContentHash: passageHash }],
    },
    source_independence: {
      verdict: 'pass',
      reasons: ['independent_origins'],
      passageRefs: [{ passageId: ids.passage, passageContentHash: passageHash }],
    },
  };
  const reviewOutputHash = sha({ dimensions: reviewDimensions });
  const reviewRow = {
    id: ids.review,
    derivation_attempt_id: ids.derivation,
    fact_revision_id: ids.revision,
    fact_content_hash: factHash,
    review_sequence: 1,
    reviewer_kind: 'model',
    reviewer_id: 'fact-reviewer',
    provider: 'provider-b',
    model: 'model-b',
    execution_id: ids.reviewExecution,
    input_manifest: { inputFingerprint, evidenceFingerprint },
    input_fingerprint: sha(reviewInput),
    review_policy_version: 'review-policy-v1',
    policy_hash: sha(reviewPolicy),
    prompt_version: 'review-prompt-v1',
    prompt_hash: createHash('sha256').update(reviewPromptText).digest('hex'),
    outcome_status: 'reviewed',
    aggregate_verdict: 'pass',
    dimensions: reviewDimensions,
    review_output_hash: reviewOutputHash,
    valid_until: new Date(nowMs + 60_000),
    failure_code: null,
  };
  const evidenceRow = {
    passage: {
      id: ids.passage,
      contract_version: 'theme-reliability-v1',
      document_id: ids.document,
      ordinal: 0,
      locator: 'record paragraph',
      passage_text: text,
      content_hash: passageHash,
    },
    document: {
      id: ids.document,
      contract_version: 'theme-reliability-v1',
      requested_url: documentSnapshot.requestedUrl,
      final_url: documentSnapshot.finalUrl,
      canonical_url: documentSnapshot.canonicalUrl,
      publisher_id: 'archive',
      source_class: 'primary_record',
      publisher: 'Archive',
      origin_group: 'archive-origin',
      source_policy_version: sourcePolicyVersion,
      extractor_version: extractorVersion,
      title: 'Record',
      language: 'en',
      status: 'retrieved',
      content_hash: documentSnapshot.contentHash,
      retrieved_at: retrievedAt,
      published_at: null,
      source_updated_at: null,
      valid_until: sourceExpiry,
      http_status: 200,
      media_type: 'text/plain',
    },
    binding: {
      source_policy_version: sourcePolicyVersion,
      registry_hash: registryHash,
      entry_id: 'archive',
    },
    registry: {
      contract_version: 'theme-source-registry-v1',
      source_policy_version: sourcePolicyVersion,
      manifest_hash: registryHash,
      manifest: registry,
    },
  };
  const factRow = {
    fact_id: ids.fact,
    canonical_key: 'fictional-event-year',
    fact_revision_id: ids.revision,
    contract_version: 'theme-reliability-v1',
    revision: 1,
    ...factSnapshot,
    supported_aliases: [],
    canonical_answer: factSnapshot.canonicalAnswer,
    content_hash: factHash,
    time_sensitive: false,
    valid_until: null,
  };
  const rows = [reviewRow];
  const state: {
    header?: Record<string, any>;
    outcome?: Record<string, any>;
    candidate?: Record<string, any>;
    revision?: Record<string, any>;
    repairParent?: Record<string, any>;
    edgeKind: string;
    nowMs: number;
    advanceOnFactLockMs: number;
    commitUnknown: boolean;
    reviews: Record<string, any>[];
    existingCandidateIds: Set<string>;
    existingQuestionRevisionIds: Set<string>;
    candidateInsertConflict: boolean;
  } = {
    edgeKind: 'supports',
    nowMs,
    advanceOnFactLockMs: 0,
    commitUnknown: false,
    reviews: rows,
    existingCandidateIds: new Set(),
    existingQuestionRevisionIds: new Set(),
    candidateInsertConflict: false,
  };
  const result = (items: unknown[] = []) =>
    ({ rows: items, rowCount: items.length }) as QueryResult;
  const contextQuery = async (sql: string, values: any[] = []) => {
    if (sql.includes('FROM theme_preparation_jobs'))
      return result([{ id: ids.job, candidate_ceiling: 2, theme_slug: 'fictional-history' }]);
    if (sql.includes('FROM theme_facts f JOIN theme_fact_revisions')) return result([factRow]);
    if (sql.includes('SELECT id FROM theme_fact_revisions')) return result([{ id: ids.revision }]);
    if (sql.includes('FROM theme_fact_derivation_attempts')) return result([derivationRow]);
    if (sql.includes('SELECT to_jsonb(p)')) return result([evidenceRow]);
    if (sql.includes('SELECT passage_id, support_kind'))
      return result([{ passage_id: ids.passage, support_kind: state.edgeKind }]);
    if (sql.includes('FROM theme_fact_review_attempts')) return result(state.reviews);
    if (sql.includes('SELECT c.*') && sql.includes('generation_parent_candidate_id'))
      return result(state.repairParent ? [state.repairParent] : []);
    if (sql.includes('SELECT id FROM theme_candidates WHERE id = $1'))
      return result(
        state.existingCandidateIds.has(values[0]) || state.candidate?.id === values[0]
          ? [{ id: values[0] }]
          : []
      );
    if (sql.includes('SELECT id FROM theme_question_revisions WHERE id = $1'))
      return result(
        state.existingQuestionRevisionIds.has(values[0]) || state.revision?.id === values[0]
          ? [{ id: values[0] }]
          : []
      );
    if (sql.includes('SELECT * FROM theme_question_generation_attempts'))
      return result(state.header?.id === values[0] ? [state.header] : []);
    if (sql.includes('SELECT * FROM theme_question_generation_outcomes'))
      return result(state.outcome?.attempt_id === values[0] ? [state.outcome] : []);
    if (sql.includes('FROM theme_candidates c JOIN theme_question_revisions'))
      return result(
        state.candidate && state.revision ? [{ ...state.candidate, ...state.revision }] : []
      );
    if (sql.includes('SELECT id FROM theme_candidates WHERE job_id'))
      return result(
        state.candidate?.job_id === values[0] && state.candidate?.ordinal === values[1]
          ? [{ id: state.candidate.id }]
          : []
      );
    throw new Error(`unexpected query ${sql}`);
  };
  const pool = {
    query: async (sql: string, values: any[] = []) => contextQuery(sql, values),
    connect: async () => {
      const client = {
        query: async (sql: string, values: any[] = []) => {
          if (sql === 'BEGIN' || sql === 'ROLLBACK') return result();
          if (sql === 'COMMIT') {
            if (state.commitUnknown) {
              state.commitUnknown = false;
              throw new Error('commit outcome unknown');
            }
            return result();
          }
          if (sql.includes('SELECT id FROM theme_facts')) {
            state.nowMs += state.advanceOnFactLockMs;
            return result([{ id: ids.fact }]);
          }
          if (sql.includes('FOR UPDATE') && sql.includes('theme_fact_revisions'))
            return result([{ id: ids.revision }]);
          if (sql.includes('SELECT * FROM theme_question_generation_attempts'))
            return result(state.header?.id === values[0] ? [state.header] : []);
          if (sql.includes('INSERT INTO theme_question_generation_attempts')) {
            if (
              state.header &&
              (state.header.candidate_id === values[4] ||
                state.header.question_revision_id === values[5])
            )
              throw Object.assign(new Error('unique attempt target collision'), { code: '23505' });
            state.header = {
              id: values[0],
              contract_version: values[1],
              job_id: values[2],
              ordinal: values[3],
              candidate_id: values[4],
              question_revision_id: values[5],
              parent_candidate_id: values[6],
              parent_question_revision_id: values[7],
              parent_question_content_hash: values[8],
              fact_id: values[9],
              fact_revision_id: values[10],
              fact_content_hash: values[11],
              fact_review_attempt_id: values[12],
              fact_review_verdict: 'pass',
              fact_review_output_hash: values[13],
              writer_kind: values[14],
              writer_id: values[15],
              provider: values[16],
              model: values[17],
              execution_id: values[18],
              generation_policy_version: values[19],
              policy_snapshot: JSON.parse(values[20]),
              policy_hash: values[21],
              prompt_version: values[22],
              prompt_hash: values[23],
              prompt_snapshot: values[24],
              input_manifest: JSON.parse(values[25]),
              input_fingerprint: values[26],
              eligibility_fingerprint: values[27],
              evaluated_at: values[28],
            };
            return result();
          }
          if (sql.includes('INSERT INTO theme_candidates')) {
            if (state.candidateInsertConflict)
              throw Object.assign(new Error('external candidate id collision'), { code: '23505' });
            state.candidate = {
              id: values[0],
              job_id: values[1],
              attempt_id: null,
              parent_candidate_id: values[2],
              fact_id: values[3],
              fact_revision_id: values[4],
              ordinal: values[5],
              revision: 1,
              status: 'pending',
              content_hash: values[6],
              content: JSON.parse(values[7]),
            };
            return result();
          }
          if (sql.includes('INSERT INTO theme_question_revisions')) {
            state.revision = {
              id: values[0],
              revision_contract: values[1],
              question_revision: 1,
              candidate_id: values[2],
              revision_content_hash: values[3],
              revision_content: JSON.parse(values[4]),
            };
            return result();
          }
          if (sql.includes('INSERT INTO theme_question_generation_outcomes')) {
            state.outcome = {
              attempt_id: values[0],
              status: sql.includes("'failed'") ? 'failed' : values[10],
              question_content_hash: sql.includes("'failed'") ? null : values[11],
              failure_code: sql.includes("'candidate_conflict'")
                ? 'candidate_conflict'
                : sql.includes("'failed'")
                  ? values[12]
                  : values[12],
            };
            return result();
          }
          return contextQuery(sql, values);
        },
        release: vi.fn(),
      };
      return client;
    },
  } as unknown as Pool;
  const config = {
    executionId: randomUUID(),
    writer: {
      kind: 'model' as const,
      id: 'question-writer',
      provider: 'provider-c',
      model: 'model-c',
    },
    generationPolicy: {
      generationPolicyVersion: 'writer-v1',
      sourcePolicyVersion,
      extractorVersion,
      allowedSourceClasses: ['primary_record' as const],
      maxSourceAgeMs: 4 * 60 * 60 * 1000,
      minimumOriginGroups: 1,
      category: 'History',
      difficulty: 'Medium' as const,
      pillar: 'Recall',
      tags: ['history'],
    },
    promptVersion: 'writer-prompt-v1',
    promptText: 'Write one concise question.',
    factReviewPolicyVersion: 'review-policy-v1',
    factReviewPolicy: reviewPolicy,
    factReviewPromptVersion: 'review-prompt-v1',
    factReviewPromptText: reviewPromptText,
  };
  const request = {
    attemptId: randomUUID(),
    jobId: ids.job,
    ordinal: 1,
    candidateId: randomUUID(),
    questionRevisionId: randomUUID(),
    factId: ids.fact,
    factRevisionId: ids.revision,
    factContentHash: factHash,
    factReviewAttemptId: ids.review,
    factReviewOutputHash: reviewOutputHash,
  };
  return {
    state,
    pool,
    config,
    request,
    repository: createPostgresThemeQuestionGenerationRepository(
      pool,
      config,
      () => new Date(state.nowMs)
    ),
  };
}

function repairFixture() {
  const fixture = repositoryFixture();
  const parentCandidateId = randomUUID();
  const parentRevisionId = randomUUID();
  const parentContent = {
    question: 'In which year did the fictional event occur?',
    answer: '1901',
    acceptableAnswers: [],
    explanation: 'The record states the year.',
    category: 'History',
    difficulty: 'Medium' as const,
    pillar: 'Recall',
    tags: ['history'],
    themeSlug: 'fictional-history',
  };
  const parentHash = hashQuestionSnapshot(parentContent);
  fixture.state.repairParent = {
    id: parentCandidateId,
    job_id: fixture.request.jobId,
    fact_id: fixture.request.factId,
    fact_revision_id: fixture.request.factRevisionId,
    ordinal: 1,
    revision: 1,
    status: 'pending',
    content_hash: parentHash,
    content: parentContent,
    parent_candidate_id: null,
    parent_revision_id: parentRevisionId,
    parent_revision_contract: 'theme-reliability-v1',
    parent_revision_number: 1,
    parent_revision_hash: parentHash,
    parent_revision_content: parentContent,
    generation_parent_candidate_id: null,
  };
  return {
    ...fixture,
    parentContent,
    parentHash,
    request: {
      ...fixture.request,
      ordinal: 2,
      repairOf: {
        parentCandidateId,
        parentQuestionRevisionId: parentRevisionId,
        parentQuestionContentHash: parentHash,
        evidenceReviewAttemptId: randomUUID(),
        failureStage: 'static' as const,
        failureReason: 'static_finding' as const,
      },
    },
  };
}

describe('theme question generation safety', () => {
  it.each(['candidate', 'question revision'] as const)(
    'rejects a pre-existing %s id before registering or dispatching',
    async (target) => {
      const f = repositoryFixture();
      if (target === 'candidate') f.state.existingCandidateIds.add(f.request.candidateId);
      else f.state.existingQuestionRevisionIds.add(f.request.questionRevisionId);
      const writer = vi.fn(() => ({
        status: 'candidate' as const,
        question: 'In which year did the event occur?',
        explanation: 'The record states the year.',
      }));

      await expect(f.repository.generate(f.request, writer)).rejects.toMatchObject({
        code: 'candidate_conflict',
      });
      expect(writer).not.toHaveBeenCalled();
      expect(f.state.header).toBeUndefined();
      expect(f.state.outcome).toBeUndefined();
    }
  );

  it('reserves candidate and revision ids across concurrent generation attempts', async () => {
    const f = repositoryFixture();
    let releaseWriter!: () => void;
    let signalWriterEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalWriterEntered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const firstWriter = vi.fn(async () => {
      signalWriterEntered();
      await blocked;
      return {
        status: 'candidate' as const,
        question: 'In which year did the event occur?',
        explanation: 'The record states the year.',
      };
    });
    const first = f.repository.generate(f.request, firstWriter);
    await entered;
    const secondWriter = vi.fn(() => ({
      status: 'candidate' as const,
      question: 'In which year did the event occur?',
      explanation: 'The record states the year.',
    }));
    const secondRequest = {
      ...f.request,
      attemptId: randomUUID(),
      ordinal: 2,
    };
    await expect(f.repository.generate(secondRequest, secondWriter)).rejects.toMatchObject({
      code: 'candidate_conflict',
    });
    expect(secondWriter).not.toHaveBeenCalled();
    releaseWriter();
    await expect(first).resolves.toMatchObject({ status: 'persisted' });
    expect(firstWriter).toHaveBeenCalledTimes(1);
  });

  it('stores a terminal conflict outcome if a candidate id is occupied after dispatch starts', async () => {
    const f = repositoryFixture();
    const writer = vi.fn(() => {
      f.state.candidateInsertConflict = true;
      return {
        status: 'candidate' as const,
        question: 'In which year did the event occur?',
        explanation: 'The record states the year.',
      };
    });
    const first = await f.repository.generate(f.request, writer);
    expect(first).toMatchObject({ status: 'failed', failureCode: 'candidate_conflict' });
    const replay = await f.repository.generate(f.request, writer);
    expect(replay).toEqual(first);
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it('stores an unchanged repair as a terminal failure without creating a child candidate', async () => {
    const f = repairFixture();
    const writer = vi.fn(() => ({
      status: 'candidate' as const,
      question: f.parentContent.question,
      explanation: f.parentContent.explanation,
    }));

    const first = await f.repository.generate(f.request, writer);
    expect(first).toMatchObject({ status: 'failed', failureCode: 'repair_unchanged' });
    expect(f.state.header).toMatchObject({
      parent_candidate_id: f.request.repairOf.parentCandidateId,
    });
    expect(f.state.candidate).toBeUndefined();
    const replay = await f.repository.generate(f.request, writer);
    expect(replay).toEqual(first);
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it('persists a changed repair as one linked child while preserving trusted answer fields', async () => {
    const f = repairFixture();
    const writer = vi.fn(() => ({
      status: 'candidate' as const,
      question: 'What year is assigned to the fictional event in the archived record?',
      explanation: 'The archived record assigns the event to that year.',
    }));

    const decision = await f.repository.generate(f.request, writer);
    expect(decision).toMatchObject({ status: 'persisted' });
    expect(f.state.candidate).toMatchObject({
      parent_candidate_id: f.request.repairOf.parentCandidateId,
      ordinal: 2,
      content: {
        answer: '1901',
        acceptableAnswers: [],
        question: 'What year is assigned to the fictional event in the archived record?',
      },
    });
  });

  it('rejects a repair whose parent is already a repair child before dispatch', async () => {
    const f = repairFixture();
    f.state.repairParent!.generation_parent_candidate_id = randomUUID();
    const writer = vi.fn(() => ({ status: 'declined' as const }));

    await expect(f.repository.generate(f.request, writer)).rejects.toMatchObject({
      code: 'repair_conflict',
    });
    expect(writer).not.toHaveBeenCalled();
  });

  it('rejects a repair policy that would change protected parent content', async () => {
    const f = repairFixture();
    const repository = createPostgresThemeQuestionGenerationRepository(
      f.pool,
      {
        ...f.config,
        generationPolicy: { ...f.config.generationPolicy, category: 'Sports' },
      },
      () => new Date(f.state.nowMs)
    );
    const writer = vi.fn(() => ({ status: 'declined' as const }));

    await expect(repository.generate(f.request, writer)).rejects.toMatchObject({
      code: 'repair_conflict',
    });
    expect(writer).not.toHaveBeenCalled();
  });

  it('persists through generate() and replays without redispatch after a candidate status change', async () => {
    const f = repositoryFixture();
    f.state.advanceOnFactLockMs = 20_000;
    const writer = vi.fn(() => ({
      status: 'candidate' as const,
      question: 'In which year did the event occur?',
      explanation: 'The record states the year.',
    }));
    const first = await f.repository.generate(f.request, writer);
    expect(first.status).toBe('persisted');
    expect(f.state.header?.evaluated_at).toBe('2026-09-28T12:00:20.123Z');
    expect(writer).toHaveBeenCalledTimes(1);
    f.state.candidate!.status = 'accepted';

    const replay = await f.repository.generate(f.request, writer);
    expect(replay).toEqual(first);
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it('stores ineligible after an evidence change during the writer callback and replays it', async () => {
    const f = repositoryFixture();
    const writer = vi.fn(() => {
      f.state.edgeKind = 'conflicts';
      return {
        status: 'candidate' as const,
        question: 'In which year did the event occur?',
        explanation: 'The record states the year.',
      };
    });
    const first = await f.repository.generate(f.request, writer);
    expect(first).toMatchObject({ status: 'ineligible', failureCode: 'ineligible' });
    const replay = await f.repository.generate(f.request, writer);
    expect(replay).toEqual(first);
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it('blocks an older passing review when a newer adverse review arrives during the callback', async () => {
    const f = repositoryFixture();
    const writer = vi.fn(() => {
      const currentReview = f.state.reviews[0];
      if (currentReview)
        f.state.reviews.push({
          ...currentReview,
          id: randomUUID(),
          review_sequence: 2,
          outcome_status: 'failed',
          aggregate_verdict: null,
          dimensions: null,
          review_output_hash: null,
          valid_until: null,
          failure_code: 'reviewer_failure',
        });
      return {
        status: 'candidate' as const,
        question: 'In which year did the event occur?',
        explanation: 'The record states the year.',
      };
    });
    const result = await f.repository.generate(f.request, writer);
    expect(result).toMatchObject({ status: 'ineligible', failureCode: 'ineligible' });
    expect(f.state.outcome?.status).toBe('ineligible');
  });

  it('leaves a committed header unresolved after an uncertain registration commit without redispatch', async () => {
    const f = repositoryFixture();
    f.state.commitUnknown = true;
    const writer = vi.fn(() => ({
      status: 'candidate' as const,
      question: 'In which year did the event occur?',
      explanation: 'The record states the year.',
    }));
    await expect(f.repository.generate(f.request, writer)).rejects.toMatchObject({
      code: 'storage_unknown_outcome',
    });
    await expect(f.repository.generate(f.request, writer)).rejects.toMatchObject({
      code: 'attempt_unresolved',
    });
    expect(writer).not.toHaveBeenCalled();
  });

  it('rejects generation source policy mismatch before invoking the writer', async () => {
    const f = repositoryFixture();
    const mismatched = createPostgresThemeQuestionGenerationRepository(
      f.pool,
      {
        ...f.config,
        generationPolicy: { ...f.config.generationPolicy, sourcePolicyVersion: 'other-policy' },
      },
      () => new Date(f.state.nowMs)
    );
    const writer = vi.fn(() => ({
      status: 'candidate' as const,
      question: 'In which year did the event occur?',
      explanation: 'The record states the year.',
    }));
    await expect(mismatched.generate(f.request, writer)).rejects.toMatchObject({
      code: 'ineligible',
    });
    expect(writer).not.toHaveBeenCalled();
  });

  it('resamples eligibility after registration locks and does not consume a slot if it expired while waiting', async () => {
    const f = repositoryFixture();
    f.state.advanceOnFactLockMs = 61_000;
    const writer = vi.fn(() => ({
      status: 'candidate' as const,
      question: 'In which year did the event occur?',
      explanation: 'The record states the year.',
    }));
    await expect(f.repository.generate(f.request, writer)).rejects.toMatchObject({
      code: 'ineligible',
    });
    expect(writer).not.toHaveBeenCalled();
    expect(f.state.header).toBeUndefined();
    expect(f.state.outcome).toBeUndefined();
    expect(f.state.nowMs).toBe(Date.parse('2026-09-28T12:01:01.123Z'));
  });

  it('isolates callback mutations and projects only writer-authored fields', () => {
    const stable = snapshotThemeQuestionWriterInput(writerInput);
    const callbackInput = structuredClone(stable);
    callbackInput.fact.contentHash = 'c'.repeat(64);
    callbackInput.fact.canonicalAnswer = 'Mutated answer';
    callbackInput.fact.supportedAliases.push('Mutated alias');
    callbackInput.evidence[0]!.passageContentHash = 'd'.repeat(64);

    const result = projectThemeQuestionWriterOutput(
      {
        status: 'candidate',
        question: 'In which city did the event occur?',
        explanation: 'The archived record places it in Halifax.',
      },
      stable,
      policy,
      'halifax-history'
    );
    expect(result.status).toBe('candidate');
    if (result.status !== 'candidate') throw new Error('expected candidate');
    expect(result.content).toMatchObject({
      answer: 'Halifax',
      acceptableAnswers: ['Halifax, Nova Scotia'],
      category: 'History',
      difficulty: 'Medium',
      pillar: 'Recall',
      tags: ['local-history'],
      themeSlug: 'halifax-history',
    });
    expect(stable.fact.contentHash).toBe('a'.repeat(64));
    expect(stable.evidence[0]?.passageContentHash).toBe('b'.repeat(64));
  });

  it('rejects an unmatched trailing surrogate but accepts a valid surrogate pair', () => {
    const input = snapshotThemeQuestionWriterInput(writerInput);
    expect(
      projectThemeQuestionWriterOutput(
        { status: 'candidate', question: 'Bad \ud800', explanation: 'Explanation.' },
        input,
        policy,
        'halifax-history'
      ).status
    ).toBe('invalid_output');
    expect(
      projectThemeQuestionWriterOutput(
        { status: 'candidate', question: 'Good \ud83d\ude00', explanation: 'Explanation.' },
        input,
        policy,
        'halifax-history'
      ).status
    ).toBe('candidate');
  });

  it('reports known rollback failures as storage_failure', async () => {
    const { pool, client } = fakePool(async (sql) => {
      if (sql === 'ROLLBACK') throw new Error('rollback connection failed');
      return {};
    });
    await expect(
      runThemeQuestionGenerationTransaction(pool, async () => {
        throw new Error('write rejected');
      })
    ).rejects.toMatchObject<Partial<ThemeQuestionGenerationError>>({ code: 'storage_failure' });
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledWith(expect.any(Error));
  });

  it('reports commit-started failures as storage_unknown_outcome', async () => {
    const commitError = new Error('connection dropped after commit started');
    const { pool, client } = fakePool(async (sql) => {
      if (sql === 'COMMIT') throw commitError;
      return {};
    });
    await expect(
      runThemeQuestionGenerationTransaction(pool, async () => 'written')
    ).rejects.toMatchObject<Partial<ThemeQuestionGenerationError>>({
      code: 'storage_unknown_outcome',
    });
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'COMMIT']);
    expect(client.release).toHaveBeenCalledWith(commitError);
  });
});
