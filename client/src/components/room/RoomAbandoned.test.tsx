import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { RoomAbandoned } from './RoomAbandoned';
import type { RoomSnapshot } from '@shared/models/rooms';

const mockSetLocation = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => ['/room/ABCDE', mockSetLocation],
}));

const mockClearRoomSession = vi.fn();
vi.mock('@/lib/room-session', () => ({
  clearRoomSession: (...args: unknown[]) => mockClearRoomSession(...args),
}));

function makePlayer(overrides: Partial<RoomSnapshot['players'][number]> = {}) {
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

function makeSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    id: 'room-1',
    code: 'ABCDE',
    status: 'abandoned',
    phase: 'QUESTION',
    version: 5,
    hostPlayerId: 'p1',
    category: 'All',
    numRounds: 10,
    currentQuestionIndex: 4,
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
    },
    players: [
      makePlayer({ id: 'p1', nickname: 'Alice', score: 20 }),
      makePlayer({ id: 'p2', nickname: 'Bob', isHost: false, score: 12 }),
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    ...overrides,
  } as unknown as RoomSnapshot;
}

describe('RoomAbandoned', () => {
  beforeEach(() => {
    mockSetLocation.mockClear();
    mockClearRoomSession.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the final scores when players have any', () => {
    render(<RoomAbandoned snapshot={makeSnapshot()} />);

    const rows = screen.getAllByTestId(/abandoned-result-row-/);
    expect(rows[0]).toHaveTextContent('Alice');
    expect(rows[1]).toHaveTextContent('Bob');
  });

  it('omits the score list when there are no players', () => {
    render(<RoomAbandoned snapshot={makeSnapshot({ players: [] })} />);

    expect(screen.queryByTestId(/abandoned-result-row-/)).toBeNull();
  });

  it('clears the room session and navigates home on Back to Home', () => {
    render(<RoomAbandoned snapshot={makeSnapshot()} />);

    fireEvent.click(screen.getByTestId('button-abandoned-home'));

    expect(mockClearRoomSession).toHaveBeenCalledWith('ABCDE');
    expect(mockSetLocation).toHaveBeenCalledWith('/');
  });
});
