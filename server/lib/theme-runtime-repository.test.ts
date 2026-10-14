import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { createPostgresThemeRuntimeRepository } from './theme-runtime-repository';
import { hashQuestionSnapshot } from './theme-evidence-eligibility';
import { ThemePreparationWorkerError } from './theme-preparation-worker';
import type { ThemeJobRecord } from './theme-lifecycle';

const NOW = new Date('2026-10-12T12:00:00Z');
const ID = '00000000-0000-4000-8000-000000000001';
const GAME = '00000000-0000-4000-8000-000000000002';
const CANDIDATE = '00000000-0000-4000-8000-000000000003';
const FACT = '00000000-0000-4000-8000-000000000004';
const REVISION = '00000000-0000-4000-8000-000000000005';
const IDENTITY = '00000000-0000-4000-8000-000000000006';
const OTHER_IDENTITY = '00000000-0000-4000-8000-000000000007';
const QUESTION = 'question-1';

function result<T>(rows: T[]) {
  return { rows, rowCount: rows.length };
}

function fakePool(
  handler: (sql: string, args: unknown[]) => ReturnType<typeof result<unknown>>,
  clock: () => Date = () => NOW
) {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    statements.push({ sql, args });
    if (sql === 'SELECT clock_timestamp() AS at') return result([{ at: clock() }]);
    return handler(sql, args);
  });
  return {
    pool: { query, connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool,
    statements,
  };
}

function job(): ThemeJobRecord {
  return {
    id: ID,
    gameId: GAME,
    contractVersion: 'theme-reliability-v1',
    stableKey: 'test',
    status: 'reserving',
    publicStage: 'reserving',
    candidateCeiling: 50,
    candidatesUsed: 1,
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

function runtime(pool: Pool, validate = vi.fn(async () => evidenceBinding())) {
  return createPostgresThemeRuntimeRepository(pool, {
    now: () => NOW,
    validateApprovalEvidence: validate,
  });
}

function evidenceBinding() {
  return {
    evidenceAttemptId: 'evidence-attempt',
    evidenceReviewId: 'evidence-review',
    evidenceFingerprint: 'evidence-fingerprint',
  };
}

describe('PostgreSQL theme runtime repository', () => {
  it.each([
    ['unknown', 'settled', 'provider_outcome_unknown'],
    ['succeeded', 'unknown', 'provider_outcome_unknown'],
    ['dispatched', 'reserved', 'preparation_failed'],
    ['reserved', 'reserved', 'preparation_failed'],
    ['succeeded', 'reserved', 'preparation_failed'],
  ])('fails closed for attempt %s and allocation %s', async (attempt, allocation, code) => {
    const { pool } = fakePool((sql) =>
      sql.includes('FROM theme_job_attempts attempt')
        ? result([
            {
              attempt_status: attempt,
              allocation_status: allocation,
              allocation_id: ID,
              allocation_job_id: ID,
            },
          ])
        : result([])
    );
    await expect(
      createPostgresThemeRuntimeRepository(pool).assertDispatchesSettled(ID)
    ).rejects.toMatchObject({
      name: ThemePreparationWorkerError.name,
      code,
    });
  });

  it('writes only spoiler-safe failure metadata under the lease and current state fence', async () => {
    const { pool, statements } = fakePool((sql) =>
      sql.startsWith('UPDATE theme_preparation_jobs') ? result([{ id: ID }]) : result([])
    );
    const recorded = await createPostgresThemeRuntimeRepository(pool).recordPause({
      jobId: ID,
      claimToken: 'claim',
      expectedStatus: 'reviewing',
      code: 'provider_outcome_unknown',
      retryable: false,
    });
    expect(recorded).toBe(true);
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain('job.lease_expires_at > clock_timestamp()');
    expect(statements[0].sql).toContain('game.expires_at > clock_timestamp()');
    expect(JSON.parse(statements[0].args[3] as string)).toEqual({
      contractVersion: 'theme-reliability-v1',
      code: 'provider_unknown_outcome',
      retryable: false,
      operation: null,
      provider: null,
      httpStatus: null,
      candidateOrdinal: null,
    });
  });

  it('rolls back before any reservation when the roster is unlocked', async () => {
    const { pool, statements } = fakePool((sql) => {
      if (sql.includes('FROM theme_preparation_jobs job'))
        return result([
          {
            job_id: ID,
            game_id: GAME,
            job_status: 'reserving',
            lease_owner: 'claim',
            lease_expires_at: new Date(NOW.getTime() + 60_000),
            game_status: 'waiting',
            game_expires_at: new Date(NOW.getTime() + 60_000),
            roster_locked_at: null,
            player_count: 2,
            themed_target: 1,
            related_target: 1,
            corpus_revision: 1,
            history_revision: 1,
          },
        ]);
      return result([]);
    });
    await expect(
      runtime(pool).reserveApproved(job(), [
        { itemKey: 'fact', candidateId: CANDIDATE, questionId: QUESTION },
      ])
    ).rejects.toMatchObject({ code: 'inventory_shortfall' });
    expect(statements.map((entry) => entry.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('FOR UPDATE OF job, game'),
      'ROLLBACK',
    ]);
  });

  it('keeps the batch atomic when an approval is missing', async () => {
    const { pool, statements } = fakePool((sql) => {
      if (sql.includes('FROM theme_preparation_jobs job'))
        return result([
          {
            job_id: ID,
            game_id: GAME,
            job_status: 'reserving',
            lease_owner: 'claim',
            lease_expires_at: new Date(NOW.getTime() + 60_000),
            game_status: 'waiting',
            game_expires_at: new Date(NOW.getTime() + 60_000),
            roster_locked_at: NOW,
            player_count: 2,
            themed_target: 1,
            related_target: 1,
            corpus_revision: 1,
            history_revision: 1,
          },
        ]);
      if (sql.includes('FROM theme_game_participants'))
        return result([{ identity_id: IDENTITY }, { identity_id: OTHER_IDENTITY }]);
      if (sql.includes('WITH RECURSIVE subjects'))
        return result([{ id: IDENTITY }, { id: OTHER_IDENTITY }]);
      if (sql.includes('count(*) FILTER')) return result([{ themed: '1', related: '1' }]);
      if (sql.includes("role = 'related_backup'")) return result([{ count: '1' }]);
      if (sql.includes("role = 'theme' ORDER BY")) return result([]);
      if (sql.includes('SELECT fact_id,fact_revision_id FROM theme_candidates'))
        return result([{ fact_id: FACT, fact_revision_id: REVISION }]);
      if (sql.includes('FROM theme_question_approvals approval')) return result([]);
      return result([]);
    });
    await expect(
      runtime(pool).reserveApproved(job(), [
        { itemKey: 'fact', candidateId: CANDIDATE, questionId: QUESTION },
      ])
    ).rejects.toMatchObject({ code: 'inventory_shortfall' });
    expect(statements.at(-1)?.sql).toBe('ROLLBACK');
    expect(
      statements.some(({ sql }) => sql.includes('INSERT INTO theme_question_reservations'))
    ).toBe(false);
    expect(
      statements.some(({ sql }) =>
        /UPDATE (rooms|theme_game_sessions)|theme_question_exposures/i.test(sql)
      )
    ).toBe(false);
  });

  it.each([
    { replayMismatch: false, staleEvidence: false },
    { replayMismatch: true, staleEvidence: false },
    { replayMismatch: false, staleEvidence: true },
    { replayMismatch: false, staleEvidence: false, expiredDuringLock: true },
    { replayMismatch: false, staleEvidence: false, staleAtCommit: true },
  ])(
    'fails closed for replay mismatch=$replayMismatch, stale evidence=$staleEvidence, lock expiry=$expiredDuringLock, or commit staleness=$staleAtCommit',
    async ({ replayMismatch, staleEvidence, expiredDuringLock = false, staleAtCommit = false }) => {
      const snapshot = {
        themeSlug: 'trees',
        category: 'Nature',
        difficulty: 'Easy' as const,
        question: 'Which tree?',
        answer: 'Oak',
        acceptableAnswers: [],
        explanation: 'It is an oak.',
        pillar: 'nature',
        tags: [],
      };
      const { pool, statements } = fakePool(
        (sql) => {
          if (sql.includes('FROM theme_preparation_jobs job'))
            return result([
              {
                job_id: ID,
                game_id: GAME,
                job_status: 'reserving',
                lease_owner: 'claim',
                lease_expires_at: new Date(NOW.getTime() + 60_000),
                game_status: 'waiting',
                game_expires_at: new Date(NOW.getTime() + 60_000),
                roster_locked_at: NOW,
                player_count: 2,
                themed_target: 1,
                related_target: 1,
                corpus_revision: 1,
                history_revision: 1,
              },
            ]);
          if (sql.includes('FROM theme_game_participants'))
            return result([{ identity_id: IDENTITY }, { identity_id: OTHER_IDENTITY }]);
          if (sql.includes('WITH RECURSIVE subjects'))
            return result([{ id: IDENTITY }, { id: OTHER_IDENTITY }]);
          if (sql.includes('count(*) FILTER')) return result([{ themed: '1', related: '1' }]);
          if (sql.includes("role = 'related_backup'")) return result([{ count: '1' }]);
          if (sql.includes("role = 'theme' ORDER BY"))
            return result(
              replayMismatch
                ? [
                    {
                      id: ID,
                      job_id: ID,
                      question_id: QUESTION,
                      question_revision_id: 'wrong-revision',
                      fact_id: FACT,
                      fact_revision_id: REVISION,
                      status: 'held',
                      released_at: null,
                      expires_at: new Date(NOW.getTime() + 60_000),
                      corpus_revision: 1,
                      history_revision: 1,
                    },
                  ]
                : []
            );
          if (sql.includes('SELECT fact_id,fact_revision_id FROM theme_candidates'))
            return result([{ fact_id: FACT, fact_revision_id: REVISION }]);
          if (sql.includes('FROM theme_question_approvals approval'))
            return result([
              {
                fact_id: FACT,
                fact_revision_id: REVISION,
                library_revision_id: REVISION,
                question_id: QUESTION,
                question_content_hash: hashQuestionSnapshot(snapshot),
                question_revision_id: REVISION,
                ...evidenceBinding(),
                evidence_attempt_id: 'evidence-attempt',
                evidence_review_id: 'evidence-review',
                evidence_fingerprint: 'evidence-fingerprint',
                content: { themeSlug: snapshot.themeSlug },
                category: snapshot.category,
                difficulty: snapshot.difficulty,
                question: snapshot.question,
                answer: snapshot.answer,
                acceptable_answers: snapshot.acceptableAnswers,
                explanation: snapshot.explanation,
                pillar: snapshot.pillar,
                tags: snapshot.tags,
              },
            ]);
          if (sql.includes('WITH last_games AS')) return result([]);
          if (sql.includes('INSERT INTO theme_question_reservations')) return result([{ id: ID }]);
          if (sql.startsWith('UPDATE theme_preparation_jobs')) return result([{ id: ID }]);
          return result([]);
        },
        () => (expiredDuringLock ? new Date(NOW.getTime() + 120_000) : NOW)
      );
      let validations = 0;
      const validate = vi.fn(async () => {
        validations += 1;
        if (staleEvidence || (staleAtCommit && validations > 1))
          throw new Error('evidence expired');
        return evidenceBinding();
      });
      const operation = runtime(pool, validate).reserveApproved(job(), [
        { itemKey: 'fact', candidateId: CANDIDATE, questionId: QUESTION },
      ]);
      if (replayMismatch || staleEvidence || expiredDuringLock || staleAtCommit) {
        await expect(operation).rejects.toMatchObject({ code: 'inventory_shortfall' });
        expect(statements.at(-1)?.sql).toBe('ROLLBACK');
      } else {
        await expect(operation).resolves.toEqual({ ready: true });
        expect(statements.at(-1)?.sql).toBe('COMMIT');
        const sql = statements.map((entry) => entry.sql);
        expect(sql.indexOf('SELECT id FROM theme_facts WHERE id = $1 FOR UPDATE')).toBeLessThan(
          sql.indexOf('SELECT id FROM theme_fact_revisions WHERE id = $1 FOR UPDATE')
        );
        expect(
          sql.indexOf('SELECT id FROM theme_fact_revisions WHERE id = $1 FOR UPDATE')
        ).toBeLessThan(sql.indexOf('SELECT id FROM theme_candidates WHERE id = $1 FOR UPDATE'));
        expect(
          sql.indexOf('SELECT id FROM theme_candidates WHERE id = $1 FOR UPDATE')
        ).toBeLessThan(sql.findIndex((entry) => entry.includes('FROM theme_question_approvals')));
        const releaseExpired = sql.findIndex((entry) =>
          entry.includes('UPDATE theme_reservation_participants participant SET released_at=$2')
        );
        const conflictCheck = sql.findIndex((entry) =>
          entry.includes('SELECT 1 FROM theme_reservation_participants')
        );
        expect(releaseExpired).toBeGreaterThan(
          sql.lastIndexOf(
            'SELECT id FROM theme_participant_identities WHERE id = ANY($1::uuid[])\n            ORDER BY id FOR UPDATE'
          )
        );
        expect(releaseExpired).toBeLessThan(conflictCheck);
        expect(
          statements.filter(({ sql }) => sql.includes('INSERT INTO theme_reservation_participants'))
        ).toHaveLength(2);
      }
      expect(
        statements.some(({ sql }) =>
          /UPDATE (rooms|theme_game_sessions)|INSERT INTO theme_question_exposures/i.test(sql)
        )
      ).toBe(false);
    }
  );
});
