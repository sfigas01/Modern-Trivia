import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getGuestSeenIds, addGuestSeenIds } from './guest-seen';

const storage: Record<string, string> = {};

function stubWorkingLocalStorage() {
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
}

describe('guest-seen', () => {
  beforeEach(() => {
    for (const key of Object.keys(storage)) delete storage[key];
    stubWorkingLocalStorage();
  });

  it('returns an empty array when nothing has been seen', () => {
    expect(getGuestSeenIds()).toEqual([]);
  });

  it('adds and retrieves seen ids', () => {
    addGuestSeenIds(['q1', 'q2']);
    expect(getGuestSeenIds()).toEqual(['q1', 'q2']);
  });

  it('appends new ids after existing ones', () => {
    addGuestSeenIds(['q1', 'q2']);
    addGuestSeenIds(['q3']);
    expect(getGuestSeenIds()).toEqual(['q1', 'q2', 'q3']);
  });

  it('moves a re-seen id to the newest position instead of duplicating it', () => {
    addGuestSeenIds(['q1', 'q2', 'q3']);
    addGuestSeenIds(['q1']);
    expect(getGuestSeenIds()).toEqual(['q2', 'q3', 'q1']);
  });

  it('does nothing when given an empty array', () => {
    addGuestSeenIds(['q1']);
    addGuestSeenIds([]);
    expect(getGuestSeenIds()).toEqual(['q1']);
  });

  it('evicts the oldest ids once the cap of 500 is exceeded (FIFO)', () => {
    const first500 = Array.from({ length: 500 }, (_, i) => `q${i}`);
    addGuestSeenIds(first500);
    expect(getGuestSeenIds()).toHaveLength(500);

    addGuestSeenIds(['q500', 'q501']);
    const result = getGuestSeenIds();

    expect(result).toHaveLength(500);
    // Oldest two (q0, q1) should have been evicted to make room.
    expect(result).not.toContain('q0');
    expect(result).not.toContain('q1');
    // Newest entries should be present.
    expect(result).toContain('q500');
    expect(result).toContain('q501');
    expect(result[result.length - 1]).toBe('q501');
  });

  it('degrades gracefully to a no-op when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(() => getGuestSeenIds()).not.toThrow();
    expect(getGuestSeenIds()).toEqual([]);

    expect(() => addGuestSeenIds(['q1'])).not.toThrow();
    expect(getGuestSeenIds()).toEqual([]);
  });

  it('resets to empty when stored JSON is malformed', () => {
    storage['modern-trivia:guest-seen:v1'] = '{not valid json';
    expect(getGuestSeenIds()).toEqual([]);

    // Should still be able to write fresh history afterward.
    addGuestSeenIds(['q1']);
    expect(getGuestSeenIds()).toEqual(['q1']);
  });

  it('trims whitespace and drops empty/duplicate ids within a single call', () => {
    addGuestSeenIds([' q1 ', 'q2', 'q2', '  ', 'q1']);
    expect(getGuestSeenIds()).toEqual(['q1', 'q2']);
  });

  it('degrades gracefully when localStorage throws (e.g. private browsing quota)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
      clear: () => {},
    });

    expect(() => getGuestSeenIds()).not.toThrow();
    expect(getGuestSeenIds()).toEqual([]);
    expect(() => addGuestSeenIds(['q1'])).not.toThrow();
  });
});
