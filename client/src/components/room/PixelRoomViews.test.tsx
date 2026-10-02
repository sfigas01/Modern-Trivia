import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { UseMutationResult } from '@tanstack/react-query';
import type { RoomSnapshot } from '@shared/models/rooms';

import {
  PixelDisputeVoteView,
  PixelFinalResults,
  PixelLeaveConfirmModal,
  PixelQuestionView,
  PixelRevealView,
  PixelRoomAbandoned,
  PixelRoundScore,
  PixelTurnHandoff,
} from './PixelRoomViews';

// Pixel multiplayer views (STE-232, STE-233). Room renders them through
// PixelRoom when VITE_PIXEL_UI is on.

const mockSetLocation = vi.hoisted(() => vi.fn());
vi.mock('wouter', () => ({ useLocation: () => ['/room/ABCDE', mockSetLocation] }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

type Phase = RoomSnapshot['phase'];
type AnySnapshot = Extract<RoomSnapshot, { phase: Phase }>;

function player(id: string, nickname: string, joinOrder: number, extra = {}) {
  return {
    id,
    nickname,
    joinOrder,
    score: 10 - joinOrder * 4,
    questionCount: 1,
    lastRoundDelta: joinOrder === 0 ? 3 : -2,
    isHost: joinOrder === 0,
    presence: 'online' as const,
    lastSeenAt: new Date().toISOString(),
    leftAt: null,
    ...extra,
  };
}

const QUESTION = {
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
};

function snapshot<T extends Phase>(phase: T, overrides: Record<string, unknown> = {}) {
  return {
    id: 'room-1',
    code: 'ABCDE',
    status: 'active',
    phase,
    version: 4,
    hostPlayerId: 'p1',
    categories: ['All'],
    numRounds: 10,
    currentQuestionIndex: 0,
    activePlayerId: 'p1',
    currentAttempt: null,
    opponentDisputeVotingEnabled: false,
    activeDisputeId: null,
    currentDisputeVote: null,
    currentQuestion: QUESTION,
    players: [player('p1', 'Alice', 0), player('p2', 'Bob', 1), player('p3', 'Cy', 2)],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    ...overrides,
  } as unknown as Extract<AnySnapshot, { phase: T }>;
}

function mutation(extra: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    ...extra,
  } as unknown as UseMutationResult<never, Error, never>;
}

afterEach(() => {
  cleanup();
  mockSetLocation.mockClear();
});

describe('PixelQuestionView', () => {
  it('lets the active player submit an answer', () => {
    const answer = mutation();
    render(
      <PixelQuestionView
        snapshot={snapshot('QUESTION')}
        currentPlayerId="p1"
        answer={answer}
        skip={mutation()}
        refetch={vi.fn()}
      />
    );
    expect(screen.getByTestId('badge-your-turn')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('input-answer'), { target: { value: 'Mercury' } });
    fireEvent.click(screen.getByTestId('button-submit-answer'));
    expect(answer.mutate).toHaveBeenCalledWith({ answer: 'Mercury' }, expect.anything());
  });

  it('shows other players who is answering', () => {
    render(
      <PixelQuestionView
        snapshot={snapshot('QUESTION')}
        currentPlayerId="p2"
        answer={mutation()}
        skip={mutation()}
        refetch={vi.fn()}
      />
    );
    expect(screen.getByTestId('text-waiting-turn')).toHaveTextContent('Waiting for Alice');
    expect(screen.queryByTestId('input-answer')).toBeNull();
  });
});

describe('PixelRevealView', () => {
  const attempt = {
    questionId: 'q1',
    playerId: 'p1',
    submittedAnswer: 'Venus',
    verdict: 'INCORRECT',
    pointsDelta: -2,
  };

  it('shows the verdict, correct answer and fact, and advances', () => {
    const advance = mutation();
    render(
      <PixelRevealView
        snapshot={snapshot('REVEAL', { currentAttempt: attempt })}
        currentPlayerId="p1"
        advance={advance}
        awardDispute={mutation()}
        submitDispute={mutation()}
        refetch={vi.fn()}
      />
    );
    expect(screen.getByTestId('text-verdict')).toHaveTextContent('INCORRECT (-2)');
    expect(screen.getByText('Mercury')).toBeInTheDocument();
    expect(screen.getByText('Mercury orbits closest to the sun.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Example Source' })).toHaveAttribute(
      'href',
      'https://example.com'
    );
    fireEvent.click(screen.getByTestId('button-next'));
    expect(advance.mutate).toHaveBeenCalled();
  });

  it('opens the pixel dispute dialog for the answering player', async () => {
    render(
      <PixelRevealView
        snapshot={snapshot('REVEAL', { currentAttempt: attempt })}
        currentPlayerId="p1"
        advance={mutation()}
        awardDispute={mutation()}
        submitDispute={mutation()}
        refetch={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dispute' }));
    expect(await screen.findByRole('dialog', { name: 'Dispute This Answer' })).toBeInTheDocument();
  });
});

describe('PixelDisputeVoteView', () => {
  it('lets an eligible opponent vote', () => {
    const cast = mutation();
    render(
      <PixelDisputeVoteView
        snapshot={snapshot('DISPUTE_VOTE', {
          currentAttempt: { questionId: 'q1', playerId: 'p1', submittedAnswer: 'Venus' },
          currentDisputeVote: {
            disputingPlayerId: 'p1',
            disputingPlayerName: 'Alice',
            explanation: 'Venus is closer sometimes.',
            eligibleVoterIds: ['p2', 'p3'],
            submittedVoterIds: [],
            closesAt: new Date(Date.now() + 30_000).toISOString(),
          },
        })}
        currentPlayerId="p2"
        castDisputeVote={cast}
        cancelDisputeVote={mutation()}
        refetch={vi.fn()}
      />
    );
    expect(screen.getByTestId('text-vote-progress')).toHaveTextContent('0 of 2 votes submitted');
    expect(screen.getByText('Venus is closer sometimes.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Agree and award points' }));
    expect(cast.mutate).toHaveBeenCalledWith({ approve: true }, expect.anything());
  });
});

describe('PixelRoundScore', () => {
  it('ranks players with round deltas and lets the host continue', () => {
    const next = mutation();
    render(
      <PixelRoundScore
        snapshot={snapshot('ROUND_SCORE')}
        currentPlayerId="p1"
        continueRound={next}
        refetch={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: 'Round Scores' })).toBeInTheDocument();
    expect(screen.getByTestId('round-score-row-p1')).toHaveTextContent('Alice (you)');
    expect(screen.getByTestId('round-score-delta-p1')).toHaveTextContent('(+3)');
    fireEvent.click(screen.getByTestId('button-next-round'));
    expect(next.mutate).toHaveBeenCalled();
  });

  it('tells guests to wait for the host', () => {
    render(
      <PixelRoundScore
        snapshot={snapshot('ROUND_SCORE')}
        currentPlayerId="p2"
        continueRound={mutation()}
        refetch={vi.fn()}
      />
    );
    expect(screen.getByTestId('text-waiting-host-round')).toBeInTheDocument();
  });
});

describe('PixelFinalResults', () => {
  it('names the winner and goes home', () => {
    render(<PixelFinalResults snapshot={snapshot('GAME_OVER')} currentPlayerId="p2" />);
    expect(screen.getByTestId('text-winner')).toHaveTextContent('Winner: Alice');
    expect(screen.getByTestId('final-result-row-p2')).toHaveTextContent('Bob (you)');
    fireEvent.click(screen.getByTestId('button-back-home'));
    expect(mockSetLocation).toHaveBeenCalledWith('/');
  });
});

describe('Pixel room overlays', () => {
  it('warns that leaving ends the game when only two players remain', () => {
    const onConfirm = vi.fn();
    render(
      <PixelLeaveConfirmModal
        snapshot={snapshot('QUESTION', {
          players: [player('p1', 'Alice', 0), player('p2', 'Bob', 1)],
        })}
        currentPlayerId="p2"
        isPending={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByRole('dialog', { name: 'End Game for Everyone?' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-leave-confirm'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('announces the turn handoff', () => {
    render(<PixelTurnHandoff nickname="Bob" onDismiss={vi.fn()} />);
    expect(screen.getByTestId('turn-handoff')).toHaveTextContent('It’s Bob’s turn!');
  });

  it('shows final scores when the host abandons the room', () => {
    render(<PixelRoomAbandoned snapshot={snapshot('QUESTION', { status: 'abandoned' })} />);
    expect(screen.getByTestId('room-abandoned')).toHaveTextContent('The host has ended this game.');
    expect(screen.getByTestId('abandoned-result-row-p1')).toBeInTheDocument();
    expect(screen.getByTestId('button-abandoned-home')).toHaveFocus();
  });
});
