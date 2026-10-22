import { Prisma, PrismaClient } from '@prisma/client';
import { assertReserveCoverage } from './reserveCoverage';
import { OtcError } from './policy';
import BigNumber from 'bignumber.js';
import { assertRestorableSpotOrder } from '../services/SpotBookTransaction';

/** Operator-invoked, never scheduled. Requires the additive OTC migration.
 * One consistent SQL-enforced READ ONLY snapshot; no repair/cancel/write. */
export async function auditSpotReserves(db: PrismaClient) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [mode] = await tx.$queryRaw<{ readOnly: string }[]>`SELECT current_setting('transaction_read_only') AS "readOnly"`;
    if (mode.readOnly !== 'on') throw new Error('READ_ONLY_REQUIRED');
    const keys = await tx.$queryRaw<{ userId: string; asset: string }[]>`
      SELECT "userId", asset FROM "Balance"
      UNION SELECT "userId", CASE WHEN side='BUY' THEN split_part(pair,'/',2) ELSE split_part(pair,'/',1) END
        FROM "Order" WHERE status IN ('OPEN','PARTIALLY_FILLED','PENDING_TRIGGER')
      UNION SELECT "userId", asset FROM "Withdrawal" WHERE "userId" IS NOT NULL AND "balanceHeld" AND status IN ('PENDING','APPROVED')
      UNION SELECT r."userId", s.asset FROM "OtcCashReservation" s JOIN "OtcCashRequest" r ON r.id=s."requestId" WHERE s.status='HELD'`;
    const issues: { userId: string; asset: string; category: string; activeOrderIds: string[] }[] = [];
    // Run before admitting ANY shared-wallet/Spot writer, not just OTC. Reserve
    // arithmetic alone misses e.g. a SELL maker with a null/negative limit price.
    const orders = await tx.order.findMany({ where: { status: { in: ['OPEN','PARTIALLY_FILLED','PENDING_TRIGGER'] } } });
    const trades = await tx.trade.findMany({ select: { id:true, makerOrderId:true, takerOrderId:true, quantity:true } });
    const filled = new Map<string, BigNumber>();
    for (const trade of trades) for (const id of [trade.makerOrderId, trade.takerOrderId])
      filled.set(id, (filled.get(id) ?? new BigNumber(0)).plus(trade.quantity.toString()));
    for (const order of orders) {
      const [base, quote, extra] = order.pair.split('/');
      let invalid = !base || !quote || !!extra || !['BUY','SELL'].includes(order.side);
      if (order.status !== 'PENDING_TRIGGER') {
        try { assertRestorableSpotOrder(order, filled.get(order.id) ?? new BigNumber(0)); }
        catch { invalid = true; }
      } else {
        const positive = (value: { toString(): string } | null) => value !== null && new BigNumber(value.toString()).isFinite() && new BigNumber(value.toString()).gt(0);
        invalid ||= !['STOP_LIMIT','STOP_MARKET','TAKE_PROFIT_LIMIT','TAKE_PROFIT_MARKET'].includes(order.type)
          || !positive(order.triggerPrice) || !positive(order.lockedAmount)
          || order.lockedAsset !== (order.side === 'BUY' ? quote : base)
          || (order.type.endsWith('_LIMIT') && !positive(order.price))
          || !positive(order.remainingQuantity)
          || !new BigNumber(order.originalQuantity.toString()).minus(filled.get(order.id) ?? 0).eq(order.remainingQuantity.toString());
      }
      if (invalid) issues.push({ userId:order.userId, asset:order.side === 'BUY' ? quote ?? '' : base ?? '',
        category:'LEGACY_ORDER_RECONCILIATION_REQUIRED', activeOrderIds:[order.id] });
    }
    // Include historical executions, not just fills still attached to active makers.
    // IDs only: no account emails, credentials or automatic historical repair.
    const invalidTrades = await tx.$queryRaw<{ id:string; makerOrderId:string; takerOrderId:string }[]>`
      SELECT t.id, t."makerOrderId", t."takerOrderId" FROM "Trade" t
      LEFT JOIN "Order" m ON m.id=t."makerOrderId" LEFT JOIN "Order" k ON k.id=t."takerOrderId"
      WHERE m.id IS NULL OR k.id IS NULL OR m.id=k.id OR m.side=k.side
        OR t.quantity<=0 OR t.price<=0 OR t.pair<>m.pair OR t.pair<>k.pair
        OR t."makerUserId"<>m."userId" OR t."takerUserId"<>k."userId"`;
    for (const key of keys) {
      try { await assertReserveCoverage(tx, key.userId, key.asset, false); }
      catch (error) {
        if (!(error instanceof OtcError)) throw error;
        const orders = await tx.order.findMany({ where: { userId: key.userId, status: { in:['OPEN','PARTIALLY_FILLED','PENDING_TRIGGER'] } }, select:{id:true} });
        issues.push({ ...key, category:error.code, activeOrderIds:orders.map(o=>o.id) });
      }
    }
    const executionIssues = invalidTrades.map(t => ({ category:'LEGACY_TRADE_RECONCILIATION_REQUIRED',
      tradeId:t.id, orderIds:[t.makerOrderId,t.takerOrderId] }));
    return { result:issues.length || executionIssues.length?'ISSUES_FOUND':'CLEAN', walletsExamined:keys.length,
      activeOrdersExamined:orders.length, tradesExamined:trades.length, issues:[...issues,...executionIssues], readOnly:true, rowsChanged:0 };
  }, { isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead, timeout:120000, maxWait:10000 });
}

async function main() {
  const url = process.env.OTC_AUDIT_DATABASE_URL;
  if (!url) { console.error('OTC_AUDIT_DATABASE_URL_REQUIRED'); process.exitCode=1; return; }
  // Explicit override only. DATABASE_URL is never a fallback; no dotenv import.
  const db = new PrismaClient({ datasources:{db:{url}}, log:[] });
  try { const result=await auditSpotReserves(db); console.log(JSON.stringify(result,null,2)); process.exitCode=result.issues.length?2:0; }
  catch { console.error('OTC_READ_ONLY_AUDIT_FAILED'); process.exitCode=1; }
  finally { await db.$disconnect(); }
}
if (require.main === module) void main();
