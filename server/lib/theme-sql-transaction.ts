import { sql, type SQL } from 'drizzle-orm';
import type { PoolClient } from 'pg';

/** Preserve parameter binding when sharing the small PostgreSQL helpers with a Drizzle transaction. */
export function themeSqlTransaction(tx: {
  execute: (query: SQL) => Promise<unknown>;
}): Pick<PoolClient, 'query'> {
  return {
    query: (async (text: string, values: unknown[] = []) => {
      const chunks = text
        .split(/\$(\d+)/g)
        .map((part, index) => (index % 2 ? sql`${values[Number(part) - 1]}` : sql.raw(part)));
      return tx.execute(sql.join(chunks, sql.raw('')));
    }) as PoolClient['query'],
  };
}
