import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearRoomSession, getRoomSession, saveRoomSession } from './room-session';

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

describe('room-session', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a saved session', () => {
    saveRoomSession({ code: 'ABCD2', playerId: 'player-1', token: 'token-1' });

    expect(getRoomSession('ABCD2')).toEqual({
      code: 'ABCD2',
      playerId: 'player-1',
      token: 'token-1',
    });
  });

  it('looks up sessions case-insensitively by room code', () => {
    saveRoomSession({ code: 'ABCD2', playerId: 'player-1', token: 'token-1' });

    expect(getRoomSession('abcd2')).toEqual({
      code: 'ABCD2',
      playerId: 'player-1',
      token: 'token-1',
    });
  });

  it('returns null when no session is stored', () => {
    expect(getRoomSession('ZZZZZ')).toBeNull();
  });

  it('returns null for malformed stored data instead of throwing', () => {
    localStorage.setItem('trivia:room-session:ABCD2', 'not-json');
    expect(getRoomSession('ABCD2')).toBeNull();

    localStorage.setItem('trivia:room-session:ABCD2', JSON.stringify({ code: 'ABCD2' }));
    expect(getRoomSession('ABCD2')).toBeNull();
  });

  it('clears a stored session', () => {
    saveRoomSession({ code: 'ABCD2', playerId: 'player-1', token: 'token-1' });
    clearRoomSession('ABCD2');
    expect(getRoomSession('ABCD2')).toBeNull();
  });
});
