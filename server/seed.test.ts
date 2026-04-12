import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks so they're available inside vi.mock factories.
const mockCount = vi.hoisted(() => vi.fn());
const mockInsertReturning = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());

// Mock drizzle's chained query builders. seedQuestions() uses:
//   db.select({ count: ... }).from(questions)          ← empty-table guard
//   db.transaction(async (tx) => { tx.insert(...) })   ← atomic first-run seed
vi.mock('./db', () => {
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: mockInsertReturning,
  };
  const selectChain = { from: mockCount };

  return {
    db: {
      select: vi.fn(() => selectChain),
      // Execute the callback immediately with a tx that has the same insert chain.
      transaction: mockTransaction,
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
  mockTransaction.mockReset();

  // Default: transaction executes the callback with a tx that has insert.
  mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      insert: vi.fn(() => ({
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        returning: mockInsertReturning,
      })),
    };
    return cb(tx);
  });
});

describe('seedQuestions — STE-145 republish-revert fix', () => {
  it('skips seeding entirely when the questions table is non-empty', async () => {
    mockCount.mockResolvedValueOnce([{ count: 42 }]);

    await seedQuestions();

    // The early-return guard fires — we should never even open a transaction.
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockInsertReturning).not.toHaveBeenCalled();
  });

  it('proceeds with seeding inside a transaction when the questions table is empty', async () => {
    mockCount.mockResolvedValueOnce([{ count: 0 }]);
    // Pretend every batch inserts one row so the returning() resolves cleanly.
    mockInsertReturning.mockResolvedValue([{ id: 'fake' }]);

    await seedQuestions();

    // The transaction must have been opened exactly once.
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // And inserts must have run inside it.
    expect(mockInsertReturning).toHaveBeenCalled();
  });

  it('rolls back automatically if a mid-seed batch throws', async () => {
    mockCount.mockResolvedValueOnce([{ count: 0 }]);

    // Simulate db.transaction propagating the error (real Drizzle rolls back on throw).
    mockTransaction.mockRejectedValueOnce(new Error('simulated mid-seed failure'));

    // seedQuestions() catches the error internally and logs — it must not throw.
    await expect(seedQuestions()).resolves.toBeUndefined();
  });
});
