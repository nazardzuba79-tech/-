import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { FuturesPositionService } from './FuturesPositionService';
import { MarkPriceService } from './MarkPriceService';
import { PositionSide } from './marginMath';
import {
  PROTECTION_CHECK_INTERVAL_MS,
  PROTECTION_STALE_CLAIM_MS,
} from '../config/futuresConfig';

export type ProtectionKind = 'TAKE_PROFIT' | 'STOP_LOSS';
export const PROTECTION_KINDS: ProtectionKind[] = ['TAKE_PROFIT', 'STOP_LOSS'];

/** Armed and re-armable. A FAILED trigger is protection that is currently
 *  not working, not protection that has been given up on. */
const CLAIMABLE = ['PENDING', 'FAILED'];

/**
 * THE SAME advisory lock `FuturesBookTransaction` takes around every futures
 * placement, cancellation and close — same literal key, deliberately, because
 * a different key would serialize nothing.
 *
 * Holding it here means a protection mutation and a position's execution can
 * never interleave: whoever gets the lock first runs to COMMIT, and the other
 * then reads committed state rather than a snapshot that has since moved.
 */
async function lockFuturesBook(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('futures-book', 0))::text AS locked`
  );
}

/**
 * Real Take Profit / Stop Loss for perpetual futures positions.
 *
 * WHAT MAKES IT REAL
 * ------------------
 * Three things, none of which the spot conditional-order stack provides for
 * futures:
 *
 *  1. The trigger authority is the FUTURES MARK PRICE
 *     (`MarkPriceService.getMarkPrice`), the same figure liquidation and
 *     unrealized PnL already use. Never a spot ticker, never the last
 *     futures trade, never a browser timer. A frontend that is closed, a
 *     laptop that is asleep, a tab that crashed — none of it matters.
 *  2. State is a row in the database with an explicit machine, so a trigger
 *     survives a backend restart and two watcher ticks cannot fire it
 *     twice. The mutual exclusion is a conditional UPDATE, not a boolean in
 *     process memory.
 *  3. Firing produces an ORDINARY reduce-only MARKET order through
 *     `FuturesPositionService.placeOrder` — the exact path a manual close
 *     already takes. There is no second accounting engine, no bespoke
 *     settlement, no private way to move margin. Everything this file can
 *     do to a balance, a position or the insurance fund, a manual close
 *     could already do.
 *
 * THE STATE MACHINE
 * -----------------
 *   PENDING ──claim──> TRIGGERING ──position closed──> EXECUTED
 *      ^                    │                              │
 *      │                    ├─ still open after the close ─┘  (a concurrent
 *      │                    │   increase left a remainder: re-arm, do not
 *      │                    │   pretend the position is protected)
 *      │                    ├─ execution threw, position still open ─> FAILED
 *      │                    └─ position gone ──────────────────────> CANCELLED
 *      │                                                              (or the
 *      └── FAILED and TRIGGERING (orphaned) are re-claimed              sibling
 *          on a later tick                                              won)
 *
 * IDEMPOTENCY. The claim is
 *
 *     UPDATE ... SET status='TRIGGERING' WHERE id=? AND status IN (PENDING,FAILED)
 *
 * issued as `updateMany`. PostgreSQL takes the row lock and re-evaluates the
 * predicate against the newest committed version, so of any number of
 * concurrent ticks exactly one sees `count === 1` and the rest see 0 and
 * return. No in-memory flag is involved, so it holds across processes too.
 *
 * OCO. When one side wins, the sibling is resolved to CANCELLED in the same
 * transaction that records the win. That is the intended path — but it is
 * not what makes double execution impossible. Even if a sibling somehow
 * fired afterwards, its close is reduce-only against a position that is no
 * longer open, and `FuturesPositionService` cancels a reduce-only order with
 * no opposing capacity without settling anything. Belt and braces.
 *
 * SIZE. No quantity is stored. The size is read from the position row at
 * execution time, so a trader who manually closed part of the position gets
 * exactly the remainder protected.
 *
 * RESTING ENTRIES. Winning the claim also CANCELS every non-reduce-only
 * futures order the same user has resting in the same
 * `(userId, symbol, marginType)` risk bucket, in the very same transaction.
 * Without that, closing the position was only half an answer: a resting BUY
 * outlived the stop that closed the LONG, filled later, and re-opened the
 * same exposure with no protection on it — the protection rows having been
 * resolved along with the position they were keyed to. Reduce-only orders
 * are left alone; they can only shrink an opposing position, so they cannot
 * re-open anything.
 *
 * MARK PRICE UNAVAILABLE. `getMarkPrice` answers `null`, and null is not a
 * number: nothing triggers, nothing is cancelled, nothing is fabricated as
 * zero. The trigger simply stays armed for a later tick, which is the same
 * choice `LiquidationEngine` already makes for the same reason.
 */
export class FuturesProtectionService {
  private timer?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaClient,
    private positionService: FuturesPositionService,
    private markPriceService: MarkPriceService
  ) {}

  // ── Read ──────────────────────────────────────────────────────────

  /** The protection a user has on their own position. Returns null when the
   *  position does not exist or belongs to somebody else — deliberately not
   *  distinguishable from the caller's side, so this cannot be used to probe
   *  for the existence of another account's positions. */
  async getProtection(userId: string, positionId: string) {
    const position = await this.prisma.futuresPosition.findUnique({ where: { id: positionId } });
    if (!position || position.userId !== userId) return null;
    const rows = await this.prisma.futuresPositionProtection.findMany({ where: { positionId } });
    return {
      positionId,
      takeProfit: serialize(rows.find((r) => r.kind === 'TAKE_PROFIT')),
      stopLoss: serialize(rows.find((r) => r.kind === 'STOP_LOSS')),
    };
  }

  /** Active protection for many positions at once, so the positions list can
   *  carry it without the client polling a second endpoint per row. */
  async activeProtectionByPosition(positionIds: string[]) {
    const map = new Map<string, { takeProfit: ReturnType<typeof serialize>; stopLoss: ReturnType<typeof serialize> }>();
    if (positionIds.length === 0) return map;
    const rows = await this.prisma.futuresPositionProtection.findMany({
      where: { positionId: { in: positionIds }, status: { in: [...CLAIMABLE, 'TRIGGERING'] } },
    });
    for (const id of positionIds) map.set(id, { takeProfit: null, stopLoss: null });
    for (const row of rows) {
      const entry = map.get(row.positionId)!;
      if (row.kind === 'TAKE_PROFIT') entry.takeProfit = serialize(row);
      else entry.stopLoss = serialize(row);
    }
    return map;
  }

  // ── Write ─────────────────────────────────────────────────────────

  /**
   * Replace this position's protection. `null` for a side removes it;
   * omitting a side is the same as `null`, because this is a PUT of the
   * whole protection, not a patch of one leg.
   */
  async setProtection(
    userId: string,
    positionId: string,
    input: { takeProfit: BigNumber | null; stopLoss: BigNumber | null }
  ) {
    const arming = input.takeProfit !== null || input.stopLoss !== null;

    // Read once outside the transaction only to answer "whose position is
    // this, and what side is it" for validation. It is NOT the authority for
    // the write — every one of these checks is repeated inside the
    // transaction below, under the futures-book lock, because the position
    // can close between here and there.
    const preview = await this.prisma.futuresPosition.findUnique({ where: { id: positionId } });
    if (!preview || preview.userId !== userId) throw new NotFound('Position not found or not open');
    if (preview.status !== 'OPEN') throw new NotFound('Position not found or not open');

    // ARMING REQUIRES AN AUTHORITATIVE MARK PRICE.
    //
    // The trigger will be judged against the mark price, so a trigger armed
    // without one is a level nobody has checked is on the right side of the
    // market — a "take profit" that could be sitting at an instant loss. When
    // the feed is down the honest answer is to refuse the instruction, not to
    // accept it against a fabricated reference. Zero is never substituted.
    //
    // Removing protection is exempt: a clear needs no price to be correct,
    // and refusing to let a trader REMOVE a stop because the feed is down
    // would be the wrong failure direction entirely.
    const markPrice = arming ? await this.markPriceService.getMarkPrice(preview.symbol) : null;
    if (arming && !markPrice) {
      throw new MarkPriceUnavailable(
        `No authoritative mark price for ${preview.symbol}; protection was not changed`
      );
    }
    validateTriggers(preview.side as PositionSide, input, markPrice);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockFuturesBook(tx);

      // Re-read UNDER THE LOCK. Ownership and OPEN are re-checked here, not
      // only above: a close (manual, triggered or liquidation) may have
      // committed while this request was being validated, and re-arming
      // protection on a position that no longer exists would be a lie.
      const position = await tx.futuresPosition.findUnique({ where: { id: positionId } });
      if (!position || position.userId !== userId || position.status !== 'OPEN') {
        throw new NotFound('Position not found or not open');
      }

      await this.refuseWhileTriggering(tx, positionId);

      for (const kind of PROTECTION_KINDS) {
        const price = kind === 'TAKE_PROFIT' ? input.takeProfit : input.stopLoss;
        if (price === null) {
          await this.resolveKind(tx, positionId, kind, 'CANCELLED');
          continue;
        }
        const existing = await tx.futuresPositionProtection.findUnique({
          where: { positionId_kind: { positionId, kind } },
        });
        const data = {
          triggerPrice: price.toString(),
          // Re-arming is a fresh trigger: an earlier failure's error and
          // attempt count are the previous instruction's history, not this
          // one's, and carrying them over would misreport the new trigger.
          status: 'PENDING',
          lastError: null,
          attempts: 0,
          triggeredAt: null,
          resolvedAt: null,
        };
        if (existing) {
          await tx.futuresPositionProtection.update({
            where: { id: existing.id },
            // The CAS token moves on every write, so any sweep still holding
            // the previous version of this row can no longer claim it.
            data: { ...data, revision: { increment: 1 } },
          });
        } else {
          await tx.futuresPositionProtection.create({
            data: { positionId, userId, symbol: position.symbol, kind, ...data },
          });
        }
      }
    });

    return this.getProtection(userId, positionId);
  }

  /** Remove both sides. */
  async clearProtection(userId: string, positionId: string) {
    // No mark price is read or required: clearing is correct without one.
    const preview = await this.prisma.futuresPosition.findUnique({ where: { id: positionId } });
    if (!preview || preview.userId !== userId) throw new NotFound('Position not found');

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockFuturesBook(tx);
      const position = await tx.futuresPosition.findUnique({ where: { id: positionId } });
      if (!position || position.userId !== userId) throw new NotFound('Position not found');
      // Deliberately NOT requiring OPEN: protection on a position that has
      // already closed is exactly the stale state a trader should be able to
      // tidy away, and doing so arms nothing.
      await this.refuseWhileTriggering(tx, positionId);
      for (const kind of PROTECTION_KINDS) await this.resolveKind(tx, positionId, kind, 'CANCELLED');
    });
  }

  /**
   * A trigger that has already been claimed is EXECUTING — a reduce-only
   * MARKET close may be in the book right now. There is no honest way to
   * "cancel" that from here, so the mutation is refused rather than allowed
   * to report a save or a cancellation that the market has already overtaken.
   *
   * This is a conflict, not a failure: once the claim resolves to EXECUTED,
   * CANCELLED or FAILED, the ordinary state model applies again and the same
   * request will succeed.
   */
  private async refuseWhileTriggering(tx: Prisma.TransactionClient, positionId: string): Promise<void> {
    const live = await tx.futuresPositionProtection.findMany({
      where: { positionId, status: 'TRIGGERING' },
    });
    if (live.length === 0) return;
    const kinds = live.map((r) => (r.kind === 'TAKE_PROFIT' ? 'take profit' : 'stop loss')).join(' and ');
    throw new Conflict(
      `This position's ${kinds} is executing right now; protection cannot be changed until it settles`
    );
  }

  // ── The watcher ───────────────────────────────────────────────────

  /**
   * One sweep. Returns how many triggers actually executed a close, so the
   * scheduler and the tests can assert on real work rather than on a log
   * line.
   */
  async checkAndTrigger(now: number = Date.now()): Promise<number> {
    await this.reclaimOrphanedClaims(now);

    const armed = await this.prisma.futuresPositionProtection.findMany({
      where: { status: { in: CLAIMABLE } },
    });
    if (armed.length === 0) return 0;

    // One mark-price read per contract per sweep, not one per trigger.
    const markPrices = new Map<string, BigNumber | null>();
    for (const symbol of new Set(armed.map((r) => r.symbol))) {
      markPrices.set(symbol, await this.markPriceService.getMarkPrice(symbol));
    }

    let executed = 0;
    for (const row of armed) {
      const position = await this.prisma.futuresPosition.findUnique({ where: { id: row.positionId } });
      // Nothing left to protect: the trader closed it, or liquidation did.
      // Resolving here is what stops a stale row sitting armed forever; it
      // is NOT how the manual-close and liquidation races are won — those
      // are won by the reduce-only close finding no capacity.
      if (!position || position.status !== 'OPEN') {
        await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await this.resolveKind(tx, row.positionId, row.kind as ProtectionKind, 'CANCELLED');
        });
        continue;
      }

      const markPrice = markPrices.get(row.symbol) ?? null;
      // No authoritative price: do not trigger, do not cancel, do not
      // substitute a zero. Leave it armed and try again next sweep.
      if (!markPrice) continue;

      if (!hasCrossed(position.side as PositionSide, row.kind as ProtectionKind, markPrice, new BigNumber(row.triggerPrice.toString()))) {
        continue;
      }

      // The WHOLE scanned row goes to fire(), not just its id: the claim has
      // to prove it is taking the same version of the trigger this decision
      // was made about.
      if (await this.fire(row)) executed++;
    }
    return executed;
  }

  /**
   * Claim one trigger and close the position with it. Every early return is
   * a race that another actor won, and every one of them leaves the books
   * untouched.
   */
  private async fire(scanned: {
    id: string;
    positionId: string;
    kind: string;
    revision: number;
    triggerPrice: { toString(): string };
  }): Promise<boolean> {
    const protectionId = scanned.id;
    const positionId = scanned.positionId;
    const kind = scanned.kind as ProtectionKind;

    // THE claim, and a COMPARE-AND-SWAP rather than a bare status check.
    //
    // Between the scan deciding this trigger has crossed and this line, the
    // trader may have edited it, removed it, or replaced it. With only
    // `id + status` the claim would happily take the NEW row on the strength
    // of a decision made about the OLD one — closing a position at a level
    // that never crossed. `revision` moves on every mutation, so a stale
    // sweep gets count === 0 and places nothing. `triggerPrice` is carried
    // too: it is the value the decision was actually made from, so the claim
    // stays correct even for a write that somehow failed to bump revision.
    //
    // Exactly one caller — this tick, the next tick, another process — can
    // see count === 1.
    //
    // The claim runs under the futures-book lock, so it cannot interleave
    // with `setProtection`/`clearProtection`, which hold the same lock while
    // they check for a live claim. Without that, a mutation could read "no
    // trigger is executing", the claim could land, and the mutation could
    // then overwrite a row whose close was already on its way.
    //
    // The lock is released by this COMMIT, deliberately BEFORE the order is
    // placed: `placeOrder` opens its own transaction and takes the same lock,
    // and holding it across that call would deadlock against ourselves.
    // Releasing early is safe because the position is what guards execution
    // from here on — a reduce-only close finds no capacity if anything else
    // closed it meanwhile.
    // AND, IN THE SAME TRANSACTION, THE BUCKET'S RESTING ENTRIES GO.
    //
    // Closing the position was never enough on its own. A non-reduce-only
    // order of the same user resting in the same
    // `(userId, symbol, marginType)` bucket survived the close, filled
    // later, and re-opened the exact exposure this stop had just closed —
    // unprotected, because the protection rows died with the position they
    // were keyed to. The trigger and those cancellations have to commit
    // together or the gap between them is the defect.
    //
    // This runs through `withFuturesBook`, so it is the same advisory lock
    // the hand-rolled `lockFuturesBook` took here before, plus the staged
    // book and the commit verification — which is what lets the cancelled
    // orders leave the published book in the same step. Nothing is cancelled
    // and nothing is refunded unless the CAS below returns count === 1: a
    // losing watcher must not touch another worker's orders or balances.
    //
    // WHY THIS IS WRAPPED. `withFuturesBook` runs SERIALIZABLE, where losing
    // a race is not always reported as "the predicate matched no rows" —
    // PostgreSQL may abort the loser outright with a serialization failure.
    // The claim used to run at READ COMMITTED, where the loser simply waited
    // for the row lock and then saw `count === 0`; moving it in here to get
    // the cancellations into the same transaction is what made 40001
    // reachable. Verified against a real server: two workers racing one
    // trigger aborted the loser rather than returning zero.
    //
    // An abort means the whole transaction rolled back, so this sweep
    // claimed nothing, cancelled nothing and released nothing — which is
    // exactly "another actor won". It is reported as such, and the trigger
    // is left claimable for the next tick. Nothing else is swallowed: any
    // other error still propagates.
    const claimed = await this.claimAndClearBucket(async (tx: Prisma.TransactionClient) => {
      const claim = await tx.futuresPositionProtection.updateMany({
        where: {
          id: protectionId,
          status: { in: CLAIMABLE },
          revision: scanned.revision,
          triggerPrice: scanned.triggerPrice.toString(),
        },
        data: { status: 'TRIGGERING', triggeredAt: new Date(), attempts: { increment: 1 } },
      });
      // Lost the race. No session is returned, so nothing is published, and
      // the transaction commits having changed nothing at all.
      if (claim.count === 0) return { result: false };

      // Won — but only a position that is still OPEN identifies a bucket
      // worth clearing. If it has already gone (manual close, liquidation,
      // the sibling trigger), this claim resolves to CANCELLED downstream
      // and the trader's resting orders are none of its business.
      const position = await tx.futuresPosition.findUnique({ where: { id: positionId } });
      if (!position || position.status !== 'OPEN') return { result: true };

      const { session } = await this.positionService.cancelBucketEntryOrdersWithin(tx, {
        userId: position.userId,
        symbol: position.symbol,
        marginType: position.marginType,
      });
      // A failure anywhere above — a cancellation, a margin release, the
      // commit verification — throws out of here, so the claim rolls back
      // with it. The trigger stays claimable, no order is left half
      // cancelled, and no margin is released twice.
      return { session, result: true };
    });
    if (!claimed) return false;

    // Re-read AFTER the claim, so the size closed is the size the position
    // has now — never the size it had when the trigger was created.
    const position = await this.prisma.futuresPosition.findUnique({ where: { id: positionId } });
    if (!position || position.status !== 'OPEN') {
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await this.resolveKind(tx, positionId, kind, 'CANCELLED');
      });
      return false;
    }

    const size = new BigNumber(position.size.toString());
    if (!size.isGreaterThan(0)) {
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await this.resolveKind(tx, positionId, kind, 'CANCELLED');
      });
      return false;
    }

    try {
      await this.positionService.placeOrder({
        userId: position.userId,
        symbol: position.symbol,
        side: position.side === 'LONG' ? 'SELL' : 'BUY',
        type: 'MARKET',
        quantity: size,
        leverage: position.leverage,
        marginType: position.marginType as 'ISOLATED' | 'CROSS',
        // The whole safety argument in one flag. A reduce-only order can
        // only shrink an existing opposing position: it can never increase
        // exposure, never reverse the position, and never open a new one.
        reduceOnly: true,
      });
    } catch (err: any) {
      // Thin book, a self-match, a size that moved under us — all real and
      // all retryable. Protection is NOT dropped: FAILED is re-claimed on a
      // later sweep for as long as the position is open.
      const after = await this.prisma.futuresPosition.findUnique({ where: { id: positionId } });
      const stillOpen = after?.status === 'OPEN';
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (stillOpen) {
          await tx.futuresPositionProtection.updateMany({
            where: { id: protectionId, status: 'TRIGGERING' },
            data: { status: 'FAILED', lastError: String(err?.message ?? err).slice(0, 500) },
          });
        } else {
          await this.resolveKind(tx, positionId, kind, 'CANCELLED');
        }
      });
      return false;
    }

    const after = await this.prisma.futuresPosition.findUnique({ where: { id: positionId } });
    if (after?.status === 'OPEN') {
      // A concurrent increase landed between the size read and the close, so
      // a remainder is still exposed. Re-arm rather than report a position
      // as protected-and-closed when it is neither.
      await this.prisma.futuresPositionProtection.updateMany({
        where: { id: protectionId, status: 'TRIGGERING' },
        data: { status: 'PENDING', triggeredAt: null },
      });
      return false;
    }

    // Won. Record it and cancel the sibling in one transaction, so the OCO
    // pair can never be observed with both sides resolved as winners.
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.futuresPositionProtection.updateMany({
        where: { id: protectionId, status: 'TRIGGERING' },
        data: { status: 'EXECUTED', resolvedAt: new Date(), lastError: null },
      });
      const sibling: ProtectionKind = kind === 'TAKE_PROFIT' ? 'STOP_LOSS' : 'TAKE_PROFIT';
      await this.resolveKind(tx, positionId, sibling, 'CANCELLED');
    });
    return true;
  }

  /**
   * Run the claim transaction, translating a serialization abort into an
   * ordinary lost race. See the note at the call site for why SERIALIZABLE
   * makes that necessary and why it is safe: an aborted transaction changed
   * nothing at all.
   */
  private async claimAndClearBucket(
    work: (tx: Prisma.TransactionClient) => Promise<{ session?: unknown; result: boolean }>
  ): Promise<boolean> {
    try {
      return await this.positionService.withFuturesBook(work as never);
    } catch (err) {
      if (isSerializationFailure(err)) return false;
      throw err;
    }
  }

  /**
   * Take back a claim that no process is still working on. The only way to
   * strand a row in TRIGGERING is for the backend to die mid-close, so this
   * is restart recovery. It cannot double-close: the reclaimed trigger
   * re-reads the position, and if the earlier attempt did close it, the row
   * resolves to CANCELLED without placing anything.
   */
  private async reclaimOrphanedClaims(now: number): Promise<void> {
    await this.prisma.futuresPositionProtection.updateMany({
      where: { status: 'TRIGGERING', triggeredAt: { lt: new Date(now - PROTECTION_STALE_CLAIM_MS) } },
      data: { status: 'PENDING', triggeredAt: null, lastError: 'Reclaimed after an interrupted trigger' },
    });
  }

  /** Resolve one side if it is still live. Never touches a side that has
   *  already reached a terminal state, so a winner is never overwritten. */
  private async resolveKind(
    tx: Prisma.TransactionClient,
    positionId: string,
    kind: ProtectionKind,
    status: 'CANCELLED'
  ): Promise<void> {
    await tx.futuresPositionProtection.updateMany({
      where: { positionId, kind, status: { in: [...CLAIMABLE, 'TRIGGERING'] } },
      data: { status, resolvedAt: new Date() },
    });
  }

  startScheduler(intervalMs: number = PROTECTION_CHECK_INTERVAL_MS): void {
    this.timer = setInterval(() => {
      this.checkAndTrigger().catch((err) => console.error('Futures protection sweep failed', err));
    }, intervalMs);
  }

  stopScheduler(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

/** Thrown for "this position is not yours / not open", which the route maps
 *  to 404 so ownership cannot be probed through the status code. */
export class NotFound extends Error {}

/** A trigger on this position is mid-execution, so the requested change
 *  cannot be honoured. The route maps it to 409: it is a state conflict the
 *  same request will clear on its own, not a bad request. */
export class Conflict extends Error {}

/** No authoritative futures mark price, so a trigger cannot be armed against
 *  it. The route maps it to 503: the instruction was fine, the data it needs
 *  is temporarily missing. */
export class MarkPriceUnavailable extends Error {}

/**
 * Did PostgreSQL abort this transaction because another one got to the same
 * rows first?
 *
 * `P2034` is Prisma's wrapper; `40001` (serialization_failure) and `40P01`
 * (deadlock_detected) are the SQLSTATEs underneath it. All three mean the
 * transaction was rolled back in full, so a caller can treat them as "the
 * work did not happen" without checking what, if anything, had been written.
 */
export function isSerializationFailure(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === 'P2034' || code === '40001' || code === '40P01';
}

/**
 * Has the mark price reached this trigger's level?
 *
 * LONG  — take profit above, stop loss below.
 * SHORT — take profit below, stop loss above.
 *
 * Inclusive on both sides: a mark price exactly at the level has reached it.
 */
export function hasCrossed(
  side: PositionSide,
  kind: ProtectionKind,
  markPrice: BigNumber,
  triggerPrice: BigNumber
): boolean {
  if (side === 'LONG') {
    return kind === 'TAKE_PROFIT'
      ? markPrice.isGreaterThanOrEqualTo(triggerPrice)
      : markPrice.isLessThanOrEqualTo(triggerPrice);
  }
  return kind === 'TAKE_PROFIT'
    ? markPrice.isLessThanOrEqualTo(triggerPrice)
    : markPrice.isGreaterThanOrEqualTo(triggerPrice);
}

/**
 * Reject a trigger that could not do what the trader is asking for.
 *
 * Two families of rule:
 *   - Always: a price must be a real positive number, and on a LONG a stop
 *     must sit below the take profit (above, on a SHORT). These need no
 *     market data, so they are enforced unconditionally.
 *   - With a mark price: the trigger must be on the side of the current mark
 *     that its name implies, so "take profit" cannot be set where it would
 *     immediately register a loss.
 *
 * `markPrice` is nullable here only because CLEARING protection calls this
 * with nothing to validate. Arming without one never reaches this function:
 * `setProtection` refuses it with MarkPriceUnavailable first, so no trigger
 * is ever created against a missing reference — and certainly not against a
 * zero standing in for one.
 */
export function validateTriggers(
  side: PositionSide,
  input: { takeProfit: BigNumber | null; stopLoss: BigNumber | null },
  markPrice: BigNumber | null
): void {
  for (const [label, price] of [['takeProfit', input.takeProfit], ['stopLoss', input.stopLoss]] as const) {
    if (price === null) continue;
    if (!price.isFinite() || !price.isGreaterThan(0)) throw new Error(`${label} must be a positive price`);
  }

  const { takeProfit, stopLoss } = input;
  if (takeProfit && stopLoss) {
    const ordered = side === 'LONG' ? stopLoss.isLessThan(takeProfit) : stopLoss.isGreaterThan(takeProfit);
    if (!ordered) {
      throw new Error(
        side === 'LONG'
          ? 'stopLoss must be below takeProfit for a LONG position'
          : 'stopLoss must be above takeProfit for a SHORT position'
      );
    }
  }

  if (!markPrice) return;
  if (side === 'LONG') {
    if (takeProfit && !takeProfit.isGreaterThan(markPrice)) {
      throw new Error('takeProfit must be above the current mark price for a LONG position');
    }
    if (stopLoss && !stopLoss.isLessThan(markPrice)) {
      throw new Error('stopLoss must be below the current mark price for a LONG position');
    }
  } else {
    if (takeProfit && !takeProfit.isLessThan(markPrice)) {
      throw new Error('takeProfit must be below the current mark price for a SHORT position');
    }
    if (stopLoss && !stopLoss.isGreaterThan(markPrice)) {
      throw new Error('stopLoss must be above the current mark price for a SHORT position');
    }
  }
}

function serialize(row?: {
  id: string;
  kind: string;
  triggerPrice: { toString(): string };
  status: string;
  lastError: string | null;
  attempts: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
} | null) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    triggerPrice: row.triggerPrice.toString(),
    status: row.status,
    lastError: row.lastError,
    attempts: row.attempts,
    // Exposed so a client can tell two versions of the same trigger apart
    // rather than assuming an unchanged id means unchanged instructions.
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
