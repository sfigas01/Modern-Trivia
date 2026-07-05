import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearRoomSession,
  getRoomSession,
  listRoomSessions,
  saveRoomSession,
} from './room-session';

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
  key: (index: number) => Object.keys(storage)[index] ?? null,
  get length() {
    return Object.keys(storage).length;
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

  describe('listRoomSessions', () => {
    it('returns an empty array when no sessions are stored', () => {
      expect(listRoomSessions()).toEqual([]);
    });

    it('returns every stored session', () => {
      saveRoomSession({ code: 'ABCD2', playerId: 'player-1', token: 'token-1' });
      saveRoomSession({ code: 'WXYZ2', playerId: 'player-2', token: 'token-2' });

      const sessions = listRoomSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions).toEqual(
        expect.arrayContaining([
          { code: 'ABCD2', playerId: 'player-1', token: 'token-1' },
          { code: 'WXYZ2', playerId: 'player-2', token: 'token-2' },
        ])
      );
    });

    it('ignores unrelated localStorage entries', () => {
      saveRoomSession({ code: 'ABCD2', playerId: 'player-1', token: 'token-1' });
      localStorage.setItem('trivia:some-other-key', 'value');

      expect(listRoomSessions()).toEqual([
        { code: 'ABCD2', playerId: 'player-1', token: 'token-1' },
      ]);
    });
  });
});
