import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import Room from './Room';
import type { RoomSnapshot } from '@shared/models/rooms';

const mockSetLocation = vi.fn();
let mockParams: { code: string } = { code: 'ABCDE' };

vi.mock('wouter', () => ({
  useParams: () => mockParams,
  useLocation: () => ['/room/ABCDE', mockSetLocation],
}));

const mockGetRoomSession = vi.fn();
vi.mock('@/lib/room-session', () => ({
  getRoomSession: (...args: unknown[]) => mockGetRoomSession(...args),
}));

const mockUseRoom = vi.fn();
vi.mock('@/hooks/use-room', () => ({
  useRoom: (...args: unknown[]) => mockUseRoom(...args),
}));

vi.mock('@/components/room/Lobby', () => ({
  Lobby: ({ snapshot }: { snapshot: RoomSnapshot }) => (
    <div data-testid="lobby-mock">Lobby for {snapshot.code}</div>
  ),
}));

vi.mock('@/components/room/PlayerRoster', () => ({
  PlayerRoster: () => <div data-testid="player-roster-mock" />,
}));

vi.mock('@/components/room/QuestionView', () => ({
  QuestionView: () => <div data-testid="question-view-mock" />,
}));

vi.mock('@/components/room/RevealView', () => ({
  RevealView: () => <div data-testid="reveal-view-mock" />,
}));

vi.mock('@/components/room/RoundScore', () => ({
  RoundScore: () => <div data-testid="round-score-mock" />,
}));

vi.mock('@/components/room/FinalResults', () => ({
  FinalResults: () => <div data-testid="final-results-mock" />,
}));

vi.mock('@/components/room/TurnHandoff', () => ({
  TurnHandoff: () => <div data-testid="turn-handoff-mock" />,
}));

const SESSION = { code: 'ABCDE', playerId: 'host-1', token: 'test-token' };

function makeSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    id: 'room-1',
    code: 'ABCDE',
    status: 'lobby',
    phase: 'LOBBY',
    version: 1,
    hostPlayerId: 'host-1',
    category: 'All',
    numRounds: 10,
    currentQuestionIndex: 0,
    activePlayerId: null,
    currentAttempt: null,
    currentQuestion: null,
    players: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    ...overrides,
  } as unknown as RoomSnapshot;
}

function makeUseRoomResult(overrides: Record<string, unknown> = {}) {
  return {
    snapshot: undefined,
    isLoading: false,
    isDisconnected: false,
    error: null,
    refetch: vi.fn(),
    join: {},
    start: {},
    answer: {},
    advance: {},
    continueRound: {},
    skip: {},
    end: {},
    ...overrides,
  };
}

describe('Room', () => {
  beforeEach(() => {
    mockSetLocation.mockClear();
    mockGetRoomSession.mockReset();
    mockUseRoom.mockReset();
    mockParams = { code: 'ABCDE' };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('redirects to home when no room session exists', () => {
    mockGetRoomSession.mockReturnValue(null);
    mockUseRoom.mockReturnValue(makeUseRoomResult());

    render(<Room />);

    expect(mockSetLocation).toHaveBeenCalledWith('/');
  });

  it('shows a loading state while useRoom is loading', () => {
    mockGetRoomSession.mockReturnValue(SESSION);
    mockUseRoom.mockReturnValue(makeUseRoomResult({ isLoading: true }));

    render(<Room />);

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('shows an error state when useRoom errors', () => {
    mockGetRoomSession.mockReturnValue(SESSION);
    mockUseRoom.mockReturnValue(makeUseRoomResult({ error: new Error('Room not found') }));

    render(<Room />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Room not found')).toBeInTheDocument();
  });

  it('shows a disconnection banner when isDisconnected is true', () => {
    mockGetRoomSession.mockReturnValue(SESSION);
    mockUseRoom.mockReturnValue(
      makeUseRoomResult({ snapshot: makeSnapshot(), isDisconnected: true })
    );

    render(<Room />);

    expect(screen.getByTestId('text-disconnected')).toBeInTheDocument();
  });

  it('renders the Lobby component when phase is LOBBY', () => {
    mockGetRoomSession.mockReturnValue(SESSION);
    mockUseRoom.mockReturnValue(makeUseRoomResult({ snapshot: makeSnapshot({ phase: 'LOBBY' }) }));

    render(<Room />);

    expect(screen.getByTestId('lobby-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('player-roster-mock')).toBeNull();
  });

  it('renders QuestionView and the PlayerRoster when phase is QUESTION', () => {
    mockGetRoomSession.mockReturnValue(SESSION);
    mockUseRoom.mockReturnValue(
      makeUseRoomResult({ snapshot: makeSnapshot({ phase: 'QUESTION', activePlayerId: 'host-1' }) })
    );

    render(<Room />);

    expect(screen.getByTestId('question-view-mock')).toBeInTheDocument();
    expect(screen.getByTestId('player-roster-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('lobby-mock')).toBeNull();
  });

  it('renders RevealView when phase is REVEAL', () => {
    mockGetRoomSession.mockReturnValue(SESSION);
    mockUseRoom.mockReturnValue(
      makeUseRoomResult({ snapshot: makeSnapshot({ phase: 'REVEAL', activePlayerId: 'host-1' }) })
    );

    render(<Room />);

    expect(screen.getByTestId('reveal-view-mock')).toBeInTheDocument();
  });

  it('renders RoundScore when phase is ROUND_SCORE', () => {
    mockGetRoomSession.mockReturnValue(SESSION);
    mockUseRoom.mockReturnValue(
      makeUseRoomResult({ snapshot: makeSnapshot({ phase: 'ROUND_SCORE', activePlayerId: 'host-1' }) })
    );

    render(<Room />);

    expect(screen.getByTestId('round-score-mock')).toBeInTheDocument();
  });

  it('renders FinalResults when phase is GAME_OVER', () => {
    mockGetRoomSession.mockReturnValue(SESSION);
    mockUseRoom.mockReturnValue(
      makeUseRoomResult({ snapshot: makeSnapshot({ phase: 'GAME_OVER', activePlayerId: 'host-1' }) })
    );

    render(<Room />);

    expect(screen.getByTestId('final-results-mock')).toBeInTheDocument();
  });
});
