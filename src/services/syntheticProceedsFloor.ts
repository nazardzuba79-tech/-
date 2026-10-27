import { Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';

type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;
export interface FloorPriceSource { getTicker(pair: string): Promise<{ lastPrice: string } | null> }

/**
 * LEGACY SYNTHETIC SPOT PROCEEDS (Issue #617).
 *
 * Until #625 a MARKET SELL of a simulated asset (NRX, a managed listing) by the
 * owner or a team test account was bought by the house at the MODEL price and
 * the USDT credited to `Balance` — the trade's maker is `simulation:<base>`.
 * That USDT is backed by nothing. Nothing here debits, zeroes or relabels it
 * (that needs the owner's reconciliation plan): it stays in the account, but it
 * may not leave the account as real value.
 *
 * The rule: an account whose `Balance` received S USDT that way keeps at least
 * S of real value after every withdrawal (create, approve, sent) and after every
 * Spot order that lowers its worst-case value. Its genuine funds above S stay
 * free. An account with S = 0 — every ordinary customer — is never priced,
 * locked or refused here.
 *
 * Real value counts only FLOOR_VALUED assets at the venue's last price; any
 * other asset counts zero (a listing or test asset, whatever the registry
 * knows), so buying one with floor-bound value is a loss, and a cold or stale
 * listing registry cannot make a minted token look real. Value leaving the
 * account (open withdrawals, held OTC reserves) is subtracted, and every open
 * Spot order is taken at its worst outcome.
 */
export const FLOOR_VALUED: readonly string[] = ['USDT', 'USDC', 'BTC', 'ETH'];
const SIMULATION_ACTIONS = ['NRX_SIMULATION_SOLD', 'TEAM_SPOT_SIMULATION_SOLD'];

export class SyntheticProceedsLockedError extends Error {
  readonly code = 'SYNTHETIC_PROCEEDS_LOCKED';
  constructor(message = 'Simulated sale proceeds on this account cannot leave it') { super(message); }
}

export type FloorMarks = Map<string, BigNumber>;

/**
 * USDT credited to this account's `Balance` by house-bought sales of anything that is not a real valued asset.
 * Every version of that sale wrote its audit row (`pair`, `proceeds`) in the same transaction as the credit; a
 * sale settled into DemoBalance (#625's opt-in) says so and taints nothing. Read through the AuditLog `userId`
 * and `action` indexes, so the Spot order path pays one small indexed read; 0 for an account that never sold.
 */
export async function syntheticProceeds(db: Db, userId: string): Promise<BigNumber> {
  const rows = await db.$queryRaw<{ v: string }[]>`
    SELECT COALESCE(SUM((metadata->>'proceeds')::numeric), 0)::text AS v FROM "AuditLog"
    WHERE "userId" = ${userId} AND action = ANY(${SIMULATION_ACTIONS})
      AND split_part(metadata->>'pair', '/', 2) = 'USDT' AND NOT (split_part(metadata->>'pair', '/', 1) = ANY(${[...FLOOR_VALUED]}))
      AND COALESCE(metadata->>'settlementLedger', 'Balance') <> 'DemoBalance'`;
  return new BigNumber(rows[0]?.v ?? '0');
}

/** The account's floor (S) and the marks to judge it, or null for an account with nothing synthetic. */
export async function prepareFloor(db: Db, userId: string, prices?: FloorPriceSource): Promise<FloorMarks | null> {
  if ((await syntheticProceeds(db, userId)).isZero()) return null;
  // Floor-bound and unpriced: refuse rather than guess (a missing mark must never value an asset at zero on its way out).
  if (!prices) throw new SyntheticProceedsLockedError('Prices are unavailable; this account cannot move value now');
  const marks: FloorMarks = new Map([['USDT', new BigNumber(1)]]);
  for (const asset of FLOOR_VALUED.filter(a => a !== 'USDT')) {
    const ticker = await prices.getTicker(`${asset}/USDT`).catch(() => null);
    const mark = new BigNumber(ticker?.lastPrice ?? NaN);
    if (!mark.isFinite() || mark.lte(0)) throw new SyntheticProceedsLockedError('Prices are unavailable; this account cannot move value now');
    marks.set(asset, mark);
  }
  return marks;
}

const markOf = (marks: FloorMarks, asset: string) => marks.get(asset) ?? new BigNumber(0);
const num = (v: unknown) => new BigNumber(v === null || v === undefined ? NaN : String(v));

/** Worst-case real value of the account (USDT). Call inside the transaction, after `lockFloor`. */
export async function floorValue(tx: Tx, userId: string, marks: FloorMarks): Promise<BigNumber> {
  let value = new BigNumber(0);
  for (const b of await tx.balance.findMany({ where: { userId } })) value = value.plus(num(b.available).plus(num(b.locked)).times(markOf(marks, b.asset)));
  // Leaving the account: requested withdrawals that hold Balance, and held OTC reserves.
  for (const w of await tx.withdrawal.findMany({ where: { userId, status: { in: ['PENDING', 'APPROVED'] }, balanceHeld: true } })) {
    value = value.minus(num(w.amount).times(markOf(marks, w.asset)));
  }
  const otc = await tx.otcCashReservation.findMany({ where: { status: 'HELD', request: { userId } } });
  for (const r of otc) value = value.minus(num(r.quantity).times(markOf(marks, r.asset)));
  // Every open Spot order at its worst fill: a BUY pays its price for what the base is worth, a SELL the reverse;
  // a MARKET-family conditional spends its whole hold (BUY) or gets nothing (SELL).
  const open = await tx.order.findMany({ where: { userId, status: { in: ['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'] } } });
  // The two legs of an OCO share one hold and only one can fill: count the worse leg once.
  const worstOco = new Map<string, BigNumber>();
  for (const o of open) {
    const [base, quote] = o.pair.split('/');
    const r = num(o.remainingQuantity), mb = markOf(marks, base), mq = markOf(marks, quote);
    let delta: BigNumber;
    if (o.price !== null) delta = o.side === 'BUY' ? r.times(mb).minus(r.times(num(o.price)).times(mq)) : r.times(num(o.price)).times(mq).minus(r.times(mb));
    else if (o.side === 'BUY') delta = num(o.lockedAmount ?? 0).times(mq).negated();
    else delta = r.times(mb).negated();
    if (!delta.isFinite()) throw new SyntheticProceedsLockedError();
    if (!delta.isNegative()) continue;
    if (o.ocoGroupId) worstOco.set(o.ocoGroupId, BigNumber.minimum(worstOco.get(o.ocoGroupId) ?? 0, delta));
    else value = value.plus(delta);
  }
  for (const delta of worstOco.values()) value = value.plus(delta);
  return value;
}

/**
 * A token the owner was allocated for a managed listing or NRX: minted by VOLTEX, never a real asset. Read from
 * the durable allocation receipts, so it holds while the in-memory listing registry is cold or stale.
 */
export async function isMintedListingAsset(db: Db, asset: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM "AuditLog" WHERE action IN ('LISTING_OWNER_ALLOCATION', 'NRX_OWNER_ALLOCATION')
      AND upper(metadata->>'asset') = upper(${asset.trim()})`;
  return (rows[0]?.n ?? 0) > 0;
}

/** One floor-bound outflow at a time per account (withdrawals, OTC and Spot orders). */
export async function lockFloor(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`synthetic-floor:${userId}`}, 0))::text`;
}

/**
 * Refuse when the account would end below its floor. `before` (the value at the start of the same
 * transaction) lets an order that does not lower the value through even when the account is already
 * under the floor — e.g. selling a listing allocation for real USDT. A withdrawal passes no `before`.
 */
export async function assertFloor(tx: Tx, userId: string, marks: FloorMarks, before?: BigNumber): Promise<void> {
  const floor = await syntheticProceeds(tx, userId);
  const after = await floorValue(tx, userId, marks);
  if (after.lt(floor) && (before === undefined || after.lt(before))) throw new SyntheticProceedsLockedError();
}
