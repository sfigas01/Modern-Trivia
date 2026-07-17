import { describe, expect, it } from 'vitest';

import {
  advanceRoomRequestSchema,
  advanceRoomResponseSchema,
  answerRoomRequestSchema,
  answerRoomResponseSchema,
  cancelDisputeVoteRequestSchema,
  cancelDisputeVoteResponseSchema,
  castDisputeVoteRequestSchema,
  castDisputeVoteResponseSchema,
  continueRoomRequestSchema,
  continueRoomResponseSchema,
  createRoomRequestSchema,
  createRoomResponseSchema,
  endRoomRequestSchema,
  endRoomResponseSchema,
  finalizedDisputeVoteSnapshotSchema,
  insertDisputeBallotSchema,
  insertDisputeSchema,
  insertQuestionSchema,
  insertRoomPlayerSchema,
  insertRoomSchema,
  joinRoomRequestSchema,
  joinRoomResponseSchema,
  openDisputeVoteSnapshotSchema,
  pollRoomRequestSchema,
  pollRoomResponseSchema,
  publicDisputeRequestSchema,
  revealedRoomQuestionSchema,
  roomAttemptSchema,
  roomCodeParamsSchema,
  roomErrorResponseSchema,
  roomSnapshotSchema,
  skipRoomRequestSchema,
  skipRoomResponseSchema,
  startRoomRequestSchema,
  startRoomResponseSchema,
  submitMultiplayerDisputeRequestSchema,
  submitMultiplayerDisputeResponseSchema,
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
const disputingPlayerId = '44444444-4444-4444-8444-444444444444';
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
  categories: ['All' as const],
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

const validOpenDisputeVote = {
  status: 'OPEN' as const,
  disputeId: 'dispute-1',
  disputingPlayerId: hostPlayerId,
  disputingPlayerName: 'Host',
  explanation: 'The answer should be accepted because the clue was ambiguous.',
  eligibleVoterIds: [guestPlayerId],
  submittedVoterIds: [],
  threshold: 1,
  openedAt: timestamp,
  closesAt: '2026-06-20T18:01:00.000Z',
};

const validFinalizedDisputeVote = {
  ...validOpenDisputeVote,
  status: 'FINALIZED' as const,
  disputingPlayerId,
  disputingPlayerName: 'Disputer',
  eligibleVoterIds: [hostPlayerId, guestPlayerId],
  submittedVoterIds: [hostPlayerId, guestPlayerId],
  threshold: 2,
  yesCount: 2,
  noCount: 0,
  nonResponseCount: 0,
  outcome: 'approved' as const,
  originalPointsDelta: -2,
  finalPointsDelta: 2,
  decidedAt: '2026-06-20T18:01:00.000Z',
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

  it('accepts persisted multiplayer decision metadata alongside legacy fields', () => {
    expect(
      insertDisputeSchema.safeParse({
        ...validDisputePayload,
        roomId,
        roomCode: 'ABCD2',
        attemptKey: `${roomId}:0`,
        disputingPlayerId: hostPlayerId,
        disputingPlayerName: 'Host',
        votingEnabled: true,
        eligibleVoterSnapshot: [{ playerId: guestPlayerId, displayName: 'Guest' }],
        threshold: 1,
        outcome: 'approved',
        originalPointsDelta: -2,
        finalPointsDelta: 2,
        decidedAt: new Date(timestamp),
      }).success
    ).toBe(true);
  });

  it('validates one persisted ballot and rejects client-supplied identity fields', () => {
    expect(
      insertDisputeBallotSchema.safeParse({
        disputeId: 'dispute-1',
        voterPlayerId: guestPlayerId,
        voterPlayerName: 'Guest',
        approve: true,
      }).success
    ).toBe(true);
    expect(
      insertDisputeBallotSchema.safeParse({
        disputeId: 'dispute-1',
        voterPlayerId: guestPlayerId,
        voterPlayerName: 'Guest',
        approve: true,
        id: 'should-not-be-client-supplied',
      }).success
    ).toBe(false);
  });
});

describe('publicDisputeRequestSchema', () => {
  it('rejects room-scoped decision fields from public dispute submissions', () => {
    expect(
      publicDisputeRequestSchema.safeParse({
        ...validDisputePayload,
        roomId,
        attemptKey: `${roomId}:0`,
        votingEnabled: true,
        outcome: 'approved',
      }).success
    ).toBe(false);
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
      opponentDisputeVotingEnabled: false,
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

  it('defaults voting off and clears active vote state for legacy snapshots', () => {
    const parsed = roomSnapshotSchema.parse(validSnapshot);
    expect(parsed.opponentDisputeVotingEnabled).toBe(false);
    expect(parsed.activeDisputeId).toBeNull();
    expect(parsed.currentDisputeVote).toBeNull();
  });

  it('accepts an open DISPUTE_VOTE snapshot without ballot choices', () => {
    const parsed = roomSnapshotSchema.parse({
      ...validSnapshot,
      phase: 'DISPUTE_VOTE',
      currentQuestion: revealedQuestion,
      activeDisputeId: validOpenDisputeVote.disputeId,
      currentDisputeVote: validOpenDisputeVote,
    });

    expect(parsed.activeDisputeId).toBe(validOpenDisputeVote.disputeId);
    expect(parsed.currentDisputeVote).toEqual(validOpenDisputeVote);
    expect(parsed.currentDisputeVote).not.toHaveProperty('approve');
    expect(
      openDisputeVoteSnapshotSchema.safeParse({
        ...validOpenDisputeVote,
        ballots: [{ voterPlayerId: guestPlayerId, approve: true }],
      }).success
    ).toBe(false);
  });

  it('accepts finalized aggregate metadata after returning to REVEAL', () => {
    expect(finalizedDisputeVoteSnapshotSchema.safeParse(validFinalizedDisputeVote).success).toBe(
      true
    );
    const parsed = roomSnapshotSchema.parse({
      ...validSnapshot,
      phase: 'REVEAL',
      currentQuestion: revealedQuestion,
      currentDisputeVote: validFinalizedDisputeVote,
    });
    expect(parsed.currentDisputeVote).toMatchObject({
      outcome: 'approved',
      yesCount: 2,
      noCount: 0,
      nonResponseCount: 0,
      finalPointsDelta: 2,
    });
  });

  it('rejects inconsistent voting thresholds, voter identities, and aggregate counts', () => {
    expect(
      openDisputeVoteSnapshotSchema.safeParse({ ...validOpenDisputeVote, threshold: 2 }).success
    ).toBe(false);
    expect(
      openDisputeVoteSnapshotSchema.safeParse({
        ...validOpenDisputeVote,
        submittedVoterIds: [hostPlayerId],
      }).success
    ).toBe(false);
    expect(
      finalizedDisputeVoteSnapshotSchema.safeParse({
        ...validFinalizedDisputeVote,
        yesCount: 1,
      }).success
    ).toBe(false);
  });

  it.each(['LOBBY', 'QUESTION', 'ROUND_SCORE', 'GAME_OVER'] as const)(
    'rejects dispute vote state from the %s phase',
    (phase) => {
      const currentQuestion =
        phase === 'LOBBY' ? null : phase === 'QUESTION' ? redactedQuestion : revealedQuestion;
      expect(
        roomSnapshotSchema.safeParse({
          ...validSnapshot,
          phase,
          currentQuestion,
          currentDisputeVote: validOpenDisputeVote,
        }).success
      ).toBe(false);
    }
  );

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
    ['categories', ['History']],
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
      createRoomRequestSchema.parse({ nickname: 'Host', categories: ['All'], numRounds: 5 })
    ).toEqual({
      nickname: 'Host',
      categories: ['All'],
      numRounds: 5,
      opponentDisputeVotingEnabled: false,
    });
    expect(
      createRoomRequestSchema.safeParse({
        nickname: 'Host',
        categories: ['All'],
        numRounds: 5,
        opponentDisputeVotingEnabled: true,
      }).success
    ).toBe(true);
    expect(joinRoomRequestSchema.safeParse({ nickname: 'Guest' }).success).toBe(true);
    expect(roomCodeParamsSchema.safeParse({ code: 'ABCD2' }).success).toBe(true);
    expect(pollRoomRequestSchema.parse({ sinceVersion: '2' })).toEqual({ sinceVersion: 2 });
    expect(roomErrorResponseSchema.safeParse({ message: 'Room is full' }).success).toBe(true);
  });

  it('validates strict multiplayer dispute request and response contracts', () => {
    expect(
      submitMultiplayerDisputeRequestSchema.safeParse({ explanation: 'The clue was ambiguous.' })
        .success
    ).toBe(true);
    expect(
      submitMultiplayerDisputeRequestSchema.safeParse({ explanation: ' ', ignored: true }).success
    ).toBe(false);
    expect(castDisputeVoteRequestSchema.safeParse({ approve: true }).success).toBe(true);
    expect(
      castDisputeVoteRequestSchema.safeParse({ approve: true, voterPlayerId: guestPlayerId })
        .success
    ).toBe(false);
    expect(cancelDisputeVoteRequestSchema.safeParse({}).success).toBe(true);
    expect(cancelDisputeVoteRequestSchema.safeParse({ reason: 'changed my mind' }).success).toBe(
      false
    );
    expect(
      submitMultiplayerDisputeResponseSchema.safeParse({ snapshot: validSnapshot }).success
    ).toBe(true);
    expect(castDisputeVoteResponseSchema.safeParse({ snapshot: validSnapshot }).success).toBe(true);
    expect(cancelDisputeVoteResponseSchema.safeParse({ snapshot: validSnapshot }).success).toBe(
      true
    );
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
      createRoomRequestSchema.safeParse({ nickname: '', categories: ['All'], numRounds: 5 }).success
    ).toBe(false);
    expect(answerRoomRequestSchema.safeParse({ answer: '' }).success).toBe(false);
    expect(startRoomRequestSchema.safeParse({ unexpected: true }).success).toBe(false);
    expect(roomCodeParamsSchema.safeParse({ code: 'ABCDE2' }).success).toBe(false);
  });
});
