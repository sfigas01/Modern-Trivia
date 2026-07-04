import { describe, expect, it } from 'vitest';

import {
  advanceRoomRequestSchema,
  advanceRoomResponseSchema,
  answerRoomRequestSchema,
  answerRoomResponseSchema,
  continueRoomRequestSchema,
  continueRoomResponseSchema,
  createRoomRequestSchema,
  createRoomResponseSchema,
  endRoomRequestSchema,
  endRoomResponseSchema,
  insertDisputeSchema,
  insertQuestionSchema,
  insertRoomPlayerSchema,
  insertRoomSchema,
  joinRoomRequestSchema,
  joinRoomResponseSchema,
  pollRoomRequestSchema,
  pollRoomResponseSchema,
  revealedRoomQuestionSchema,
  roomAttemptSchema,
  roomCodeParamsSchema,
  roomErrorResponseSchema,
  roomSnapshotSchema,
  skipRoomRequestSchema,
  skipRoomResponseSchema,
  startRoomRequestSchema,
  startRoomResponseSchema,
} from './schema';

const validDisputePayload = {
  questionId: 'q-1',
  questionText: 'What is the capital of Canada?',
  correctAnswer: 'Ottawa',
  teamName: 'Alpha',
  submittedAnswer: 'Toronto',
  teamExplanation: 'The clue made Toronto sound acceptable.',
};

const validQuestionPayload = {
  id: 'q-test',
  category: 'History & Geography',
  difficulty: 'Medium',
  question: 'Which civilization built Machu Picchu?',
  answer: 'Inca Empire',
  explanation: 'Machu Picchu was built by the Inca Empire in the 15th century.',
  pillar: 'TimeCapsule',
};

const roomId = '11111111-1111-4111-8111-111111111111';
const hostPlayerId = '22222222-2222-4222-8222-222222222222';
const guestPlayerId = '33333333-3333-4333-8333-333333333333';
const timestamp = '2026-06-20T18:00:00.000Z';

const redactedQuestion = {
  id: 'q-1',
  category: 'History & Geography' as const,
  difficulty: 'Medium' as const,
  question: 'What is the capital of Canada?',
  pillar: 'TimeCapsule',
  tags: ['canada'],
  sourceUrl: 'https://example.com/canada',
  sourceName: 'Example',
};

const revealedQuestion = {
  ...redactedQuestion,
  answer: 'Ottawa',
  acceptableAnswers: ['City of Ottawa'],
  explanation: 'Ottawa is the capital of Canada.',
};

const validSnapshot = {
  id: roomId,
  code: 'ABCD2',
  status: 'active' as const,
  phase: 'QUESTION' as const,
  version: 2,
  hostPlayerId,
  category: 'All' as const,
  numRounds: 5 as const,
  currentQuestionIndex: 0,
  activePlayerId: hostPlayerId,
  currentAttempt: null,
  currentQuestion: redactedQuestion,
  players: [
    {
      id: hostPlayerId,
      nickname: 'Host',
      joinOrder: 0,
      score: 0,
      questionCount: 0,
      lastRoundDelta: 0,
      isHost: true,
      presence: 'online' as const,
      lastSeenAt: timestamp,
      leftAt: null,
    },
  ],
  createdAt: timestamp,
  updatedAt: timestamp,
  expiresAt: '2026-06-21T18:00:00.000Z',
};

describe('insertDisputeSchema', () => {
  it('accepts a valid dispute payload', () => {
    expect(insertDisputeSchema.parse(validDisputePayload)).toEqual(validDisputePayload);
  });

  it('rejects a payload missing a required field', () => {
    const result = insertDisputeSchema.safeParse({
      ...validDisputePayload,
      teamExplanation: undefined,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'teamExplanation')).toBe(
      true
    );
  });
});

describe('insertQuestionSchema', () => {
  it('accepts a valid question and applies insert defaults', () => {
    expect(insertQuestionSchema.parse(validQuestionPayload)).toMatchObject({
      ...validQuestionPayload,
      acceptableAnswers: [],
      status: 'approved',
      tags: [],
    });
  });

  it.each([
    ['category', 'History'],
    ['category', 'Movies'],
    ['category', 'General Knowledge'],
    ['category', 'geography'],
    ['difficulty', 'Impossible'],
    ['pillar', 'WrongPillar'],
    ['status', 'archived'],
  ])('rejects an invalid %s value "%s"', (field, value) => {
    const result = insertQuestionSchema.safeParse({
      ...validQuestionPayload,
      [field]: value,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === field)).toBe(true);
  });

  it.each([
    'History & Geography',
    'Science & Nature',
    'Sports',
    'Entertainment & Pop Culture',
    'Food & Culture',
    'Technology',
  ])('accepts canonical category "%s"', (category) => {
    const result = insertQuestionSchema.safeParse({ ...validQuestionPayload, category });
    expect(result.success).toBe(true);
  });
});

describe('rooms database schemas', () => {
  it('accepts a room insert and applies contract defaults', () => {
    expect(
      insertRoomSchema.parse({
        code: 'ABCD2',
        category: 'All',
        numRounds: 5,
      })
    ).toMatchObject({
      code: 'ABCD2',
      status: 'lobby',
      phase: 'LOBBY',
      category: 'All',
      numRounds: 5,
      questionIds: [],
    });
  });

  it('accepts a player insert while leaving database defaults optional', () => {
    expect(
      insertRoomPlayerSchema.parse({
        roomId,
        nickname: '  Guest  ',
        token: 'secret-token',
        joinOrder: 1,
      })
    ).toMatchObject({ roomId, nickname: 'Guest', token: 'secret-token', joinOrder: 1 });
  });

  it.each([
    ['code', { code: 'OOPS1', category: 'All', numRounds: 5 }],
    ['status', { code: 'ABCD2', category: 'All', numRounds: 5, status: 'waiting' }],
    ['phase', { code: 'ABCD2', category: 'All', numRounds: 5, phase: 'VERIFYING' }],
    ['category', { code: 'ABCD2', category: 'History', numRounds: 5 }],
    ['numRounds', { code: 'ABCD2', category: 'All', numRounds: 7 }],
  ])('rejects an invalid room %s', (_field, payload) => {
    expect(insertRoomSchema.safeParse(payload).success).toBe(false);
  });

  it.each(['', '123456789012345678901'])('rejects invalid nickname %j', (nickname) => {
    expect(
      insertRoomPlayerSchema.safeParse({ roomId, nickname, token: 'token', joinOrder: 1 }).success
    ).toBe(false);
  });
});

describe('RoomSnapshot contract', () => {
  it('accepts a QUESTION snapshot with answer fields absent', () => {
    const snapshot = roomSnapshotSchema.parse(validSnapshot);
    expect(snapshot.currentQuestion).not.toHaveProperty('answer');
    expect(snapshot.currentQuestion).not.toHaveProperty('acceptableAnswers');
    expect(snapshot.currentQuestion).not.toHaveProperty('explanation');
  });

  it.each(['online', 'away', 'stale'] as const)(
    'accepts %s as a derived player presence state',
    (presence) => {
      expect(
        roomSnapshotSchema.safeParse({
          ...validSnapshot,
          players: [{ ...validSnapshot.players[0], presence }],
        }).success
      ).toBe(true);
    }
  );

  it('accepts revealed answer fields for a REVEAL snapshot', () => {
    expect(
      roomSnapshotSchema.safeParse({
        ...validSnapshot,
        phase: 'REVEAL',
        currentQuestion: revealedQuestion,
        currentAttempt: {
          questionId: 'q-1',
          playerId: hostPlayerId,
          submittedAnswer: 'Toronto',
          verdict: 'INCORRECT',
          pointsDelta: -2,
        },
      }).success
    ).toBe(true);
    expect(revealedRoomQuestionSchema.safeParse(revealedQuestion).success).toBe(true);
  });

  it('rejects revealed answer fields before the REVEAL phase', () => {
    expect(
      roomSnapshotSchema.safeParse({
        ...validSnapshot,
        phase: 'QUESTION',
        currentQuestion: revealedQuestion,
      }).success
    ).toBe(false);
  });

  it.each(['REVEAL', 'ROUND_SCORE', 'GAME_OVER'] as const)(
    'requires revealed answer fields for a %s snapshot',
    (phase) => {
      expect(
        roomSnapshotSchema.safeParse({
          ...validSnapshot,
          phase,
          currentQuestion: redactedQuestion,
        }).success
      ).toBe(false);
    }
  );

  it.each([
    ['status', 'waiting'],
    ['phase', 'VERIFYING'],
    ['code', 'OOPS1'],
    ['category', 'History'],
    ['numRounds', 7],
  ])('rejects an invalid snapshot %s', (field, value) => {
    expect(roomSnapshotSchema.safeParse({ ...validSnapshot, [field]: value }).success).toBe(false);
  });

  it('rejects malformed attempts', () => {
    expect(
      roomAttemptSchema.safeParse({
        questionId: 'q-1',
        playerId: 'not-a-uuid',
        submittedAnswer: null,
        verdict: 'PENDING',
        pointsDelta: 0.5,
      }).success
    ).toBe(false);
  });
});

describe('rooms endpoint contract', () => {
  it('validates create, join, code params, poll query, and error payloads', () => {
    expect(
      createRoomRequestSchema.safeParse({ nickname: 'Host', category: 'All', numRounds: 5 }).success
    ).toBe(true);
    expect(joinRoomRequestSchema.safeParse({ nickname: 'Guest' }).success).toBe(true);
    expect(roomCodeParamsSchema.safeParse({ code: 'ABCD2' }).success).toBe(true);
    expect(pollRoomRequestSchema.parse({ sinceVersion: '2' })).toEqual({ sinceVersion: 2 });
    expect(roomErrorResponseSchema.safeParse({ message: 'Room is full' }).success).toBe(true);
  });

  it('validates create and join responses', () => {
    expect(
      createRoomResponseSchema.safeParse({
        code: 'ABCD2',
        playerId: hostPlayerId,
        token: 'host-token',
      }).success
    ).toBe(true);
    expect(
      joinRoomResponseSchema.safeParse({
        playerId: guestPlayerId,
        token: 'guest-token',
        snapshot: validSnapshot,
      }).success
    ).toBe(true);
  });

  it.each([
    ['start', startRoomRequestSchema, startRoomResponseSchema, {}],
    ['answer', answerRoomRequestSchema, answerRoomResponseSchema, { answer: 'Ottawa' }],
    ['pass', answerRoomRequestSchema, answerRoomResponseSchema, { answer: null }],
    ['advance', advanceRoomRequestSchema, advanceRoomResponseSchema, {}],
    ['continue', continueRoomRequestSchema, continueRoomResponseSchema, {}],
    ['skip', skipRoomRequestSchema, skipRoomResponseSchema, {}],
    ['end', endRoomRequestSchema, endRoomResponseSchema, {}],
  ])(
    'validates the %s endpoint request and response',
    (_name, requestSchema, responseSchema, body) => {
      expect(requestSchema.safeParse(body).success).toBe(true);
      expect(responseSchema.safeParse({ snapshot: validSnapshot }).success).toBe(true);
    }
  );

  it('accepts unchanged and changed poll responses', () => {
    expect(pollRoomResponseSchema.safeParse({ changed: false }).success).toBe(true);
    expect(pollRoomResponseSchema.safeParse(validSnapshot).success).toBe(true);
    expect(pollRoomResponseSchema.safeParse({ changed: true }).success).toBe(false);
  });

  it('rejects invalid endpoint inputs', () => {
    expect(
      createRoomRequestSchema.safeParse({ nickname: '', category: 'All', numRounds: 5 }).success
    ).toBe(false);
    expect(answerRoomRequestSchema.safeParse({ answer: '' }).success).toBe(false);
    expect(startRoomRequestSchema.safeParse({ unexpected: true }).success).toBe(false);
    expect(roomCodeParamsSchema.safeParse({ code: 'ABCDE2' }).success).toBe(false);
  });
});
