import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRecordRoomQuestion } from './use-record-room-question';
import { getGuestSeenIds } from '@/lib/guest-seen';

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

describe('useRecordRoomQuestion', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn(() => Promise.resolve({ ok: true }) as unknown as Promise<Response>);
    vi.stubGlobal('fetch', fetchMock);
  });

  it('records the displayed question to local history for a guest', () => {
    renderHook(() => useRecordRoomQuestion('q1', false, false));
    expect(getGuestSeenIds()).toEqual(['q1']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records the displayed question to server history for a signed-in player', () => {
    renderHook(() => useRecordRoomQuestion('q1', true, false));
    // Server-side, not browser-local.
    expect(getGuestSeenIds()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/questions/seen');
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ questionIds: ['q1'] });
  });

  it('does not record while auth status is still loading', () => {
    renderHook(() => useRecordRoomQuestion('q1', false, true));
    expect(getGuestSeenIds()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not record when there is no question id yet', () => {
    renderHook(() => useRecordRoomQuestion(undefined, false, false));
    expect(getGuestSeenIds()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records a new question id when it changes, without re-recording the same one', () => {
    const { rerender } = renderHook(
      ({ questionId }) => useRecordRoomQuestion(questionId, false, false),
      { initialProps: { questionId: 'q1' } }
    );
    expect(getGuestSeenIds()).toEqual(['q1']);

    rerender({ questionId: 'q1' });
    expect(getGuestSeenIds()).toEqual(['q1']);

    rerender({ questionId: 'q2' });
    expect(getGuestSeenIds()).toEqual(['q1', 'q2']);
  });

  it('does not re-post the same question id for a signed-in player', () => {
    const { rerender } = renderHook(
      ({ questionId }) => useRecordRoomQuestion(questionId, true, false),
      { initialProps: { questionId: 'q1' } }
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ questionId: 'q1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ questionId: 'q2' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('starts recording once auth resolves to guest after a loading state', () => {
    const { rerender } = renderHook(
      ({ authLoading }) => useRecordRoomQuestion('q1', false, authLoading),
      { initialProps: { authLoading: true } }
    );
    expect(getGuestSeenIds()).toEqual([]);

    rerender({ authLoading: false });
    expect(getGuestSeenIds()).toEqual(['q1']);
  });
});
