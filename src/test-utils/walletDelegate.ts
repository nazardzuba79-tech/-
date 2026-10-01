import BigNumber from 'bignumber.js';

type Row = { available: string; locked: string };
/** Test-only Prisma decimal increment/conditional update semantics. PostgreSQL
 * integration tests separately cover actual locks, isolation and rollback. */
export function walletDelegate(rows: Map<string, Row>) {
  const key = (where: any) => {
    const w = where.userId_asset ?? where;
    return `${w.userId}:${w.asset}`;
  };
  const apply = (row: Row, data: any) => {
    for (const field of ['available', 'locked'] as const) {
      if (data[field] !== undefined) row[field] = typeof data[field] === 'object'
        ? new BigNumber(row[field]).plus(data[field].increment ?? 0).minus(data[field].decrement ?? 0).toFixed()
        : String(data[field]);
    }
    return { ...row };
  };
  return {
    findUnique: jest.fn(async ({ where }: any) => rows.has(key(where)) ? { ...rows.get(key(where))! } : null),
    findUniqueOrThrow: jest.fn(async ({ where }: any) => {
      const row = rows.get(key(where)); if (!row) throw new Error('Missing wallet fixture');
      return { asset: (where.userId_asset ?? where).asset, ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.get(key(where)); if (!row) throw new Error('Missing wallet fixture');
      return apply(row, data);
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const row = rows.get(key(where));
      if (!row || ['available', 'locked'].some(f => where[f]?.gte !== undefined
        && new BigNumber(row[f as keyof Row]).lt(where[f].gte))) return { count: 0 };
      apply(row, data); return { count: 1 };
    }),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const k = key(where);
      if (!rows.has(k)) rows.set(k, { available: String(create.available), locked: String(create.locked) });
      else apply(rows.get(k)!, update);
      return { ...rows.get(k)! };
    }),
  };
}
