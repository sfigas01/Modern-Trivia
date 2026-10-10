import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStableGuestSubjectId } from './guest-subject';

const STORAGE_KEY = 'trivia:guest-subject:v1';
const UUID = 'f3a31e9c-6e8a-4a61-a24b-6882ef4b12c7';

describe('getStableGuestSubjectId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates and persists an opaque UUID, then reuses it', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const randomUUID = vi.fn(() => UUID);
    vi.stubGlobal('crypto', { randomUUID });

    expect(getStableGuestSubjectId()).toBe(UUID);
    expect(getStableGuestSubjectId()).toBe(UUID);
    expect(values.get(STORAGE_KEY)).toBe(UUID);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('replaces malformed stored values', () => {
    const values = new Map([[STORAGE_KEY, 'not-a-uuid']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal('crypto', { randomUUID: () => UUID });

    expect(getStableGuestSubjectId()).toBe(UUID);
    expect(values.get(STORAGE_KEY)).toBe(UUID);
  });
});
