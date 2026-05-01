import { vi, type Mock } from 'vitest';

export type QueryMock<T> = PromiseLike<T> & {
  from: Mock;
  leftJoin: Mock;
  limit: Mock;
  offset: Mock;
  onConflictDoNothing: Mock;
  onConflictDoUpdate: Mock;
  orderBy: Mock;
  returning: Mock;
  set: Mock;
  values: Mock;
  where: Mock;
};

export function createQueryMock<T>(result: T): QueryMock<T> {
  const promise = Promise.resolve(result);
  const query = {
    from: vi.fn(() => query),
    leftJoin: vi.fn(() => query),
    limit: vi.fn(() => query),
    offset: vi.fn(() => query),
    onConflictDoNothing: vi.fn(() => query),
    onConflictDoUpdate: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    returning: vi.fn(() => Promise.resolve(result)),
    set: vi.fn(() => query),
    then: promise.then.bind(promise),
    values: vi.fn(() => query),
    where: vi.fn(() => query),
  };

  return query;
}
