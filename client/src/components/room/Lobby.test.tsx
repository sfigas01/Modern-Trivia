import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UseMutationResult } from '@tanstack/react-query';

import { Lobby } from './Lobby';
import { addGuestSeenIds } from '@/lib/guest-seen';
import type {
  EndRoomResponse,
  LeaveRoomResponse,
  RoomSnapshot,
  StartRoomRequest,
  StartRoomResponse,
} from '@shared/models/rooms';

vi.mock('wouter', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ['/', vi.fn()],
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
    category: 'All',
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

describe('Lobby', () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
    localStorage.clear();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.assign(navigator, { clipboard: originalClipboard });
  });

  it('disables Start Game with fewer than 2 players', () => {
    const snapshot = makeSnapshot();
    render(
      <Lobby
        snapshot={snapshot}
        currentPlayerId="host-1"
        start={makeMutation<StartRoomResponse, StartRoomRequest>()}
        end={makeMutation<EndRoomResponse, void>()}
        leave={makeMutation<LeaveRoomResponse, void>()}
      />
    );

    expect(screen.getByTestId('button-start-game')).toBeDisabled();
    expect(screen.getByTestId('text-need-players')).toBeInTheDocument();
  });

  it('enables Start Game with 2 or more active players', () => {
    const snapshot = makeSnapshot({
      players: [
        makePlayer({ id: 'host-1' }),
        makePlayer({ id: 'p2', isHost: false, joinOrder: 1 }),
      ],
    });
    render(
      <Lobby
        snapshot={snapshot}
        currentPlayerId="host-1"
        start={makeMutation<StartRoomResponse, StartRoomRequest>()}
        end={makeMutation<EndRoomResponse, void>()}
        leave={makeMutation<LeaveRoomResponse, void>()}
      />
    );

    expect(screen.getByTestId('button-start-game')).not.toBeDisabled();
  });

  it('does not count players who have left toward the start-game gate', () => {
    const snapshot = makeSnapshot({
      players: [
        makePlayer({ id: 'host-1' }),
        makePlayer({ id: 'p2', isHost: false, joinOrder: 1, leftAt: new Date().toISOString() }),
      ],
    });
    render(
      <Lobby
        snapshot={snapshot}
        currentPlayerId="host-1"
        start={makeMutation<StartRoomResponse, StartRoomRequest>()}
        end={makeMutation<EndRoomResponse, void>()}
        leave={makeMutation<LeaveRoomResponse, void>()}
      />
    );

    expect(screen.getByTestId('button-start-game')).toBeDisabled();
  });

  it('shows host controls for the host', () => {
    const snapshot = makeSnapshot();
    render(
      <Lobby
        snapshot={snapshot}
        currentPlayerId="host-1"
        start={makeMutation<StartRoomResponse, StartRoomRequest>()}
        end={makeMutation<EndRoomResponse, void>()}
        leave={makeMutation<LeaveRoomResponse, void>()}
      />
    );

    expect(screen.getByTestId('button-start-game')).toBeInTheDocument();
    expect(screen.getByTestId('button-close-room')).toBeInTheDocument();
    expect(screen.queryByTestId('text-waiting-host')).toBeNull();
  });

  it('shows a waiting message for guests instead of host controls', () => {
    const snapshot = makeSnapshot();
    render(
      <Lobby
        snapshot={snapshot}
        currentPlayerId="guest-1"
        start={makeMutation<StartRoomResponse, StartRoomRequest>()}
        end={makeMutation<EndRoomResponse, void>()}
        leave={makeMutation<LeaveRoomResponse, void>()}
      />
    );

    expect(screen.getByTestId('text-waiting-host')).toBeInTheDocument();
    expect(screen.queryByTestId('button-start-game')).toBeNull();
    expect(screen.queryByTestId('button-close-room')).toBeNull();
  });

  it('copies the join link to the clipboard and confirms via toast', async () => {
    const snapshot = makeSnapshot();
    render(
      <Lobby
        snapshot={snapshot}
        currentPlayerId="host-1"
        start={makeMutation<StartRoomResponse, StartRoomRequest>()}
        end={makeMutation<EndRoomResponse, void>()}
        leave={makeMutation<LeaveRoomResponse, void>()}
      />
    );

    fireEvent.click(screen.getByTestId('button-copy-link'));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/join/ABCDE`
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('sends the locally-seen guest question ids when starting the game', async () => {
    addGuestSeenIds(['q1', 'q2']);
    const snapshot = makeSnapshot({
      players: [
        makePlayer({ id: 'host-1' }),
        makePlayer({ id: 'p2', isHost: false, joinOrder: 1 }),
      ],
    });
    const start = makeMutation<StartRoomResponse, StartRoomRequest>();
    render(
      <Lobby
        snapshot={snapshot}
        currentPlayerId="host-1"
        start={start}
        end={makeMutation<EndRoomResponse, void>()}
        leave={makeMutation<LeaveRoomResponse, void>()}
      />
    );

    fireEvent.click(screen.getByTestId('button-start-game'));

    expect(start.mutate).toHaveBeenCalledWith(
      { excludeQuestionIds: ['q1', 'q2'] },
      expect.anything()
    );
  });

  it('shows a closed message with a link home when the room is no longer in the lobby status', () => {
    const snapshot = makeSnapshot({ status: 'abandoned' });
    render(
      <Lobby
        snapshot={snapshot}
        currentPlayerId="guest-1"
        start={makeMutation<StartRoomResponse, StartRoomRequest>()}
        end={makeMutation<EndRoomResponse, void>()}
        leave={makeMutation<LeaveRoomResponse, void>()}
      />
    );

    expect(screen.getByTestId('lobby-closed')).toBeInTheDocument();
    expect(screen.getByTestId('link-home')).toBeInTheDocument();
    expect(screen.queryByTestId('text-room-code')).toBeNull();
  });
});
