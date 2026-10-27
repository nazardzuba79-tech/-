"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderService = exports.spotRequestOrderId = exports.OrderRequestConflict = void 0;
exports.effectiveOrderType = effectiveOrderType;
const client_1 = require("@prisma/client");
const bignumber_js_1 = __importDefault(require("bignumber.js"));
const uuid_1 = require("uuid");
const nrxSpot_1 = require("./testMarkets/nrxSpot");
const testAssetConfig_1 = require("./testMarkets/testAssetConfig");
const access_1 = require("../private-trading/access");
const WalletMutation_1 = require("./WalletMutation");
const SpotBookTransaction_1 = require("./SpotBookTransaction");
/** A client request ID that already placed an order with other terms. */
class OrderRequestConflict extends Error {
}
exports.OrderRequestConflict = OrderRequestConflict;
/** One order per (account, client request ID): a retry after a lost response
 * finds the order its first attempt committed instead of placing a second one
 * (the demo ledger does the same, DemoTradingService.demoOrderId). Another
 * account's request ID never collides; the ID is the table's primary key. */
const spotRequestOrderId = (userId, requestId, leg = 'order') => (0, uuid_1.v5)(`voltex:spot-${leg}:${userId}:${requestId}`, uuid_1.v5.URL);
exports.spotRequestOrderId = spotRequestOrderId;
/** Both absent, or both present and numerically equal. */
const sameAmount = (stored, wanted) => stored === null || wanted == null ? stored === null && wanted == null : new bignumber_js_1.default(stored.toString()).eq(wanted);
const CONDITIONAL_TYPES = new Set(['STOP_LIMIT', 'STOP_MARKET', 'TAKE_PROFIT_LIMIT', 'TAKE_PROFIT_MARKET']);
const LIMIT_FAMILY = new Set(['LIMIT', 'STOP_LIMIT', 'TAKE_PROFIT_LIMIT']);
function isConditionalType(type) {
    return CONDITIONAL_TYPES.has(type);
}
/** LIMIT-family orders (plain LIMIT and the two *_LIMIT conditional types)
 * execute at a fixed price once active; MARKET-family orders (plain
 * MARKET and the two *_MARKET conditional types) execute at whatever the
 * book gives once active. This is the "family" a conditional order joins
 * once PriceWatcherService triggers it. */
function effectiveOrderType(type) {
    return LIMIT_FAMILY.has(type) ? 'LIMIT' : 'MARKET';
}
/**
 * Bridges the in-memory MatchingEngine with persistent balances/orders.
 *
 * CRITICAL INVARIANT (repeated from MatchingEngine.ts because it matters):
 * funds are locked at ORDER PLACEMENT time, inside the same DB transaction
 * that creates the order row. This prevents a user from placing two orders
 * that both spend the same balance before either fills ("balance race").
 * This applies to conditional orders too — a STOP_LIMIT/TAKE_PROFIT_* order
 * locks its funds at placement, sits as PENDING_TRIGGER (never touching the
 * matching engine), and only actually matches once PriceWatcherService
 * calls triggerOrder() after the real market price crosses its trigger.
 */
class OrderService {
    constructor(prisma, engine, priceSource, 
    /**
     * Called once a PENDING_TRIGGER order has COMMITTED, so the price
     * watcher returns to its base cadence immediately rather than after a
     * backed-off wait. Optional: without it the watcher still finds the
     * order within its idle ceiling. Never called from inside the
     * transaction — a watcher woken before the commit would query, find
     * nothing and go back to sleep.
     */
    onConditionalOrderCommitted = () => { }) {
        this.prisma = prisma;
        this.engine = engine;
        this.priceSource = priceSource;
        this.onConditionalOrderCommitted = onConditionalOrderCommitted;
    }
    async placeOrder(params) {
        const requestOrderId = params.requestId ? (0, exports.spotRequestOrderId)(params.userId, params.requestId) : undefined;
        // An earlier attempt with this request ID already committed: answer with it,
        // place and lock nothing (before any price or listing read can fail the retry).
        if (requestOrderId) {
            const existing = await this.prisma.order.findUnique({ where: { id: requestOrderId } });
            if (existing)
                return this.replayOrder(this.prisma, existing, params);
        }
        // Listing gates remain authoritative for every path, including the
        // owner's NRX simulation sale below.
        await (0, nrxSpot_1.assertSpotListingReady)(params.pair);
        // Owner/admin and explicitly allowlisted team test accounts trade with
        // simulation-only Spot settlement for MARKET SELL. Their synthetic/test
        // balances must not depend on another human posting liquidity into the
        // internal book. Ordinary users, BUY orders and non-market orders keep the
        // normal matching-engine path.
        if (params.side === 'SELL' && params.type === 'MARKET') {
            const user = await this.prisma.user.findUnique({
                where: { id: params.userId },
                select: { role: true, blockedAt: true },
            });
            if (user && !user.blockedAt && (user.role === 'ADMIN' || (0, access_1.isSimulationOnlyUser)(params.userId))) {
                return this.sellTeamSpotSimulation(params.userId, params.pair, params.quantity, params.requestId);
            }
        }
        const [base, quote] = params.pair.split('/'); // e.g. BTC/USDT
        const conditional = isConditionalType(params.type);
        const effType = effectiveOrderType(params.type);
        if (effType === 'LIMIT' && !params.price) {
            throw new Error(`price is required for a ${params.type} order`);
        }
        if (conditional && !params.triggerPrice) {
            throw new Error(`triggerPrice is required for a ${params.type} order`);
        }
        let currentPrice = null;
        if (conditional) {
            const ticker = await (0, nrxSpot_1.spotPriceSource)(this.priceSource).getTicker(params.pair);
            if (!ticker)
                throw new Error('Unable to fetch the current market price to validate the trigger price');
            currentPrice = new bignumber_js_1.default(ticker.lastPrice);
            this.validateTriggerDirection(params.type, params.side, params.triggerPrice, currentPrice);
        }
        const lockAsset = params.side === 'BUY' ? quote : base;
        let lockAmount;
        if (conditional) {
            // No live book price to lock against for a not-yet-active order — use
            // the trigger price (LIMIT-family locks its own execution price
            // instead, which is always at least as conservative). MARKET-family
            // gets the same 2% slippage buffer a live MARKET BUY gets, since the
            // price it actually fills at once triggered is just as uncertain.
            const refPrice = effType === 'LIMIT' ? params.price : params.triggerPrice;
            lockAmount =
                params.side === 'BUY' ? refPrice.times(params.quantity).times(effType === 'MARKET' ? 1.02 : 1) : params.quantity;
        }
        else if (params.type === 'LIMIT') {
            lockAmount = params.side === 'BUY' ? params.price.times(params.quantity) : params.quantity;
        }
        else if (params.side === 'SELL') {
            lockAmount = params.quantity;
        }
        else {
            lockAmount = new bignumber_js_1.default(0); // authoritative committed book is loaded inside the transaction
        }
        const placed = await SpotBookTransaction_1.SpotBookTransaction.run(this.prisma, this.engine, async (tx, session) => {
            // Under the Spot book lock: racing first attempts with one request ID place one order.
            if (requestOrderId) {
                const existing = await tx.order.findUnique({ where: { id: requestOrderId } });
                if (existing)
                    return this.replayOrder(tx, existing, params);
            }
            const staged = conditional ? undefined : await session.book(params.pair);
            if (!conditional && params.type === 'MARKET' && params.side === 'BUY') {
                const bestAsk = staged.getBook(params.pair).bestAsk()?.price;
                if (!bestAsk)
                    throw new Error('No liquidity available for this market order');
                lockAmount = params.quantity.times(bestAsk).times(1.02);
            }
            await this.lockFunds(tx, params.userId, lockAsset, lockAmount);
            const orderId = requestOrderId ?? (0, uuid_1.v4)();
            let createdAt = Date.now();
            if (staged)
                for (const side of ['BUY', 'SELL'])
                    for (const resting of staged.getBook(params.pair).getBook(side)) {
                        createdAt = Math.max(createdAt, resting.createdAt + 1);
                    }
            await tx.order.create({
                data: {
                    id: orderId,
                    userId: params.userId,
                    pair: params.pair,
                    side: params.side,
                    type: params.type,
                    price: effType === 'LIMIT' ? params.price.toString() : null,
                    triggerPrice: conditional ? params.triggerPrice.toString() : null,
                    ocoGroupId: params.ocoGroupId ?? null,
                    lockedAmount: conditional ? lockAmount.toString() : null,
                    lockedAsset: conditional ? lockAsset : null,
                    originalQuantity: params.quantity.toString(),
                    remainingQuantity: params.quantity.toString(),
                    status: conditional ? 'PENDING_TRIGGER' : 'OPEN',
                    createdAt: new Date(createdAt),
                },
            });
            // A conditional order does nothing else at placement time — it just
            // waits. PriceWatcherService is what actually submits it to the
            // matching engine, via triggerOrder(), once the real price crosses.
            if (conditional) {
                return {
                    order: {
                        id: orderId,
                        userId: params.userId,
                        pair: params.pair,
                        side: params.side,
                        type: params.type,
                        price: effType === 'LIMIT' ? params.price : null,
                        originalQuantity: params.quantity,
                        remainingQuantity: params.quantity,
                        status: 'PENDING_TRIGGER',
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    },
                    trades: [],
                };
            }
            const order = {
                id: orderId,
                userId: params.userId,
                pair: params.pair,
                side: params.side,
                type: effType,
                price: effType === 'LIMIT' ? params.price : null,
                originalQuantity: params.quantity,
                remainingQuantity: params.quantity,
                status: 'OPEN',
                createdAt,
                updatedAt: Date.now(),
            };
            return this.matchAndSettle(tx, staged, order, base, quote, lockAsset, lockAmount, params.price ?? null);
        });
        // After the commit, never inside it: a watcher woken before this row
        // is readable would query, find nothing and go back to sleep.
        if (conditional)
            this.onConditionalOrderCommitted();
        return placed;
    }
    /** The committed outcome of an earlier attempt with the same request ID.
     * Other terms under that ID are refused: one request is one order. */
    async replayOrder(db, row, params) {
        const limitFamily = effectiveOrderType(params.type) === 'LIMIT';
        const same = row.userId === params.userId && row.pair === params.pair && row.side === params.side && row.type === params.type
            && row.ocoGroupId === null && new bignumber_js_1.default(row.originalQuantity.toString()).eq(params.quantity)
            && sameAmount(row.price, limitFamily ? params.price : null)
            && sameAmount(row.triggerPrice, isConditionalType(params.type) ? params.triggerPrice : null);
        if (!same)
            throw new OrderRequestConflict('This request was already used for a different order');
        const trades = await db.trade.findMany({ where: { takerOrderId: row.id }, orderBy: [{ executedAt: 'asc' }, { id: 'asc' }] });
        return {
            order: {
                id: row.id, userId: row.userId, pair: row.pair, side: row.side, type: row.type,
                price: row.price ? new bignumber_js_1.default(row.price.toString()) : null,
                originalQuantity: new bignumber_js_1.default(row.originalQuantity.toString()), remainingQuantity: new bignumber_js_1.default(row.remainingQuantity.toString()),
                status: row.status, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime(),
            },
            trades: trades.map(t => ({ id: t.id, pair: t.pair, takerOrderId: t.takerOrderId, makerOrderId: t.makerOrderId, takerUserId: t.takerUserId,
                makerUserId: t.makerUserId, price: new bignumber_js_1.default(t.price.toString()), quantity: new bignumber_js_1.default(t.quantity.toString()),
                side: t.side, executedAt: t.executedAt.getTime() })),
            replayed: true,
        };
    }
    /**
     * Simulation-only Spot liquidation for the owner/admin and explicitly
     * allowlisted team test accounts.
     *
     * This does NOT touch MatchingEngine depth. The caller's ordinary Spot
     * balance is still the source of truth and is debited atomically; proceeds
     * are credited in the quote asset at the canonical/current server price.
     * Scope is intentionally narrow: SELL + MARKET only.
     */
    async sellTeamSpotSimulation(userId, pair, quantity, requestId) {
        if (!quantity.isFinite() || quantity.lte(0))
            throw new Error('Quantity must be greater than zero');
        const [base, quote] = pair.split('/');
        if (!base || !quote)
            throw new Error('Invalid Spot pair');
        const terms = { userId, pair, side: 'SELL', type: 'MARKET', quantity };
        // A concurrent attempt with the same request ID fails on the order's primary
        // key (the whole sale rolls back); both then answer with the committed order.
        if (requestId) {
            try {
                return await this.sellTeamSpotSimulationOnce(userId, pair, quantity, (0, exports.spotRequestOrderId)(userId, requestId));
            }
            catch (error) {
                const existing = await this.prisma.order.findUnique({ where: { id: (0, exports.spotRequestOrderId)(userId, requestId) } });
                if (existing)
                    return this.replayOrder(this.prisma, existing, terms);
                throw error;
            }
        }
        return this.sellTeamSpotSimulationOnce(userId, pair, quantity, (0, uuid_1.v4)());
    }
    async sellTeamSpotSimulationOnce(userId, pair, quantity, orderId) {
        const [base, quote] = pair.split('/');
        // The same server price the pair's Spot ticker, chart and conditional
        // triggers use: NRX and a published managed listing their model price,
        // an ordinary pair the venue. A modeled pair is never priced by the venue.
        const ticker = await (0, nrxSpot_1.spotPriceSource)(this.priceSource).getTicker(pair);
        const price = ticker ? new bignumber_js_1.default(ticker.lastPrice) : new bignumber_js_1.default(NaN);
        if (!price.isFinite() || price.lte(0))
            throw new Error('Simulation price is temporarily unavailable');
        // Default-off P0 fence: an explicitly enabled, private simulated-asset sale
        // settles proceeds ONLY in DemoBalance. It never mints spendable Spot USDT.
        // No change to normal venues or existing feature switches.
        const simulatedAsset = (0, testAssetConfig_1.isTestAssetPairOrSymbol)(pair);
        if (simulatedAsset && process.env.SIMULATION_SPOT_DEMO_SETTLEMENT_ENABLED !== 'true')
            throw new Error('Simulation Spot sale is not available for this listing');
        const proceeds = price.times(quantity);
        if (!proceeds.isFinite() || proceeds.gte('1000000000000000000'))
            throw new Error('Simulation proceeds exceed supported precision');
        if (simulatedAsset && (proceeds.decimalPlaces() ?? 19) > 18)
            throw new Error('Simulation proceeds exceed demo ledger precision');
        const now = Date.now();
        const tradeId = (0, uuid_1.v4)();
        const syntheticMaker = `simulation:${base}`;
        const auditAction = 'TEAM_SPOT_SIMULATION_SOLD';
        return this.prisma.$transaction(async (tx) => {
            // Re-check server-side test identity and block state inside the financial
            // transaction. The client cannot opt itself into this settlement path.
            const user = await tx.user.findUnique({
                where: { id: userId },
                select: { role: true, blockedAt: true },
            });
            if (!user || user.blockedAt || (user.role !== 'ADMIN' && !(0, access_1.isSimulationOnlyUser)(userId))) {
                throw new Error('Simulation Spot sale is not available for this account');
            }
            await (0, WalletMutation_1.mutateSpotBalance)(tx, userId, base, { available: quantity.negated() });
            if (simulatedAsset) {
                // The debit and the non-withdrawable demo credit share one serializable transaction.
                // DemoBalance is excluded from the real Spot book, transfers and withdrawals.
                // A unique (userId, asset) key makes retries and concurrent credits atomic.
                const amount = proceeds.toFixed(18);
                await tx.demoBalance.upsert({
                    where: { userId_asset: { userId, asset: quote } },
                    create: { userId, asset: quote, available: amount },
                    update: { available: { increment: amount } },
                });
            }
            else {
                await (0, WalletMutation_1.mutateSpotBalance)(tx, userId, quote, { available: proceeds });
            }
            await tx.order.create({
                data: {
                    id: orderId,
                    userId,
                    pair,
                    side: 'SELL',
                    type: 'MARKET',
                    price: null,
                    originalQuantity: quantity.toFixed(),
                    remainingQuantity: '0',
                    status: 'FILLED',
                    createdAt: new Date(now),
                },
            });
            await tx.trade.create({
                data: {
                    id: tradeId,
                    pair,
                    takerOrderId: orderId,
                    makerOrderId: syntheticMaker,
                    takerUserId: userId,
                    makerUserId: syntheticMaker,
                    price: price.toFixed(),
                    quantity: quantity.toFixed(),
                    side: 'SELL',
                    executedAt: new Date(now),
                },
            });
            await tx.auditLog.create({
                data: {
                    userId,
                    action: auditAction,
                    metadata: {
                        pair,
                        asset: base,
                        quote,
                        orderId,
                        tradeId,
                        quantity: quantity.toFixed(),
                        price: price.toFixed(),
                        proceeds: proceeds.toFixed(),
                        counterparty: syntheticMaker,
                        source: 'VOLTEX team test Spot simulation',
                        settlementLedger: simulatedAsset ? 'DemoBalance' : 'Balance',
                        withdrawableProceeds: !simulatedAsset,
                    },
                },
            });
            return {
                order: {
                    id: orderId,
                    userId,
                    pair,
                    side: 'SELL',
                    type: 'MARKET',
                    price: null,
                    originalQuantity: quantity,
                    remainingQuantity: new bignumber_js_1.default(0),
                    status: 'FILLED',
                    createdAt: now,
                    updatedAt: now,
                },
                trades: [{
                        id: tradeId,
                        pair,
                        takerOrderId: orderId,
                        makerOrderId: syntheticMaker,
                        takerUserId: userId,
                        makerUserId: syntheticMaker,
                        price,
                        quantity,
                        side: 'SELL',
                        executedAt: now,
                    }],
            };
        }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
    }
    /**
     * Places a One-Cancels-the-Other pair: a take-profit leg and a stop leg,
     * same side/quantity, sharing one fund lock (only one leg will ever
     * actually execute) and one ocoGroupId. When either leg triggers or is
     * cancelled, PriceWatcherService/cancelOrder cancels the sibling.
     */
    async placeOcoOrder(params) {
        const ids = params.requestId ? {
            ocoGroupId: (0, exports.spotRequestOrderId)(params.userId, params.requestId, 'oco'),
            takeProfitOrderId: (0, exports.spotRequestOrderId)(params.userId, params.requestId, 'oco-take-profit'),
            stopOrderId: (0, exports.spotRequestOrderId)(params.userId, params.requestId, 'oco-stop'),
        } : undefined;
        if (ids) {
            const replay = await this.replayOco(this.prisma, ids, params);
            if (replay)
                return replay;
        }
        await (0, nrxSpot_1.assertSpotListingReady)(params.pair);
        const [base, quote] = params.pair.split('/');
        const ticker = await (0, nrxSpot_1.spotPriceSource)(this.priceSource).getTicker(params.pair);
        if (!ticker)
            throw new Error('Unable to fetch the current market price to validate the trigger prices');
        const currentPrice = new bignumber_js_1.default(ticker.lastPrice);
        this.validateTriggerDirection('TAKE_PROFIT_LIMIT', params.side, params.takeProfitPrice, currentPrice);
        this.validateTriggerDirection('STOP_LIMIT', params.side, params.stopTriggerPrice, currentPrice);
        const lockAsset = params.side === 'BUY' ? quote : base;
        // Only one leg will ever fill, so lock the larger of the two — the
        // other leg's cancellation (by triggerOrder, once its sibling fires)
        // never touches the balance again.
        const lockAmount = params.side === 'BUY'
            ? bignumber_js_1.default.maximum(params.takeProfitPrice.times(params.quantity), params.stopLimitPrice.times(params.quantity))
            : params.quantity;
        const oco = await SpotBookTransaction_1.SpotBookTransaction.run(this.prisma, this.engine, async (tx) => {
            if (ids) {
                const replay = await this.replayOco(tx, ids, params);
                if (replay)
                    return replay;
            }
            await this.lockFunds(tx, params.userId, lockAsset, lockAmount);
            const ocoGroupId = ids?.ocoGroupId ?? (0, uuid_1.v4)();
            const takeProfitId = ids?.takeProfitOrderId ?? (0, uuid_1.v4)();
            const stopId = ids?.stopOrderId ?? (0, uuid_1.v4)();
            const shared = {
                userId: params.userId,
                pair: params.pair,
                side: params.side,
                ocoGroupId,
                lockedAmount: lockAmount.toString(),
                lockedAsset: lockAsset,
                originalQuantity: params.quantity.toString(),
                remainingQuantity: params.quantity.toString(),
                status: 'PENDING_TRIGGER',
            };
            await tx.order.create({
                data: {
                    id: takeProfitId,
                    ...shared,
                    type: 'TAKE_PROFIT_LIMIT',
                    price: params.takeProfitPrice.toString(),
                    triggerPrice: params.takeProfitPrice.toString(),
                },
            });
            await tx.order.create({
                data: {
                    id: stopId,
                    ...shared,
                    type: 'STOP_LIMIT',
                    price: params.stopLimitPrice.toString(),
                    triggerPrice: params.stopTriggerPrice.toString(),
                },
            });
            return { ocoGroupId, takeProfitOrderId: takeProfitId, stopOrderId: stopId };
        });
        // Both legs rest as PENDING_TRIGGER, so this always has work for the
        // watcher — after the commit, for the same reason as above.
        this.onConditionalOrderCommitted();
        return oco;
    }
    /** An OCO pair an earlier attempt with this request ID committed, or null. */
    async replayOco(db, ids, params) {
        const [takeProfit, stop] = await Promise.all([ids.takeProfitOrderId, ids.stopOrderId].map(id => db.order.findUnique({ where: { id } })));
        if (!takeProfit && !stop)
            return null;
        const leg = (row, type, price, trigger) => !!row && row.userId === params.userId
            && row.pair === params.pair && row.side === params.side && row.type === type && row.ocoGroupId === ids.ocoGroupId
            && new bignumber_js_1.default(row.originalQuantity.toString()).eq(params.quantity) && sameAmount(row.price, price) && sameAmount(row.triggerPrice, trigger);
        if (!leg(takeProfit, 'TAKE_PROFIT_LIMIT', params.takeProfitPrice, params.takeProfitPrice) || !leg(stop, 'STOP_LIMIT', params.stopLimitPrice, params.stopTriggerPrice)) {
            throw new OrderRequestConflict('This request was already used for a different order');
        }
        return { ...ids, replayed: true };
    }
    /**
     * Activates a PENDING_TRIGGER order once its trigger condition has been
     * met (called by PriceWatcherService, never directly by a route). Reuses
     * the exact settlement/refund logic real immediate orders go through —
     * the only difference is the fund lock already happened at placement
     * time, so it's read back from the stored row instead of recomputed.
     * Returns null if the order is no longer PENDING_TRIGGER (already
     * cancelled by the user, or by its OCO sibling triggering first) — a
     * normal, expected race, not an error.
     */
    async triggerOrder(orderId) {
        return SpotBookTransaction_1.SpotBookTransaction.run(this.prisma, this.engine, async (tx, session) => {
            const row = await tx.order.findUnique({ where: { id: orderId } });
            if (!row || row.status !== 'PENDING_TRIGGER')
                return null;
            const staged = await session.book(row.pair);
            const [base, quote] = row.pair.split('/');
            const effType = effectiveOrderType(row.type);
            const lockAsset = row.lockedAsset;
            const lockAmount = new bignumber_js_1.default(row.lockedAmount.toString());
            const price = row.price ? new bignumber_js_1.default(row.price.toString()) : null;
            const order = {
                id: row.id,
                userId: row.userId,
                pair: row.pair,
                side: row.side,
                type: effType,
                price: effType === 'LIMIT' ? price : null,
                originalQuantity: new bignumber_js_1.default(row.originalQuantity.toString()),
                remainingQuantity: new bignumber_js_1.default(row.remainingQuantity.toString()),
                status: 'OPEN',
                createdAt: row.createdAt.getTime(),
                updatedAt: Date.now(),
            };
            // Persist the type flip (STOP_LIMIT -> LIMIT etc.) so the order no
            // longer reads as "conditional" anywhere downstream (open-orders
            // list, cancelOrder) once it's a live book order.
            await tx.order.update({ where: { id: row.id }, data: { type: effType } });
            const result = await this.matchAndSettle(tx, staged, order, base, quote, lockAsset, lockAmount, price);
            if (row.ocoGroupId) {
                const sibling = await tx.order.findFirst({
                    where: { ocoGroupId: row.ocoGroupId, id: { not: row.id }, status: 'PENDING_TRIGGER' },
                });
                if (sibling) {
                    // The shared lock was already fully accounted for by this leg's
                    // own settlement above — cancelling the sibling must NOT touch
                    // the balance again, or the same funds get refunded twice.
                    await tx.order.update({ where: { id: sibling.id }, data: { status: 'CANCELLED' } });
                }
            }
            return result;
        });
    }
    /**
     * Moves a still-PENDING_TRIGGER order's trigger price (and, for a
     * LIMIT-family conditional order, its execution price too) — what
     * powers dragging a SL/TP line on the chart. Re-validates direction
     * against the current market price exactly like placement does, and
     * adjusts the fund lock by the delta rather than releasing and
     * re-locking (so a balance dip between the two steps can never leave
     * the order under-margined). Returns null if the order doesn't exist,
     * isn't the caller's, or is no longer pending (already triggered/
     * cancelled) — a normal race, not an error.
     */
    async updateConditionalOrder(userId, orderId, updates) {
        const candidate = await this.prisma.order.findUnique({ where: { id: orderId } });
        if (!candidate || candidate.userId !== userId || candidate.status !== 'PENDING_TRIGGER')
            return null;
        const ticker = await (0, nrxSpot_1.spotPriceSource)(this.priceSource).getTicker(candidate.pair);
        if (!ticker)
            throw new Error('Unable to fetch the current market price to validate the trigger price');
        return SpotBookTransaction_1.SpotBookTransaction.run(this.prisma, this.engine, async (tx) => {
            const row = await tx.order.findUnique({ where: { id: orderId } });
            if (!row || row.userId !== userId || row.status !== 'PENDING_TRIGGER')
                return null;
            const effType = effectiveOrderType(row.type);
            const newTriggerPrice = updates.triggerPrice ?? new bignumber_js_1.default(row.triggerPrice.toString());
            const newPrice = effType === 'LIMIT' ? updates.price ?? new bignumber_js_1.default(row.price.toString()) : null;
            const currentPrice = new bignumber_js_1.default(ticker.lastPrice);
            this.validateTriggerDirection(row.type, row.side, newTriggerPrice, currentPrice);
            const lockAsset = row.lockedAsset;
            const oldLockAmount = new bignumber_js_1.default(row.lockedAmount.toString());
            const quantity = new bignumber_js_1.default(row.remainingQuantity.toString());
            const refPrice = effType === 'LIMIT' ? newPrice : newTriggerPrice;
            // SELL locks the base quantity outright, unaffected by price — only
            // a BUY-side lock (quote-denominated) actually moves with the price.
            let newLockAmount = row.side === 'BUY' ? refPrice.times(quantity).times(effType === 'MARKET' ? 1.02 : 1) : quantity;
            // An OCO pair's shared lock must stay at least as large as whatever
            // the untouched sibling leg alone would need — never shrink below that.
            if (row.ocoGroupId && row.side === 'BUY') {
                const sibling = await tx.order.findFirst({
                    where: { ocoGroupId: row.ocoGroupId, id: { not: row.id }, status: 'PENDING_TRIGGER' },
                });
                if (sibling) {
                    const siblingRefPrice = sibling.price
                        ? new bignumber_js_1.default(sibling.price.toString())
                        : new bignumber_js_1.default(sibling.triggerPrice.toString());
                    newLockAmount = bignumber_js_1.default.maximum(newLockAmount, siblingRefPrice.times(quantity));
                }
            }
            const delta = newLockAmount.minus(oldLockAmount);
            if (delta.isGreaterThan(0)) {
                const balance = await tx.balance.findUnique({ where: { userId_asset: { userId, asset: lockAsset } } });
                const available = new bignumber_js_1.default(balance?.available.toString() ?? '0');
                if (available.isLessThan(delta)) {
                    throw new Error(`Insufficient ${lockAsset} balance to move the trigger price that far`);
                }
            }
            if (!delta.isZero()) {
                await this.adjustBalance(tx, userId, lockAsset, { available: delta.negated(), locked: delta });
            }
            await tx.order.update({
                where: { id: row.id },
                data: {
                    triggerPrice: newTriggerPrice.toString(),
                    price: newPrice ? newPrice.toString() : row.price,
                    lockedAmount: newLockAmount.toString(),
                },
            });
            if (row.ocoGroupId) {
                const sibling = await tx.order.findFirst({
                    where: { ocoGroupId: row.ocoGroupId, id: { not: row.id }, status: 'PENDING_TRIGGER' },
                });
                if (sibling) {
                    await tx.order.update({ where: { id: sibling.id }, data: { lockedAmount: newLockAmount.toString() } });
                }
            }
            return { id: row.id, triggerPrice: newTriggerPrice.toString(), price: newPrice?.toString() ?? row.price };
        });
    }
    /** Shared core of placeOrder's immediate path and triggerOrder: run the
     * order through the matching engine, persist trades, settle both sides,
     * update the order row, and refund whatever of the lock wasn't consumed
     * or isn't still backing a resting order. */
    async matchAndSettle(tx, engine, order, base, quote, lockAsset, lockAmount, limitPrice) {
        const makerRemaining = new Map();
        for (const side of ['BUY', 'SELL'])
            for (const maker of engine.getBook(order.pair).getBook(side)) {
                makerRemaining.set(maker.id, maker.remainingQuantity);
            }
        const { trades, order: finalOrder } = engine.submitOrder(order);
        const changedMakers = new Set();
        for (const trade of trades) {
            makerRemaining.set(trade.makerOrderId, makerRemaining.get(trade.makerOrderId).minus(trade.quantity));
            changedMakers.add(trade.makerOrderId);
            await tx.trade.create({
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
            await this.settleTrade(tx, trade, base, quote);
        }
        for (const id of changedMakers) {
            const remaining = makerRemaining.get(id);
            await tx.order.update({ where: { id }, data: {
                    remainingQuantity: remaining.toFixed(), status: remaining.isZero() ? 'FILLED' : 'PARTIALLY_FILLED',
                } });
        }
        await tx.order.update({
            where: { id: order.id },
            data: {
                status: finalOrder.status,
                remainingQuantity: finalOrder.remainingQuantity.toString(),
            },
        });
        // Refund whatever of the initial lock wasn't actually consumed AND
        // isn't still backing a resting order. A LIMIT order that's still
        // (partially) OPEN must keep remainingQuantity locked at its limit
        // price/quantity — only the "price improvement" on the filled slice
        // (trade price better than the limit) is refundable now. A MARKET
        // order never rests, so everything beyond what actually filled —
        // including the slippage buffer — is refundable.
        const stillResting = order.type === 'LIMIT' && finalOrder.remainingQuantity.isGreaterThan(0);
        const shouldRemainLocked = stillResting
            ? order.side === 'BUY'
                ? finalOrder.remainingQuantity.times(limitPrice)
                : finalOrder.remainingQuantity
            : new bignumber_js_1.default(0);
        const consumedOrFilled = order.side === 'BUY'
            ? trades.reduce((sum, t) => sum.plus(t.price.times(t.quantity)), new bignumber_js_1.default(0))
            : order.originalQuantity.minus(finalOrder.remainingQuantity);
        const refund = lockAmount.minus(consumedOrFilled).minus(shouldRemainLocked);
        if (refund.isGreaterThan(0)) {
            await this.adjustBalance(tx, order.userId, lockAsset, { available: refund, locked: refund.negated() });
        }
        return { order: finalOrder, trades };
    }
    /**
     * A STOP order protects against an adverse move, so it must sit on the
     * far side of the current price from where the market would need to go
     * to hurt the position: a SELL stop (protecting a long) triggers as
     * price falls, so it must start below the current price; a BUY stop
     * (protecting a short, or a breakout entry) triggers as price rises, so
     * it must start above. A TAKE_PROFIT order captures a favorable move, so
     * it's the mirror image: SELL take-profit sits above, BUY take-profit
     * sits below.
     */
    validateTriggerDirection(type, side, triggerPrice, currentPrice) {
        const isStopFamily = type === 'STOP_LIMIT' || type === 'STOP_MARKET';
        const mustBeBelow = (isStopFamily && side === 'SELL') || (!isStopFamily && side === 'BUY');
        if (mustBeBelow && triggerPrice.isGreaterThanOrEqualTo(currentPrice)) {
            throw new Error(`Trigger price must be below the current price (${currentPrice.toString()})`);
        }
        if (!mustBeBelow && triggerPrice.isLessThanOrEqualTo(currentPrice)) {
            throw new Error(`Trigger price must be above the current price (${currentPrice.toString()})`);
        }
    }
    async lockFunds(tx, userId, asset, amount) {
        await (0, WalletMutation_1.mutateSpotBalance)(tx, userId, asset, { available: amount.negated(), locked: amount });
    }
    /**
     * Cancels a resting OR pending-trigger order and releases whatever of it
     * was still locked. Returns null if the order doesn't exist, isn't the
     * caller's, or is no longer cancellable (already FILLED/CANCELLED) — the
     * route maps that to a 404/409 as appropriate.
     */
    async cancelOrder(userId, orderId) {
        return SpotBookTransaction_1.SpotBookTransaction.run(this.prisma, this.engine, async (tx, session) => {
            const order = await tx.order.findUnique({ where: { id: orderId } });
            if (!order || order.userId !== userId)
                return null;
            if (!['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'].includes(order.status))
                return null;
            const staged = order.status === 'PENDING_TRIGGER' ? undefined : await session.book(order.pair);
            await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
            if (order.status === 'PENDING_TRIGGER') {
                // Never touched the matching engine — its whole lock (shared with
                // its OCO sibling, if any) is refundable outright. Only refund
                // once per OCO pair: skip if the sibling already triggered and
                // resolved this lock (it would no longer be PENDING_TRIGGER).
                await this.adjustBalance(tx, userId, order.lockedAsset, {
                    available: new bignumber_js_1.default(order.lockedAmount.toString()),
                    locked: new bignumber_js_1.default(order.lockedAmount.toString()).negated(),
                });
                if (order.ocoGroupId) {
                    const sibling = await tx.order.findFirst({
                        where: { ocoGroupId: order.ocoGroupId, id: { not: order.id }, status: 'PENDING_TRIGGER' },
                    });
                    if (sibling)
                        await tx.order.update({ where: { id: sibling.id }, data: { status: 'CANCELLED' } });
                }
                return order;
            }
            if (!staged.cancelOrder(order.pair, order.id))
                throw new Error('Active Spot order missing from committed book');
            const [base, quote] = order.pair.split('/');
            const remaining = new bignumber_js_1.default(order.remainingQuantity.toString());
            if (order.side === 'BUY') {
                const amount = remaining.times(new bignumber_js_1.default(order.price.toString()));
                await this.adjustBalance(tx, userId, quote, { available: amount, locked: amount.negated() });
            }
            else {
                await this.adjustBalance(tx, userId, base, { available: remaining, locked: remaining.negated() });
            }
            return order;
        });
    }
    /** Moves locked/available balances for both counterparties of a trade. */
    async settleTrade(tx, trade, base, quote) {
        const quoteAmount = trade.price.times(trade.quantity);
        // Taker and maker sides depend on trade.side (side of the taker).
        const buyerId = trade.side === 'BUY' ? trade.takerUserId : trade.makerUserId;
        const sellerId = trade.side === 'BUY' ? trade.makerUserId : trade.takerUserId;
        // Buyer: loses locked quote, gains available base.
        await this.adjustBalance(tx, buyerId, quote, { locked: quoteAmount.negated() });
        await this.adjustBalance(tx, buyerId, base, { available: trade.quantity });
        // Seller: loses locked base, gains available quote.
        await this.adjustBalance(tx, sellerId, base, { locked: trade.quantity.negated() });
        await this.adjustBalance(tx, sellerId, quote, { available: quoteAmount });
    }
    async adjustBalance(tx, userId, asset, delta) {
        await (0, WalletMutation_1.mutateSpotBalance)(tx, userId, asset, delta);
    }
}
exports.OrderService = OrderService;
//# sourceMappingURL=OrderService.js.map