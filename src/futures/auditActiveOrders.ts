import { Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';

/** Read-only pre-release audit. Never cancels, re-margins or repairs live data. */
export async function auditActiveFuturesOrders(prisma: PrismaClient) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
    const orders = await tx.futuresOrder.findMany({ where: { status: { in: ['OPEN', 'PARTIALLY_FILLED'] } } });
    const positions = await tx.futuresPosition.findMany({ where: { status: 'OPEN' } });
    const issues: { orderId: string; reason: string }[] = [];
    for (const order of orders) {
      const size = new BigNumber(order.remainingQuantity.toString());
      if (!size.isGreaterThan(0) || order.type !== 'LIMIT' || !order.price) {
        issues.push({ orderId: order.id, reason: 'Invalid active order shape' });
        continue;
      }
      const bucket = (row: { userId: string; symbol: string; marginType: string }) =>
        row.userId === order.userId && row.symbol === order.symbol && row.marginType === order.marginType;
      const position = positions.find(bucket);
      const direction = order.side === 'BUY' ? 'LONG' : 'SHORT';
      if (order.reduceOnly) {
        if (!position || position.side === direction || size.isGreaterThan(position.size.toString())) {
          issues.push({ orderId: order.id, reason: 'Stale reduce-only remainder (execution will cancel excess)' });
        }
      } else {
        if (position?.side === direction && position.leverage !== order.leverage) {
          issues.push({ orderId: order.id, reason: 'Leverage incompatible with existing position' });
        }
        if (orders.some(other => other.id !== order.id && bucket(other) && !other.reduceOnly
          && other.side === order.side && new BigNumber(other.remainingQuantity.toString()).isGreaterThan(0)
          && other.leverage !== order.leverage)) {
          issues.push({ orderId: order.id, reason: 'Incompatible same-side pending leverage' });
        }
      }
    }
    return issues;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

if (require.main === module) {
  // Explicit opt-in URL; never silently use the application's DATABASE_URL.
  const url = process.env.FUTURES_AUDIT_DATABASE_URL;
  if (!url) throw new Error('Set FUTURES_AUDIT_DATABASE_URL explicitly for the read-only audit');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  auditActiveFuturesOrders(prisma).then(issues => {
    console.log(JSON.stringify({ activeOrderIssues: issues }, null, 2));
    process.exitCode = issues.length ? 1 : 0;
  }).catch(() => {
    console.error('Futures audit failed; no release clearance. Check connectivity/permissions privately.');
    process.exitCode = 2;
  }).finally(() => prisma.$disconnect());
}
