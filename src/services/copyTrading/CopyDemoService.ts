import { Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';
import { DemoTradingError, DemoTradingService } from '../DemoTradingService';
import { DEMO_SPOT_LEDGER, SpotBookTransaction } from '../SpotBookTransaction';
import { PUBLIC_STRATEGIES } from './strategyOwner';

type Tx = Prisma.TransactionClient;
const ACTIVE = ['OPEN', 'PARTIALLY_FILLED'];
const bn = (n: { toString(): string } | string) => new BigNumber(n.toString());
export const copyDemoEnabled = (env: NodeJS.ProcessEnv = process.env) => {
  if (env.COPY_DEMO_ENABLED !== 'true' || env.COPY_DEMO_ISOLATED_REVIEW !== 'true'
    || env.DEMO_SPOT_ENABLED !== 'true' || env.NODE_ENV !== 'test') return false;
  try {
    const db = new URL(env.DATABASE_URL ?? '');
    return ['postgres:', 'postgresql:'].includes(db.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(db.hostname)
      && /^\/copy_demo_[a-z0-9_]+$/.test(db.pathname);
  } catch { return false; }
};
export class CopyDemoError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export interface CopyDemoRisk { ratio: string; maxOrderUsdt: string; maxExposureUsdt: string }

/** First vertical slice: only bound leaders' real demo Spot LIMIT commands.
 * Synthetic performance snapshots are deliberately not imported. No top-up,
 * price feed, exchange connector or real ledger is reachable from this class.
 */
export class CopyDemoService {
  constructor(private db: PrismaClient, private engine: MatchingEngine,
    private demo: DemoTradingService, private enabled = copyDemoEnabled) {}
  private on() { if (!this.enabled()) throw new CopyDemoError('COPY_DEMO_OFF', 403); }
  private lock<T>(work: (tx: Tx) => Promise<T>) {
    return SpotBookTransaction.run(this.db, this.engine, work, DEMO_SPOT_LEDGER);
  }
  private async audit(tx: Tx, userId: string, action: string, details: Record<string, string>) {
    await tx.auditLog.create({ data: { userId, action, metadata: details } });
  }
  private async admitted(tx: Tx, userId: string) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { blockedAt: true } });
    const credit = await tx.auditLog.findFirst({ where: { userId, action: 'DEMO_BALANCE_ADJUSTED' }, select: { id: true } });
    if (!user || user.blockedAt || !credit) throw new CopyDemoError('COPY_DEMO_ACCESS_DENIED', 403);
  }
  private risk(risk: CopyDemoRisk) {
    for (const v of Object.values(risk)) if (!/^(0|[1-9]\d{0,11})(\.\d{1,8})?$/.test(v) || !bn(v).gt(0)) throw new CopyDemoError('INVALID_RISK', 400);
    if (bn(risk.ratio).gt(1) || bn(risk.maxOrderUsdt).gt(risk.maxExposureUsdt)) throw new CopyDemoError('INVALID_RISK', 400);
  }
  async subscribe(userId: string, traderId: string, risk: CopyDemoRisk) {
    this.on(); this.risk(risk);
    return this.lock(async tx => {
      this.on(); await this.admitted(tx, userId);
      if (!(PUBLIC_STRATEGIES as readonly string[]).includes(traderId)) throw new CopyDemoError('UNSUPPORTED_STRATEGY', 400);
      const strategy = await tx.copyStrategyOwner.findUnique({ where: { traderId } });
      if (!strategy?.ownerUserId) throw new CopyDemoError('STRATEGY_NOT_BOUND');
      await this.admitted(tx, strategy.ownerUserId);
      // Leaders cannot follow anyone: forbids self-copy and all multi-hop cycles.
      if (await tx.copyStrategyOwner.findFirst({ where: { ownerUserId: userId } })) throw new CopyDemoError('LEADER_CANNOT_FOLLOW', 403);
      const current = await tx.copyDemoSubscription.findUnique({ where: { userId } });
      if (current && (current.traderId !== traderId || current.ownerUserId !== strategy.ownerUserId || current.status === 'STOPPING')) throw new CopyDemoError('STOP_OR_RECONCILE_EXISTING_SUBSCRIPTION');
      if (current?.status !== 'ACTIVE' && await tx.copyDemoSubscription.count({ where: { traderId, status: 'ACTIVE' } }) >= 25) throw new CopyDemoError('REVIEW_CAPACITY_REACHED');
      const ledger = current ? await this.ledger(tx, current.id) : null;
      if (ledger && ledger.exposure.gt(risk.maxExposureUsdt)) throw new CopyDemoError('EXPOSURE_ABOVE_NEW_LIMIT');
      const sub = await tx.copyDemoSubscription.upsert({ where: { userId },
        create: { userId, traderId, ownerUserId: strategy.ownerUserId, ...risk },
        update: { ...risk, status: 'ACTIVE' } });
      await this.audit(tx, userId, 'COPY_DEMO_SUBSCRIBED', { subscriptionId: sub.id, traderId, ...risk });
      return sub;
    });
  }
  /** Called inside the SAME transaction that commits the leader's demo order. */
  async orderLifecycle(tx: Tx, sourceOrderId: string, event: 'PLACED' | 'CANCELLED') {
    if (!this.enabled()) return;
    if (event === 'CANCELLED') {
      const copied = await tx.copyDemoExecution.findUnique({ where: { demoOrderId: sourceOrderId }, include: { subscription: true } });
      if (copied) await this.audit(tx, copied.subscription.userId, 'COPY_DEMO_ORDER_CANCELLED', { executionId: copied.id, demoOrderId: sourceOrderId });
      await tx.copyDemoExecution.updateMany({ where: { sourceOrderId, status: 'PENDING' }, data: { status: 'SKIPPED', reason: 'SOURCE_CANCELLED' } });
      await tx.copyDemoExecution.updateMany({ where: { sourceOrderId, status: 'EXECUTED' }, data: { cancelRequested: true } });
      return;
    }
    const order = await tx.demoOrder.findUniqueOrThrow({ where: { id: sourceOrderId } });
    const subs = await tx.copyDemoSubscription.findMany({ where: { ownerUserId: order.userId, status: 'ACTIVE' } });
    for (const sub of subs) {
      const supported = order.type === 'LIMIT' && /^[A-Z0-9]{2,16}\/USDT$/.test(order.pair);
      await tx.copyDemoExecution.create({ data: { subscriptionId: sub.id, sourceOrderId, pair: order.pair,
        side: order.side, sourceType: order.type, sourcePrice: order.price, sourceQuantity: order.originalQuantity,
        ratio: sub.ratio, status: supported ? 'PENDING' : 'REJECTED', reason: supported ? null : 'UNSUPPORTED_ORDER' } });
    }
  }
  /** Append only a reference/sequence, never duplicate price/quantity/balances.
   * DemoTrade has millisecond timestamps; ties must not reorder BUY and SELL.
   */
  async captureFills(tx: Tx, tradeIds: string[]) {
    if (!this.enabled()) return;
    for (const tradeId of tradeIds) {
      const trade = await tx.demoTrade.findUniqueOrThrow({ where: { id: tradeId } });
      const executions = await tx.copyDemoExecution.findMany({ where: { demoOrderId: { in: [trade.makerOrderId, trade.takerOrderId] } } });
      if (executions.length && trade.makerUserId === trade.takerUserId) throw new CopyDemoError('COPY_SELF_MATCH_REFUSED');
      for (const execution of executions) await tx.copyDemoFill.upsert({
        where: { executionId_tradeId: { executionId: execution.id, tradeId } }, create: { executionId: execution.id, tradeId }, update: {},
      });
    }
  }
  /** Derive positions, realized PnL and reserves only from committed demo fills. */
  private async ledger(tx: Tx, subscriptionId: string) {
    const executions = await tx.copyDemoExecution.findMany({ where: { subscriptionId, demoOrderId: { not: null } } });
    const ids = executions.map(e => e.demoOrderId!);
    const orders = await tx.demoOrder.findMany({ where: { id: { in: ids } } });
    const trades = await tx.demoTrade.findMany({ where: { OR: [{ makerOrderId: { in: ids } }, { takerOrderId: { in: ids } }] } });
    const receipts = await tx.copyDemoFill.findMany({ where: { executionId: { in: executions.map(e => e.id) } }, orderBy: { sequence: 'asc' } });
    const positions = new Map<string, { quantity: BigNumber; cost: BigNumber; reservedSell: BigNumber }>();
    const position = (pair: string) => { let p = positions.get(pair); if (!p) { p = { quantity: bn('0'), cost: bn('0'), reservedSell: bn('0') }; positions.set(pair, p); } return p; };
    let pnl = bn('0'), reserve = bn('0');
    const byId = new Map(orders.map(o => [o.id, o]));
    const byTrade = new Map(trades.map(t => [t.id, t]));
    const byExecution = new Map(executions.map(e => [e.id, e]));
    const expected = trades.reduce((n, t) => n + Number(byId.has(t.makerOrderId)) + Number(byId.has(t.takerOrderId)), 0);
    if (expected !== receipts.length) throw new CopyDemoError('COPY_LEDGER_RECONCILIATION_REQUIRED');
    for (const receipt of receipts) {
      const trade = byTrade.get(receipt.tradeId), execution = byExecution.get(receipt.executionId);
      const order = execution?.demoOrderId ? byId.get(execution.demoOrderId) : undefined;
      if (!trade || !order) throw new CopyDemoError('COPY_LEDGER_RECONCILIATION_REQUIRED');
      const p = position(order.pair), q = bn(trade.quantity), value = q.times(bn(trade.price));
      if (order.side === 'BUY') { p.quantity = p.quantity.plus(q); p.cost = p.cost.plus(value); }
      else {
        if (q.gt(p.quantity)) throw new CopyDemoError('COPY_LEDGER_RECONCILIATION_REQUIRED');
        const cost = p.quantity.isZero() ? bn('0') : p.cost.times(q).div(p.quantity);
        pnl = pnl.plus(value.minus(cost)); p.quantity = p.quantity.minus(q); p.cost = p.cost.minus(cost);
      }
    }
    for (const order of orders) if (ACTIVE.includes(order.status)) {
      if (order.side === 'BUY') reserve = reserve.plus(bn(order.remainingQuantity).times(bn(order.price!)));
      else position(order.pair).reservedSell = position(order.pair).reservedSell.plus(bn(order.remainingQuantity));
    }
    const exposure = [...positions.values()].reduce((n, p) => n.plus(p.cost), reserve);
    return { positions, exposure, pnl, orders };
  }
  async snapshot(userId: string) {
    this.on();
    return this.lock(async tx => {
      await this.admitted(tx, userId);
      const sub = await tx.copyDemoSubscription.findUnique({ where: { userId } });
      if (!sub) return { mode: 'ISOLATED_DEMO' as const, subscription: null, executions: [], positions: [], realizedPnlUsdt: '0', exposureUsdt: '0' };
      const ledger = await this.ledger(tx, sub.id);
      const executions = await tx.copyDemoExecution.findMany({ where: { subscriptionId: sub.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
      const byId = new Map(ledger.orders.map(o => [o.id, o]));
      return { mode: 'ISOLATED_DEMO' as const, subscription: { id: sub.id, traderId: sub.traderId, status: sub.status,
        ratio: sub.ratio.toString(), maxOrderUsdt: sub.maxOrderUsdt.toString(), maxExposureUsdt: sub.maxExposureUsdt.toString() },
        executions: executions.map(e => ({ id: e.id, pair: e.pair, side: e.side, status: e.status, reason: e.reason,
          cancelRequested: e.cancelRequested, createdAt: e.createdAt, order: e.demoOrderId ? byId.get(e.demoOrderId) : null })),
        positions: [...ledger.positions].map(([pair, p]) => ({ pair, quantity: p.quantity.toFixed(), costUsdt: p.cost.toFixed() })),
        realizedPnlUsdt: ledger.pnl.toFixed(), exposureUsdt: ledger.exposure.toFixed() };
    });
  }
  async stop(userId: string) {
    this.on();
    await this.lock(async tx => {
      const sub = await tx.copyDemoSubscription.findUnique({ where: { userId } });
      if (!sub || sub.status === 'STOPPED') return;
      await tx.copyDemoSubscription.update({ where: { id: sub.id }, data: { status: 'STOPPING' } });
      await tx.copyDemoExecution.updateMany({ where: { subscriptionId: sub.id, status: 'PENDING' }, data: { status: 'SKIPPED', reason: 'SUBSCRIPTION_STOPPED' } });
      await tx.copyDemoExecution.updateMany({ where: { subscriptionId: sub.id, status: 'EXECUTED' }, data: { cancelRequested: true } });
      await this.audit(tx, userId, 'COPY_DEMO_STOP_REQUESTED', { subscriptionId: sub.id, filledAssets: 'RETAINED' });
    });
    await this.cancellations();
    return this.snapshot(userId);
  }
  private async cancellations() {
    const rows = await this.db.copyDemoExecution.findMany({ where: { cancelRequested: true }, include: { subscription: true }, take: 50 });
    for (const row of rows) {
      this.on();
      if (row.demoOrderId) await this.demo.cancelOrder(row.subscription.userId, row.demoOrderId);
      await this.db.copyDemoExecution.update({ where: { id: row.id }, data: { cancelRequested: false } });
    }
    await this.lock(async tx => {
      for (const sub of await tx.copyDemoSubscription.findMany({ where: { status: 'STOPPING' } })) {
        const ledger = await this.ledger(tx, sub.id);
        if (!ledger.orders.some(o => ACTIVE.includes(o.status))) {
          await tx.copyDemoSubscription.update({ where: { id: sub.id }, data: { status: 'STOPPED' } });
          await this.audit(tx, sub.userId, 'COPY_DEMO_STOPPED', { subscriptionId: sub.id, filledAssets: 'RETAINED' });
        }
      }
    });
  }
  async drain() {
    this.on(); await this.cancellations();
    const pending = await this.db.copyDemoExecution.findMany({ where: { status: 'PENDING' }, orderBy: { sequence: 'asc' }, take: 25, include: { subscription: true } });
    for (const row of pending) {
      const quantity = bn(row.sourceQuantity).times(bn(row.ratio)).decimalPlaces(18, BigNumber.ROUND_DOWN);
      try {
        await this.demo.placeOrder({ userId: row.subscription.userId, pair: row.pair, side: row.side as 'BUY' | 'SELL', type: 'LIMIT',
          price: bn(row.sourcePrice!), quantity, requestId: `copy-demo:${row.id}`,
          transactionGuard: async tx => {
            this.on(); const current = await tx.copyDemoExecution.findUniqueOrThrow({ where: { id: row.id }, include: { subscription: true } });
            if (current.status !== 'PENDING' || current.subscription.status !== 'ACTIVE') throw new CopyDemoError('SUBSCRIPTION_STOPPED');
            await this.admitted(tx, row.subscription.userId);
            await this.admitted(tx, row.subscription.ownerUserId);
            const owner = await tx.copyStrategyOwner.findUnique({ where: { traderId: row.subscription.traderId } });
            if (owner?.ownerUserId !== row.subscription.ownerUserId) throw new CopyDemoError('OWNER_BINDING_CHANGED');
            if (await tx.copyStrategyOwner.findFirst({ where: { ownerUserId: row.subscription.userId } })) throw new CopyDemoError('LEADER_CANNOT_FOLLOW');
            const master = await tx.demoOrder.findUniqueOrThrow({ where: { id: row.sourceOrderId } });
            if (master.status === 'CANCELLED') throw new CopyDemoError('SOURCE_CANCELLED');
            const amount = quantity.times(bn(row.sourcePrice!));
            if (amount.gt(bn(current.subscription.maxOrderUsdt))) throw new CopyDemoError('MAX_ORDER_EXCEEDED');
            const ledger = await this.ledger(tx, row.subscriptionId);
            if (row.side === 'BUY' && ledger.exposure.plus(amount).gt(bn(current.subscription.maxExposureUsdt))) throw new CopyDemoError('MAX_EXPOSURE_EXCEEDED');
            const position = ledger.positions.get(row.pair);
            if (row.side === 'SELL' && (!position || quantity.gt(position.quantity.minus(position.reservedSell)))) throw new CopyDemoError('NO_COPIED_POSITION');
          },
          transactionComplete: async (tx, demoOrderId) => {
            await tx.copyDemoExecution.update({ where: { id: row.id }, data: { status: 'EXECUTED', demoOrderId } });
            const fills = await tx.demoTrade.findMany({ where: { OR: [{ makerOrderId: demoOrderId }, { takerOrderId: demoOrderId }] }, orderBy: [{ executedAt: 'asc' }, { id: 'asc' }] });
            await this.captureFills(tx, fills.map(fill => fill.id));
            await this.audit(tx, row.subscription.userId, 'COPY_DEMO_ORDER_CREATED', { executionId: row.id, demoOrderId, sourceOrderId: row.sourceOrderId });
          } });
      } catch (error) {
        if (!(error instanceof CopyDemoError) && !(error instanceof DemoTradingError)) throw error;
        await this.lock(async tx => {
          const changed = await tx.copyDemoExecution.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: 'REJECTED', reason: error.code } });
          if (changed.count) await this.audit(tx, row.subscription.userId, 'COPY_DEMO_ORDER_REJECTED', { executionId: row.id, reason: error.code });
        });
      }
    }
  }
}
