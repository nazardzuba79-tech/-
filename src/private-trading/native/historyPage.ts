import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { demoPositionView, emptyDemoState, migrateDemoState, type DemoPosition } from './engine';
import { PrivateTradingError } from '../serviceTypes';

export const historyQuery = z.object({
  kind: z.enum(['positions', 'orders', 'events', 'entries']),
  symbol: z.string().regex(/^[A-Z0-9]{1,32}$/).optional(),
  revision: z.coerce.number().int().positive(),
  cursor: z.string().max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});
export type HistoryQuery = z.infer<typeof historyQuery>;
const cursorSchema = z.object({ revision: z.number().int(), kind: historyQuery.shape.kind,
  symbol: z.string(), time: z.number().finite(), ordinal: z.number().int().positive() });

/** Keyset pagination over ONE immutable revision. Only the requested page
 * crosses the DB connection; commands are projected to entry-candle metadata. */
export async function nativeHistoryPage(db: PrismaClient, userId: string, query: HistoryQuery) {
  let c:z.infer<typeof cursorSchema>|null=null;
  try{c=query.cursor?cursorSchema.parse(JSON.parse(Buffer.from(query.cursor,'base64url').toString())):null;}
  catch{throw new PrivateTradingError('invalid_history_cursor','Обновите историю',400);}
  if (c && (c.revision !== query.revision || c.kind !== query.kind || c.symbol !== (query.symbol ?? '')))
    throw new PrivateTradingError('invalid_history_cursor','Обновите историю',400);
  const revision=await db.nativeDemoRevision.findUnique({where:{userId_revision:{userId,revision:query.revision}},select:{revision:true}});
  if(!revision)throw new PrivateTradingError('history_revision_missing','Обновите историю',404);
  const path = query.kind === 'entries' ? ['commands'] : ['snapshot', query.kind];
  const source = query.kind === 'positions' ? Prisma.sql`v->>'status' != 'OPEN'`
    : query.kind === 'orders' ? Prisma.sql`v->>'status' NOT IN ('OPEN','PARTIALLY_FILLED')`
    : query.kind === 'entries' ? Prisma.sql`v->>'kind' = 'OPEN'` : Prisma.sql`TRUE`;
  const symbol = query.kind === 'entries' ? Prisma.sql`v->'order'->>'symbol'` : Prisma.sql`v->>'symbol'`;
  const time = query.kind === 'positions' ? Prisma.sql`COALESCE((v->>'closedAt')::bigint,(v->>'openedAt')::bigint)`
    : query.kind === 'orders' ? Prisma.sql`(v->>'createdAt')::bigint`
    : query.kind === 'entries' ? Prisma.sql`(v->>'at')::bigint` : Prisma.sql`(v->>'time')::bigint`;
  const value = query.kind === 'entries' ? Prisma.sql`jsonb_build_object('positionId',v->'order'->'id','candle',v->'candle')` : Prisma.sql`v`;
  const rows = await db.$queryRaw<{ value: unknown; time: bigint; ordinal: bigint }[]>(Prisma.sql`
    SELECT ${value} AS value, ${time} AS time, ordinal
    FROM "NativeDemoRevision" r,
      LATERAL jsonb_array_elements(r."payload" #> ARRAY[${Prisma.join(path)}]::text[]) WITH ORDINALITY AS items(v,ordinal)
    WHERE r."userId"=${userId} AND r."revision"=${query.revision} AND ${source}
      ${query.symbol ? Prisma.sql`AND ${symbol}=${query.symbol}` : Prisma.empty}
      ${c ? Prisma.sql`AND (${time},ordinal)<(${c.time}::bigint,${c.ordinal}::bigint)` : Prisma.empty}
    ORDER BY time DESC, ordinal DESC LIMIT ${query.limit + 1}`);
  const page = rows.slice(0, query.limit), last = page.at(-1);
  const values = page.map(row => {
    if (query.kind !== 'positions') return row.value;
    const state = migrateDemoState({ ...emptyDemoState('0', 0), version: 1, positions: [row.value as DemoPosition] });
    return demoPositionView(state, state.positions[0]);
  });
  return { revision: query.revision, kind: query.kind, items: values,
    nextCursor: rows.length > query.limit && last ? Buffer.from(JSON.stringify({ revision: query.revision,
      kind: query.kind, symbol: query.symbol ?? '', time: Number(last.time), ordinal: Number(last.ordinal) })).toString('base64url') : null };
}
