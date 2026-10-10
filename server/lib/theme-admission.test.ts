import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashQuestionSnapshot } from './theme-evidence-eligibility';
import {
  createThemeAdmission,
  recordThemeExposure,
  resolveThemeIdentity,
  themeSubjectHash,
} from './theme-admission';
import type { ThemeQuestionEvidenceReviewConfig } from './theme-question-evidence-review';

const evidence = vi.hoisted(() => ({ qaContext: vi.fn() }));
vi.mock('./theme-question-evidence-review', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./theme-question-evidence-review')>()),
  createPostgresThemeQuestionEvidenceReviewRepository: () => evidence,
}));
const roomId = randomUUID(),
  hostPlayerId = randomUUID(),
  guestPlayerId = randomUUID();
const hostIdentity = randomUUID(),
  guestIdentity = randomUUID(),
  gameId = randomUUID(),
  jobId = randomUUID();
const at = new Date();
function inventory(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const content = {
      themeSlug: 'planets',
      question: `Which world is recorded in entry ${index}?`,
      answer: `World ${index}`,
      acceptableAnswers: [],
      explanation: `Entry ${index} records World ${index}.`,
      category: 'Science & Nature',
      difficulty: 'Easy',
      pillar: 'GlobalEh',
      tags: ['Global'],
    };
    return {
      id: `q-${index}`,
      category: content.category,
      difficulty: content.difficulty,
      question: content.question,
      answer: content.answer,
      acceptable_answers: [],
      explanation: content.explanation,
      pillar: content.pillar,
      tags: content.tags,
      content,
      question_content_hash: hashQuestionSnapshot(content),
      candidate_id: randomUUID(),
      question_revision_id: randomUUID(),
      library_revision_id: randomUUID(),
      evidence_attempt_id: randomUUID(),
      evidence_review_id: randomUUID(),
      evidence_fingerprint: 'a'.repeat(64),
      fact_id: randomUUID(),
      fact_revision_id: randomUUID(),
    };
  });
}
function setup(
  options: {
    count?: number;
    actorUser?: string;
    rounds?: number;
    duplicateIdentity?: boolean;
    missingHostIdentity?: boolean;
    singleConnection?: boolean;
    guestSeen?: string[];
    history?: { question_id: string; fact_id: string | null }[];
    conflictFact?: string;
    failReservation?: boolean;
  } = {}
) {
  const rows = inventory(options.count ?? 40);
  let game: Record<string, unknown> | undefined, job: Record<string, unknown> | undefined;
  let lockedGameId: string | null = null;
  const commands: { text: string; values: unknown[] }[] = [];
  const reservations: string[] = [];
  const query = vi.fn(async (raw: string, values: unknown[] = []) => {
    const text = raw.replace(/\s+/g, ' ').trim();
    commands.push({ text, values });
    const result = (rows: unknown[]) => ({ rows, rowCount: rows.length });
    if (text === 'SELECT clock_timestamp() AS at') return result([{ at }]);
    if (text.startsWith('SELECT * FROM rooms'))
      return result([
        {
          id: roomId,
          code: 'ABCD2',
          status: 'lobby',
          phase: 'LOBBY',
          theme: 'Planets',
          category: 'Science & Nature',
          num_rounds: options.rounds ?? 5,
          host_player_id: hostPlayerId,
          expires_at: new Date(at.getTime() + 3600000),
          theme_preparation_game_id: lockedGameId,
        },
      ]);
    if (text.startsWith('SELECT * FROM room_players') && text.includes('token='))
      return result([
        { id: hostPlayerId, is_host: true, user_id: options.actorUser ?? 'host-account' },
      ]);
    if (text.startsWith('SELECT * FROM room_players'))
      return result([
        {
          id: hostPlayerId,
          user_id: 'host-account',
          theme_identity_id: options.missingHostIdentity ? null : hostIdentity,
        },
        {
          id: guestPlayerId,
          user_id: null,
          theme_identity_id: options.duplicateIdentity ? hostIdentity : guestIdentity,
          guest_seen_ids: options.guestSeen ?? [],
        },
      ]);
    if (text.startsWith('INSERT INTO theme_participant_identities'))
      return result([{ id: hostIdentity }]);
    if (text.startsWith('WITH RECURSIVE'))
      return result([{ id: hostIdentity }, { id: guestIdentity }]);
    if (text.startsWith('WITH last_games')) return result(options.history ?? []);
    if (text.startsWith('INSERT INTO theme_game_sessions')) {
      game = {
        id: gameId,
        contract_version: values[0],
        idempotency_key: values[1],
        idempotency_owner_hash: values[2],
        request_fingerprint: values[3],
        room_id: values[4],
        mode: values[5],
        status: 'preflight',
        theme: values[6],
        theme_slug: values[7],
        related_categories: JSON.parse(String(values[8])),
        player_count: values[9],
        question_count: values[10],
        themed_question_target: values[11],
        related_question_target: values[12],
        candidate_ceiling: values[13],
        opening_question_target: values[14],
        opening_themed_target: values[15],
        opening_related_target: values[16],
        roster_locked_at: at,
        expires_at: values[18],
        mix_consent_status: 'not_required',
        accepted_themed_target: null,
        accepted_related_target: null,
        created_at: at,
        updated_at: at,
      };
      return result([game]);
    }
    if (text.startsWith('INSERT INTO theme_preparation_jobs')) {
      job = {
        id: jobId,
        game_id: gameId,
        contract_version: values[0],
        stable_key: values[2],
        status: 'queued',
        public_stage: 'waiting',
        candidate_ceiling: 40 + 10,
        ready_count: 0,
        themed_ready_count: 0,
        related_ready_count: 0,
        candidates_used: 0,
        last_failure: null,
        lease_owner: null,
        lease_expires_at: null,
        started_at: null,
        completed_at: null,
        created_at: at,
        updated_at: at,
      };
      return result([]);
    }
    if (text.startsWith('SELECT * FROM theme_game_sessions')) return result(game ? [game] : []);
    if (text.startsWith('SELECT * FROM theme_preparation_jobs')) return result(job ? [job] : []);
    if (text.startsWith('SELECT id FROM theme_preparation_jobs')) return result([{ id: jobId }]);
    if (text.startsWith('SELECT generation_owner_user_id'))
      return result([{ generation_owner_user_id: 'host-account' }]);
    if (text.startsWith('UPDATE rooms SET theme_preparation_game_id')) {
      lockedGameId = gameId;
      return result([]);
    }
    if (text.startsWith('UPDATE theme_game_sessions SET status=')) {
      game!.status = 'waiting';
      return result([]);
    }
    if (text.startsWith('UPDATE theme_preparation_jobs SET status=')) {
      job!.status = text.includes("'shortfall'") ? 'shortfall' : 'waiting';
      job!.last_failure = values[1] ? JSON.parse(String(values[1])) : null;
      return result([]);
    }
    if (text.startsWith('SELECT q.*')) return result(rows);
    if (text.startsWith('SELECT 1 FROM theme_reservation_participants'))
      return result(values[1] === options.conflictFact ? [{ exists: 1 }] : []);
    if (text.startsWith('INSERT INTO theme_question_reservations')) {
      if (options.failReservation) throw new Error('database failed');
      reservations.push(String(values[2]));
      return result([{ id: randomUUID() }]);
    }
    return result([]);
  });
  evidence.qaContext.mockImplementation(async (request: { candidateId: string }) => {
    const row = rows.find((row) => row.candidate_id === request.candidateId)!;
    return {
      evidenceAttemptId: row.evidence_attempt_id,
      evidenceReviewId: row.evidence_review_id,
      evidenceFingerprint: row.evidence_fingerprint,
    };
  });
  let checkedOut = false;
  const pool = {
    connect: vi.fn(async () => {
      if (options.singleConnection && checkedOut)
        throw new Error('Projection requested a connection before admission released its client');
      checkedOut = true;
      return {
        query,
        release: vi.fn(() => {
          checkedOut = false;
        }),
      };
    }),
    query,
  } as unknown as Pool;
  return {
    admission: createThemeAdmission(pool, { evidence: {} as ThemeQuestionEvidenceReviewConfig }),
    pool,
    rows,
    query,
    commands,
    reservations,
  };
}
const input = { code: 'ABCD2', playerToken: 'host-token', userId: 'host-account' };
beforeEach(() => vi.clearAllMocks());
describe('dormant atomic theme admission', () => {
  it('reserves the full 40-question backup set, freezes once, and records no exposure', async () => {
    const test = setup();
    const first = await test.admission.start(input),
      second = await test.admission.start(input);
    expect(first.gameId).toBe(second.gameId);
    expect(first.progress).toMatchObject({
      status: 'waiting',
      readyCount: 0,
      canStart: false,
      candidatesUsed: 0,
    });
    expect(test.reservations).toHaveLength(40);
    expect(
      test.commands.filter((c) => c.text.startsWith('INSERT INTO theme_game_sessions'))
    ).toHaveLength(1);
    expect(
      test.commands.filter((c) => c.text.startsWith('INSERT INTO theme_game_participants'))
    ).toHaveLength(2);
    expect(
      test.commands.filter((c) => c.text.startsWith('INSERT INTO theme_reservation_participants'))
    ).toHaveLength(80);
    expect(
      test.commands.some((c) => c.text.startsWith('INSERT INTO theme_question_exposures'))
    ).toBe(false);
    expect(evidence.qaContext).toHaveBeenCalledTimes(40);
    expect(
      test.commands.find((c) =>
        c.text.startsWith('UPDATE theme_game_sessions SET generation_owner_user_id')
      )?.values
    ).toEqual([gameId, 'host-account']);
  });
  it('releases the transaction client before projecting both initial admission and retries', async () => {
    const test = setup({ singleConnection: true });
    const first = await test.admission.start(input);
    const retry = await test.admission.start(input);
    expect(retry.gameId).toBe(first.gameId);
    expect(test.pool.connect).toHaveBeenCalledTimes(6);
    expect(test.commands.filter((command) => command.text === 'COMMIT')).toHaveLength(2);
  });
  it('uses persisted subjects without rewriting account identities during admission', async () => {
    const test = setup();
    await test.admission.start(input);
    expect(
      test.commands.some((command) =>
        command.text.startsWith('INSERT INTO theme_participant_identities')
      )
    ).toBe(false);
    expect(
      test.commands.find((command) => command.text.startsWith('WITH RECURSIVE'))?.values
    ).toEqual([[hostIdentity, guestIdentity]]);
    expect(
      test.commands.find((command) =>
        command.text.startsWith('SELECT id FROM theme_participant_identities')
      )?.text
    ).toContain('ORDER BY id FOR UPDATE');
  });
  it('fails closed if a signed-in participant has no persisted history identity', async () => {
    const test = setup({ missingHostIdentity: true });
    await expect(test.admission.start(input)).rejects.toMatchObject({ status: 409 });
    expect(
      test.commands.some((command) =>
        command.text.startsWith('INSERT INTO theme_participant_identities')
      )
    ).toBe(false);
    expect(
      test.commands.some((command) => command.text.startsWith('INSERT INTO theme_game_sessions'))
    ).toBe(false);
    expect(test.commands.at(-1)?.text).toBe('ROLLBACK');
  });
  it('persists explicit shortfall and reserves nothing when any backup is missing', async () => {
    const test = setup({ count: 39 });
    const result = await test.admission.start(input);
    expect(result.progress).toMatchObject({
      status: 'shortfall',
      canStart: false,
      failure: { code: 'related_inventory_shortfall' },
    });
    expect(test.reservations).toHaveLength(0);
  });
  it('ignores ordinary approved questions without runtime evidence policy', async () => {
    const test = setup();
    const result = await createThemeAdmission(test.pool).start(input);
    expect(result.progress.status).toBe('shortfall');
    expect(evidence.qaContext).not.toHaveBeenCalled();
    expect(test.reservations).toHaveLength(0);
  });
  it('excludes recent exact-question and canonical-fact history and guest exclusions', async () => {
    const test = setup({ count: 43, guestSeen: ['q-2'] });
    // Emulate the authoritative history query rather than trusting caller exclusions.
    const original = test.query.getMockImplementation()!;
    test.query.mockImplementation(async (text, values) =>
      text.includes('WITH last_games')
        ? { rows: [{ question_id: 'q-0', fact_id: test.rows[1].fact_id }], rowCount: 1 }
        : original(text, values)
    );
    await test.admission.start(input);
    expect(test.reservations).toHaveLength(40);
    expect(test.reservations).not.toEqual(expect.arrayContaining(['q-0', 'q-1', 'q-2']));
  });
  it.each([{ actorUser: 'other-account' }, { rounds: 10 }, { duplicateIdentity: true }])(
    'rejects invalid ownership, round count or history identities: %j',
    async (options) => {
      const test = setup(options);
      await expect(test.admission.start(input)).rejects.toMatchObject({
        status: options.actorUser ? 403 : 409,
      });
      expect(test.commands.some((c) => c.text.startsWith('INSERT INTO theme_game_sessions'))).toBe(
        false
      );
      expect(test.commands.at(-1)?.text).toBe('ROLLBACK');
    }
  );
  it('rolls back game, roster lock and reservations together on persistence failure', async () => {
    const test = setup({ failReservation: true });
    await expect(test.admission.start(input)).rejects.toThrow('database failed');
    expect(test.commands.at(-1)?.text).toBe('ROLLBACK');
    expect(test.commands.some((c) => c.text === 'COMMIT')).toBe(false);
  });
});

describe('authoritative theme identity and exposure', () => {
  it('hashes an opaque guest subject and links it only to the server-authenticated account', async () => {
    const calls: { text: string; values: unknown[] }[] = [];
    const query = vi.fn(async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      return { rows: [{ id: calls.length === 1 ? hostIdentity : guestIdentity }], rowCount: 1 };
    });
    const subject = randomUUID();
    await resolveThemeIdentity({ query } as never, {
      userId: 'account-from-session',
      stableGuestSubjectId: subject,
    });
    expect(calls[0].values).toEqual([
      'account',
      themeSubjectHash('account:account-from-session'),
      'account-from-session',
    ]);
    expect(calls[1].values).toEqual([themeSubjectHash(`guest:${subject}`)]);
    expect(calls[2].values).toEqual([guestIdentity, hostIdentity]);
    expect(JSON.stringify(calls)).not.toContain(subject);
  });
  it('refuses anonymous identity reset when no stable subject is supplied', async () => {
    const query = vi.fn();
    await expect(resolveThemeIdentity({ query } as never, {})).rejects.toMatchObject({
      status: 422,
    });
    expect(query).not.toHaveBeenCalled();
  });
  it('refuses to mark held or unselected backup questions as exposed', async () => {
    const query = vi.fn(async (text: string) => ({
      rows: text.startsWith('SELECT identity_id FROM') ? [{ identity_id: hostIdentity }] : [],
      rowCount: 0,
    }));
    await expect(
      recordThemeExposure({ query } as never, {
        gameId,
        roomPlayerId: hostPlayerId,
        displayKey: 'round-1-q-1',
        questionId: 'backup-q',
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(
      query.mock.calls.some(([text]) => text.startsWith('INSERT INTO theme_question_exposures'))
    ).toBe(false);
  });
});
