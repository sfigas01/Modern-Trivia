import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdminDispute } from '@shared/schema';

import { DisputeVoteAudit } from './DisputeVoteAudit';

const VOTER_ONE = '11111111-1111-4111-8111-111111111111';
const VOTER_TWO = '22222222-2222-4222-8222-222222222222';

function makeDispute(overrides: Partial<AdminDispute> = {}): AdminDispute {
  return {
    id: 'dispute-1',
    questionId: 'q-1',
    questionText: 'What is the capital of Canada?',
    correctAnswer: 'Ottawa',
    teamName: 'Alpha',
    submittedAnswer: 'Toronto',
    teamExplanation: 'The clue was ambiguous.',
    timestamp: new Date('2026-07-14T12:00:00Z'),
    status: 'pending',
    resolutionNote: null,
    aiAnalysis: null,
    roomId: '33333333-3333-4333-8333-333333333333',
    roomCode: 'ABCD2',
    attemptKey: '33333333-3333-4333-8333-333333333333:4',
    disputingPlayerId: '44444444-4444-4444-8444-444444444444',
    disputingPlayerName: 'Alpha',
    votingEnabled: true,
    eligibleVoterSnapshot: [
      { playerId: VOTER_ONE, displayName: 'Bravo' },
      { playerId: VOTER_TWO, displayName: 'Charlie' },
    ],
    threshold: 2,
    outcome: 'approved',
    originalPointsDelta: -3,
    finalPointsDelta: 5,
    decidedAt: new Date('2026-07-14T12:01:00Z'),
    ballots: [
      {
        id: 'ballot-1',
        disputeId: 'dispute-1',
        voterPlayerId: VOTER_ONE,
        voterPlayerName: 'Bravo',
        approve: true,
        castAt: new Date('2026-07-14T12:00:30Z'),
      },
    ],
    ...overrides,
  };
}

afterEach(cleanup);

describe('DisputeVoteAudit', () => {
  it('renders outcome, threshold, totals, score transition, context, and non-responders', () => {
    render(<DisputeVoteAudit dispute={makeDispute()} />);

    expect(screen.getByText('Opponent vote')).toBeInTheDocument();
    expect(screen.getByText('approved')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('1 yes / 0 no / 1 no response')).toBeInTheDocument();
    expect(screen.getByText('Threshold: 2')).toBeInTheDocument();
    expect(screen.getByText('-3 → +5')).toBeInTheDocument();
    expect(screen.getByText('ABCD2')).toBeInTheDocument();
    expect(screen.getByText(/33333333-3333-4333-8333-333333333333:4/)).toBeInTheDocument();
    expect(screen.getByTestId(`ballot-row-${VOTER_ONE}`)).toHaveTextContent('Agree');
    expect(screen.getByTestId(`ballot-row-${VOTER_TWO}`)).toHaveTextContent('No response');
  });

  it.each(['approved', 'rejected', 'tied', 'expired', 'canceled'] as const)(
    'renders the %s gameplay outcome independently from rejected QA status',
    (outcome) => {
      render(<DisputeVoteAudit dispute={makeDispute({ outcome, status: 'rejected' })} />);

      expect(screen.getAllByText(outcome)).not.toHaveLength(0);
      expect(screen.getByText('Independent QA review').parentElement).toHaveTextContent('rejected');
      expect(
        screen.getByText(/Gameplay scoring and content QA are reviewed independently/)
      ).toBeInTheDocument();
    }
  );

  it('keeps legacy solo records safe without invented vote metadata', () => {
    render(
      <DisputeVoteAudit
        dispute={makeDispute({
          roomId: null,
          roomCode: null,
          attemptKey: null,
          disputingPlayerId: null,
          disputingPlayerName: null,
          votingEnabled: false,
          eligibleVoterSnapshot: null,
          threshold: null,
          outcome: null,
          originalPointsDelta: null,
          finalPointsDelta: null,
          decidedAt: null,
          ballots: [],
        })}
      />
    );

    expect(screen.getByText('Solo dispute')).toBeInTheDocument();
    expect(screen.getByText('Not applicable')).toBeInTheDocument();
    expect(screen.getAllByText('Not recorded')).not.toHaveLength(0);
    expect(screen.queryByText(/Ballot details/)).not.toBeInTheDocument();
  });

  it('renders partial multiplayer records and unexpected ballots without crashing', () => {
    render(
      <DisputeVoteAudit
        dispute={makeDispute({
          roomCode: null,
          attemptKey: null,
          disputingPlayerName: null,
          eligibleVoterSnapshot: null,
          threshold: null,
          outcome: null,
          originalPointsDelta: null,
          finalPointsDelta: null,
        })}
      />
    );

    expect(screen.getAllByText('Not recorded')).not.toHaveLength(0);
    expect(screen.getByText(/missing from eligible snapshot/)).toBeInTheDocument();
    expect(
      screen.getByText('Ballot details (1 recorded; eligible snapshot unavailable)')
    ).toBeInTheDocument();
  });

  it('labels disabled multiplayer disputes as manual awards', () => {
    render(<DisputeVoteAudit dispute={makeDispute({ votingEnabled: false })} />);
    expect(screen.getByText('Manual multiplayer')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });
});
