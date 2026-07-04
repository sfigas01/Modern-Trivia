import { QUESTIONS_PER_TEAM_ROTATION, verifyAttempt, type Question } from '@shared/lib/answers';
import type { RoomAttempt, RoomPhase } from '@shared/schema';

export interface EnginePlayer {
  id: string;
  score: number;
  questionCount: number;
  lastRoundDelta: number;
}

export interface AdvanceRoomInput {
  activePlayerId: string;
  currentAttempt: RoomAttempt;
  currentQuestionIndex: number;
  players: EnginePlayer[];
  questionCount: number;
}

export interface AdvanceRoomResult {
  activePlayerId: string;
  currentQuestionIndex: number;
  phase: Extract<RoomPhase, 'QUESTION' | 'ROUND_SCORE' | 'GAME_OVER'>;
  players: EnginePlayer[];
}

export function createRoomAttempt(
  playerId: string,
  answer: string | null,
  question: Question
): RoomAttempt {
  if (answer === null) {
    return {
      questionId: question.id,
      playerId,
      submittedAnswer: null,
      verdict: 'PASS',
      pointsDelta: 0,
    };
  }

  const result = verifyAttempt(answer, question);
  return {
    questionId: question.id,
    playerId,
    submittedAnswer: answer,
    verdict: result.verdict,
    pointsDelta: result.points,
  };
}

export function advanceRoomEngine(input: AdvanceRoomInput): AdvanceRoomResult {
  if (input.players.length === 0) {
    throw new Error('Cannot advance a room without players');
  }
  if (input.currentAttempt.playerId !== input.activePlayerId) {
    throw new Error('Current attempt does not belong to the active player');
  }

  const activePlayerIndex = input.players.findIndex((player) => player.id === input.activePlayerId);
  if (activePlayerIndex === -1) {
    throw new Error('Active player is not in the room');
  }

  const players = input.players.map((player) =>
    player.id === input.currentAttempt.playerId
      ? {
          ...player,
          score: player.score + input.currentAttempt.pointsDelta,
          questionCount: player.questionCount + 1,
          lastRoundDelta: input.currentAttempt.pointsDelta,
        }
      : { ...player, lastRoundDelta: 0 }
  );

  const updatedActivePlayer = players[activePlayerIndex];
  let activePlayerId = input.activePlayerId;
  if (updatedActivePlayer.questionCount % QUESTIONS_PER_TEAM_ROTATION === 0) {
    activePlayerId = players[(activePlayerIndex + 1) % players.length].id;
  }

  const currentQuestionIndex = input.currentQuestionIndex + 1;
  const questionsPerRound = players.length * QUESTIONS_PER_TEAM_ROTATION;
  const isRoundComplete = currentQuestionIndex % questionsPerRound === 0;

  let phase: AdvanceRoomResult['phase'] = 'QUESTION';
  if (currentQuestionIndex >= input.questionCount) {
    phase = 'GAME_OVER';
  } else if (isRoundComplete) {
    phase = 'ROUND_SCORE';
  }

  return {
    activePlayerId,
    currentQuestionIndex,
    phase,
    players,
  };
}
