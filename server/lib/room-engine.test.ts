import { describe, expect, it } from 'vitest';

import { advanceRoomEngine, createRoomAttempt, type EnginePlayer } from './room-engine';

const hostId = '22222222-2222-4222-8222-222222222222';
const guestId = '33333333-3333-4333-8333-333333333333';

const question = {
  id: 'question-1',
  category: 'History & Geography',
  difficulty: 'Medium' as const,
  question: 'What is the capital of Canada?',
  answer: 'Ottawa',
  acceptableAnswers: ['Ottawa, Ontario'],
  explanation: 'Ottawa is the federal capital.',
  pillar: 'GlobalEh',
  tags: ['Canada'],
};

function players(overrides: Partial<EnginePlayer>[] = []): EnginePlayer[] {
  return [
    { id: hostId, score: 0, questionCount: 0, lastRoundDelta: 0, ...overrides[0] },
    { id: guestId, score: 0, questionCount: 0, lastRoundDelta: 0, ...overrides[1] },
  ];
}

describe('room engine', () => {
  it('creates correct, incorrect, and pass attempts with solo scoring parity', () => {
    expect(createRoomAttempt(hostId, 'ottawa', question)).toMatchObject({
      verdict: 'CORRECT',
      pointsDelta: 2,
    });
    expect(createRoomAttempt(hostId, 'Toronto', question)).toMatchObject({
      verdict: 'INCORRECT',
      pointsDelta: -2,
    });
    expect(createRoomAttempt(hostId, null, question)).toMatchObject({
      submittedAnswer: null,
      verdict: 'PASS',
      pointsDelta: 0,
    });
  });

  it('applies score and keeps the same player active before four questions', () => {
    const result = advanceRoomEngine({
      activePlayerId: hostId,
      currentAttempt: createRoomAttempt(hostId, 'Ottawa', question),
      currentQuestionIndex: 0,
      players: players(),
      questionCount: 40,
    });

    expect(result).toMatchObject({
      activePlayerId: hostId,
      currentQuestionIndex: 1,
      phase: 'QUESTION',
    });
    expect(result.players[0]).toMatchObject({ score: 2, questionCount: 1, lastRoundDelta: 2 });
  });

  it('rotates after the active player answers four questions', () => {
    const result = advanceRoomEngine({
      activePlayerId: hostId,
      currentAttempt: createRoomAttempt(hostId, null, question),
      currentQuestionIndex: 3,
      players: players([{ questionCount: 3 }]),
      questionCount: 40,
    });

    expect(result.activePlayerId).toBe(guestId);
    expect(result.phase).toBe('QUESTION');
  });

  it('enters round score after every player completes a rotation', () => {
    const result = advanceRoomEngine({
      activePlayerId: guestId,
      currentAttempt: createRoomAttempt(guestId, 'Ottawa', question),
      currentQuestionIndex: 7,
      players: players([{ questionCount: 4 }, { questionCount: 3 }]),
      questionCount: 40,
    });

    expect(result).toMatchObject({
      activePlayerId: hostId,
      currentQuestionIndex: 8,
      phase: 'ROUND_SCORE',
    });
    expect(result.players[0].lastRoundDelta).toBe(0);
    expect(result.players[1].lastRoundDelta).toBe(2);
  });

  it('finishes the game instead of showing round score after the final question', () => {
    const result = advanceRoomEngine({
      activePlayerId: guestId,
      currentAttempt: createRoomAttempt(guestId, null, question),
      currentQuestionIndex: 39,
      players: players([{ questionCount: 20 }, { questionCount: 19 }]),
      questionCount: 40,
    });

    expect(result.currentQuestionIndex).toBe(40);
    expect(result.phase).toBe('GAME_OVER');
  });
});
