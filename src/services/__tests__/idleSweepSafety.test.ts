import { PriceWatcherService } from '../PriceWatcherService';
import { LiquidationEngine } from '../../futures/LiquidationEngine';
import { OrderService } from '../OrderService';
import { CfdPositionService } from '../../cfd/CfdPositionService';
import BigNumber from 'bignumber.js';

/**
 * The two properties the idle backoff depends on for safety.
 *
 * 1. A sweep that FOUND rows but acted on none must still report
 *    'found-work'. Every sweep here returns a count of actions taken, which
 *    is zero for an empty table AND for a book of healthy positions — so a
 *    backoff driven off that number would slow the liquidation and
 *    stop-loss checks down exactly while real positions are open.
 *
 * 2. The wake that shortcuts the backoff must fire only AFTER the placing
 *    transaction has committed. A sweep woken any earlier would query,
 *    not yet see the row, and go straight back to sleep — which would be
 *    worse than not waking at all.
 */

describe('idle backoff: a busy sweep is never mistaken for an idle one', () => {
  it('PriceWatcherService reports found-work when orders rest but none trigger', async () => {
    const resting = {
      id: 'o1', pair: 'BTC/USDT', side: 'SELL', type: 'STOP_LIMIT',
      triggerPrice: { toString: () => '55000' }, status: 'PENDING_TRIGGER', ocoGroupId: null,
    };
    const prisma = { order: { findMany: jest.fn(async () => [resting]) } } as any;
    const orders = { triggerOrder: jest.fn() } as any;
    // Price nowhere near the trigger: nothing fires.
    const svc = new PriceWatcherService(prisma, orders, { getTicker: async () => ({ lastPrice: '90000' }) } as any);

    const triggered = await svc.checkAndTrigger();

    expect(triggered).toBe(0);            // acted on nothing …
    expect(svc.sweepOutcome).toBe('found-work'); // … but is NOT idle
    expect(orders.triggerOrder).not.toHaveBeenCalled();
  });

  it('PriceWatcherService reports idle only when nothing rests at all', async () => {
    const prisma = { order: { findMany: jest.fn(async () => []) } } as any;
    const svc = new PriceWatcherService(prisma, { triggerOrder: jest.fn() } as any, { getTicker: async () => null } as any);

    await svc.checkAndTrigger();

    expect(svc.sweepOutcome).toBe('idle');
  });

  it('LiquidationEngine reports found-work when positions are open but none are liquidatable', async () => {
    const healthy = {
      id: 'p1', userId: 'u1', symbol: 'BTC/USDT', side: 'LONG',
      liquidationPrice: { toString: () => '10000' },
    };
    const prisma = { futuresPosition: { findMany: jest.fn(async () => [healthy]) } } as any;
    // Mark price far above the long's liquidation price: healthy.
    const marks = { getMarkPrice: jest.fn(async () => new BigNumber('90000')) } as any;
    const engine = new LiquidationEngine(prisma, marks);

    const liquidated = await engine.checkAndLiquidate();

    expect(liquidated).toBe(0);
    expect(engine.sweepOutcome).toBe('found-work');
  });

  it('LiquidationEngine reports idle only with no open position at all', async () => {
    const prisma = { futuresPosition: { findMany: jest.fn(async () => []) } } as any;
    const engine = new LiquidationEngine(prisma, { getMarkPrice: jest.fn() } as any);

    await engine.checkAndLiquidate();

    expect(engine.sweepOutcome).toBe('idle');
  });
});

describe('idle backoff: the wake fires after the commit, never inside it', () => {
  /** A prisma whose $transaction records when the callback ran relative to
   *  the transaction resolving. */
  function trackingPrisma(inner: (tx: any) => Promise<any>, log: string[]) {
    return {
      $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => {
        log.push('tx:start');
        const out = await fn(await inner({}));
        log.push('tx:commit');
        return out;
      }),
    } as any;
  }

  it('OrderService wakes the price watcher after a conditional order commits', async () => {
    const log: string[] = [];
    const created: any[] = [];
    const tx = {
      order: { create: jest.fn(async (a: any) => { created.push(a); return a; }) },
      balance: { findUnique: async () => ({ available: '999999', locked: '0' }), update: async () => ({}) },
    };
    const prisma = trackingPrisma(async () => tx, log);
    const engine = { getBestBid: () => null, getBestAsk: () => null } as any;
    const priceSource = { getTicker: async () => ({ lastPrice: '60000' }) } as any;
    const svc = new OrderService(prisma, engine, priceSource, () => log.push('wake'));

    await svc.placeOrder({
      userId: 'u1', pair: 'BTC/USDT', side: 'SELL', type: 'STOP_LIMIT',
      price: new BigNumber('50000'), triggerPrice: new BigNumber('55000'),
      quantity: new BigNumber('1'),
    } as any);

    expect(log).toContain('wake');
    // THE ORDERING THAT MATTERS: the commit happened first.
    expect(log.indexOf('wake')).toBeGreaterThan(log.indexOf('tx:commit'));
    expect(created[0].data.status).toBe('PENDING_TRIGGER');
  });

  it('OrderService does NOT wake the price watcher for a plain order that rests on the book', async () => {
    const log: string[] = [];
    const tx = {
      order: { create: jest.fn(async (a: any) => a), update: jest.fn(async (a: any) => a), findUnique: jest.fn(async () => null) },
      balance: { findUnique: async () => ({ available: '999999', locked: '0' }), update: async () => ({}) },
      trade: { create: jest.fn(async (a: any) => a) },
    };
    const prisma = trackingPrisma(async () => tx, log);
    const engine = {
      getBestBid: () => null, getBestAsk: () => null,
      submitOrder: () => ({ trades: [], remainingQuantity: new BigNumber('1') }),
    } as any;
    const svc = new OrderService(prisma, engine, { getTicker: async () => ({ lastPrice: '60000' }) } as any, () => log.push('wake'));

    await svc.placeOrder({
      userId: 'u1', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT',
      price: new BigNumber('50000'), quantity: new BigNumber('1'),
    } as any).catch(() => { /* settlement paths are not what this asserts */ });

    // A LIMIT order goes to the matching engine, not to the price watcher.
    expect(log).not.toContain('wake');
  });
});
