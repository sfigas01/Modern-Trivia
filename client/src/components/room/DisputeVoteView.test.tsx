import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseMutationResult } from '@tanstack/react-query';
import type { CastDisputeVoteResponse, RoomSnapshot } from '@shared/models/rooms';

import { DisputeVoteView } from './DisputeVoteView';

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

type VoteSnapshot = Extract<RoomSnapshot, { phase: 'DISPUTE_VOTE' }>;

function mutation(mutate = vi.fn(), isPending = false) {
  return { mutate, isPending } as unknown as UseMutationResult<
    CastDisputeVoteResponse,
    Error,
    { approve: boolean }
  >;
}

function makeSnapshot(overrides: Partial<VoteSnapshot> = {}): VoteSnapshot {
  const now = Date.now();
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'ABCD2',
    status: 'active',
    phase: 'DISPUTE_VOTE',
    version: 3,
    hostPlayerId: '22222222-2222-4222-8222-222222222222',
    categories: ['All'],
    numRounds: 5,
    currentQuestionIndex: 0,
    activePlayerId: '11111111-1111-4111-8111-111111111111',
    currentAttempt: {
      questionId: 'q1',
      playerId: '11111111-1111-4111-8111-111111111111',
      submittedAnswer: 'Venus',
      verdict: 'INCORRECT',
      pointsDelta: -3,
    },
    opponentDisputeVotingEnabled: true,
    activeDisputeId: 'dispute-1',
    currentDisputeVote: {
      disputeId: 'dispute-1',
      disputingPlayerId: '11111111-1111-4111-8111-111111111111',
      disputingPlayerName: 'Alice',
      explanation: 'The wording allows Venus.',
      eligibleVoterIds: [
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
      ],
      submittedVoterIds: [],
      threshold: 2,
      openedAt: new Date(now - 10_000).toISOString(),
      closesAt: new Date(now + 60_000).toISOString(),
      status: 'OPEN',
    },
    currentQuestion: {
      id: 'q1',
      category: 'Science',
      difficulty: 'Medium',
      question: 'Which planet is closest to the Sun?',
      pillar: 'Astronomy',
      tags: [],
      sourceUrl: null,
      sourceName: null,
      answer: 'Mercury',
      acceptableAnswers: ['Mercury'],
      explanation: 'Mercury is closest.',
    },
    players: [],
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    ...overrides,
  } as VoteSnapshot;
}

function renderVote(snapshot: VoteSnapshot, currentPlayerId: string, mutate = vi.fn()) {
  return render(
    <DisputeVoteView
      snapshot={snapshot}
      currentPlayerId={currentPlayerId}
      castDisputeVote={mutation(mutate)}
      cancelDisputeVote={mutation() as never}
      refetch={vi.fn()}
    />
  );
}

describe('DisputeVoteView', () => {
  beforeEach(() => toastError.mockClear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows the question, answers, explanation, private progress, and server deadline', () => {
    renderVote(makeSnapshot(), '33333333-3333-4333-8333-333333333333');
    expect(screen.getByText('Which planet is closest to the Sun?')).toBeInTheDocument();
    expect(screen.getByText('Venus')).toBeInTheDocument();
    expect(screen.getByText('Mercury')).toBeInTheDocument();
    expect(screen.getByText('The wording allows Venus.')).toBeInTheDocument();
    expect(screen.getByTestId('text-vote-progress')).toHaveTextContent('0 of 2 votes submitted');
    expect(screen.getByTestId('text-vote-countdown')).toHaveTextContent(/\d+s/);
    expect(screen.queryByText(/yes vote|no vote/i)).toBeNull();
  });

  it('shows vote controls only to an eligible opponent and submits one boolean choice', () => {
    const mutate = vi.fn();
    renderVote(makeSnapshot(), '33333333-3333-4333-8333-333333333333', mutate);
    fireEvent.click(screen.getByRole('button', { name: 'Agree and award points' }));
    expect(mutate).toHaveBeenCalledWith({ approve: true }, expect.any(Object));
    expect(screen.getByRole('button', { name: 'Disagree with dispute' })).toBeInTheDocument();
  });

  it('locks an eligible opponent after reconnecting with their submitted ID', () => {
    const snapshot = makeSnapshot({
      currentDisputeVote: {
        ...makeSnapshot().currentDisputeVote,
        submittedVoterIds: ['33333333-3333-4333-8333-333333333333'],
      },
    });
    renderVote(snapshot, '33333333-3333-4333-8333-333333333333');
    expect(screen.getByTestId('text-vote-locked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agree and award points' })).toBeNull();
  });

  it('gives the disputing player waiting state without vote controls', () => {
    renderVote(makeSnapshot(), '11111111-1111-4111-8111-111111111111');
    expect(screen.getByTestId('text-disputant-waiting')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agree and award points' })).toBeNull();
  });

  it('gives an ineligible observer progress without controls', () => {
    renderVote(makeSnapshot(), '44444444-4444-4444-8444-444444444444');
    expect(screen.getByTestId('text-observer-waiting')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agree and award points' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel dispute vote' })).toBeNull();
  });

  it('lets an eligible host vote and cancel without revealing ballot choices', () => {
    renderVote(makeSnapshot(), '22222222-2222-4222-8222-222222222222');
    expect(screen.getByRole('button', { name: 'Agree and award points' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel dispute vote' })).toBeInTheDocument();
    expect(screen.queryByText(/alice voted/i)).toBeNull();
  });

  it('reconciles a 409 vote conflict by refetching without a toast', () => {
    const refetch = vi.fn();
    const error = Object.assign(new Error('Player has already voted'), { status: 409 });
    const mutate = vi.fn((_body, options) => options.onError(error));
    render(
      <DisputeVoteView
        snapshot={makeSnapshot()}
        currentPlayerId="33333333-3333-4333-8333-333333333333"
        castDisputeVote={mutation(mutate)}
        cancelDisputeVote={mutation() as never}
        refetch={refetch}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disagree with dispute' }));
    expect(refetch).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});
