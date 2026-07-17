import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomSnapshot } from '@shared/models/rooms';

import { saveRoomSession } from '@/lib/room-session';
import { buildPollUrl, getPollIntervalMs, newerSnapshot, useRoom } from './use-room';

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
  opponentDisputeVotingEnabled: false,
  activeDisputeId: null,
  currentDisputeVote: null,
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
  return { Wrapper, queryClient };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getPollIntervalMs', () => {
  it.each(['LOBBY', 'QUESTION', 'REVEAL', 'DISPUTE_VOTE'] as const)(
    'polls every 2s during %s',
    (phase) => {
      expect(getPollIntervalMs(phase)).toBe(2000);
    }
  );

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

describe('newerSnapshot', () => {
  it('keeps the current snapshot when the candidate is not newer', () => {
    const current = { ...baseSnapshot, version: 3 };
    const candidate = { ...baseSnapshot, version: 2 };
    expect(newerSnapshot(candidate, current)).toBe(current);
    expect(newerSnapshot({ ...baseSnapshot, version: 3 }, current)).toBe(current);
  });

  it('adopts the candidate when it is newer or nothing is cached yet', () => {
    const candidate = { ...baseSnapshot, version: 4 };
    expect(newerSnapshot(candidate, { ...baseSnapshot, version: 3 })).toBe(candidate);
    expect(newerSnapshot(candidate, undefined)).toBe(candidate);
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

    const { result } = renderHook(() => useRoom('ABCD2'), { wrapper: createWrapper().Wrapper });

    await waitFor(() => expect(result.current.snapshot).toBeDefined());

    expect(fetchMock).toHaveBeenCalledWith(
      buildPollUrl('ABCD2'),
      expect.objectContaining({ headers: { 'X-Player-Token': 'secret-token' } })
    );
  });

  it('omits the token header when no session is stored', async () => {
    fetchMock.mockResolvedValue(jsonResponse(baseSnapshot));

    const { result } = renderHook(() => useRoom('ABCD2'), { wrapper: createWrapper().Wrapper });

    await waitFor(() => expect(result.current.snapshot).toBeDefined());

    expect(fetchMock).toHaveBeenCalledWith(
      buildPollUrl('ABCD2'),
      expect.objectContaining({ headers: {} })
    );
  });

  it('requests sinceVersion on the next poll and keeps the same snapshot reference when unchanged', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(baseSnapshot))
      .mockResolvedValueOnce(jsonResponse({ changed: false }));

    const { result } = renderHook(() => useRoom('ABCD2'), { wrapper: createWrapper().Wrapper });

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
    fetchMock.mockResolvedValue(
      new Response('Server error', { status: 500, statusText: 'Server error' })
    );

    const { result } = renderHook(() => useRoom('ABCD2'), { wrapper: createWrapper().Wrapper });

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

  it('does not let a stale in-flight poll roll back a newer snapshot written by a mutation', async () => {
    let resolveStalePoll!: (res: Response) => void;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(baseSnapshot)) // initial mount fetch -> version 1
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveStalePoll = resolve;
          })
      );

    const { Wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useRoom('ABCD2'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.snapshot?.version).toBe(1));

    let stalePoll!: Promise<unknown>;
    act(() => {
      stalePoll = result.current.refetch();
    });

    // A mutation (e.g. `answer`) resolves while the poll above is still in
    // flight and writes a newer snapshot into the cache.
    const newer = { ...baseSnapshot, version: 2, phase: 'REVEAL' as const };
    act(() => {
      queryClient.setQueryData(['/api/rooms', 'ABCD2'], newer);
    });

    // The stale poll now resolves as unchanged relative to the version it
    // was sent with (1), which must not overwrite the newer cached data.
    await act(async () => {
      resolveStalePoll(jsonResponse({ changed: false }));
      await stalePoll;
    });

    await waitFor(() => expect(result.current.snapshot).toEqual(newer));
  });

  it('does not let a stale mutation response overwrite a newer snapshot already in the cache', async () => {
    fetchMock.mockResolvedValue(jsonResponse(baseSnapshot));

    const { Wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useRoom('ABCD2'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.snapshot?.version).toBe(1));

    // A concurrent poll (or another mutation) has already advanced the room
    // past what this in-flight mutation is about to report.
    const newer = { ...baseSnapshot, version: 5, phase: 'GAME_OVER' as const };
    act(() => {
      queryClient.setQueryData(['/api/rooms', 'ABCD2'], newer);
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ snapshot: { ...baseSnapshot, version: 2 } }));
    await act(async () => {
      await result.current.advance.mutateAsync();
    });

    await waitFor(() => expect(result.current.snapshot).toEqual(newer));
  });

  it('posts room-scoped dispute actions with shared payloads and the player token', async () => {
    saveRoomSession({ code: 'ABCD2', playerId: 'player-1', token: 'secret-token' });
    fetchMock.mockResolvedValueOnce(jsonResponse(baseSnapshot));
    const { result } = renderHook(() => useRoom('ABCD2'), { wrapper: createWrapper().Wrapper });
    await waitFor(() => expect(result.current.snapshot).toBeDefined());

    for (const [mutation, response] of [
      [
        () => result.current.submitDispute.mutateAsync({ explanation: 'The source supports us.' }),
        2,
      ],
      [() => result.current.castDisputeVote.mutateAsync({ approve: true }), 3],
      [() => result.current.cancelDisputeVote.mutateAsync(), 4],
    ] as const) {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ snapshot: { ...baseSnapshot, version: response } })
      );
      await act(async () => {
        await mutation();
      });
    }

    const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(postCalls.map(([url]) => url)).toEqual([
      '/api/rooms/ABCD2/disputes',
      '/api/rooms/ABCD2/disputes/vote',
      '/api/rooms/ABCD2/disputes/cancel',
    ]);
    expect(postCalls.map(([, init]) => JSON.parse(init.body as string))).toEqual([
      { explanation: 'The source supports us.' },
      { approve: true },
      {},
    ]);
    for (const [, init] of postCalls) {
      expect(init.headers).toMatchObject({ 'X-Player-Token': 'secret-token' });
    }
  });

  it('preserves 409 status on dispute action errors for caller refetch handling', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(baseSnapshot));
    const { result } = renderHook(() => useRoom('ABCD2'), { wrapper: createWrapper().Wrapper });
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Player has already voted' }, 409));

    await expect(
      result.current.castDisputeVote.mutateAsync({ approve: false })
    ).rejects.toMatchObject({ status: 409, message: 'Player has already voted' });
  });
});
