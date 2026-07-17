import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { FinalResults } from './FinalResults';
import type { RoomSnapshot } from '@shared/models/rooms';

const mockSetLocation = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => ['/room/ABCDE', mockSetLocation],
}));

const mockClearRoomSession = vi.fn();
vi.mock('@/lib/room-session', () => ({
  clearRoomSession: (...args: unknown[]) => mockClearRoomSession(...args),
}));

type GameOverSnapshot = Extract<RoomSnapshot, { phase: 'GAME_OVER' }>;

function makePlayer(overrides: Partial<GameOverSnapshot['players'][number]> = {}) {
  return {
    id: 'p1',
    nickname: 'Alice',
    joinOrder: 0,
    score: 20,
    questionCount: 8,
    lastRoundDelta: 0,
    isHost: true,
    presence: 'online' as const,
    lastSeenAt: new Date().toISOString(),
    leftAt: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<GameOverSnapshot> = {}): GameOverSnapshot {
  return {
    id: 'room-1',
    code: 'ABCDE',
    status: 'finished',
    phase: 'GAME_OVER',
    version: 9,
    hostPlayerId: 'p1',
    category: 'All',
    numRounds: 10,
    currentQuestionIndex: 40,
    activePlayerId: 'p1',
    currentAttempt: null,
    currentQuestion: {
      id: 'q1',
      category: 'Science',
      difficulty: 'Medium',
      question: 'What planet is closest to the sun?',
      pillar: 'Astronomy',
      tags: [],
      sourceUrl: null,
      sourceName: null,
      answer: 'Mercury',
      acceptableAnswers: ['Mercury'],
      explanation: 'Mercury orbits closest to the sun.',
    },
    players: [
      makePlayer({ id: 'p1', nickname: 'Alice', score: 20 }),
      makePlayer({ id: 'p2', nickname: 'Bob', isHost: false, score: 12 }),
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    ...overrides,
  } as GameOverSnapshot;
}

describe('FinalResults', () => {
  beforeEach(() => {
    mockSetLocation.mockClear();
    mockClearRoomSession.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the winner and final ranking', () => {
    const snapshot = makeSnapshot();
    render(<FinalResults snapshot={snapshot} currentPlayerId="p1" />);

    expect(screen.getByTestId('text-winner')).toHaveTextContent('Alice');
    const rows = screen.getAllByTestId(/final-result-row-/);
    expect(rows[0]).toHaveTextContent('Alice');
    expect(rows[1]).toHaveTextContent('Bob');
  });

  it('clears the room session and navigates home on Back to Home', () => {
    const snapshot = makeSnapshot();
    render(<FinalResults snapshot={snapshot} currentPlayerId="p1" />);

    fireEvent.click(screen.getByTestId('button-back-home'));

    expect(mockClearRoomSession).toHaveBeenCalledWith('ABCDE');
    expect(mockSetLocation).toHaveBeenCalledWith('/');
  });
});
