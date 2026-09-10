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
    const position = await this.prisma.futuresPosition.findUnique({ where: { id: positionId } });
    if (!position || position.userId !== userId) throw new NotFound('Position not found or not open');
    if (position.status !== 'OPEN') throw new NotFound('Position not found or not open');

    const side = position.side as PositionSide;
    // Validate against the same mark price the trigger will later be judged
    // by. When it is unavailable the price-relative checks are SKIPPED
    // rather than run against an invented number — the ordering rules below
    // still apply, and a trigger that is already through its level simply
    // fires on the first tick that has a mark price, which is honest.
    const markPrice = await this.markPriceService.getMarkPrice(position.symbol);
    validateTriggers(side, input, markPrice);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
          await tx.futuresPositionProtection.update({ where: { id: existing.id }, data });
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
    const position = await this.prisma.futuresPosition.findUnique({ where: { id: positionId } });
    if (!position || position.userId !== userId) throw new NotFound('Position not found');
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const kind of PROTECTION_KINDS) await this.resolveKind(tx, positionId, kind, 'CANCELLED');
    });
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

      if (await this.fire(row.id, row.positionId, row.kind as ProtectionKind)) executed++;
    }
    return executed;
  }

  /**
   * Claim one trigger and close the position with it. Every early return is
   * a race that another actor won, and every one of them leaves the books
   * untouched.
   */
  private async fire(protectionId: string, positionId: string, kind: ProtectionKind): Promise<boolean> {
    // THE claim. Exactly one caller — this tick, the next tick, another
    // process — can see count === 1.
    const claim = await this.prisma.futuresPositionProtection.updateMany({
      where: { id: protectionId, status: { in: CLAIMABLE } },
      data: { status: 'TRIGGERING', triggeredAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 0) return false;

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
 *   - Only with a mark price: the trigger must be on the side of the
 *     current mark that its name implies, so "take profit" cannot be set
 *     where it would immediately register a loss. With no mark price the
 *     check is skipped rather than run against a made-up number.
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
