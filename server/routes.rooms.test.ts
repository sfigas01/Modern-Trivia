import type { Express, NextFunction, Request, Response } from 'express';
import { PgDialect } from 'drizzle-orm/pg-core';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTestApp } from './test/testApp';

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
      limit: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      returning: vi.fn(() => Promise.resolve(result)),
      set: vi.fn(() => chain),
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
  isAuthenticated: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  registerAuthRoutes: vi.fn(),
  setupAuth: vi.fn(async (_app: Express) => undefined),
}));

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

  it('creates a lobby room and its host atomically after cleaning up expired rooms', async () => {
    dbMocks.insertResults.push([room({ hostPlayerId: null })], [player()]);
    const app = await buildTestApp();

    const response = await request(app)
      .post('/api/rooms')
      .send({ nickname: 'Host', category: 'All', numRounds: 5 })
      .expect(201);

    expect(response.body).toMatchObject({ code: 'ABCD2', playerId: hostId, token: 'host-secret' });
    expect(dbMocks.delete).toHaveBeenCalledOnce();
    expect(dbMocks.transaction).toHaveBeenCalledOnce();
    expect(dbMocks.insert).toHaveBeenCalledTimes(2);
    expect(dbMocks.update).toHaveBeenCalledOnce();

    const cleanupCondition = dbMocks.whereArgs[0] as Parameters<PgDialect['sqlToQuery']>[0];
    const cleanupQuery = new PgDialect().sqlToQuery(cleanupCondition);
    expect(cleanupQuery.sql).toContain('"rooms"."status" = $1');
    expect(cleanupQuery.sql).toContain('"rooms"."phase" = $2');
    expect(cleanupQuery.sql).toContain('"rooms"."expires_at" <= $3');
    expect(cleanupQuery.params.slice(0, 2)).toEqual(['lobby', 'LOBBY']);
  });

  it('retries a room-code collision', async () => {
    dbMocks.transaction.mockRejectedValueOnce(postgresUniqueViolation('rooms_code_unique'));
    dbMocks.insertResults.push([room({ hostPlayerId: null })], [player()]);
    const app = await buildTestApp();

    await request(app)
      .post('/api/rooms')
      .send({ nickname: 'Host', category: 'All', numRounds: 5 })
      .expect(201);

    expect(dbMocks.transaction).toHaveBeenCalledTimes(2);
  });

  it('stops after five room-code collisions', async () => {
    dbMocks.transaction.mockRejectedValue(postgresUniqueViolation('rooms_code_unique'));
    const app = await buildTestApp();

    await request(app)
      .post('/api/rooms')
      .send({ nickname: 'Host', category: 'All', numRounds: 5 })
      .expect(500);

    expect(dbMocks.transaction).toHaveBeenCalledTimes(5);
  });

  it('returns 422 for invalid create input', async () => {
    const app = await buildTestApp();

    await request(app)
      .post('/api/rooms')
      .send({ nickname: '', category: 'All', numRounds: 3 })
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

  it('returns unchanged while still refreshing presence', async () => {
    queueSelect([room()], [player()]);
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
    queueSelect([questionRoom], [player()], [player()], [question]);
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
    queueSelect([revealRoom], [player()], [player()], [question]);
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
});
