import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { MatchingEngine } from '../matching-engine/MatchingEngine';
import { Order, OrderSide, OrderType, OrderBookSnapshot } from '../matching-engine/types';
import { isTestAssetPairOrSymbol, TEST_ASSET_NOT_TRADABLE_MESSAGE } from './testMarkets/testAssetConfig';
import { DEMO_SPOT_LEDGER, SpotBookTransaction } from './SpotBookTransaction';
import { checkReference, DemoLiquidity, DemoReferenceQuote, liquidityAccountRefusal, liquidityOrderId, liquidityQuote } from './DemoLiquidity';

type TxClient = Prisma.TransactionClient;

/** Machine-readable reason for a refusal; the message keeps the real Spot wording. */
export type DemoTradingErrorCode = 'INVALID_ORDER' | 'INSUFFICIENT_BALANCE' | 'NO_LIQUIDITY' | 'REQUEST_CONFLICT';

export class DemoTradingError extends Error {
  constructor(message: string, readonly code: DemoTradingErrorCode = 'INVALID_ORDER') { super(message); }
}

/** DemoBalance is Decimal(36,18): do not round a lock/transfer into a different amount. */
function exactDemoDelta(value: BigNumber): string {
  if (!value.isFinite() || value.decimalPlaces()! > 18 || value.abs().gte('1000000000000000000')) {
    throw new DemoTradingError('Demo amount exceeds supported precision');
  }
  return value.toFixed();
}

const ACTIVE = ['OPEN', 'PARTIALLY_FILLED'];
const NO_LIQUIDITY_MESSAGE = 'No liquidity available for this market order';

/** One order per (account, client request): a retried request after a lost
 * response finds the order its first attempt committed instead of a second one.
 * Same derivation as VtaDemoSales. Another account's request ID never collides. */
export const demoOrderId = (userId: string, requestId: string) => uuidv5(`voltex:demo-spot-order:${userId}:${requestId}`, uuidv5.URL);

export interface DemoTradingOptions {
  liquidity?: DemoLiquidity | null;
  /** Why configured liquidity stayed off (shown to the admin), if it did. */
  liquidityProblem?: string;
}

/**
 * A stripped-down mirror of OrderService (LIMIT/MARKET only — no
 * stop/take-profit/OCO, no PriceWatcher integration) that trades against
 * its own MatchingEngine instance and its own DemoBalance/DemoOrder/
 * DemoTrade tables instead of the real ones. See the DemoBalance doc
 * comment in schema.prisma for why this is a fully separate stack rather
 * than a flag on the real tables: nothing here can ever reach a real
 * user's balance, order, or the reserves calculation.
 *
 * Without internal liquidity (the default), a MARKET order fills only
 * against resting DemoOrder liquidity in this same demo book — never priced
 * off the real Kraken mirror, so
 * the sandbox behaves exactly like a brand-new, empty exchange: you have
 * to place LIMIT orders to build depth before a MARKET order has anything
 * to fill against, which is the point of using this to watch how a book
 * behaves.
 *
 * Every state transition runs through SpotBookTransaction on DEMO_SPOT_LEDGER,
 * exactly like real Spot: the book is loaded from committed DemoOrder rows
 * under one advisory lock, matched in the transaction, and published to the
 * in-memory projection only after PostgreSQL reports the commit. Makers'
 * remaining quantities are persisted, so a restart or a rolled-back
 * transaction can never leave a filled order cancellable or a lost one locked.
 *
 * With internal liquidity configured (DemoLiquidity, off by default), a
 * designated account's already-credited demo funds also answer a taker on its
 * listed pairs, at the server's market reference plus a spread — inside the
 * same transaction, never resting, never more than that account holds. That
 * reference is read from the market-data cache; no order goes to any venue.
 */
export class DemoTradingService {
  private readonly liquidity: DemoLiquidity | null;
  constructor(private prisma: PrismaClient, private engine: MatchingEngine, private options: DemoTradingOptions = {}) {
    this.liquidity = options.liquidity ?? null;
  }

  async getBalances(userId: string) {
    return this.prisma.demoBalance.findMany({ where: { userId }, orderBy: { asset: 'asc' } });
  }

  async getOpenOrders(userId: string) {
    return this.prisma.demoOrder.findMany({
      where: { userId, status: { in: ACTIVE } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** The account's own finished orders, newest first. */
  async getOrderHistory(userId: string, limit = 100) {
    return this.prisma.demoOrder.findMany({
      where: { userId, status: { in: ['FILLED', 'CANCELLED'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit,
    });
  }

  async getRecentTrades(pair: string, limit = 50) {
    return this.prisma.demoTrade.findMany({ where: { pair }, orderBy: { executedAt: 'desc' }, take: limit });
  }

  /** Read from the committed rows, not the in-process projection, so the
   * book is right after a restart and on every instance. */
  async getOrderBook(pair: string): Promise<OrderBookSnapshot> {
    const rows = await this.prisma.demoOrder.findMany({ where: { pair, type: 'LIMIT', status: { in: ACTIVE } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const book = new MatchingEngine();
    for (const row of rows) {
      if (!row.price) continue;
      book.loadRestingOrder({ id: row.id, userId: row.userId, pair, side: row.side as OrderSide, type: 'LIMIT',
        price: new BigNumber(row.price.toString()), originalQuantity: new BigNumber(row.originalQuantity.toString()),
        remainingQuantity: new BigNumber(row.remainingQuantity.toString()), status: row.status as Order['status'],
        createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() });
    }
    return book.getBook(pair).snapshot();
  }

  async placeOrder(params: {
    userId: string;
    pair: string;
    side: OrderSide;
    type: OrderType;
    price?: BigNumber; // required for LIMIT
    quantity: BigNumber;
    /** Optional client request ID (UUID): makes a retry return the same order. */
    requestId?: string;
  }) {
    if (isTestAssetPairOrSymbol(params.pair)) throw new DemoTradingError(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    const [base, quote] = params.pair.split('/');
    if (!base || !quote) throw new DemoTradingError(`Invalid pair: ${params.pair}`);
    if (params.type === 'LIMIT' && (!params.price || !params.price.isFinite() || params.price.lte(0))) {
      throw new DemoTradingError('price is required for a LIMIT order');
    }
    if (!params.quantity.isFinite() || params.quantity.isLessThanOrEqualTo(0)) {
      throw new DemoTradingError('quantity must be a positive number');
    }

    const lockAsset = params.side === 'BUY' ? quote : base;

    const orderId = params.requestId ? demoOrderId(params.userId, params.requestId) : uuidv4();
    // Read before the book lock: the lock is never held across a market-data read.
    const reference = await this.liquidityReference(params.userId, params.pair);

    return SpotBookTransaction.run(this.prisma, this.engine, async (tx, session) => {
      // Under the book lock: a request ID that already committed is answered
      // from its order, never placed (or reserved) a second time.
      if (params.requestId) {
        const existing = await tx.demoOrder.findUnique({ where: { id: orderId } });
        if (existing) return this.replay(tx, existing, params);
      }
      const staged = await session.book(params.pair);
      const liquidity = reference ? await this.stageLiquidity(tx, staged, orderId, params.pair, params.side, base, quote, reference) : null;
      let lockAmount: BigNumber;
      if (params.type === 'LIMIT') {
        lockAmount = params.side === 'BUY' ? params.price!.times(params.quantity) : params.quantity;
      } else if (params.side === 'SELL') {
        lockAmount = params.quantity;
      } else {
        // Committed depth, read under the book lock: no invented fill price.
        const bestAsk = staged.getBook(params.pair).bestAsk()?.price;
        if (!bestAsk) throw new DemoTradingError(NO_LIQUIDITY_MESSAGE, 'NO_LIQUIDITY');
        lockAmount = params.quantity.times(bestAsk).times(1.02); // same 2% slippage buffer as real MARKET orders
      }
      await this.lockFunds(tx, params.userId, lockAsset, lockAmount);

      let createdAt = Date.now();
      for (const side of ['BUY', 'SELL'] as const) for (const resting of staged.getBook(params.pair).getBook(side)) {
        createdAt = Math.max(createdAt, resting.createdAt + 1);
      }
      await tx.demoOrder.create({
        data: {
          id: orderId,
          userId: params.userId,
          pair: params.pair,
          side: params.side,
          type: params.type,
          price: params.type === 'LIMIT' ? params.price!.toString() : null,
          originalQuantity: params.quantity.toString(),
          remainingQuantity: params.quantity.toString(),
          status: 'OPEN',
          createdAt: new Date(createdAt),
        },
      });

      const order: Order = {
        id: orderId,
        userId: params.userId,
        pair: params.pair,
        side: params.side,
        type: params.type,
        price: params.type === 'LIMIT' ? params.price! : null,
        originalQuantity: params.quantity,
        remainingQuantity: params.quantity,
        status: 'OPEN',
        createdAt,
        updatedAt: Date.now(),
      };

      const result = await this.matchAndSettle(tx, staged, order, base, quote, lockAsset, lockAmount, params.price ?? null, liquidity);
      // A liquidity quote answers this taker only: whatever it did not fill never rests.
      if (liquidity) staged.cancelOrder(params.pair, liquidity.id);
      return result;
    }, DEMO_SPOT_LEDGER);
  }

  /** The market reference for an internal liquidity quote, or null when none may be offered. */
  private async liquidityReference(userId: string, pair: string): Promise<DemoReferenceQuote | null> {
    const lp = this.liquidity;
    if (!lp || userId === lp.config.accountId || !lp.config.pairs.has(pair)) return null;
    return lp.reference(pair).catch(() => null);
  }

  /** Puts the liquidity account's one quote for this taker into the staged
   * book, sized from its committed available funds read under the book lock. */
  private async stageLiquidity(tx: TxClient, staged: MatchingEngine, takerOrderId: string, pair: string, takerSide: OrderSide,
    base: string, quote: string, reference: DemoReferenceQuote): Promise<Order | null> {
    const { config } = this.liquidity!;
    // An unblocked USER with no ordinary Balance, checked on committed rows under this lock (fail closed).
    if (await liquidityAccountRefusal(tx, config.accountId, true)) return null;
    const rows = await tx.demoBalance.findMany({ where: { userId: config.accountId, asset: { in: [base, quote] } } });
    const available = (asset: string) => new BigNumber(rows.find(row => row.asset === asset)?.available.toString() ?? 0);
    const offer = liquidityQuote(config, reference, takerSide, { base: available(base), quote: available(quote) });
    if (!offer) return null;
    // Resting testers keep priority at an equal price.
    let createdAt = Date.now();
    for (const side of ['BUY', 'SELL'] as const) for (const resting of staged.getBook(pair).getBook(side)) {
      createdAt = Math.max(createdAt, resting.createdAt + 1);
    }
    const order: Order = { id: liquidityOrderId(takerOrderId), userId: config.accountId, pair, side: offer.side, type: 'LIMIT',
      price: offer.price, originalQuantity: offer.quantity, remainingQuantity: offer.quantity, status: 'OPEN', createdAt, updatedAt: createdAt };
    staged.loadRestingOrder(order);
    return order;
  }

  /** Read-only state for the admin: configuration, inventory and whether each pair's reference may be quoted now. */
  async liquidityStatus() {
    if (!this.liquidity) return { enabled: false, problem: this.options.liquidityProblem ?? null };
    const { config, reference } = this.liquidity;
    const inventory = await this.prisma.demoBalance.findMany({ where: { userId: config.accountId }, orderBy: { asset: 'asc' } });
    const account = (await liquidityAccountRefusal(this.prisma, config.accountId)) ?? 'OK';
    const pairs = [];
    for (const pair of config.pairs) {
      const current = await reference(pair).catch(() => null), now = Date.now();
      const checked = checkReference(config, current, now);
      pairs.push({ pair, reference: checked.ok ? 'OK' : checked.reason, bid: current?.bid ?? null, ask: current?.ask ?? null,
        ageMs: current ? now - current.fetchedAt : null });
    }
    return {
      enabled: true, accountId: config.accountId, account, spreadBps: config.spreadBps, maxOrderQuote: config.maxOrderQuote.toFixed(),
      maxQuoteAgeMs: config.maxQuoteAgeMs, maxReferenceSpreadBps: config.maxReferenceSpreadBps,
      inventory: inventory.map(b => ({ asset: b.asset, available: b.available.toString(), locked: b.locked.toString() })), pairs,
    };
  }

  /** The committed outcome of an earlier attempt with the same request ID. */
  private async replay(tx: TxClient, row: {
    id: string; userId: string; pair: string; side: string; type: string; price: { toString(): string } | null;
    originalQuantity: { toString(): string }; remainingQuantity: { toString(): string }; status: string; createdAt: Date; updatedAt: Date;
  }, params: { userId: string; pair: string; side: OrderSide; type: OrderType; price?: BigNumber; quantity: BigNumber }) {
    const same = row.userId === params.userId && row.pair === params.pair && row.side === params.side && row.type === params.type
      && new BigNumber(row.originalQuantity.toString()).eq(params.quantity)
      && (params.type === 'MARKET' ? row.price === null : row.price !== null && new BigNumber(row.price.toString()).eq(params.price!));
    if (!same) throw new DemoTradingError('This request was already used for a different order', 'REQUEST_CONFLICT');
    const trades = await tx.demoTrade.findMany({ where: { pair: row.pair, takerOrderId: row.id }, orderBy: [{ executedAt: 'asc' }, { id: 'asc' }] });
    const order: Order = {
      id: row.id, userId: row.userId, pair: row.pair, side: row.side as OrderSide, type: row.type as OrderType,
      price: row.price ? new BigNumber(row.price.toString()) : null,
      originalQuantity: new BigNumber(row.originalQuantity.toString()), remainingQuantity: new BigNumber(row.remainingQuantity.toString()),
      status: row.status as Order['status'], createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime(),
    };
    return {
      order, replayed: true as const,
      trades: trades.map(t => ({ id: t.id, pair: t.pair, takerOrderId: t.takerOrderId, makerOrderId: t.makerOrderId, takerUserId: t.takerUserId,
        makerUserId: t.makerUserId, price: new BigNumber(t.price.toString()), quantity: new BigNumber(t.quantity.toString()),
        side: t.side as OrderSide, executedAt: t.executedAt.getTime() })),
    };
  }

  async cancelOrder(userId: string, orderId: string) {
    return SpotBookTransaction.run(this.prisma, this.engine, async (tx, session) => {
      const order = await tx.demoOrder.findUnique({ where: { id: orderId } });
      if (!order || order.userId !== userId) return null;
      if (!ACTIVE.includes(order.status)) return null;
      const staged = await session.book(order.pair);

      await tx.demoOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
      if (!staged.cancelOrder(order.pair, order.id)) throw new Error('Active demo order missing from committed book');

      const [base, quote] = order.pair.split('/');
      const remaining = new BigNumber(order.remainingQuantity.toString());
      if (order.side === 'BUY') {
        const amount = remaining.times(new BigNumber(order.price!.toString()));
        await this.adjustBalance(tx, userId, quote, { available: amount, locked: amount.negated() });
      } else {
        await this.adjustBalance(tx, userId, base, { available: remaining, locked: remaining.negated() });
      }

      return order;
    }, DEMO_SPOT_LEDGER);
  }

  /** Same as OrderService.matchAndSettle on the demo tables: trades, both
   * sides settled, every changed maker and the taker persisted, and whatever
   * of the lock neither filled nor still backs a resting order refunded. */
  private async matchAndSettle(
    tx: TxClient,
    engine: MatchingEngine,
    order: Order,
    base: string,
    quote: string,
    lockAsset: string,
    lockAmount: BigNumber,
    limitPrice: BigNumber | null,
    liquidity: Order | null = null
  ) {
    const makerRemaining = new Map<string, BigNumber>();
    for (const side of ['BUY', 'SELL'] as const) for (const maker of engine.getBook(order.pair).getBook(side)) {
      makerRemaining.set(maker.id, maker.remainingQuantity);
    }
    const { trades, order: finalOrder } = engine.submitOrder(order);
    const changedMakers = new Set<string>();

    for (const trade of trades) {
      makerRemaining.set(trade.makerOrderId, makerRemaining.get(trade.makerOrderId)!.minus(trade.quantity));
      changedMakers.add(trade.makerOrderId);
      await tx.demoTrade.create({
        data: {
          id: trade.id,
          pair: trade.pair,
          takerOrderId: trade.takerOrderId,
          makerOrderId: trade.makerOrderId,
          takerUserId: trade.takerUserId,
          makerUserId: trade.makerUserId,
          price: trade.price.toString(),
          quantity: trade.quantity.toString(),
          side: trade.side,
        },
      });
      if (trade.makerOrderId === liquidity?.id) {
        // Reserve exactly what this fill takes from the liquidity account, conditionally: never overdrawn.
        const funds = liquidity.side === 'SELL' ? { asset: base, amount: trade.quantity } : { asset: quote, amount: trade.price.times(trade.quantity) };
        try { await this.lockFunds(tx, liquidity.userId, funds.asset, funds.amount); }
        catch (error) { throw error instanceof DemoTradingError ? new DemoTradingError(NO_LIQUIDITY_MESSAGE, 'NO_LIQUIDITY') : error; }
      }
      await this.settleTrade(tx, trade, base, quote);
    }
    for (const id of changedMakers) {
      if (id === liquidity?.id) {
        // Its receipt: the executed part of the quote, already filled.
        const filled = liquidity.originalQuantity.minus(makerRemaining.get(id)!);
        await tx.demoOrder.create({ data: { id, userId: liquidity.userId, pair: order.pair, side: liquidity.side, type: 'LIMIT',
          price: liquidity.price!.toString(), originalQuantity: filled.toFixed(), remainingQuantity: '0', status: 'FILLED',
          createdAt: new Date(liquidity.createdAt) } });
        continue;
      }
      const remaining = makerRemaining.get(id)!;
      await tx.demoOrder.update({ where: { id }, data: {
        remainingQuantity: remaining.toFixed(), status: remaining.isZero() ? 'FILLED' : 'PARTIALLY_FILLED',
      } });
    }

    await tx.demoOrder.update({
      where: { id: order.id },
      data: { status: finalOrder.status, remainingQuantity: finalOrder.remainingQuantity.toString() },
    });

    // Same refund logic as OrderService.matchAndSettle — see there for the
    // reasoning behind each term.
    const stillResting = order.type === 'LIMIT' && finalOrder.remainingQuantity.isGreaterThan(0);
    const shouldRemainLocked = stillResting
      ? order.side === 'BUY'
        ? finalOrder.remainingQuantity.times(limitPrice!)
        : finalOrder.remainingQuantity
      : new BigNumber(0);
    const consumedOrFilled =
      order.side === 'BUY'
        ? trades.reduce((sum, t) => sum.plus(t.price.times(t.quantity)), new BigNumber(0))
        : order.originalQuantity.minus(finalOrder.remainingQuantity);
    const refund = lockAmount.minus(consumedOrFilled).minus(shouldRemainLocked);
    if (refund.isGreaterThan(0)) {
      await this.adjustBalance(tx, order.userId, lockAsset, { available: refund, locked: refund.negated() });
    }

    return { order: finalOrder, trades };
  }

  private async lockFunds(tx: TxClient, userId: string, asset: string, amount: BigNumber) {
    const exact = exactDemoDelta(amount);
    if (!amount.gt(0)) throw new DemoTradingError('Demo lock must be positive');
    // Shares the same database row with private leveraged-demo allocations. A
    // conditional delta survives concurrent transfers without overwriting them.
    const updated = await tx.demoBalance.updateMany({
      where: { userId, asset, available: { gte: exact } },
      data: { available: { decrement: exact }, locked: { increment: exact } },
    });
    if (updated.count !== 1) {
      throw new DemoTradingError(`Insufficient ${asset} balance`, 'INSUFFICIENT_BALANCE');
    }
  }

  private async settleTrade(tx: TxClient, trade: { side: OrderSide; price: BigNumber; quantity: BigNumber; takerUserId: string; makerUserId: string }, base: string, quote: string) {
    const quoteAmount = trade.price.times(trade.quantity);
    const buyerId = trade.side === 'BUY' ? trade.takerUserId : trade.makerUserId;
    const sellerId = trade.side === 'BUY' ? trade.makerUserId : trade.takerUserId;

    await this.adjustBalance(tx, buyerId, quote, { locked: quoteAmount.negated() });
    await this.adjustBalance(tx, buyerId, base, { available: trade.quantity });
    await this.adjustBalance(tx, sellerId, base, { locked: trade.quantity.negated() });
    await this.adjustBalance(tx, sellerId, quote, { available: quoteAmount });
  }

  private async adjustBalance(tx: TxClient, userId: string, asset: string, delta: { available?: BigNumber; locked?: BigNumber }) {
    const available = delta.available ?? new BigNumber(0), locked = delta.locked ?? new BigNumber(0);
    const exactAvailable = exactDemoDelta(available), exactLocked = exactDemoDelta(locked);
    const data = { available: { increment: exactAvailable }, locked: { increment: exactLocked } };
    if (!available.isNegative() && !locked.isNegative()) {
      await tx.demoBalance.upsert({ where: { userId_asset: { userId, asset } },
        create: { userId, asset, available: exactAvailable, locked: exactLocked }, update: data });
      return;
    }
    const updated = await tx.demoBalance.updateMany({
      where: { userId, asset,
        ...(available.isNegative() ? { available: { gte: available.negated().toFixed() } } : {}),
        ...(locked.isNegative() ? { locked: { gte: locked.negated().toFixed() } } : {}),
      }, data,
    });
    if (updated.count !== 1) throw new DemoTradingError(`Insufficient ${asset} balance`, 'INSUFFICIENT_BALANCE');
  }

  /** Manual credit/debit — the demo equivalent of BalanceAdjustmentService,
   * used only by the admin "demo top-up" route. Always logs to AuditLog. */
  async topUp(params: { userId: string; asset: string; amount: string; performedByAdminId: string; note?: string }) {
    const ownVtaDemo = params.asset === 'VTA' && params.userId === params.performedByAdminId;
    if (isTestAssetPairOrSymbol(params.asset) && !ownVtaDemo) throw new DemoTradingError(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    const delta = new BigNumber(params.amount);
    if (!delta.isFinite() || delta.isZero()) throw new DemoTradingError('Amount must be a non-zero number');
    exactDemoDelta(delta);

    return this.prisma.$transaction(async (tx: TxClient) => {
      if (ownVtaDemo) {
        const admin = await tx.user.findUnique({ where: { id: params.userId }, select: { role: true, blockedAt: true } });
        if (admin?.role !== 'ADMIN' || admin.blockedAt) throw new DemoTradingError('Admin access required');
      }
      await this.adjustBalance(tx, params.userId, params.asset, { available: delta });
      // The preceding atomic mutation holds this row's lock until commit.
      const updated = await tx.demoBalance.findUniqueOrThrow({ where: { userId_asset: { userId: params.userId, asset: params.asset } } });

      await tx.auditLog.create({
        data: {
          userId: params.userId,
          action: 'DEMO_BALANCE_ADJUSTED',
          metadata: {
            asset: params.asset,
            delta: delta.toString(),
            newAvailable: updated.available.toString(),
            reason: 'demo top-up',
            note: params.note ?? null,
            performedByAdminId: params.performedByAdminId,
          },
        },
      });

      return { asset: updated.asset, available: updated.available.toString(), locked: updated.locked.toString() };
    });
  }
}
