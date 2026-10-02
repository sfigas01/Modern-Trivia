import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UseMutationResult } from '@tanstack/react-query';

import PixelLobby from './PixelLobby';
import type {
  EndRoomResponse,
  LeaveRoomResponse,
  RoomSnapshot,
  StartRoomRequest,
  StartRoomResponse,
} from '@shared/models/rooms';

const mockSetLocation = vi.hoisted(() => vi.fn());

vi.mock('wouter', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ['/', mockSetLocation],
}));

// Stub localStorage for jsdom compatibility
const storage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => {
    storage[key] = value;
  },
  removeItem: (key: string) => {
    delete storage[key];
  },
  clear: () => {
    for (const key of Object.keys(storage)) delete storage[key];
  },
});

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

type LobbySnapshot = Extract<RoomSnapshot, { phase: 'LOBBY' }>;

function makePlayer(overrides: Partial<LobbySnapshot['players'][number]> = {}) {
  return {
    id: 'host-1',
    nickname: 'Steph',
    joinOrder: 0,
    score: 0,
    questionCount: 0,
    lastRoundDelta: 0,
    isHost: true,
    presence: 'online' as const,
    lastSeenAt: new Date().toISOString(),
    leftAt: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<LobbySnapshot> = {}): LobbySnapshot {
  return {
    id: 'room-1',
    code: 'ABCDE',
    status: 'lobby',
    phase: 'LOBBY',
    version: 1,
    hostPlayerId: 'host-1',
    categories: ['All'],
    numRounds: 10,
    currentQuestionIndex: 0,
    activePlayerId: null,
    currentAttempt: null,
    currentQuestion: null,
    players: [makePlayer()],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMutation<TData, TVariables>(
  overrides: Partial<{ isPending: boolean }> = {}
): UseMutationResult<TData, Error, TVariables> {
  return {
    mutate: vi.fn(),
    isPending: false,
    ...overrides,
  } as unknown as UseMutationResult<TData, Error, TVariables>;
}

function renderLobby(snapshot: LobbySnapshot, currentPlayerId = 'host-1', extra = {}) {
  const start = makeMutation<StartRoomResponse, StartRoomRequest>();
  const end = makeMutation<EndRoomResponse, void>();
  const leave = makeMutation<LeaveRoomResponse, void>();
  render(
    <PixelLobby
      snapshot={snapshot}
      currentPlayerId={currentPlayerId}
      start={start}
      end={end}
      leave={leave}
      {...extra}
    />
  );
  return { start, end, leave };
}

const GUEST = makePlayer({ id: 'guest-1', nickname: 'Jo', joinOrder: 1, isHost: false });

// Pixel lobby (STE-234): Room.tsx renders it in the LOBBY phase when
// VITE_PIXEL_UI is on.
describe('PixelLobby', () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
    mockSetLocation.mockClear();
    localStorage.clear();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the room code, invite QR and settings', () => {
    renderLobby(makeSnapshot({ categories: ['Sports', 'Technology'], numRounds: 15 }));
    expect(screen.getByTestId('text-room-code')).toHaveTextContent('ABCDE');
    expect(screen.getByTestId('qr-room-invite')).toBeInTheDocument();
    expect(screen.getByText('Sports, Technology · 15 rounds')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Game Lobby' })).toBeInTheDocument();
  });

  it('copies the join link', async () => {
    renderLobby(makeSnapshot());
    fireEvent.click(screen.getByTestId('button-copy-link'));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/join/ABCDE`
      )
    );
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('lists players with host badge, presence and (you)', () => {
    renderLobby(makeSnapshot({ players: [makePlayer(), { ...GUEST, presence: 'stale' }] }));
    expect(screen.getByRole('heading', { name: 'Players (2/4)' })).toBeInTheDocument();
    const hostRow = screen.getByTestId('player-row-host-1');
    expect(hostRow).toHaveTextContent('Steph (you)');
    expect(hostRow).toHaveTextContent('Host');
    expect(screen.getByTestId('presence-dot-guest-1')).toHaveAttribute('aria-label', 'Stale');
  });

  it('only lets the host start once two players have joined', () => {
    const { start } = renderLobby(makeSnapshot());
    expect(screen.getByTestId('button-start-game')).toBeDisabled();
    expect(screen.getByTestId('text-need-players')).toBeInTheDocument();
    cleanup();

    const two = renderLobby(makeSnapshot({ players: [makePlayer(), GUEST] }));
    fireEvent.click(screen.getByTestId('button-start-game'));
    expect(two.start.mutate).toHaveBeenCalled();
    expect(start.mutate).not.toHaveBeenCalled();
  });

  it('lets the host close the room', () => {
    const { end } = renderLobby(makeSnapshot({ players: [makePlayer(), GUEST] }));
    fireEvent.click(screen.getByTestId('button-close-room'));
    expect(end.mutate).toHaveBeenCalled();
  });

  it('shows guests a waiting message and a Leave Room button', () => {
    renderLobby(makeSnapshot({ players: [makePlayer(), GUEST] }), 'guest-1');
    expect(screen.getByTestId('text-waiting-host')).toBeInTheDocument();
    expect(screen.queryByTestId('button-start-game')).toBeNull();
    expect(screen.getByTestId('button-leave-room')).toBeEnabled();
  });

  it('shows the closed-room screen with a way home', () => {
    renderLobby(makeSnapshot({ status: 'finished' }));
    expect(screen.getByTestId('lobby-closed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/');
  });

  it('shows the reconnecting banner when disconnected', () => {
    renderLobby(makeSnapshot(), 'host-1', { isDisconnected: true });
    expect(screen.getByTestId('text-disconnected')).toHaveTextContent('Reconnecting');
  });
});
