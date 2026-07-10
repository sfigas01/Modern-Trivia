import type { Express, NextFunction, Request, Response } from 'express';
import { PgDialect } from 'drizzle-orm/pg-core';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTestApp } from './test/testApp';
import { deriveRoomPresence, determineDisputeVoteOutcome } from './routes.rooms';

const dbMocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const insertResults: unknown[][] = [];
  const updateResults: unknown[][] = [];
  const valueArgs: unknown[] = [];
  const whereArgs: unknown[] = [];

  function query(result: unknown[]) {
    const promise = Promise.resolve(result);
    const chain = {
      for: vi.fn(() => chain),
      from: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      onConflictDoUpdate: vi.fn(() => chain),
      returning: vi.fn(() => Promise.resolve(result)),
      set: vi.fn((value) => {
        valueArgs.push(value);
        return chain;
      }),
      then: promise.then.bind(promise),
      values: vi.fn((value) => {
        valueArgs.push(value);
        return chain;
      }),
      where: vi.fn((condition) => {
        whereArgs.push(condition);
        return chain;
      }),
    };
    return chain;
  }

  const methods = {
    delete: vi.fn(() => query([])),
    insert: vi.fn(() => query(insertResults.shift() ?? [])),
    select: vi.fn(() => query(selectResults.shift() ?? [])),
    selectDistinct: vi.fn(() => query([])),
    update: vi.fn(() => query(updateResults.shift() ?? [])),
  };

  const transaction = vi.fn(async (callback: (tx: typeof methods) => Promise<unknown>) =>
    callback(methods)
  );

  return {
    ...methods,
    transaction,
    selectResults,
    insertResults,
    updateResults,
    valueArgs,
    whereArgs,
  };
});

const authMocks = vi.hoisted(() => ({
  isAuthenticated: vi.fn((req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { user?: TestUser }).user;

    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    next();
  }),
  registerAuthRoutes: vi.fn(),
  setupAuth: vi.fn(async (app: Express) => {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const userId = req.header('x-test-user-id');

      if (userId) {
        (req as Request & { user?: TestUser }).user = {
          claims: { sub: userId },
          expires_at: Math.floor(Date.now() / 1000) + 60,
        };
      }

      next();
    });
  }),
}));

type TestUser = {
  claims: { sub: string };
  expires_at: number;
};

vi.mock('./db', () => ({
  db: {
    delete: dbMocks.delete,
    insert: dbMocks.insert,
    select: dbMocks.select,
    selectDistinct: dbMocks.selectDistinct,
    transaction: dbMocks.transaction,
    update: dbMocks.update,
  },
}));

vi.mock('./replit_integrations/auth', () => authMocks);
vi.mock('./lib/subjectivity-enricher', () => ({ enrichSubjectiveFindings: vi.fn() }));
vi.mock('./lib/ai', () => ({ analyzeDispute: vi.fn() }));
vi.mock('./lib/guardian', () => ({ generateQuestions: vi.fn() }));
vi.mock('./lib/field-fix', () => ({ getAiFieldFix: vi.fn() }));
vi.mock('./lib/question-quality-audit', () => ({ auditQuestionQuality: vi.fn() }));
vi.mock('./lib/duplicate-detector', () => ({ detectDuplicates: vi.fn() }));
vi.mock('./lib/verifier', () => ({ batchFactCheck: vi.fn() }));

const roomId = '11111111-1111-4111-8111-111111111111';
const hostId = '22222222-2222-4222-8222-222222222222';
const guestId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-07-03T15:00:00.000Z');

function room(overrides: Record<string, unknown> = {}) {
  return {
    id: roomId,
    code: 'ABCD2',
    status: 'lobby',
    phase: 'LOBBY',
    version: 1,
    hostPlayerId: hostId,
    category: 'All',
    numRounds: 5,
    questionIds: [],
    currentQuestionIndex: 0,
    activePlayerId: null,
    currentAttempt: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date('2099-07-03T17:00:00.000Z'),
    ...overrides,
  };
}

function player(overrides: Record<string, unknown> = {}) {
  return {
    id: hostId,
    roomId,
    nickname: 'Host',
    token: 'host-secret',
    joinOrder: 0,
    score: 0,
    questionCount: 0,
    lastRoundDelta: 0,
    isHost: true,
    lastSeenAt: now,
    leftAt: null,
    ...overrides,
  };
}

function question(id = 'question-1') {
  return {
    id,
    category: 'History & Geography',
    difficulty: 'Easy',
    question: 'What is the capital of Canada?',
    answer: 'Ottawa',
    acceptableAnswers: ['Ottawa, Ontario'],
    explanation: 'Ottawa is the federal capital.',
    pillar: 'GlobalEh',
    tags: ['Canada'],
    sourceUrl: 'https://example.com/ottawa',
    sourceName: 'Ottawa reference',
    status: 'approved',
    aiAnalysis: null,
    createdAt: now,
    updatedAt: now,
  };
}

function openDisputeVote(overrides: Record<string, unknown> = {}) {
  return {
    disputeId: 'dispute-1',
    disputingPlayerId: hostId,
    disputingPlayerName: 'Host',
    explanation: 'The alternate answer should count.',
    eligibleVoterIds: [guestId],
    submittedVoterIds: [],
    threshold: 1,
    openedAt: '2026-07-03T15:00:00.000Z',
    closesAt: '2099-07-03T15:01:00.000Z',
    status: 'OPEN' as const,
    ...overrides,
  };
}

function queueSelect(...results: unknown[][]) {
  dbMocks.selectResults.push(...results);
}

function postgresUniqueViolation(constraint: string) {
  return Object.assign(new Error('duplicate key'), { code: '23505', constraint });
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

describe('room lifecycle routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.selectResults.length = 0;
    dbMocks.insertResults.length = 0;
    dbMocks.updateResults.length = 0;
    dbMocks.valueArgs.length = 0;
    dbMocks.whereArgs.length = 0;
    dbMocks.transaction.mockImplementation(async (callback) =>
      callback({
        delete: dbMocks.delete,
        insert: dbMocks.insert,
        select: dbMocks.select,
        selectDistinct: dbMocks.selectDistinct,
        update: dbMocks.update,
      })
    );
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('derives online, away, and stale presence at the exact thresholds', () => {
    const observedAt = new Date('2026-07-03T15:00:30.000Z');

    expect(deriveRoomPresence(new Date('2026-07-03T15:00:20.001Z'), observedAt)).toBe('online');
    expect(deriveRoomPresence(new Date('2026-07-03T15:00:20.000Z'), observedAt)).toBe('away');
    expect(deriveRoomPresence(new Date('2026-07-03T15:00:00.000Z'), observedAt)).toBe('away');
    expect(deriveRoomPresence(new Date('2026-07-03T14:59:59.999Z'), observedAt)).toBe('stale');
  });

  it.each([
    [1, 0, 0, 1, 'approved'],
    [2, 0, 1, 2, 'approved'],
    [1, 1, 0, 2, 'tied'],
    [1, 2, 0, 2, 'rejected'],
    [1, 0, 2, 2, 'rejected'],
  ] as const)(
    'determines dispute outcome for yes=%i no=%i missing=%i threshold=%i',
    (yesCount, noCount, nonResponseCount, threshold, expected) => {
      expect(determineDisputeVoteOutcome(yesCount, noCount, nonResponseCount, threshold)).toBe(
        expected
      );
    }
  );

  it('preserves explicit expiry and cancellation outcomes', () => {
    expect(determineDisputeVoteOutcome(2, 0, 1, 2, 'expired')).toBe('approved');
    expect(determineDisputeVoteOutcome(1, 0, 2, 2, 'expired')).toBe('expired');
    expect(determineDisputeVoteOutcome(2, 0, 0, 2, 'canceled')).toBe('canceled');
  });

  it('submits a room-scoped dispute and freezes eligible voters', async () => {
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
    });
    const attempt = {
      questionId: 'question-1',
      playerId: hostId,
      submittedAnswer: 'Toronto',
      verdict: 'INCORRECT' as const,
      pointsDelta: -1,
    };
    const revealRoom = room({
      status: 'active',
      phase: 'REVEAL',
      activePlayerId: hostId,
      questionIds: ['question-1'],
      currentAttempt: attempt,
      opponentDisputeVotingEnabled: true,
      activeDisputeId: null,
      currentDisputeVote: null,
    });
    const vote = openDisputeVote();
    const votingRoom = room({
      ...revealRoom,
      phase: 'DISPUTE_VOTE',
      version: 2,
      activeDisputeId: 'dispute-1',
      currentDisputeVote: vote,
    });
    queueSelect(
      [revealRoom],
      [player()],
      [question()],
      [player(), guest],
      [player(), guest],
      [question()]
    );
    dbMocks.insertResults.push([{ id: 'dispute-1' }]);
    dbMocks.updateResults.push([votingRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/disputes')
      .set('X-Player-Token', 'host-secret')
      .send({ explanation: vote.explanation })
      .expect(200);

    expect(response.body.snapshot).toMatchObject({
      phase: 'DISPUTE_VOTE',
      currentDisputeVote: { eligibleVoterIds: [guestId], threshold: 1 },
    });
  });

  it('rejects dispute submission by a non-answering player and duplicate attempts', async () => {
    const attempt = {
      questionId: 'question-1',
      playerId: hostId,
      submittedAnswer: 'Toronto',
      verdict: 'INCORRECT' as const,
      pointsDelta: -1,
    };
    const revealRoom = room({
      status: 'active',
      phase: 'REVEAL',
      activePlayerId: hostId,
      currentAttempt: attempt,
    });
    const guest = player({ id: guestId, token: 'guest-secret', isHost: false });
    queueSelect([revealRoom], [guest]);
    const app = await buildTestApp();

    await request(app)
      .post('/api/rooms/ABCD2/disputes')
      .set('X-Player-Token', 'guest-secret')
      .send({ explanation: 'Please review this answer.' })
      .expect(403);

    queueSelect([{ ...revealRoom, activeDisputeId: 'dispute-1' }], [player()]);
    await request(app)
      .post('/api/rooms/ABCD2/disputes')
      .set('X-Player-Token', 'host-secret')
      .send({ explanation: 'Please review this answer.' })
      .expect(409);
  });

  it('requires authentication before an expired vote can finalize', async () => {
    queueSelect([
      room({
        status: 'active',
        phase: 'DISPUTE_VOTE',
        activeDisputeId: 'dispute-1',
        currentDisputeVote: openDisputeVote({ closesAt: '2020-01-01T00:00:00.000Z' }),
      }),
    ]);
    const app = await buildTestApp();

    await request(app).post('/api/rooms/ABCD2/disputes/vote').send({ approve: true }).expect(401);
    expect(dbMocks.update).not.toHaveBeenCalled();
  });

  it('finalizes an all-ballots approval and converts the attempt once', async () => {
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
    });
    const attempt = {
      questionId: 'question-1',
      playerId: hostId,
      submittedAnswer: 'Toronto',
      verdict: 'INCORRECT' as const,
      pointsDelta: -1,
    };
    const vote = openDisputeVote();
    const votingRoom = room({
      status: 'active',
      phase: 'DISPUTE_VOTE',
      activePlayerId: hostId,
      questionIds: ['question-1'],
      currentAttempt: attempt,
      opponentDisputeVotingEnabled: true,
      activeDisputeId: 'dispute-1',
      currentDisputeVote: vote,
    });
    const finalizedRoom = room({
      ...votingRoom,
      phase: 'REVEAL',
      version: 2,
      currentAttempt: { ...attempt, verdict: 'CORRECT', pointsDelta: 1 },
      currentDisputeVote: {
        ...vote,
        submittedVoterIds: [guestId],
        status: 'FINALIZED',
        yesCount: 1,
        noCount: 0,
        nonResponseCount: 0,
        outcome: 'approved',
        originalPointsDelta: -1,
        finalPointsDelta: 1,
        decidedAt: '2026-07-03T15:00:30.000Z',
      },
    });
    queueSelect(
      [votingRoom],
      [guest],
      [{ approve: true }],
      [question()],
      [player(), guest],
      [question()]
    );
    dbMocks.insertResults.push([]);
    dbMocks.updateResults.push([], [finalizedRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/disputes/vote')
      .set('X-Player-Token', 'guest-secret')
      .send({ approve: true })
      .expect(200);

    expect(response.body.snapshot).toMatchObject({
      phase: 'REVEAL',
      currentAttempt: { verdict: 'CORRECT', pointsDelta: 1 },
      currentDisputeVote: { outcome: 'approved' },
    });
  });

  it('requires the host to cancel an open dispute vote', async () => {
    const guest = player({ id: guestId, token: 'guest-secret', isHost: false });
    queueSelect(
      [
        room({
          status: 'active',
          phase: 'DISPUTE_VOTE',
          activeDisputeId: 'dispute-1',
          currentDisputeVote: openDisputeVote(),
        }),
      ],
      [guest]
    );
    const app = await buildTestApp();

    await request(app)
      .post('/api/rooms/ABCD2/disputes/cancel')
      .set('X-Player-Token', 'guest-secret')
      .send({})
      .expect(403);
  });

  it('finalizes an expired vote during polling and returns the recovered state', async () => {
    const attempt = {
      questionId: 'question-1',
      playerId: hostId,
      submittedAnswer: 'Toronto',
      verdict: 'INCORRECT' as const,
      pointsDelta: -1,
    };
    const vote = openDisputeVote({ closesAt: '2020-01-01T00:00:00.000Z' });
    const votingRoom = room({
      status: 'active',
      phase: 'DISPUTE_VOTE',
      activePlayerId: hostId,
      questionIds: ['question-1'],
      currentAttempt: attempt,
      activeDisputeId: 'dispute-1',
      currentDisputeVote: vote,
    });
    const finalizedRoom = room({
      ...votingRoom,
      phase: 'REVEAL',
      version: 2,
      currentDisputeVote: {
        ...vote,
        status: 'FINALIZED',
        yesCount: 0,
        noCount: 0,
        nonResponseCount: 1,
        outcome: 'expired',
        originalPointsDelta: -1,
        finalPointsDelta: -1,
        decidedAt: '2026-07-03T15:00:00.000Z',
      },
    });
    const guest = player({ id: guestId, token: 'guest-secret', isHost: false });
    queueSelect([votingRoom], [player()], [], [question()], [player(), guest], [question()]);
    dbMocks.updateResults.push([], [], [finalizedRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .get('/api/rooms/ABCD2')
      .set('X-Player-Token', 'host-secret')
      .expect(200);

    expect(response.body).toMatchObject({
      phase: 'REVEAL',
      currentAttempt: { verdict: 'INCORRECT', pointsDelta: -1 },
      currentDisputeVote: { outcome: 'expired' },
    });
  });

  it('creates a lobby room and its host atomically after cleaning up expired rooms', async () => {
    dbMocks.insertResults.push([room({ hostPlayerId: null })], [player()]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms')
      .send({ nickname: 'Host', categories: ['All'], numRounds: 5 })
      .expect(201);

    expect(response.body).toMatchObject({ code: 'ABCD2', playerId: hostId, token: 'host-secret' });
    expect(dbMocks.delete).toHaveBeenCalledOnce();
    expect(dbMocks.transaction).toHaveBeenCalledOnce();
    expect(dbMocks.insert).toHaveBeenCalledTimes(2);
    expect(dbMocks.update).toHaveBeenCalledOnce();

    const cleanupCondition = dbMocks.whereArgs[0] as Parameters<PgDialect['sqlToQuery']>[0];
    const cleanupQuery = new PgDialect().sqlToQuery(cleanupCondition);
    expect(cleanupQuery.sql).toContain('"rooms"."expires_at" <= $1');
    expect(cleanupQuery.params).toHaveLength(1);
  });

  it('retries a room-code collision', async () => {
    dbMocks.transaction.mockRejectedValueOnce(postgresUniqueViolation('rooms_code_unique'));
    dbMocks.insertResults.push([room({ hostPlayerId: null })], [player()]);
    const app = await buildTestApp();

    await request(app)
      .post('/api/rooms')
      .send({ nickname: 'Host', categories: ['All'], numRounds: 5 })
      .expect(201);

    expect(dbMocks.transaction).toHaveBeenCalledTimes(2);
  });

  it('stops after five room-code collisions', async () => {
    dbMocks.transaction.mockRejectedValue(postgresUniqueViolation('rooms_code_unique'));
    const app = await buildTestApp();

    await request(app)
      .post('/api/rooms')
      .send({ nickname: 'Host', categories: ['All'], numRounds: 5 })
      .expect(500);

    expect(dbMocks.transaction).toHaveBeenCalledTimes(5);
  });

  it('returns 422 for invalid create input', async () => {
    const app = await buildTestApp();

    await request(app)
      .post('/api/rooms')
      .send({ nickname: '', categories: ['All'], numRounds: 3 })
      .expect(422);

    expect(dbMocks.delete).not.toHaveBeenCalled();
  });

  it('joins a lobby room and returns credentials with the new snapshot', async () => {
    const host = player();
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
    });
    const updatedRoom = room({ version: 2 });
    queueSelect([room()], [host], [host, guest]);
    dbMocks.insertResults.push([guest]);
    dbMocks.updateResults.push([updatedRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/abcd2/join')
      .send({ nickname: 'Guest' })
      .expect(200);

    expect(response.body).toMatchObject({
      playerId: guestId,
      token: 'guest-secret',
      snapshot: {
        code: 'ABCD2',
        version: 2,
        players: [{ nickname: 'Host' }, { nickname: 'Guest' }],
      },
    });
    expect(response.body.snapshot.players[1]).not.toHaveProperty('token');
  });

  it.each([
    ['missing room', [], 404, 'Room not found'],
    [
      'expired room',
      [room({ expiresAt: new Date('2020-01-01T00:00:00.000Z') })],
      404,
      'Room expired',
    ],
    [
      'started room',
      [room({ status: 'active', phase: 'QUESTION' })],
      409,
      'Game has already started',
    ],
  ])('rejects join for a %s', async (_label, roomRows, status, message) => {
    queueSelect(roomRows as unknown[]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/join')
      .send({ nickname: 'Guest' })
      .expect(status as number);

    expect(response.body.message).toBe(message);
  });

  it('rejects a fifth player with a distinct conflict message', async () => {
    queueSelect(
      [room()],
      [
        player(),
        player({ id: guestId, nickname: 'Two', joinOrder: 1 }),
        player({ id: '44444444-4444-4444-8444-444444444444', nickname: 'Three', joinOrder: 2 }),
        player({ id: '55555555-5555-4555-8555-555555555555', nickname: 'Four', joinOrder: 3 }),
      ]
    );
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/join')
      .send({ nickname: 'Five' })
      .expect(409);

    expect(response.body.message).toBe('Room is full');
  });

  it('rejects a case-insensitive duplicate nickname', async () => {
    queueSelect([room()], [player()]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/join')
      .send({ nickname: 'host' })
      .expect(409);

    expect(response.body.message).toBe('Nickname is already taken');
  });

  it('maps a database nickname race to the nickname conflict', async () => {
    queueSelect([room()], [player()]);
    dbMocks.insert.mockImplementationOnce(() => {
      throw postgresUniqueViolation('uq_room_players_room_nickname_ci');
    });
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/join')
      .send({ nickname: 'Guest' })
      .expect(409);

    expect(response.body.message).toBe('Nickname is already taken');
  });

  it('allocates join order after departed players instead of reusing an indexed value', async () => {
    const departed = player({
      id: guestId,
      nickname: 'Departed',
      joinOrder: 1,
      isHost: false,
      leftAt: new Date('2026-07-03T15:05:00.000Z'),
    });
    const active = player({
      id: '44444444-4444-4444-8444-444444444444',
      nickname: 'Active',
      token: 'active-secret',
      joinOrder: 2,
      isHost: false,
    });
    const newcomer = player({
      id: '55555555-5555-4555-8555-555555555555',
      nickname: 'Newcomer',
      token: 'newcomer-secret',
      joinOrder: 3,
      isHost: false,
    });
    queueSelect([room()], [player(), departed, active], [player(), departed, active, newcomer]);
    dbMocks.insertResults.push([newcomer]);
    dbMocks.updateResults.push([room({ version: 2 })]);
    const app = await buildTestApp();

    await request(app).post('/api/rooms/ABCD2/join').send({ nickname: 'Newcomer' }).expect(200);

    expect(dbMocks.valueArgs).toContainEqual(
      expect.objectContaining({ nickname: 'Newcomer', joinOrder: 3 })
    );
  });

  it('starts a room with shuffled approved questions and the first player active', async () => {
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
    });
    const selectedQuestions = Array.from({ length: 40 }, (_, index) => ({
      id: `question-${index + 1}`,
    }));
    const startedRoom = room({
      status: 'active',
      phase: 'QUESTION',
      version: 2,
      questionIds: selectedQuestions.map(({ id }) => id),
      activePlayerId: hostId,
    });
    queueSelect(
      [room()],
      [player()],
      [player(), guest],
      selectedQuestions,
      [player(), guest],
      [question()]
    );
    dbMocks.updateResults.push([startedRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/start')
      .set('X-Player-Token', 'host-secret')
      .send({})
      .expect(200);

    expect(response.body.snapshot).toMatchObject({
      status: 'active',
      phase: 'QUESTION',
      activePlayerId: hostId,
      currentQuestion: { id: 'question-1' },
    });
    expect(dbMocks.valueArgs).toContainEqual(
      expect.objectContaining({
        status: 'active',
        phase: 'QUESTION',
        activePlayerId: hostId,
        questionIds: selectedQuestions.map(({ id }) => id),
      })
    );
  });

  it('records the selected questions in seen history for an authenticated host', async () => {
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
    });
    const selectedQuestions = Array.from({ length: 40 }, (_, index) => ({
      id: `question-${index + 1}`,
    }));
    const startedRoom = room({
      status: 'active',
      phase: 'QUESTION',
      version: 2,
      questionIds: selectedQuestions.map(({ id }) => id),
      activePlayerId: hostId,
    });
    queueSelect(
      [room()],
      [player()],
      [player(), guest],
      selectedQuestions,
      [player(), guest],
      [question()]
    );
    dbMocks.updateResults.push([startedRoom]);
    const app = await buildTestApp();

    await request(app)
      .post('/api/rooms/ABCD2/start')
      .set('X-Player-Token', 'host-secret')
      .set('x-test-user-id', 'host-user')
      .send({})
      .expect(200);

    expect(dbMocks.insert).toHaveBeenCalledTimes(1);
    expect(dbMocks.valueArgs).toContainEqual(
      selectedQuestions.map(({ id }) => ({ userId: 'host-user', questionId: id }))
    );
  });

  it('honors excludeQuestionIds for a guest host when the unseen pool is sufficient', async () => {
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
    });
    const selectedQuestions = Array.from({ length: 40 }, (_, index) => ({
      id: `question-${index + 1}`,
    }));
    const startedRoom = room({
      status: 'active',
      phase: 'QUESTION',
      version: 2,
      questionIds: selectedQuestions.map(({ id }) => id),
      activePlayerId: hostId,
    });
    queueSelect(
      [room()],
      [player()],
      [player(), guest],
      selectedQuestions,
      [player(), guest],
      [question()]
    );
    dbMocks.updateResults.push([startedRoom]);
    const app = await buildTestApp();

    await request(app)
      .post('/api/rooms/ABCD2/start')
      .set('X-Player-Token', 'host-secret')
      .send({ excludeQuestionIds: ['seen-1', 'seen-2'] })
      .expect(200);

    // Sufficient supply after exclusion — no backfill query needed.
    expect(dbMocks.select).toHaveBeenCalledTimes(6);

    const exclusionCondition = dbMocks.whereArgs.find((condition) => {
      const query = new PgDialect().sqlToQuery(condition as Parameters<PgDialect['sqlToQuery']>[0]);
      return query.sql.includes('not in') && query.params.includes('seen-1');
    });
    expect(exclusionCondition).toBeDefined();
  });

  it('backfills only the deficit, oldest-seen first, for a guest host when the unseen pool is too small', async () => {
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
    });
    // 10 unseen questions available; questionLimit is 40 (5 rounds * 2 players * 4),
    // so 30 more are needed. 35 eligible previously-seen ids are supplied,
    // oldest-first, and only the 30 oldest should be used to fill the deficit.
    const unseenQuestions = Array.from({ length: 10 }, (_, index) => ({
      id: `unseen-${index + 1}`,
    }));
    const excludeIds = Array.from({ length: 35 }, (_, index) => `seen-${index + 1}`);
    const eligibleSeenQuestions = excludeIds.map((id) => ({ id }));
    const expectedSelection = [...unseenQuestions.map(({ id }) => id), ...excludeIds.slice(0, 30)];
    const startedRoom = room({
      status: 'active',
      phase: 'QUESTION',
      version: 2,
      questionIds: expectedSelection,
      activePlayerId: hostId,
    });
    queueSelect(
      [room()],
      [player()],
      [player(), guest],
      unseenQuestions,
      eligibleSeenQuestions,
      [player(), guest],
      [question()]
    );
    dbMocks.updateResults.push([startedRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/start')
      .set('X-Player-Token', 'host-secret')
      .send({ excludeQuestionIds: excludeIds })
      .expect(200);

    // Two question-selection queries: the unseen attempt, then the eligible-seen backfill.
    expect(dbMocks.select).toHaveBeenCalledTimes(7);
    expect(response.body.snapshot.status).toBe('active');
    // The already-found unseen questions are kept; only the deficit (30) is
    // backfilled, from the oldest-seen ids first — never a fresh unconstrained draw.
    expect(dbMocks.valueArgs).toContainEqual(
      expect.objectContaining({ questionIds: expectedSelection })
    );
  });

  it('rejects more than 500 excludeQuestionIds with a 422', async () => {
    const app = await buildTestApp();

    await request(app)
      .post('/api/rooms/ABCD2/start')
      .set('X-Player-Token', 'host-secret')
      .send({ excludeQuestionIds: Array.from({ length: 501 }, (_, i) => `q${i}`) })
      .expect(422);

    expect(dbMocks.transaction).not.toHaveBeenCalled();
  });

  it('ignores client-supplied excludeQuestionIds for an authenticated host', async () => {
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
    });
    const selectedQuestions = Array.from({ length: 40 }, (_, index) => ({
      id: `question-${index + 1}`,
    }));
    const startedRoom = room({
      status: 'active',
      phase: 'QUESTION',
      version: 2,
      questionIds: selectedQuestions.map(({ id }) => id),
      activePlayerId: hostId,
    });
    queueSelect(
      [room()],
      [player()],
      [player(), guest],
      selectedQuestions,
      [player(), guest],
      [question()]
    );
    dbMocks.updateResults.push([startedRoom]);
    const app = await buildTestApp();

    await request(app)
      .post('/api/rooms/ABCD2/start')
      .set('X-Player-Token', 'host-secret')
      .set('x-test-user-id', 'host-user')
      .send({ excludeQuestionIds: ['some-guest-only-id'] })
      .expect(200);

    // Same single question-selection query as the plain authenticated flow —
    // the client's exclusion list never reaches the authenticated branch.
    expect(dbMocks.select).toHaveBeenCalledTimes(6);
    const exclusionCondition = dbMocks.whereArgs.find((condition) => {
      const query = new PgDialect().sqlToQuery(condition as Parameters<PgDialect['sqlToQuery']>[0]);
      return query.params.includes('some-guest-only-id');
    });
    expect(exclusionCondition).toBeUndefined();
  });

  it('returns 409 when the pool is genuinely too small even after backfill', async () => {
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
    });
    const stillShort = Array.from({ length: 10 }, (_, index) => ({
      id: `question-${index + 1}`,
    }));
    queueSelect([room()], [player()], [player(), guest], stillShort.slice(0, 5), stillShort);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/start')
      .set('X-Player-Token', 'host-secret')
      .send({ excludeQuestionIds: ['seen-1'] })
      .expect(409);

    expect(response.body.message).toBe('Not enough approved questions to start this game');
  });

  it('requires a host and at least two players to start', async () => {
    const guest = player({ id: guestId, token: 'guest-secret', isHost: false });
    queueSelect([room()], [guest]);
    const app = await buildTestApp();

    expect(
      (
        await request(app)
          .post('/api/rooms/ABCD2/start')
          .set('X-Player-Token', 'guest-secret')
          .send({})
          .expect(403)
      ).body.message
    ).toBe('Host token required');

    queueSelect([room()], [player()], [player()]);
    expect(
      (
        await request(app)
          .post('/api/rooms/ABCD2/start')
          .set('X-Player-Token', 'host-secret')
          .send({})
          .expect(409)
      ).body.message
    ).toBe('At least two players are required to start');
  });

  it('accepts an active-player answer and reveals its scored attempt', async () => {
    const questionRoom = room({
      status: 'active',
      phase: 'QUESTION',
      questionIds: ['question-1'],
      activePlayerId: hostId,
    });
    const answeredRoom = room({
      status: 'active',
      phase: 'REVEAL',
      version: 2,
      questionIds: ['question-1'],
      activePlayerId: hostId,
      currentAttempt: {
        questionId: 'question-1',
        playerId: hostId,
        submittedAnswer: 'Ottawa',
        verdict: 'CORRECT',
        pointsDelta: 1,
      },
    });
    queueSelect([questionRoom], [player()], [question()], [player()], [question()]);
    dbMocks.updateResults.push([answeredRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/answer')
      .set('X-Player-Token', 'host-secret')
      .send({ answer: 'Ottawa' })
      .expect(200);

    expect(response.body.snapshot).toMatchObject({
      phase: 'REVEAL',
      currentAttempt: { verdict: 'CORRECT', pointsDelta: 1 },
      currentQuestion: { answer: 'Ottawa' },
    });
  });

  it('rejects a non-active answer and a duplicate answer', async () => {
    const guest = player({ id: guestId, token: 'guest-secret', isHost: false });
    queueSelect(
      [
        room({
          status: 'active',
          phase: 'QUESTION',
          questionIds: ['question-1'],
          activePlayerId: hostId,
        }),
      ],
      [guest]
    );
    const app = await buildTestApp();

    expect(
      (
        await request(app)
          .post('/api/rooms/ABCD2/answer')
          .set('X-Player-Token', 'guest-secret')
          .send({ answer: 'Ottawa' })
          .expect(403)
      ).body.message
    ).toBe('Only the active player can answer');

    queueSelect([room({ status: 'active', phase: 'REVEAL' })]);
    expect(
      (
        await request(app)
          .post('/api/rooms/ABCD2/answer')
          .set('X-Player-Token', 'host-secret')
          .send({ answer: 'Ottawa' })
          .expect(409)
      ).body.message
    ).toBe('Room is not accepting answers');
  });

  it('advances once, applies score, and rejects a duplicate advance', async () => {
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
    });
    const attempt = {
      questionId: 'question-1',
      playerId: hostId,
      submittedAnswer: 'Ottawa',
      verdict: 'CORRECT' as const,
      pointsDelta: 1,
    };
    const revealRoom = room({
      status: 'active',
      phase: 'REVEAL',
      questionIds: ['question-1', 'question-2'],
      activePlayerId: hostId,
      currentAttempt: attempt,
    });
    const advancedRoom = room({
      status: 'active',
      phase: 'QUESTION',
      version: 2,
      questionIds: ['question-1', 'question-2'],
      currentQuestionIndex: 1,
      activePlayerId: hostId,
      currentAttempt: attempt,
    });
    queueSelect(
      [revealRoom],
      [player()],
      [player(), guest],
      [player({ score: 1, questionCount: 1, lastRoundDelta: 1 }), guest],
      [question('question-2')]
    );
    dbMocks.updateResults.push([advancedRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/advance')
      .set('X-Player-Token', 'host-secret')
      .send({})
      .expect(200);

    expect(response.body.snapshot).toMatchObject({
      phase: 'QUESTION',
      currentQuestionIndex: 1,
      currentQuestion: { id: 'question-2' },
    });
    expect(response.body.snapshot.players[0]).toMatchObject({
      id: hostId,
      score: 1,
      questionCount: 1,
    });

    queueSelect([advancedRoom]);
    expect(
      (
        await request(app)
          .post('/api/rooms/ABCD2/advance')
          .set('X-Player-Token', 'host-secret')
          .send({})
          .expect(409)
      ).body.message
    ).toBe('Room is not ready to advance');
  });

  it('returns a valid revealed snapshot when the final answer ends the game', async () => {
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
    });
    const attempt = {
      questionId: 'question-1',
      playerId: hostId,
      submittedAnswer: 'Ottawa',
      verdict: 'CORRECT' as const,
      pointsDelta: 1,
    };
    const revealRoom = room({
      status: 'active',
      phase: 'REVEAL',
      questionIds: ['question-1'],
      activePlayerId: hostId,
      currentAttempt: attempt,
    });
    const finishedRoom = room({
      status: 'finished',
      phase: 'GAME_OVER',
      version: 2,
      questionIds: ['question-1'],
      currentQuestionIndex: 1,
      activePlayerId: hostId,
      currentAttempt: attempt,
    });
    queueSelect(
      [revealRoom],
      [player()],
      [player(), guest],
      [player({ score: 1, questionCount: 1, lastRoundDelta: 1 }), guest],
      [question()]
    );
    dbMocks.updateResults.push([finishedRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/advance')
      .set('X-Player-Token', 'host-secret')
      .send({})
      .expect(200);

    expect(response.body.snapshot).toMatchObject({
      status: 'finished',
      phase: 'GAME_OVER',
      currentQuestionIndex: 1,
      currentQuestion: { id: 'question-1', answer: 'Ottawa' },
    });
  });

  it('allows only the host to continue from round score', async () => {
    const attempt = {
      questionId: 'question-1',
      playerId: guestId,
      submittedAnswer: null,
      verdict: 'PASS' as const,
      pointsDelta: 0,
    };
    const scoreRoom = room({
      status: 'active',
      phase: 'ROUND_SCORE',
      questionIds: ['question-1', 'question-2'],
      currentQuestionIndex: 1,
      activePlayerId: hostId,
      currentAttempt: attempt,
    });
    const guest = player({ id: guestId, token: 'guest-secret', isHost: false });
    queueSelect([scoreRoom], [guest]);
    const app = await buildTestApp();

    await request(app)
      .post('/api/rooms/ABCD2/continue')
      .set('X-Player-Token', 'guest-secret')
      .send({})
      .expect(403);

    const continuedRoom = room({
      status: 'active',
      phase: 'QUESTION',
      version: 2,
      questionIds: ['question-1', 'question-2'],
      currentQuestionIndex: 1,
      activePlayerId: hostId,
      currentAttempt: null,
    });
    queueSelect([scoreRoom], [player()], [player(), guest], [question('question-2')]);
    dbMocks.updateResults.push([continuedRoom]);
    const response = await request(app)
      .post('/api/rooms/ABCD2/continue')
      .set('X-Player-Token', 'host-secret')
      .send({})
      .expect(200);

    expect(response.body.snapshot).toMatchObject({ phase: 'QUESTION', currentAttempt: null });
  });

  it('lets only the host abandon a lobby', async () => {
    const guest = player({ id: guestId, token: 'guest-secret', isHost: false });
    queueSelect([room()], [guest]);
    const app = await buildTestApp();

    await request(app)
      .post('/api/rooms/ABCD2/end')
      .set('X-Player-Token', 'guest-secret')
      .send({})
      .expect(403);

    const abandonedRoom = room({ status: 'abandoned', phase: 'LOBBY', version: 2 });
    queueSelect([room()], [player()], [player(), guest]);
    dbMocks.updateResults.push([abandonedRoom]);
    const response = await request(app)
      .post('/api/rooms/ABCD2/end')
      .set('X-Player-Token', 'host-secret')
      .send({})
      .expect(200);

    expect(response.body.snapshot).toMatchObject({ status: 'abandoned', phase: 'LOBBY' });
  });

  it('lets the host skip an active player stale for more than sixty seconds', async () => {
    const observedAt = Date.now();
    const host = player({ lastSeenAt: new Date(observedAt) });
    const staleGuest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
      lastSeenAt: new Date(observedAt - 60_001),
    });
    const questionRoom = room({
      status: 'active',
      phase: 'QUESTION',
      questionIds: ['question-1', 'question-2'],
      activePlayerId: guestId,
    });
    const skippedRoom = room({
      status: 'active',
      phase: 'QUESTION',
      version: 2,
      questionIds: ['question-1', 'question-2'],
      currentQuestionIndex: 1,
      activePlayerId: hostId,
      currentAttempt: {
        questionId: 'question-1',
        playerId: guestId,
        submittedAnswer: null,
        verdict: 'PASS',
        pointsDelta: 0,
      },
    });
    queueSelect(
      [questionRoom],
      [host],
      [host, staleGuest],
      [host, { ...staleGuest, questionCount: 1 }],
      [question('question-2')]
    );
    dbMocks.updateResults.push([skippedRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/skip')
      .set('X-Player-Token', 'host-secret')
      .send({})
      .expect(200);

    expect(response.body.snapshot).toMatchObject({
      phase: 'QUESTION',
      currentQuestionIndex: 1,
      activePlayerId: hostId,
      currentAttempt: { playerId: guestId, verdict: 'PASS', pointsDelta: 0 },
      currentQuestion: { id: 'question-2' },
    });
    expect(response.body.snapshot.players[1]).toMatchObject({ score: 0, questionCount: 1 });
  });

  it('rejects skip from a non-host and while the active player is not stale enough', async () => {
    const observedAt = Date.now();
    const host = player({ lastSeenAt: new Date(observedAt) });
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
      lastSeenAt: new Date(observedAt - 30_000),
    });
    const questionRoom = room({
      status: 'active',
      phase: 'QUESTION',
      questionIds: ['question-1'],
      activePlayerId: guestId,
    });
    queueSelect([questionRoom], [guest]);
    const app = await buildTestApp();

    expect(
      (
        await request(app)
          .post('/api/rooms/ABCD2/skip')
          .set('X-Player-Token', 'guest-secret')
          .send({})
          .expect(403)
      ).body.message
    ).toBe('Host token required');

    queueSelect([questionRoom], [host], [host, guest]);
    expect(
      (
        await request(app)
          .post('/api/rooms/ABCD2/skip')
          .set('X-Player-Token', 'host-secret')
          .send({})
          .expect(409)
      ).body.message
    ).toBe('Active player is not stale enough to skip');
  });

  it('abandons a lobby lazily when a guest polls after the host is stale for five minutes', async () => {
    const observedAt = Date.now();
    const staleHost = player({ lastSeenAt: new Date(observedAt - 300_001) });
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
      lastSeenAt: new Date(observedAt),
    });
    const abandonedRoom = room({ status: 'abandoned', version: 2 });
    queueSelect([room()], [guest], [staleHost, guest], [staleHost, guest]);
    dbMocks.updateResults.push([], [abandonedRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .get('/api/rooms/ABCD2')
      .set('X-Player-Token', 'guest-secret')
      .expect(200);

    expect(response.body).toMatchObject({ status: 'abandoned', phase: 'LOBBY', version: 2 });
  });

  it('promotes the oldest connected player once when the host is stale mid-game', async () => {
    const observedAt = Date.now();
    const staleHost = player({ lastSeenAt: new Date(observedAt - 120_001) });
    const oldestConnected = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
      lastSeenAt: new Date(observedAt),
    });
    const newerConnected = player({
      id: '44444444-4444-4444-8444-444444444444',
      nickname: 'Newer',
      token: 'newer-secret',
      joinOrder: 2,
      isHost: false,
      lastSeenAt: new Date(observedAt),
    });
    const activeRoom = room({
      status: 'active',
      phase: 'QUESTION',
      questionIds: ['question-1'],
      activePlayerId: hostId,
    });
    const promotedRoom = room({
      status: 'active',
      phase: 'QUESTION',
      version: 2,
      hostPlayerId: guestId,
      questionIds: ['question-1'],
      activePlayerId: hostId,
    });
    const promotedPlayers = [
      { ...staleHost, isHost: false },
      { ...oldestConnected, isHost: true },
      newerConnected,
    ];
    queueSelect(
      [activeRoom],
      [oldestConnected],
      [staleHost, oldestConnected, newerConnected],
      promotedPlayers,
      [question()]
    );
    // lastSeenAt update, isHost:false (promoteHost), isHost:true (promoteHost), room hostPlayerId update
    dbMocks.updateResults.push([], [], [], [promotedRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .get('/api/rooms/ABCD2')
      .set('X-Player-Token', 'guest-secret')
      .expect(200);

    expect(response.body).toMatchObject({ hostPlayerId: guestId, version: 2 });
    expect(response.body.players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: hostId, isHost: false }),
        expect.objectContaining({ id: guestId, isHost: true }),
      ])
    );
    expect(
      dbMocks.valueArgs.filter(
        (value) => typeof value === 'object' && value !== null && 'hostPlayerId' in value
      )
    ).toHaveLength(1);
  });

  it('keeps abandoned and finished rooms readable', async () => {
    const abandonedRoom = room({ status: 'abandoned' });
    queueSelect([abandonedRoom], [player()], [player()]);
    const app = await buildTestApp();

    expect(
      (await request(app).get('/api/rooms/ABCD2').set('X-Player-Token', 'host-secret').expect(200))
        .body.status
    ).toBe('abandoned');

    const attempt = {
      questionId: 'question-1',
      playerId: hostId,
      submittedAnswer: null,
      verdict: 'PASS' as const,
      pointsDelta: 0,
    };
    const finishedRoom = room({
      status: 'finished',
      phase: 'GAME_OVER',
      questionIds: ['question-1'],
      currentQuestionIndex: 1,
      activePlayerId: hostId,
      currentAttempt: attempt,
    });
    queueSelect([finishedRoom], [player()], [player()], [question()]);
    expect(
      (await request(app).get('/api/rooms/ABCD2').set('X-Player-Token', 'host-secret').expect(200))
        .body
    ).toMatchObject({ status: 'finished', phase: 'GAME_OVER' });
  });

  it('returns a fresh live-room snapshot when only presence changed', async () => {
    const refreshedHost = player({ lastSeenAt: new Date() });
    queueSelect([room()], [player()], [player()], [refreshedHost]);
    const app = await buildTestApp();

    const response = await request(app)
      .get('/api/rooms/ABCD2?sinceVersion=1')
      .set('X-Player-Token', 'host-secret')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'lobby',
      version: 1,
      players: [{ id: hostId, presence: 'online' }],
    });
    expect(dbMocks.update).toHaveBeenCalledOnce();
  });

  it('returns unchanged for a terminal room at the current version', async () => {
    queueSelect([room({ status: 'abandoned' })], [player()]);
    const app = await buildTestApp();

    const response = await request(app)
      .get('/api/rooms/ABCD2?sinceVersion=1')
      .set('X-Player-Token', 'host-secret')
      .expect(200);

    expect(response.body).toEqual({ changed: false });
    expect(dbMocks.update).toHaveBeenCalledOnce();
  });

  it('returns 422 for an invalid polling version', async () => {
    const app = await buildTestApp();

    await request(app).get('/api/rooms/ABCD2?sinceVersion=-1').expect(422);

    expect(dbMocks.select).not.toHaveBeenCalled();
  });

  it('requires a valid player token to poll', async () => {
    queueSelect([room()]);
    const app = await buildTestApp();

    const missing = await request(app).get('/api/rooms/ABCD2').expect(401);
    expect(missing.body.message).toBe('Player token required');

    queueSelect([room()], []);
    const invalid = await request(app)
      .get('/api/rooms/ABCD2')
      .set('X-Player-Token', 'wrong')
      .expect(401);
    expect(invalid.body.message).toBe('Invalid player token');
  });

  it('returns distinct not-found and expired errors when polling', async () => {
    const app = await buildTestApp();

    queueSelect([]);
    expect((await request(app).get('/api/rooms/ABCD2').expect(404)).body.message).toBe(
      'Room not found'
    );

    queueSelect([room({ expiresAt: new Date('2020-01-01T00:00:00.000Z') })]);
    expect((await request(app).get('/api/rooms/ABCD2').expect(404)).body.message).toBe(
      'Room expired'
    );
  });

  it('redacts answer and source fields during the QUESTION phase', async () => {
    const questionRoom = room({
      status: 'active',
      phase: 'QUESTION',
      questionIds: ['question-1'],
      activePlayerId: hostId,
    });
    const question = {
      id: 'question-1',
      category: 'History & Geography',
      difficulty: 'Easy',
      question: 'What is the capital of Canada?',
      answer: 'Ottawa',
      acceptableAnswers: ['Ottawa, Ontario'],
      explanation: 'Ottawa is the federal capital.',
      pillar: 'GlobalEh',
      tags: ['Canada'],
      sourceUrl: 'https://example.com/ottawa',
      sourceName: 'Ottawa reference',
    };
    queueSelect([questionRoom], [player()], [player()], [player()], [question]);
    const app = await buildTestApp();

    const response = await request(app)
      .get('/api/rooms/ABCD2')
      .set('X-Player-Token', 'host-secret')
      .expect(200);

    expect(response.body.currentQuestion).toMatchObject({
      id: 'question-1',
      sourceUrl: null,
      sourceName: null,
    });
    expect(response.body.currentQuestion).not.toHaveProperty('answer');
    expect(response.body.currentQuestion).not.toHaveProperty('acceptableAnswers');
    expect(response.body.currentQuestion).not.toHaveProperty('explanation');
  });

  it('reveals answer fields during REVEAL', async () => {
    const revealRoom = room({
      status: 'active',
      phase: 'REVEAL',
      questionIds: ['question-1'],
      activePlayerId: hostId,
    });
    const question = {
      id: 'question-1',
      category: 'History & Geography',
      difficulty: 'Easy',
      question: 'What is the capital of Canada?',
      answer: 'Ottawa',
      acceptableAnswers: ['Ottawa, Ontario'],
      explanation: 'Ottawa is the federal capital.',
      pillar: 'GlobalEh',
      tags: ['Canada'],
      sourceUrl: 'https://example.com/ottawa',
      sourceName: 'Ottawa reference',
    };
    queueSelect([revealRoom], [player()], [player()], [player()], [question]);
    const app = await buildTestApp();

    const response = await request(app)
      .get('/api/rooms/ABCD2')
      .set('X-Player-Token', 'host-secret')
      .expect(200);

    expect(response.body.currentQuestion).toMatchObject({
      answer: 'Ottawa',
      acceptableAnswers: ['Ottawa, Ontario'],
      explanation: 'Ottawa is the federal capital.',
    });
  });

  // ── /leave route ────────────────────────────────────────────────────────────

  it('non-host player leaves mid-game and the game continues', async () => {
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
    });
    const thirdId = '44444444-4444-4444-8444-444444444444';
    const thirdPlayer = player({
      id: thirdId,
      nickname: 'Third',
      token: 'third-secret',
      joinOrder: 2,
      isHost: false,
    });
    const activeRoom = room({
      status: 'active',
      phase: 'QUESTION',
      questionIds: ['question-1', 'question-2'],
      activePlayerId: hostId,
    });
    const updatedRoom = room({
      status: 'active',
      phase: 'QUESTION',
      version: 2,
      questionIds: ['question-1', 'question-2'],
      activePlayerId: hostId,
    });
    queueSelect(
      [activeRoom],
      [guest],
      [player(), guest, thirdPlayer],
      [player(), thirdPlayer],
      [question()]
    );
    // leftAt update (no returning), then room version bump
    dbMocks.updateResults.push([], [updatedRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/leave')
      .set('X-Player-Token', 'guest-secret')
      .send({})
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.snapshot).toMatchObject({ status: 'active', version: 2 });
    expect(dbMocks.update).toHaveBeenCalledTimes(2); // leftAt update + room version bump
  });

  it('leaving player was active during QUESTION — auto-passes and advances turn', async () => {
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
    });
    const thirdId = '44444444-4444-4444-8444-444444444444';
    const thirdPlayer = player({
      id: thirdId,
      nickname: 'Third',
      token: 'third-secret',
      joinOrder: 2,
      isHost: false,
    });
    const questionRoom = room({
      status: 'active',
      phase: 'QUESTION',
      questionIds: ['question-1', 'question-2', 'question-3'],
      activePlayerId: guestId,
    });
    const advancedRoom = room({
      status: 'active',
      phase: 'QUESTION',
      version: 2,
      questionIds: ['question-1', 'question-2', 'question-3'],
      currentQuestionIndex: 1,
      activePlayerId: thirdId,
    });
    queueSelect(
      [questionRoom],
      [guest],
      [player(), guest, thirdPlayer],
      [player(), thirdPlayer],
      [question('question-2')]
    );
    // leftAt update, then room update with transition, then 2 player score updates
    dbMocks.updateResults.push([], [advancedRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/leave')
      .set('X-Player-Token', 'guest-secret')
      .send({})
      .expect(200);

    expect(response.body.snapshot).toMatchObject({
      status: 'active',
      phase: 'QUESTION',
      currentQuestionIndex: 1,
    });
    // Verify the PASS attempt was stored and next player was set
    const roomSetCall = dbMocks.valueArgs.find(
      (v) =>
        typeof v === 'object' &&
        v !== null &&
        'currentAttempt' in v &&
        (v as Record<string, unknown>).currentAttempt !== null
    );
    expect(roomSetCall).toBeDefined();
  });

  it('second player leaves a 2-player game — game ends with GAME_OVER', async () => {
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
    });
    const activeRoom = room({
      status: 'active',
      phase: 'QUESTION',
      questionIds: ['question-1'],
      activePlayerId: hostId,
    });
    const finishedRoom = room({
      status: 'finished',
      phase: 'GAME_OVER',
      version: 2,
      questionIds: ['question-1'],
      activePlayerId: hostId,
    });
    // remainingPlayers = [host] (count=1) after guest leaves
    queueSelect([activeRoom], [guest], [player(), guest], [player()], [question()]);
    // leftAt update, then room status→finished update
    dbMocks.updateResults.push([], [finishedRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/leave')
      .set('X-Player-Token', 'guest-secret')
      .send({})
      .expect(200);

    expect(response.body.snapshot).toMatchObject({ status: 'finished', phase: 'GAME_OVER' });
  });

  it('host leaves mid-game — next player is immediately promoted', async () => {
    const observedAt = Date.now();
    const host = player({ lastSeenAt: new Date(observedAt) });
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
      lastSeenAt: new Date(observedAt),
    });
    const thirdId = '44444444-4444-4444-8444-444444444444';
    const thirdPlayer = player({
      id: thirdId,
      nickname: 'Third',
      token: 'third-secret',
      joinOrder: 2,
      isHost: false,
      lastSeenAt: new Date(observedAt),
    });
    const activeRoom = room({
      status: 'active',
      phase: 'QUESTION',
      questionIds: ['question-1'],
      activePlayerId: thirdId,
    });
    const promotedRoom = room({
      status: 'active',
      phase: 'QUESTION',
      version: 2,
      hostPlayerId: guestId,
      questionIds: ['question-1'],
      activePlayerId: thirdId,
    });
    queueSelect(
      [activeRoom],
      [host],
      [host, guest, thirdPlayer],
      [player({ id: guestId, isHost: true }), thirdPlayer],
      [question()]
    );
    // leftAt, isHost:false (promoteHost), isHost:true (promoteHost), room update with new hostPlayerId
    dbMocks.updateResults.push([], [], [], [promotedRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/leave')
      .set('X-Player-Token', 'host-secret')
      .send({})
      .expect(200);

    expect(response.body.snapshot).toMatchObject({ hostPlayerId: guestId, version: 2 });
    // isHost toggled on both players
    const isHostUpdates = dbMocks.valueArgs.filter(
      (v) => typeof v === 'object' && v !== null && 'isHost' in v
    );
    expect(isHostUpdates).toHaveLength(2);
  });

  it('non-host leaves the lobby and is removed', async () => {
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
    });
    const lobbyRoom = room({ version: 1 });
    const updatedLobby = room({ version: 2 });
    queueSelect([lobbyRoom], [guest], [player(), guest], [player()]);
    // leftAt update, then room version bump
    dbMocks.updateResults.push([], [updatedLobby]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/leave')
      .set('X-Player-Token', 'guest-secret')
      .send({})
      .expect(200);

    expect(response.body.snapshot).toMatchObject({ status: 'lobby', version: 2 });
  });

  it('returns 409 when leaving a finished room', async () => {
    const finishedRoom = room({ status: 'finished', phase: 'GAME_OVER' });
    queueSelect([finishedRoom], [player()]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/leave')
      .set('X-Player-Token', 'host-secret')
      .send({})
      .expect(409);

    expect(response.body.message).toBe('Room has already ended');
  });

  it('active player leaves during ROUND_SCORE — activePlayerId is reassigned to next player', async () => {
    const guest = player({
      id: guestId,
      nickname: 'Guest',
      token: 'guest-secret',
      joinOrder: 1,
      isHost: false,
    });
    const thirdId = '44444444-4444-4444-8444-444444444444';
    const thirdPlayer = player({
      id: thirdId,
      nickname: 'Third',
      token: 'third-secret',
      joinOrder: 2,
      isHost: false,
    });
    const scoreRoom = room({
      status: 'active',
      phase: 'ROUND_SCORE',
      questionIds: ['question-1', 'question-2', 'question-3'],
      currentQuestionIndex: 1,
      activePlayerId: guestId,
    });
    const updatedRoom = room({
      status: 'active',
      phase: 'ROUND_SCORE',
      version: 2,
      questionIds: ['question-1', 'question-2', 'question-3'],
      currentQuestionIndex: 1,
      activePlayerId: thirdId,
    });
    queueSelect(
      [scoreRoom],
      [guest],
      [player(), guest, thirdPlayer],
      [player(), guest, thirdPlayer],
      [question()]
    );
    // leftAt update, then room update with new activePlayerId
    dbMocks.updateResults.push([], [updatedRoom]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms/ABCD2/leave')
      .set('X-Player-Token', 'guest-secret')
      .send({})
      .expect(200);

    expect(response.body.snapshot).toMatchObject({
      status: 'active',
      phase: 'ROUND_SCORE',
      activePlayerId: thirdId,
    });
    expect(dbMocks.update).toHaveBeenCalledTimes(2); // leftAt + room update
  });

  it('requires a valid player token to leave', async () => {
    queueSelect([room({ status: 'active', phase: 'QUESTION' })]);
    const app = await buildTestApp();

    await request(app).post('/api/rooms/ABCD2/leave').send({}).expect(401);
  });
});
