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
const markOf = (marks: FloorMarks, asset: string) => marks.get(asset) ?? new BigNumber(0);
const num = (v: unknown) => new BigNumber(v === null || v === undefined ? NaN : String(v));

/**
 * USDT credited to this account's `Balance` by house-bought sales of anything that is not a real valued asset.
 * Every version of that sale wrote its audit row (`pair`, `proceeds`) in the same transaction as the credit; a
 * sale settled into DemoBalance (#625's opt-in) says so and taints nothing. Read through the AuditLog `userId`
 * index with the model API (no raw query on the shared client before the Spot transaction, whose commit-outcome
 * read is the only raw read there); an account that never sold reads no rows and gets 0.
 */
export async function syntheticProceeds(db: Db, userId: string): Promise<BigNumber> {
  const rows = await db.auditLog.findMany({ where: { userId, action: { in: SIMULATION_ACTIONS } }, select: { metadata: true } });
  let total = new BigNumber(0);
  for (const { metadata } of rows) {
    const m = (metadata ?? {}) as Record<string, unknown>;
    if (m.settlementLedger === 'DemoBalance') continue;
    const parts = String(m.pair ?? '').split('/');
    const [base, quote] = parts;
    if (parts.length !== 2 || !base || !quote) throw new SyntheticProceedsLockedError('Unreconciled simulation receipt');
    if (quote !== 'USDT' || FLOOR_VALUED.includes(base)) continue;
    const proceeds = num(m.proceeds);
    // A receipt whose amount cannot be read is never counted as zero.
    if (!proceeds.isFinite() || proceeds.isNegative()) throw new SyntheticProceedsLockedError();
    total = total.plus(proceeds);
  }
  return total;
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

/** Worst-case real value of the account (USDT). Call inside the transaction, after `lockFloor`. */
export async function floorValue(tx: Tx, userId: string, marks: FloorMarks, ignoreOrders: ReadonlySet<string> = new Set()): Promise<BigNumber> {
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
    if (ignoreOrders.has(o.id)) continue;
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
  if (!value.isFinite()) throw new SyntheticProceedsLockedError('Unreconciled wallet value');
  return value;
}

/**
 * A token the owner was allocated for a managed listing or NRX: minted by VOLTEX, never a real asset. Read from
 * the durable allocation receipts, so it holds while the in-memory listing registry is cold or stale.
 */
export async function isMintedListingAsset(db: Db, asset: string): Promise<boolean> {
  const wanted = asset.trim().toUpperCase();
  if (!wanted) return false;
  const rows = await db.auditLog.findMany({ where: { action: { in: ['LISTING_OWNER_ALLOCATION', 'NRX_OWNER_ALLOCATION'] } }, select: { metadata: true } });
  return rows.some(({ metadata }) => {
    const a = (metadata as Record<string, unknown> | null)?.asset;
    return typeof a === 'string' && a.toUpperCase() === wanted;
  });
}

/** One floor-bound outflow at a time per account (withdrawals, OTC and Spot orders). */
export async function lockFloor(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`synthetic-floor:${userId}`}, 0))::text`;
}

/** Assets that count toward the floor when value LEAVES the account: realized stable cash only. */
export const FLOOR_CASH: readonly string[] = ['USDT', 'USDC'];

/**
 * Cash-out valuation for an account RELEASED_TO_FLOOR: the floor S must be covered by realized stable cash.
 * BTC/ETH held at an unrealized mark count zero, so a mark rise alone never unlocks synthetic USDT.
 */
export function cashOutMarks(marks: FloorMarks): FloorMarks {
  return new Map([...marks].filter(([asset]) => FLOOR_CASH.includes(asset)));
}

/**
 * PROVENANCE QUARANTINE (owner decision 2026-11-01, PR #630) — temporary containment, not confiscation.
 *
 * An account identified by immutable simulation-sale receipts (S > 0) is UNVERIFIED by default: no value
 * may leave it (withdrawal create/approve/SENT, OTC reserve/payout, Spot→Futures, Banking principal) and
 * no Spot order or fill may lower its worst-case value at the marks (overpaying a counterparty, self-trade
 * laundering). Value-neutral trades, views, cancellations and admin REJECT stay available. Nothing is
 * debited, frozen in the ledger, relabelled or deleted.
 *
 * Only an authenticated admin decision, recorded as an append-only audit row with a reason, changes it:
 * RELEASE_TO_FLOOR (provenance adjudicated: S stays locked, realized genuine cash above S is free) or
 * QUARANTINE (back on hold). The latest decision (highest seq) wins; each is reversible by the next.
 */
export const PROVENANCE_DECISION = 'SYNTHETIC_PROVENANCE_DECISION';
export type ProvenanceDecision = 'QUARANTINE' | 'RELEASE_TO_FLOOR';
export type ProvenanceStatus = 'CLEAR' | 'UNVERIFIED' | 'RELEASED_TO_FLOOR';

export class ProvenanceDecisionError extends Error {
  constructor(readonly code: 'NOT_IDENTIFIED' | 'INVALID_DECISION' | 'REQUEST_ID_REUSED', message: string) { super(message); }
}

interface DecisionRow { seq: number; decision: ProvenanceDecision; reason: string; adminId: string; requestId: string; at: string }

async function decisions(db: Db, userId: string): Promise<DecisionRow[]> {
  const rows = await db.auditLog.findMany({ where: { userId, action: PROVENANCE_DECISION }, select: { metadata: true, createdAt: true } });
  return rows.map(({ metadata, createdAt }): DecisionRow => {
    const m = (metadata ?? {}) as Record<string, unknown>;
    const seq = Number(m.seq), decision = m.decision, at = createdAt instanceof Date ? createdAt.toISOString() : '';
    // An unreadable decision row can never release anything.
    if (!Number.isSafeInteger(seq) || seq < 1 || (decision !== 'QUARANTINE' && decision !== 'RELEASE_TO_FLOOR')) {
      return { seq: Number.MAX_SAFE_INTEGER, decision: 'QUARANTINE' as const, reason: 'unreadable decision row', adminId: '', requestId: '', at };
    }
    return { seq, decision, reason: String(m.reason ?? ''), adminId: String(m.adminId ?? ''), requestId: String(m.requestId ?? ''), at };
  }).sort((a, b) => a.seq - b.seq);
}

/** CLEAR for every account without simulation-sale receipts; otherwise the latest admin decision, UNVERIFIED by default. */
export async function provenanceStatus(db: Db, userId: string): Promise<ProvenanceStatus> {
  if ((await syntheticProceeds(db, userId)).isZero()) return 'CLEAR';
  const latest = (await decisions(db, userId)).at(-1);
  return latest?.decision === 'RELEASE_TO_FLOOR' ? 'RELEASED_TO_FLOOR' : 'UNVERIFIED';
}

/** Admin view of one identified account: status and the full decision history (no balances, no personal data). */
export async function provenanceRecord(db: Db, userId: string) {
  return { status: await provenanceStatus(db, userId), decisions: await decisions(db, userId) };
}

/**
 * Append one decision. Serialized with every outflow of the account by the floor lock; replaying the same
 * requestId returns the recorded decision and writes nothing; reusing it for a different decision is refused.
 * Only accounts identified by simulation-sale receipts can be decided on. Writes nothing but the audit row.
 */
export async function recordProvenanceDecision(db: PrismaClient, input: { userId: string; adminId: string; decision: ProvenanceDecision; reason: string; requestId: string }) {
  const reason = input.reason.trim();
  if (input.decision !== 'QUARANTINE' && input.decision !== 'RELEASE_TO_FLOOR') throw new ProvenanceDecisionError('INVALID_DECISION', 'Unknown decision');
  if (reason.length < 10 || reason.length > 1000) throw new ProvenanceDecisionError('INVALID_DECISION', 'A review reason of 10-1000 characters is required');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId)) throw new ProvenanceDecisionError('INVALID_DECISION', 'Invalid requestId');
  return db.$transaction(async tx => {
    await lockFloor(tx, input.userId);
    if ((await syntheticProceeds(tx, input.userId)).isZero()) throw new ProvenanceDecisionError('NOT_IDENTIFIED', 'Account has no simulation-sale receipts');
    const history = await decisions(tx, input.userId);
    const replay = history.find(d => d.requestId === input.requestId);
    if (replay) {
      if (replay.decision !== input.decision || replay.reason !== reason || replay.adminId !== input.adminId) throw new ProvenanceDecisionError('REQUEST_ID_REUSED', 'requestId already used for a different decision');
      return { status: await provenanceStatus(tx, input.userId), replayed: true };
    }
    const seq = history.filter(d => d.seq !== Number.MAX_SAFE_INTEGER).length + 1;
    await tx.auditLog.create({ data: { userId: input.userId, action: PROVENANCE_DECISION,
      metadata: { seq, decision: input.decision, reason, adminId: input.adminId, requestId: input.requestId } } });
    return { status: await provenanceStatus(tx, input.userId), replayed: false };
  });
}

export class ProvenanceHoldError extends SyntheticProceedsLockedError {
  constructor() { super('This account is under provenance review; value cannot leave it until the review is complete'); }
}

/**
 * Refuse when the account would end below its floor. `before` (the value at the start of the same
 * transaction) marks a Spot order, judged at the marks; a cash-out passes no `before`.
 * UNVERIFIED (quarantine): every cash-out is refused, and a Spot change may not lower the value at all.
 * RELEASED_TO_FLOOR: a cash-out is judged on realized stable cash only (`cashOutMarks`); a Spot order may
 * not take the account below S unless it does not lower the value (e.g. selling a listing allocation).
 */
export async function assertFloor(tx: Tx, userId: string, marks: FloorMarks, before?: BigNumber): Promise<void> {
  const status = await provenanceStatus(tx, userId);
  if (status === 'CLEAR') return;
  if (status === 'UNVERIFIED') {
    if (before === undefined) throw new ProvenanceHoldError();
    if ((await floorValue(tx, userId, marks)).lt(before)) throw new ProvenanceHoldError();
    return;
  }
  const floor = await syntheticProceeds(tx, userId);
  const after = await floorValue(tx, userId, before === undefined ? cashOutMarks(marks) : marks);
  if (after.lt(floor) && (before === undefined || after.lt(before))) throw new SyntheticProceedsLockedError();
}
