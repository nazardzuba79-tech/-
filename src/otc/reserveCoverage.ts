import { Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { OtcError } from './policy';

/** Admission-only reconciliation, not a repair. Lock the actual asset row,
 * then inspect committed obligations; a legacy deficit must not be hidden by
 * adding a fresh OTC hold. Other products use atomic deltas against this row. */
export async function assertReserveCoverage(tx: Prisma.TransactionClient, userId: string, asset: string, lockBalance = true) {
  const [balance] = lockBalance ? await tx.$queryRaw<{ locked: string; available: string }[]>`
    SELECT locked::text,available::text FROM "Balance" WHERE "userId"=${userId} AND asset=${asset} FOR UPDATE`
    : await tx.$queryRaw<{ locked: string; available: string }[]>`SELECT locked::text,available::text FROM "Balance" WHERE "userId"=${userId} AND asset=${asset}`;
  if (!balance) {
    if (!lockBalance) throw new OtcError('MISSING_WALLET_ROW');
    return; // Conditional debit below reports insufficient funds.
  }
  if ([balance.available,balance.locked].some(value=>!new BigNumber(value).isFinite()||new BigNumber(value).lt(0)))
    throw new OtcError('INVALID_WALLET_STATE');
  const orders = await tx.order.findMany({ where: { userId, status: { in: ['OPEN','PARTIALLY_FILLED','PENDING_TRIGGER'] } } });
  for (const order of orders.filter(o=>o.status==='PENDING_TRIGGER'&&o.ocoGroupId)) {
    const siblings=orders.filter(o=>o.ocoGroupId===order.ocoGroupId);
    if (siblings.length!==2 || siblings.some(o=>o.status!=='PENDING_TRIGGER'||o.pair!==order.pair||o.side!==order.side))
      throw new OtcError('LEGACY_OCO_RECONCILIATION_REQUIRED');
  }
  const ids = orders.map(o => o.id);
  const fills = ids.length ? await tx.trade.findMany({ where: { OR: [{ makerOrderId: { in: ids } }, { takerOrderId: { in: ids } }] },
    select: { makerOrderId: true, takerOrderId: true, quantity: true } }) : [];
  const filled = new Map<string,BigNumber>();
  for (const trade of fills) for (const id of [trade.makerOrderId,trade.takerOrderId]) filled.set(id,(filled.get(id) ?? new BigNumber(0)).plus(trade.quantity.toString()));
  const groups = new Map<string,BigNumber>();
  for (const order of orders) {
    const [base,quote] = order.pair.split('/');
    if ((order.side === 'BUY' ? quote : base) !== asset) continue;
    const remaining = new BigNumber(order.remainingQuantity.toString());
    if (!remaining.gt(0) || !new BigNumber(order.originalQuantity.toString()).minus(filled.get(order.id) ?? 0).eq(remaining))
      throw new OtcError('LEGACY_ORDER_RECONCILIATION_REQUIRED');
    let held: BigNumber;
    if (order.status === 'PENDING_TRIGGER') held = new BigNumber(order.lockedAmount?.toString() ?? 'NaN');
    else {
      if (order.type !== 'LIMIT') throw new OtcError('LEGACY_ORDER_RECONCILIATION_REQUIRED');
      held = order.side === 'BUY' ? remaining.times(order.price?.toString() ?? 'NaN') : remaining;
    }
    if (!held.isFinite() || !held.gt(0)) throw new OtcError('LEGACY_ORDER_RECONCILIATION_REQUIRED');
    const key = order.status === 'PENDING_TRIGGER' && order.ocoGroupId ? `oco:${order.ocoGroupId}` : order.id;
    if (groups.has(key) && !groups.get(key)!.eq(held)) throw new OtcError('LEGACY_OCO_RECONCILIATION_REQUIRED');
    groups.set(key,held);
  }
  const withdrawals = await tx.withdrawal.aggregate({ where: { userId, asset, balanceHeld: true, status: { in: ['PENDING','APPROVED'] } }, _sum: { amount: true } });
  const otc = await tx.otcCashReservation.aggregate({ where: { asset, status: 'HELD', request: { userId } }, _sum: { quantity: true } });
  const required = [...groups.values()].reduce((sum,x) => sum.plus(x), new BigNumber(withdrawals._sum.amount?.toString() ?? '0'))
    .plus(otc._sum.quantity?.toString() ?? '0');
  // Unexplained excess is also a reconciliation matter, not spendable money.
  if (!required.eq(balance.locked)) throw new OtcError('WALLET_RECONCILIATION_REQUIRED');
}
