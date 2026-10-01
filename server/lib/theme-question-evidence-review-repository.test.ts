import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EVIDENCE_DIMENSIONS,
  THEME_RELIABILITY_CONTRACT_VERSION,
} from '@shared/models/theme-evidence';
import { hashQuestionSnapshot } from './theme-evidence-eligibility';

vi.mock('./theme-question-generation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./theme-question-generation')>()),
  loadGenerationContext: vi.fn(),
}));
vi.mock('./theme-fact-review-eligibility', () => ({
  evaluateThemeFactReviewEligibility: vi.fn(() => ({
    eligible: true,
    attemptId: id(5),
    fingerprint: 'f'.repeat(64),
  })),
}));
vi.mock('./theme-evidence-eligibility', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./theme-evidence-eligibility')>()),
  evaluateThemeEvidenceEligibility: vi.fn(() => ({
    eligible: true,
    reason: 'eligible',
    reviewId: id(9),
    fingerprint: 'e'.repeat(64),
  })),
}));

import { loadGenerationContext } from './theme-question-generation';
import { createPostgresThemeQuestionEvidenceReviewRepository } from './theme-question-evidence-review';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = new Date('2026-09-30T12:00:00.000Z');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const hashText = (value: string) => createHash('sha256').update(value).digest('hex');

function fixture() {
  const content = {
    question: 'Which city hosted the first final?',
    answer: 'Ottawa',
    acceptableAnswers: [],
    explanation: 'The final took place in Ottawa.',
    category: 'History',
    difficulty: 'Medium' as const,
    pillar: 'TimeCapsule',
    tags: [],
    themeSlug: 'history',
  };
  const contentHash = hashQuestionSnapshot(content);
  const generationPolicy = {
    generationPolicyVersion: 'generation-v1',
    sourcePolicyVersion: 'sources-v1',
    extractorVersion: 'extractor-v1',
    allowedSourceClasses: ['primary_record'],
    maxSourceAgeMs: 7 * 86400_000,
    minimumOriginGroups: 1,
    category: 'History',
    difficulty: 'Medium',
    pillar: 'TimeCapsule',
    tags: [],
  };
  const factReviewPolicy = {
    sourcePolicyVersion: 'sources-v1',
    extractorVersion: 'extractor-v1',
    allowedSourceClasses: ['primary_record'],
    minimumOriginGroups: 1,
    maxSourceAgeMs: 7 * 86400_000,
    validForMs: 7 * 86400_000,
  };
  const policySnapshot = {
    generationPolicy,
    factReviewPolicyVersion: 'fact-review-v1',
    factReviewPolicy,
    factReviewPolicyHash: hash(factReviewPolicy),
    factReviewPromptVersion: 'fact-prompt-v1',
    factReviewPromptHash: hashText('fact prompt'),
    themeSlug: 'history',
  };
  const inputManifest = { evidence: 'bounded' };
  const generation = {
    id: id(1),
    job_id: id(2),
    ordinal: 1,
    candidate_id: id(3),
    question_revision_id: id(4),
    fact_id: id(6),
    fact_revision_id: id(7),
    fact_content_hash: 'a'.repeat(64),
    fact_review_attempt_id: id(5),
    fact_review_output_hash: 'b'.repeat(64),
    generation_status: 'persisted',
    outcome_question_hash: contentHash,
    candidate_status: 'pending',
    candidate_revision: 1,
    candidate_hash: contentHash,
    candidate_content: content,
    candidate_fact_id: id(6),
    candidate_fact_revision_id: id(7),
    question_contract: THEME_RELIABILITY_CONTRACT_VERSION,
    question_revision: 1,
    revision_hash: contentHash,
    revision_content: content,
    revision_created_at: '2026-09-29T12:00:00.000Z',
    policy_snapshot: policySnapshot,
    policy_hash: hash(policySnapshot),
    input_manifest: inputManifest,
    input_fingerprint: hash(inputManifest),
    prompt_snapshot: 'writer prompt',
    prompt_hash: hashText('writer prompt'),
    prompt_version: 'writer-prompt-v1',
    generation_policy_version: 'generation-v1',
    writer_kind: 'model',
    writer_id: 'writer',
    provider: 'provider-w',
    model: 'model-w',
    execution_id: id(11),
    evaluated_at: '2026-09-29T12:00:00.000Z',
    eligibility_fingerprint: 'f'.repeat(64),
  };
  const scope = {
    entity: 'first final',
    relation: 'host city',
    time: null,
    geography: null,
    competitionOrDomain: null,
    qualifiers: [],
    asOf: null,
  };
  const evidence = [
    {
      passageId: id(20),
      passageContentHash: hashText('Ottawa hosted the first final.'),
      text: 'Ottawa hosted the first final.',
      originGroup: 'one',
      sourceClass: 'primary_record' as const,
      supportKind: 'supports' as const,
    },
    {
      passageId: id(21),
      passageContentHash: hashText('Other context.'),
      text: 'Other context.',
      originGroup: 'two',
      sourceClass: 'primary_record' as const,
      supportKind: 'context' as const,
    },
    {
      passageId: id(22),
      passageContentHash: hashText('A second record also confirms Ottawa hosted the first final.'),
      text: 'A second record also confirms Ottawa hosted the first final.',
      originGroup: 'three',
      sourceClass: 'primary_record' as const,
      supportKind: 'supports' as const,
    },
  ];
  const rows = evidence.map((item, index) => ({
    id: item.passageId,
    contract_version: THEME_RELIABILITY_CONTRACT_VERSION,
    document_id: id(30 + index),
    ordinal: 0,
    locator: 'p1',
    passage_text: item.text,
    content_hash: item.passageContentHash,
    doc_id: id(30 + index),
    doc_contract: THEME_RELIABILITY_CONTRACT_VERSION,
    requested_url: `https://example.org/${index}`,
    final_url: `https://example.org/${index}`,
    canonical_url: `https://example.org/${index}`,
    publisher_id: `publisher-${index}`,
    source_class: 'primary_record',
    publisher: `Publisher ${index}`,
    origin_group: item.originGroup,
    source_policy_version: 'sources-v1',
    extractor_version: 'extractor-v1',
    title: `Record ${index}`,
    language: 'en',
    status: 'retrieved',
    doc_hash: hashText('document'),
    retrieved_at: '2026-09-29T12:00:00.000Z',
    published_at: null,
    source_updated_at: null,
    doc_valid_until: '2026-10-01T12:00:00.000Z',
    http_status: 200,
    media_type: 'text/html',
  }));
  vi.mocked(loadGenerationContext).mockResolvedValue({
    graph: {
      derivation: {
        producerId: 'proposer',
        executionId: id(12),
        producerKind: 'model',
        provider: 'provider-p',
        model: 'model-p',
      },
      reviewPromptHash: hashText('fact prompt'),
    },
    selectedReview: {
      attemptId: id(5),
      reviewerId: 'fact-reviewer',
      executionId: id(13),
      reviewerKind: 'model',
      provider: 'provider-f',
      model: 'model-f',
      outcome: { outputHash: 'b'.repeat(64) },
    },
    writerInput: { evidence },
    fact: {
      contract_version: THEME_RELIABILITY_CONTRACT_VERSION,
      fact_revision_id: id(7),
      fact_id: id(6),
      revision: 1,
      statement: 'Ottawa hosted the first final.',
      scope,
      canonical_answer: 'Ottawa',
      supported_aliases: [],
      content_hash: 'a'.repeat(64),
      time_sensitive: false,
      valid_until: '2026-10-01T12:00:00.000Z',
    },
  } as never);
  const request = {
    attemptId: id(8),
    candidateId: id(3),
    questionRevisionId: id(4),
    questionContentHash: contentHash,
  };
  const config = {
    executionId: id(14),
    reviewer: {
      kind: 'model' as const,
      id: 'question-reviewer',
      provider: 'provider-q',
      model: 'model-q',
    },
    policy: {
      sourcePolicyVersion: 'sources-v1',
      extractorVersion: 'extractor-v1',
      reviewPolicyVersion: 'question-review-v1',
      reviewerPromptVersion: 'question-prompt-v1',
      allowedSourceClasses: ['primary_record' as const],
      maxSourceAgeMs: 7 * 86400_000,
      maxReviewAgeMs: 86400_000,
      minIndependentOriginGroupsPerFact: 1,
    },
    promptText: 'review question evidence',
  };
  return { generation, rows, request, config };
}

function fakePool(f: ReturnType<typeof fixture>) {
  const state: {
    attempt: Record<string, unknown> | null;
    outcome: Record<string, unknown> | null;
    reviewCount: number;
    unowned: boolean;
    raceReplay: boolean;
    attemptReads: number;
    review: Record<string, unknown> | null;
  } = {
    attempt: null,
    outcome: null,
    reviewCount: 0,
    unowned: false,
    raceReplay: false,
    attemptReads: 0,
    review: null,
  };
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('FROM theme_question_generation_attempts g'))
      return { rows: [f.generation], rowCount: 1 };
    if (sql.includes('FROM theme_evidence_passages p'))
      return { rows: f.rows, rowCount: f.rows.length };
    if (sql.includes('FROM theme_evidence_reviews r') && sql.includes('o.attempt_id IS NULL'))
      return { rows: state.unowned ? [{ id: id(99) }] : [], rowCount: state.unowned ? 1 : 0 };
    if (
      sql.includes('FROM theme_question_evidence_review_attempts a') &&
      sql.includes('LEFT JOIN')
    ) {
      if (!state.attempt) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            ...state.attempt,
            outcome_status: state.outcome?.status ?? null,
            review_id: state.outcome?.review_id ?? null,
            outcome_verdict: state.outcome?.verdict ?? null,
            outcome_hash: state.review ? hash(state.review.dimension_results) : null,
            review_contract: state.review?.contract_version,
            stored_review_policy_version: state.review?.review_policy_version,
            stored_prompt_version: state.review?.reviewer_prompt_version,
            dimension_results: state.review?.dimension_results,
            stored_reviewer_kind: state.review?.reviewer_kind,
            reviewer_model: state.review?.reviewer_model,
            reviewed_at: state.review?.reviewed_at,
            valid_until: state.review?.valid_until,
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('SELECT fact_revision_id FROM theme_evidence_review_facts'))
      return { rows: [{ fact_revision_id: id(7) }], rowCount: 1 };
    if (sql.includes('SELECT passage_id FROM theme_evidence_review_passages'))
      return { rows: [{ passage_id: id(20) }, { passage_id: id(22) }], rowCount: 2 };
    if (sql.includes('SELECT r.dimension_results'))
      return state.review
        ? { rows: [{ dimension_results: state.review.dimension_results }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    if (sql.includes('SELECT COALESCE(MAX(review_sequence)'))
      return { rows: [{ sequence: 1 }], rowCount: 1 };
    if (sql.includes('SELECT * FROM theme_question_evidence_review_attempts WHERE id')) {
      state.attemptReads++;
      if (state.raceReplay && state.attemptReads === 2 && !state.attempt) {
        state.attempt = {
          id: f.request.attemptId,
          candidate_id: f.request.candidateId,
          question_revision_id: f.request.questionRevisionId,
          question_content_hash: f.request.questionContentHash,
          reviewer_kind: f.config.reviewer.kind,
          reviewer_id: f.config.reviewer.id,
          provider: f.config.reviewer.provider,
          model: f.config.reviewer.model,
          execution_id: f.config.executionId,
          review_policy_version: f.config.policy.reviewPolicyVersion,
          policy_hash: hash(f.config.policy),
          prompt_version: f.config.policy.reviewerPromptVersion,
          prompt_hash: hashText(f.config.promptText),
        };
        state.outcome = {
          attempt_id: f.request.attemptId,
          status: 'reviewed',
          review_id: id(9),
          verdict: 'pass',
          failure_code: null,
        };
      }
      return { rows: state.attempt ? [state.attempt] : [], rowCount: state.attempt ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO theme_question_evidence_review_attempts')) {
      state.attempt = {
        id: values[0],
        contract_version: values[1],
        candidate_id: values[2],
        question_revision_id: values[3],
        question_content_hash: values[4],
        generation_attempt_id: values[5],
        fact_revision_id: values[6],
        review_sequence: values[7],
        reviewer_kind: values[8],
        reviewer_id: values[9],
        provider: values[10],
        model: values[11],
        execution_id: values[12],
        review_policy_version: values[13],
        policy_snapshot: JSON.parse(String(values[14])),
        policy_hash: values[15],
        prompt_version: values[16],
        prompt_hash: values[17],
        input_manifest: JSON.parse(String(values[18])),
        input_fingerprint: values[19],
        evaluated_at: values[20],
      };
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO theme_evidence_reviews')) {
      state.reviewCount++;
      state.review = {
        id: values[0],
        contract_version: values[1],
        review_policy_version: values[4],
        reviewer_prompt_version: values[5],
        verdict: values[6],
        dimension_results: JSON.parse(String(values[7])),
        reviewer_kind: values[8],
        reviewer_model: values[9],
        reviewed_at: values[10],
        valid_until: values[11],
      };
    }
    if (sql.includes('INSERT INTO theme_question_evidence_review_outcomes')) {
      state.outcome = {
        status: values[4],
        review_id: values[5],
        verdict: values[6],
        failure_code: values[8],
      };
    }
    if (sql.includes('FROM theme_question_evidence_review_outcomes'))
      return { rows: state.outcome ? [state.outcome] : [], rowCount: state.outcome ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = { query, connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, state, query };
}

beforeEach(() => vi.clearAllMocks());

describe('S8a repository question review', () => {
  it('reviews a valid S7 candidate whose attempt has no question_content_hash column, then replays', async () => {
    const f = fixture();
    expect('question_content_hash' in f.generation).toBe(false);
    const db = fakePool(f);
    const repo = createPostgresThemeQuestionEvidenceReviewRepository(db.pool, f.config, () => at);
    const callback = vi.fn(() => ({
      dimensionResults: EVIDENCE_DIMENSIONS.map((dimension) => ({
        dimension,
        verdict: 'pass',
        reasons: ['supported'],
        passageIds: [id(20)],
      })),
    }));
    expect(await repo.review(f.request, callback)).toMatchObject({
      status: 'reviewed',
      verdict: 'pass',
    });
    expect(db.state.reviewCount).toBe(1);
    expect(db.state.outcome?.status).toBe('reviewed');
    expect(await repo.review(f.request, callback)).toMatchObject({
      status: 'reviewed',
      verdict: 'pass',
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('projects QA source metadata only from a cited supporting passage', async () => {
    const f = fixture();
    const db = fakePool(f);
    const repo = createPostgresThemeQuestionEvidenceReviewRepository(db.pool, f.config, () => at);
    const callback = vi.fn(() => ({
      dimensionResults: EVIDENCE_DIMENSIONS.map((dimension) => ({
        dimension,
        verdict: 'pass',
        reasons: ['supported'],
        passageIds: [id(20)],
      })),
    }));
    await repo.review(f.request, callback);

    await expect(
      repo.qaContext({
        candidateId: f.request.candidateId,
        questionRevisionId: f.request.questionRevisionId,
        questionContentHash: f.request.questionContentHash,
      })
    ).resolves.toMatchObject({
      evidenceAttemptId: f.request.attemptId,
      evidenceReviewId: id(9),
      evidenceFingerprint: 'e'.repeat(64),
      source: {
        documentId: id(30),
        url: 'https://example.org/0',
        name: 'Publisher 0',
      },
    });
  });

  it('does not project source metadata from an uncited linked supporting passage', async () => {
    const f = fixture();
    const db = fakePool(f);
    const repo = createPostgresThemeQuestionEvidenceReviewRepository(db.pool, f.config, () => at);
    await repo.review(f.request, () => ({
      dimensionResults: EVIDENCE_DIMENSIONS.map((dimension) => ({
        dimension,
        verdict: 'pass',
        reasons: ['supported'],
        passageIds: [id(22)],
      })),
    }));

    await expect(
      repo.qaContext({
        candidateId: f.request.candidateId,
        questionRevisionId: f.request.questionRevisionId,
        questionContentHash: f.request.questionContentHash,
      })
    ).resolves.toMatchObject({
      source: {
        documentId: id(32),
        url: 'https://example.org/2',
        name: 'Publisher 2',
      },
    });
  });

  it('stores a safe terminal outcome when a passing dimension cites a context passage', async () => {
    const f = fixture();
    const db = fakePool(f);
    const repo = createPostgresThemeQuestionEvidenceReviewRepository(db.pool, f.config, () => at);
    const callback = vi.fn(() => ({
      dimensionResults: EVIDENCE_DIMENSIONS.map((dimension) => ({
        dimension,
        verdict: 'pass',
        reasons: ['supported'],
        passageIds: [id(21)],
      })),
    }));
    expect(await repo.review(f.request, callback)).toMatchObject({
      status: 'invalid_output',
      failureCode: 'invalid_output',
    });
    expect(db.state.reviewCount).toBe(0);
    expect(db.state.outcome?.status).toBe('invalid_output');
    expect(await repo.review(f.request, callback)).toMatchObject({ status: 'invalid_output' });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('withholds eligibility when an exact-revision review has no S8a outcome owner', async () => {
    const f = fixture();
    const db = fakePool(f);
    db.state.unowned = true;
    const repo = createPostgresThemeQuestionEvidenceReviewRepository(db.pool, f.config, () => at);
    expect(
      await repo.eligibility({
        candidateId: f.request.candidateId,
        questionRevisionId: f.request.questionRevisionId,
        questionContentHash: f.request.questionContentHash,
      })
    ).toMatchObject({ eligible: false, reason: 'unowned_review' });
  });

  it('replays when an identical attempt completes during locked registration', async () => {
    const f = fixture();
    const db = fakePool(f);
    db.state.raceReplay = true;
    const repo = createPostgresThemeQuestionEvidenceReviewRepository(db.pool, f.config, () => at);
    const callback = vi.fn();

    expect(await repo.review(f.request, callback)).toMatchObject({
      status: 'reviewed',
      reviewId: id(9),
      verdict: 'pass',
    });
    expect(callback).not.toHaveBeenCalled();
  });
});
