import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UseMutationResult } from '@tanstack/react-query';

import { RevealView } from './RevealView';
import type { AdvanceRoomResponse, RoomSnapshot } from '@shared/models/rooms';

const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

type RevealSnapshot = Extract<RoomSnapshot, { phase: 'REVEAL' }>;

function makePlayer(overrides: Partial<RevealSnapshot['players'][number]> = {}) {
  return {
    id: 'p1',
    nickname: 'Alice',
    joinOrder: 0,
    score: 10,
    questionCount: 1,
    lastRoundDelta: 5,
    isHost: true,
    presence: 'online' as const,
    lastSeenAt: new Date().toISOString(),
    leftAt: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<RevealSnapshot> = {}): RevealSnapshot {
  return {
    id: 'room-1',
    code: 'ABCDE',
    status: 'active',
    phase: 'REVEAL',
    version: 4,
    hostPlayerId: 'p1',
    category: 'All',
    numRounds: 10,
    currentQuestionIndex: 0,
    activePlayerId: 'p1',
    currentAttempt: {
      questionId: 'q1',
      playerId: 'p1',
      submittedAnswer: 'Mercury',
      verdict: 'CORRECT',
      pointsDelta: 5,
    },
    opponentDisputeVotingEnabled: false,
    activeDisputeId: null,
    currentDisputeVote: null,
    currentQuestion: {
      id: 'q1',
      category: 'Science',
      difficulty: 'Medium',
      question: 'What planet is closest to the sun?',
      pillar: 'Astronomy',
      tags: [],
      sourceUrl: 'https://example.com',
      sourceName: 'Example Source',
      answer: 'Mercury',
      acceptableAnswers: ['Mercury'],
      explanation: 'Mercury orbits closest to the sun.',
    },
    players: [
      makePlayer({ id: 'p1', nickname: 'Alice' }),
      makePlayer({ id: 'p2', nickname: 'Bob', isHost: false }),
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    ...overrides,
  } as RevealSnapshot;
}

function makeMutation(
  overrides: Partial<{ isPending: boolean; mutate: ReturnType<typeof vi.fn> }> = {}
): UseMutationResult<AdvanceRoomResponse, Error, void> {
  return {
    mutate: vi.fn(),
    isPending: false,
    ...overrides,
  } as unknown as UseMutationResult<AdvanceRoomResponse, Error, void>;
}

describe('RevealView', () => {
  beforeEach(() => {
    toastError.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the submitted answer, verdict, points, and correct answer', () => {
    const snapshot = makeSnapshot();
    render(
      <RevealView
        snapshot={snapshot}
        currentPlayerId="p1"
        advance={makeMutation()}
        refetch={vi.fn()}
      />
    );

    expect(screen.getByText('Mercury', { selector: '.text-primary' })).toBeInTheDocument();
    expect(screen.getByTestId('text-verdict')).toHaveTextContent('CORRECT (+5)');
    expect(screen.getByText('Mercury orbits closest to the sun.')).toBeInTheDocument();
  });

  it('shows the Next button for the active player', () => {
    const snapshot = makeSnapshot({ activePlayerId: 'p1', hostPlayerId: 'p2' });
    render(
      <RevealView
        snapshot={snapshot}
        currentPlayerId="p1"
        advance={makeMutation()}
        refetch={vi.fn()}
      />
    );

    expect(screen.getByTestId('button-next')).toBeInTheDocument();
    expect(screen.queryByTestId('text-waiting-continue')).toBeNull();
  });

  it('shows the Next button for the host even when not active', () => {
    const snapshot = makeSnapshot({ activePlayerId: 'p1', hostPlayerId: 'p2' });
    render(
      <RevealView
        snapshot={snapshot}
        currentPlayerId="p2"
        advance={makeMutation()}
        refetch={vi.fn()}
      />
    );

    expect(screen.getByTestId('button-next')).toBeInTheDocument();
  });

  it('hides the Next button for a spectator who is neither active nor host', () => {
    const snapshot = makeSnapshot({
      activePlayerId: 'p1',
      hostPlayerId: 'p1',
      players: [
        makePlayer({ id: 'p1', nickname: 'Alice' }),
        makePlayer({ id: 'p2', nickname: 'Bob', isHost: false }),
        makePlayer({ id: 'p3', nickname: 'Cara', isHost: false }),
      ],
    });
    render(
      <RevealView
        snapshot={snapshot}
        currentPlayerId="p3"
        advance={makeMutation()}
        refetch={vi.fn()}
      />
    );

    expect(screen.queryByTestId('button-next')).toBeNull();
    expect(screen.getByTestId('text-waiting-continue')).toBeInTheDocument();
  });

  it('calls advance when Next is clicked', () => {
    const snapshot = makeSnapshot({ activePlayerId: 'p1' });
    const mutate = vi.fn();
    render(
      <RevealView
        snapshot={snapshot}
        currentPlayerId="p1"
        advance={makeMutation({ mutate })}
        refetch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('button-next'));
    expect(mutate).toHaveBeenCalledWith(undefined, expect.any(Object));
  });

  it('reconciles silently on a 409 conflict instead of showing a toast', () => {
    const snapshot = makeSnapshot({ activePlayerId: 'p1' });
    const refetch = vi.fn();
    const mutate = vi.fn((_body, options) => {
      const error = new Error('Room state changed before it could advance') as Error & {
        status: number;
      };
      error.status = 409;
      options.onError(error);
    });
    render(
      <RevealView
        snapshot={snapshot}
        currentPlayerId="p1"
        advance={makeMutation({ mutate })}
        refetch={refetch}
      />
    );

    fireEvent.click(screen.getByTestId('button-next'));

    expect(refetch).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('only shows Dispute to the answering player for an undisputed incorrect answer', () => {
    const snapshot = makeSnapshot({
      activePlayerId: 'p1',
      currentAttempt: {
        questionId: 'q1',
        playerId: 'p1',
        submittedAnswer: 'Venus',
        verdict: 'INCORRECT',
        pointsDelta: -3,
      },
    });
    const props = {
      snapshot,
      advance: makeMutation(),
      awardDispute: makeMutation(),
      refetch: vi.fn(),
    };
    const { rerender } = render(<RevealView {...props} currentPlayerId="p2" />);
    expect(screen.queryByRole('button', { name: /dispute/i })).toBeNull();

    rerender(<RevealView {...props} currentPlayerId="p1" />);
    expect(screen.getByRole('button', { name: /dispute/i })).toBeInTheDocument();
  });

  it('shows synchronized disabled-mode submission state and manual award only to the host', () => {
    const snapshot = makeSnapshot({
      hostPlayerId: 'p2',
      activePlayerId: 'p1',
      activeDisputeId: 'dispute-1',
      opponentDisputeVotingEnabled: false,
      currentAttempt: {
        questionId: 'q1',
        playerId: 'p1',
        submittedAnswer: 'Venus',
        verdict: 'INCORRECT',
        pointsDelta: -3,
      },
    });
    const props = {
      snapshot,
      advance: makeMutation(),
      awardDispute: makeMutation(),
      refetch: vi.fn(),
    };
    const { rerender } = render(<RevealView {...props} currentPlayerId="p1" />);
    expect(screen.getByTestId('text-dispute-submitted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /group agreed/i })).toBeNull();

    rerender(<RevealView {...props} currentPlayerId="p2" />);
    expect(screen.getByRole('button', { name: /group agreed/i })).toBeInTheDocument();
  });

  it('hides the pending dispute banner after a disabled-mode manual award', () => {
    const snapshot = makeSnapshot({
      hostPlayerId: 'p2',
      activePlayerId: 'p1',
      activeDisputeId: 'dispute-1',
      opponentDisputeVotingEnabled: false,
      currentAttempt: {
        questionId: 'q1',
        playerId: 'p1',
        submittedAnswer: 'Venus',
        verdict: 'CORRECT',
        pointsDelta: 3,
      },
    });

    render(
      <RevealView
        snapshot={snapshot}
        currentPlayerId="p2"
        advance={makeMutation()}
        awardDispute={makeMutation()}
        refetch={vi.fn()}
      />
    );

    expect(screen.queryByTestId('text-dispute-submitted')).toBeNull();
    expect(screen.queryByRole('button', { name: /group agreed/i })).toBeNull();
  });

  it.each([
    ['approved', 5, 'Dispute approved', '+5'],
    ['rejected', -3, 'Dispute rejected', '-3'],
    ['tied', -3, 'Dispute tied', '-3'],
    ['expired', -3, 'Dispute expired', '-3'],
    ['canceled', -3, 'Dispute canceled', '-3'],
  ] as const)(
    'renders the server-finalized %s outcome and delta',
    (outcome, delta, label, points) => {
      const snapshot = makeSnapshot({
        activeDisputeId: 'dispute-1',
        currentDisputeVote: {
          disputeId: 'dispute-1',
          disputingPlayerId: 'p1',
          disputingPlayerName: 'Alice',
          explanation: 'Mercury was intended.',
          eligibleVoterIds: ['p2'],
          submittedVoterIds: ['p2'],
          threshold: 1,
          openedAt: '2026-01-01T00:00:00.000Z',
          closesAt: '2026-01-01T00:01:00.000Z',
          status: 'FINALIZED',
          yesCount: outcome === 'approved' ? 1 : 0,
          noCount: outcome === 'rejected' ? 1 : 0,
          nonResponseCount: outcome === 'rejected' || outcome === 'approved' ? 0 : 1,
          outcome,
          originalPointsDelta: -3,
          finalPointsDelta: delta,
          decidedAt: '2026-01-01T00:00:30.000Z',
        },
      });
      render(
        <RevealView
          snapshot={snapshot}
          currentPlayerId="p1"
          advance={makeMutation()}
          awardDispute={makeMutation()}
          refetch={vi.fn()}
        />
      );
      expect(screen.getByTestId('card-dispute-outcome')).toHaveTextContent(label);
      expect(screen.getByTestId('card-dispute-outcome')).toHaveTextContent(points);
    }
  );
});
