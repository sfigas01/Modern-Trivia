import { createHash, randomUUID } from 'node:crypto';

import type { Pool, QueryResult } from 'pg';
import { describe, expect, it } from 'vitest';

import { hashThemeFactSnapshot } from './theme-fact-derivation';
import { createPostgresThemeFactReviewRepository } from './theme-fact-review';
import { hashThemeSourceRegistry } from './theme-source-registry';
import type { ThemeSourceRegistry } from '@shared/models/theme-source-registry';

const sourcePolicyVersion = 'review-test-source-policy';
const extractorVersion = 'review-test-extractor';
const reviewerPolicy = {
  sourcePolicyVersion,
  extractorVersion,
  allowedSourceClasses: ['primary_record' as const],
  minimumOriginGroups: 1,
  maxSourceAgeMs: 4 * 60 * 60 * 1000,
  validForMs: 60 * 60 * 1000,
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function sha(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

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

type Fixture = ReturnType<typeof fixture>;
function fixture(
  startMs = Date.parse('2026-09-28T12:00:00.000Z'),
  sourceTtlMs = 4 * 60 * 60 * 1000
) {
  const attemptId = randomUUID();
  const revisionId = randomUUID();
  const passageId = randomUUID();
  const documentId = randomUUID();
  const producerExecutionId = randomUUID();
  const text = 'The fictional event occurred in 1901.';
  const passageHash = createHash('sha256').update(text, 'utf8').digest('hex');
  const registryHash = hashThemeSourceRegistry(registry);
  const retrievedAt = new Date(startMs - 60_000);
  const sourceValidUntil = new Date(startMs + sourceTtlMs);
  const factValidUntil = new Date(startMs + 5 * 60 * 60 * 1000);
  const snapshot = {
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
    timeSensitive: true,
    validUntil: factValidUntil.toISOString(),
  };
  const factHash = hashThemeFactSnapshot(snapshot as never);
  const documentSnapshot = {
    contractVersion: 'theme-reliability-v1',
    id: documentId,
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
    contentHash: 'b'.repeat(64),
    retrievedAt: retrievedAt.toISOString(),
    publishedAt: null,
    sourceUpdatedAt: null,
    validUntil: sourceValidUntil.toISOString(),
    httpStatus: 200,
    mediaType: 'text/plain',
  };
  const citation = { passageId, passageContentHash: passageHash, supportKind: 'supports' };
  const derivationPolicy = {
    sourcePolicyVersion,
    extractorVersion,
    allowedSourceClasses: ['primary_record'],
    maxSourceAgeMs: 24 * 60 * 60 * 1000,
    minimumOriginGroups: 1,
    timeSensitiveTtlMs: 5 * 60 * 60 * 1000,
  };
  const inputManifest = {
    canonicalKey: 'fictional-event-year',
    requestedRevisionId: revisionId,
    expectedLatestRevision: 0,
    passageIds: [passageId],
    policy: derivationPolicy,
    evidence: {
      passages: [
        {
          passageId,
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
  const proposalSnapshot = {
    status: 'proposed',
    snapshot,
    contentHash: factHash,
    citations: [citation],
    supportOriginCount: 1,
    policySatisfied: true,
    persistence: null,
  };
  const row = {
    id: attemptId,
    contract_version: 'theme-fact-derivation-provenance-v1',
    canonical_key: 'fictional-event-year',
    requested_revision_id: revisionId,
    expected_latest_revision: 0,
    derivation_policy_version: 'derive-policy-v1',
    policy_snapshot: derivationPolicy,
    policy_hash: sha(derivationPolicy),
    prompt_version: 'derive-prompt-v1',
    prompt_hash: 'c'.repeat(64),
    input_manifest: inputManifest,
    input_fingerprint: sha(inputManifest),
    producer_kind: 'model',
    producer_id: 'producer-1',
    provider: 'provider-a',
    model: 'model-a',
    execution_id: producerExecutionId,
    derivation_outcome: 'persisted',
    proposal_snapshot: proposalSnapshot,
    output_hash: sha(proposalSnapshot),
    outcome_revision_id: revisionId,
    outcome_fact_hash: factHash,
    bindings_fingerprint: sha([citation]),
    fact_id: randomUUID(),
    revision: 1,
    revision_contract: 'theme-reliability-v1',
    statement: snapshot.statement,
    scope: snapshot.scope,
    canonical_answer: snapshot.canonicalAnswer,
    supported_aliases: snapshot.supportedAliases,
    content_hash: factHash,
    time_sensitive: snapshot.timeSensitive,
    fact_valid_until: factValidUntil,
  };
  const evidenceRow = {
    passage: {
      id: passageId,
      contract_version: 'theme-reliability-v1',
      document_id: documentId,
      ordinal: 0,
      locator: 'record paragraph',
      passage_text: text,
      content_hash: passageHash,
    },
    document: {
      id: documentId,
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
      valid_until: sourceValidUntil,
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
  return {
    startMs,
    attemptId,
    revisionId,
    passageId,
    passageHash,
    text,
    row,
    evidenceRow,
    citation,
    sourceValidUntil,
  };
}

function passingOutput(passageId: string, passageHash: string) {
  const ref = { passageId, passageContentHash: passageHash };
  return {
    dimensions: {
      entailment: { verdict: 'pass', reasons: ['supported'], passageRefs: [ref] },
      scope: { verdict: 'pass', reasons: ['scope_match'], passageRefs: [ref] },
      canonical_answer: { verdict: 'pass', reasons: ['answer_supported'], passageRefs: [ref] },
      aliases: { verdict: 'pass', reasons: ['no_aliases'], passageRefs: [] },
      conflict: { verdict: 'pass', reasons: ['no_conflict'], passageRefs: [ref] },
      source_independence: {
        verdict: 'pass',
        reasons: ['independent_origins'],
        passageRefs: [ref],
      },
    },
  };
}

function fakePool(
  f: Fixture,
  options: {
    fail?: 'connect' | 'begin' | 'registration' | 'rollback' | 'outcome' | 'commit';
    raceSameAttempt?: boolean;
  } = {}
) {
  const state: {
    attempt?: Record<string, unknown>;
    outcome?: Record<string, unknown>;
    releasedWithError: boolean;
  } = { releasedWithError: false };
  let commits = 0;
  let initialAttemptReads = 0;
  let releaseAttemptReadBarrier!: () => void;
  const attemptReadBarrier = new Promise<void>((resolve) => {
    releaseAttemptReadBarrier = resolve;
  });
  let revisionLockTail = Promise.resolve();
  const result = (rows: unknown[] = []): QueryResult =>
    ({ rows, rowCount: rows.length }) as QueryResult;
  const query = async (sql: string, _values: unknown[] = []) => {
    if (sql.includes('SELECT a.*, o.outcome')) return result([f.row]);
    if (sql.includes('SELECT to_jsonb(p)')) return result([f.evidenceRow]);
    if (sql.includes('SELECT passage_id, support_kind'))
      return result([{ passage_id: f.passageId, support_kind: 'supports' }]);
    if (sql.includes('SELECT * FROM theme_fact_review_attempts')) {
      if (options.raceSameAttempt && initialAttemptReads < 2) {
        initialAttemptReads++;
        if (initialAttemptReads === 2) releaseAttemptReadBarrier();
        await attemptReadBarrier;
      }
      return result(state.attempt ? [state.attempt] : []);
    }
    if (sql.includes('SELECT * FROM theme_fact_review_outcomes'))
      return result(state.outcome ? [state.outcome] : []);
    throw new Error(`unexpected query: ${sql}`);
  };
  const makeClient = () => {
    let releaseRevisionLock: (() => void) | undefined;
    const clientQuery = async (sql: string, values: unknown[] = []) => {
      if (sql === 'BEGIN' && options.fail === 'begin') throw new Error('private db details');
      if (sql === 'ROLLBACK' && options.fail === 'rollback') throw new Error('rollback failed');
      if (sql === 'BEGIN') return result();
      if (sql === 'ROLLBACK') {
        releaseRevisionLock?.();
        releaseRevisionLock = undefined;
        return result();
      }
      if (sql === 'COMMIT') {
        commits++;
        if (options.fail === 'commit' && commits === 1) throw new Error('commit failed');
        releaseRevisionLock?.();
        releaseRevisionLock = undefined;
        return result();
      }
      if (sql.includes('SELECT id FROM theme_fact_revisions')) {
        const previous = revisionLockTail;
        let unlock!: () => void;
        revisionLockTail = new Promise<void>((resolve) => {
          unlock = resolve;
        });
        await previous;
        releaseRevisionLock = unlock;
        return result([{ id: f.revisionId }]);
      }
      if (sql.includes('SELECT COALESCE(MAX(review_sequence)'))
        return result([
          { next_sequence: state.attempt ? Number(state.attempt.review_sequence) + 1 : 1 },
        ]);
      if (sql.includes('INSERT INTO theme_fact_review_attempts')) {
        if (options.fail === 'registration' || options.fail === 'rollback')
          throw new Error('private db details');
        // Model ON CONFLICT DO NOTHING for the same UUID or review sequence.
        if (state.attempt) return result();
        state.attempt = {
          id: values[0],
          contract_version: values[1],
          derivation_attempt_id: values[2],
          fact_revision_id: values[3],
          fact_content_hash: values[4],
          review_sequence: values[5],
          review_policy_version: values[6],
          policy_snapshot: JSON.parse(String(values[7])),
          policy_hash: values[8],
          prompt_version: values[9],
          prompt_hash: values[10],
          input_manifest: JSON.parse(String(values[11])),
          input_fingerprint: values[12],
          reviewer_kind: values[13],
          reviewer_id: values[14],
          provider: values[15],
          model: values[16],
          execution_id: values[17],
          evaluated_at: values[18],
        };
        return result();
      }
      if (sql.includes('SELECT id FROM theme_fact_review_attempts'))
        return result(state.attempt ? [{ id: state.attempt.id }] : []);
      if (sql.includes('SELECT * FROM theme_fact_review_attempts'))
        return result(state.attempt ? [state.attempt] : []);
      if (sql.includes('SELECT * FROM theme_fact_review_outcomes'))
        return result(state.outcome ? [state.outcome] : []);
      if (sql.includes('INSERT INTO theme_fact_review_outcomes')) {
        if (options.fail === 'outcome') throw new Error('private db details');
        state.outcome = {
          attempt_id: values[0],
          status: values[1],
          aggregate_verdict: values[2],
          dimensions: values[3] === null ? null : JSON.parse(String(values[3])),
          output_hash: values[4],
          valid_until: values[5],
          failure_code: values[6],
        };
        return result();
      }
      throw new Error(`unexpected client query: ${sql}`);
    };
    return {
      query: clientQuery,
      release: (error?: Error) => {
        if (error) state.releasedWithError = true;
        releaseRevisionLock?.();
        releaseRevisionLock = undefined;
      },
    };
  };
  const pool = {
    query,
    connect: async () => {
      if (options.fail === 'connect') throw new Error('private db details');
      return makeClient();
    },
  } as unknown as Pool;
  return { pool, state };
}

function repository(f: Fixture, db = fakePool(f), getNow: () => Date = () => new Date(f.startMs)) {
  return {
    ...db,
    repository: createPostgresThemeFactReviewRepository(
      db.pool,
      {
        executionId: randomUUID(),
        reviewPolicyVersion: 'review-policy-v1',
        policy: reviewerPolicy,
        promptVersion: 'review-prompt-v1',
        promptText: 'Review all evidence and the exact fact.',
        reviewer: { kind: 'model', id: 'reviewer-2', provider: 'provider-b', model: 'model-b' },
      },
      getNow
    ),
  };
}

describe('theme fact review repository', () => {
  it('deduplicates concurrent identical UUIDs and replays after the first review completes', async () => {
    const f = fixture();
    const setup = repository(f, fakePool(f, { raceSameAttempt: true }));
    const request = {
      attemptId: randomUUID(),
      derivationAttemptId: f.attemptId,
      factRevisionId: f.revisionId,
    };
    let callbackCalls = 0;
    let markCallbackEntered!: () => void;
    const callbackEntered = new Promise<void>((resolve) => {
      markCallbackEntered = resolve;
    });
    let releaseCallback!: () => void;
    const callbackGate = new Promise<void>((resolve) => {
      releaseCallback = resolve;
    });
    const invoke = () =>
      setup.repository.review(request, async () => {
        callbackCalls++;
        markCallbackEntered();
        await callbackGate;
        return passingOutput(f.passageId, f.passageHash);
      });
    const concurrent = [invoke(), invoke()];
    await callbackEntered;
    const firstSettled = await Promise.race(
      concurrent.map((promise) =>
        promise.then(
          (value) => ({ kind: 'value' as const, value }),
          (error: unknown) => ({ kind: 'error' as const, error })
        )
      )
    );
    expect(firstSettled.kind).toBe('error');
    if (firstSettled.kind === 'error')
      expect(firstSettled.error).toMatchObject({ code: 'attempt_unresolved' });
    releaseCallback();
    const settled = await Promise.allSettled(concurrent);
    const completed = settled.find(
      (item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof invoke>>> =>
        item.status === 'fulfilled'
    );
    expect(completed?.value).toMatchObject({ status: 'reviewed', verdict: 'pass' });
    expect(callbackCalls).toBe(1);
    await expect(
      setup.repository.review(request, () => passingOutput(f.passageId, f.passageHash))
    ).resolves.toEqual(completed?.value);
    expect(callbackCalls).toBe(1);
  });

  it('validates against a private snapshot when the callback mutates its defensive input copy', async () => {
    const f = fixture();
    const setup = repository(f);
    const result = await setup.repository.review(
      { attemptId: randomUUID(), derivationAttemptId: f.attemptId, factRevisionId: f.revisionId },
      (input) => {
        input.supportedAliases.push('injected-alias');
        input.evidence[0].passageContentHash = '0'.repeat(64);
        return passingOutput(f.passageId, f.passageHash);
      }
    );
    expect(result).toMatchObject({ status: 'reviewed', verdict: 'pass' });
    expect(setup.state.outcome?.status).toBe('reviewed');
  });

  it('caps validity from the original evaluation time and all evidence expiry limits', async () => {
    const f = fixture(undefined, 30 * 60 * 1000);
    let nowMs = f.startMs;
    const setup = repository(f, fakePool(f), () => new Date(nowMs));
    const result = await setup.repository.review(
      { attemptId: randomUUID(), derivationAttemptId: f.attemptId, factRevisionId: f.revisionId },
      () => {
        nowMs += 10 * 60 * 1000;
        return passingOutput(f.passageId, f.passageHash);
      }
    );
    expect(result).toMatchObject({ status: 'reviewed' });
    if (result.status === 'reviewed')
      expect(result.validUntil).toBe(new Date(f.startMs + 30 * 60 * 1000).toISOString());
  });

  it('consumes review TTL while the callback runs', async () => {
    const f = fixture(undefined, 4 * 60 * 60 * 1000);
    let nowMs = f.startMs;
    const setup = repository(f, fakePool(f), () => new Date(nowMs));
    const result = await setup.repository.review(
      { attemptId: randomUUID(), derivationAttemptId: f.attemptId, factRevisionId: f.revisionId },
      () => {
        nowMs += 20 * 60 * 1000;
        return passingOutput(f.passageId, f.passageHash);
      }
    );
    expect(result).toMatchObject({ status: 'reviewed' });
    if (result.status === 'reviewed')
      expect(result.validUntil).toBe(new Date(f.startMs + reviewerPolicy.validForMs).toISOString());
  });

  it('replays exact completed attempts after fact and evidence expiry without renewing validity', async () => {
    const f = fixture();
    let nowMs = f.startMs;
    const setup = repository(f, fakePool(f), () => new Date(nowMs));
    let calls = 0;
    const request = {
      attemptId: randomUUID(),
      derivationAttemptId: f.attemptId,
      factRevisionId: f.revisionId,
    };
    const first = await setup.repository.review(request, () => {
      calls++;
      return passingOutput(f.passageId, f.passageHash);
    });
    nowMs += 24 * 60 * 60 * 1000;
    const replay = await setup.repository.review(request, () => {
      calls++;
      throw new Error('must not redispatch');
    });
    expect(replay).toEqual(first);
    expect(calls).toBe(1);
  });

  it.each([
    ['connect', 'storage_failure', false],
    ['begin', 'storage_failure', true],
    ['registration', 'storage_failure', false],
    ['rollback', 'storage_failure', true],
    ['outcome', 'storage_failure', false],
    ['commit', 'storage_unknown_outcome', true],
  ] as const)(
    'sanitizes %s failures as %s and safely releases connections',
    async (failure, code, discarded) => {
      const f = fixture();
      const db = fakePool(f, { fail: failure });
      const setup = repository(f, db);
      await expect(
        setup.repository.review(
          {
            attemptId: randomUUID(),
            derivationAttemptId: f.attemptId,
            factRevisionId: f.revisionId,
          },
          () => passingOutput(f.passageId, f.passageHash)
        )
      ).rejects.toMatchObject({ code, message: code });
      expect(db.state.releasedWithError).toBe(discarded);
    }
  );
});
