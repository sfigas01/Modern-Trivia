import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomSnapshot } from '@shared/models/rooms';

import { saveRoomSession } from '@/lib/room-session';
import { buildPollUrl, getPollIntervalMs, useRoom } from './use-room';

const baseSnapshot: RoomSnapshot = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'ABCD2',
  status: 'lobby',
  phase: 'LOBBY',
  version: 1,
  hostPlayerId: null,
  category: 'All',
  numRounds: 5,
  currentQuestionIndex: 0,
  activePlayerId: null,
  currentAttempt: null,
  currentQuestion: null,
  players: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-02T00:00:00.000Z',
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getPollIntervalMs', () => {
  it.each(['LOBBY', 'QUESTION', 'REVEAL'] as const)('polls every 2s during %s', (phase) => {
    expect(getPollIntervalMs(phase)).toBe(2000);
  });

  it.each(['ROUND_SCORE', 'GAME_OVER'] as const)('polls every 5s during %s', (phase) => {
    expect(getPollIntervalMs(phase)).toBe(5000);
  });

  it('defaults to the fast interval before any snapshot has loaded', () => {
    expect(getPollIntervalMs(undefined)).toBe(2000);
  });
});

describe('buildPollUrl', () => {
  it('omits sinceVersion when not yet known', () => {
    expect(buildPollUrl('ABCD2')).toBe('/api/rooms/ABCD2');
  });

  it('appends sinceVersion once a snapshot version is known', () => {
    expect(buildPollUrl('ABCD2', 3)).toBe('/api/rooms/ABCD2?sinceVersion=3');
  });
});

describe('useRoom', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
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

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sends the stored player token as an X-Player-Token header', async () => {
    saveRoomSession({ code: 'ABCD2', playerId: 'player-1', token: 'secret-token' });
    fetchMock.mockResolvedValue(jsonResponse(baseSnapshot));

    const { result } = renderHook(() => useRoom('ABCD2'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.snapshot).toBeDefined());

    expect(fetchMock).toHaveBeenCalledWith(
      buildPollUrl('ABCD2'),
      expect.objectContaining({ headers: { 'X-Player-Token': 'secret-token' } })
    );
  });

  it('omits the token header when no session is stored', async () => {
    fetchMock.mockResolvedValue(jsonResponse(baseSnapshot));

    const { result } = renderHook(() => useRoom('ABCD2'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.snapshot).toBeDefined());

    expect(fetchMock).toHaveBeenCalledWith(buildPollUrl('ABCD2'), expect.objectContaining({ headers: {} }));
  });

  it('requests sinceVersion on the next poll and keeps the same snapshot reference when unchanged', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(baseSnapshot))
      .mockResolvedValueOnce(jsonResponse({ changed: false }));

    const { result } = renderHook(() => useRoom('ABCD2'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    const firstSnapshot = result.current.snapshot;

    await act(async () => {
      await result.current.refetch();
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      buildPollUrl('ABCD2', baseSnapshot.version),
      expect.anything()
    );
    expect(result.current.snapshot).toBe(firstSnapshot);
  });

  it('marks the room disconnected after two consecutive poll failures and recovers on the next success', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response('Server error', { status: 500, statusText: 'Server error' }));

    const { result } = renderHook(() => useRoom('ABCD2'), { wrapper: createWrapper() });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.isDisconnected).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.isDisconnected).toBe(true);

    fetchMock.mockResolvedValue(jsonResponse(baseSnapshot));
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.isDisconnected).toBe(false);
  });
});
