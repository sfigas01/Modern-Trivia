import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UseMutationResult } from '@tanstack/react-query';

import { RoundScore } from './RoundScore';
import type { ContinueRoomResponse, RoomSnapshot } from '@shared/models/rooms';

const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

type RoundScoreSnapshot = Extract<RoomSnapshot, { phase: 'ROUND_SCORE' }>;

function makePlayer(overrides: Partial<RoundScoreSnapshot['players'][number]> = {}) {
  return {
    id: 'p1',
    nickname: 'Alice',
    joinOrder: 0,
    score: 10,
    questionCount: 4,
    lastRoundDelta: 5,
    isHost: true,
    presence: 'online' as const,
    lastSeenAt: new Date().toISOString(),
    leftAt: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<RoundScoreSnapshot> = {}): RoundScoreSnapshot {
  return {
    id: 'room-1',
    code: 'ABCDE',
    status: 'active',
    phase: 'ROUND_SCORE',
    version: 5,
    hostPlayerId: 'p1',
    category: 'All',
    numRounds: 10,
    currentQuestionIndex: 8,
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
      makePlayer({ id: 'p1', nickname: 'Alice', score: 10, lastRoundDelta: 5 }),
      makePlayer({ id: 'p2', nickname: 'Bob', isHost: false, score: 15, lastRoundDelta: -2 }),
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    ...overrides,
  } as RoundScoreSnapshot;
}

function makeMutation(
  overrides: Partial<{ isPending: boolean; mutate: ReturnType<typeof vi.fn> }> = {}
): UseMutationResult<ContinueRoomResponse, Error, void> {
  return {
    mutate: vi.fn(),
    isPending: false,
    ...overrides,
  } as unknown as UseMutationResult<ContinueRoomResponse, Error, void>;
}

describe('RoundScore', () => {
  beforeEach(() => {
    toastError.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('ranks players by score with deltas shown', () => {
    const snapshot = makeSnapshot();
    render(
      <RoundScore
        snapshot={snapshot}
        currentPlayerId="p1"
        continueRound={makeMutation()}
        refetch={vi.fn()}
      />
    );

    const rows = screen.getAllByTestId(/round-score-row-/);
    expect(rows[0]).toHaveTextContent('Bob');
    expect(rows[1]).toHaveTextContent('Alice');
    expect(screen.getByTestId('round-score-delta-p1')).toHaveTextContent('(+5)');
    expect(screen.getByTestId('round-score-delta-p2')).toHaveTextContent('(-2)');
  });

  it('shows Next Round for the host', () => {
    const snapshot = makeSnapshot({ hostPlayerId: 'p1' });
    render(
      <RoundScore
        snapshot={snapshot}
        currentPlayerId="p1"
        continueRound={makeMutation()}
        refetch={vi.fn()}
      />
    );

    expect(screen.getByTestId('button-next-round')).toBeInTheDocument();
    expect(screen.queryByTestId('text-waiting-host-round')).toBeNull();
  });

  it('hides Next Round for a non-host player', () => {
    const snapshot = makeSnapshot({ hostPlayerId: 'p1' });
    render(
      <RoundScore
        snapshot={snapshot}
        currentPlayerId="p2"
        continueRound={makeMutation()}
        refetch={vi.fn()}
      />
    );

    expect(screen.queryByTestId('button-next-round')).toBeNull();
    expect(screen.getByTestId('text-waiting-host-round')).toBeInTheDocument();
  });

  it('calls continueRound when Next Round is clicked', () => {
    const snapshot = makeSnapshot({ hostPlayerId: 'p1' });
    const mutate = vi.fn();
    render(
      <RoundScore
        snapshot={snapshot}
        currentPlayerId="p1"
        continueRound={makeMutation({ mutate })}
        refetch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('button-next-round'));
    expect(mutate).toHaveBeenCalledWith(undefined, expect.any(Object));
  });

  it('reconciles silently on a 409 conflict instead of showing a toast', () => {
    const snapshot = makeSnapshot({ hostPlayerId: 'p1' });
    const refetch = vi.fn();
    const mutate = vi.fn((_body, options) => {
      const error = new Error('Room is not ready for the next round') as Error & {
        status: number;
      };
      error.status = 409;
      options.onError(error);
    });
    render(
      <RoundScore
        snapshot={snapshot}
        currentPlayerId="p1"
        continueRound={makeMutation({ mutate })}
        refetch={refetch}
      />
    );

    fireEvent.click(screen.getByTestId('button-next-round'));

    expect(refetch).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});
