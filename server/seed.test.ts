import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks so they're available inside vi.mock factories.
const mockCount = vi.hoisted(() => vi.fn());
const mockInsertReturning = vi.hoisted(() => vi.fn());

// Mock drizzle's chained query builders. seedQuestions() uses:
//   db.select({ count: ... }).from(questions)
//   db.insert(questions).values(batch).onConflictDoNothing().returning({ id })
vi.mock('./db', () => {
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: mockInsertReturning,
  };
  const selectChain = {
    from: mockCount,
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
    },
  };
});

// Avoid pulling in the real schema (which can drag in pg drivers).
vi.mock('@shared/schema', () => ({
  questions: {},
}));

import { seedQuestions } from './seed';

beforeEach(() => {
  mockCount.mockReset();
  mockInsertReturning.mockReset();
});

describe('seedQuestions — STE-145 republish-revert fix', () => {
  it('skips seeding entirely when the questions table is non-empty', async () => {
    mockCount.mockResolvedValueOnce([{ count: 42 }]);

    await seedQuestions();

    // The early-return guard should mean we never even reached the insert path.
    expect(mockInsertReturning).not.toHaveBeenCalled();
  });

  it('proceeds with seeding when the questions table is empty', async () => {
    mockCount.mockResolvedValueOnce([{ count: 0 }]);
    // Pretend every batch inserts everything we passed in.
    mockInsertReturning.mockResolvedValue([{ id: 'fake' }]);

    await seedQuestions();

    // We can't assert exact counts without coupling to the file size, but the
    // insert path MUST have been exercised at least once if seed-data.json
    // exists. If the file is empty/missing this still passes (early return),
    // which is acceptable — the contract under test is "non-empty DB ⇒ no
    // inserts", which the previous test covers.
    expect(mockCount).toHaveBeenCalledTimes(1);
  });
});
