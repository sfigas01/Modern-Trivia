import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRecordGuestRoomQuestion } from './use-record-guest-room-question';
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

describe('useRecordGuestRoomQuestion', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('records the displayed question for a guest', () => {
    renderHook(() => useRecordGuestRoomQuestion('q1', false, false));
    expect(getGuestSeenIds()).toEqual(['q1']);
  });

  it('does not record while auth status is still loading', () => {
    renderHook(() => useRecordGuestRoomQuestion('q1', false, true));
    expect(getGuestSeenIds()).toEqual([]);
  });

  it('does not record for a signed-in player', () => {
    renderHook(() => useRecordGuestRoomQuestion('q1', true, false));
    expect(getGuestSeenIds()).toEqual([]);
  });

  it('does not record when there is no question id yet', () => {
    renderHook(() => useRecordGuestRoomQuestion(undefined, false, false));
    expect(getGuestSeenIds()).toEqual([]);
  });

  it('records a new question id when it changes, without re-recording the same one', () => {
    const { rerender } = renderHook(
      ({ questionId }) => useRecordGuestRoomQuestion(questionId, false, false),
      { initialProps: { questionId: 'q1' } }
    );
    expect(getGuestSeenIds()).toEqual(['q1']);

    rerender({ questionId: 'q1' });
    expect(getGuestSeenIds()).toEqual(['q1']);

    rerender({ questionId: 'q2' });
    expect(getGuestSeenIds()).toEqual(['q1', 'q2']);
  });

  it('starts recording once auth resolves to guest after a loading state', () => {
    const { rerender } = renderHook(
      ({ authLoading }) => useRecordGuestRoomQuestion('q1', false, authLoading),
      { initialProps: { authLoading: true } }
    );
    expect(getGuestSeenIds()).toEqual([]);

    rerender({ authLoading: false });
    expect(getGuestSeenIds()).toEqual(['q1']);
  });
});
