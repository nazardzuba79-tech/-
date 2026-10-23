import BigNumber from 'bignumber.js';
import { DemoTradingService } from '../DemoTradingService';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';
import { checkReference, DemoLiquidityConfig, DemoReferenceQuote, demoLiquidityConfig, liquidityOrderId, liquidityQuote } from '../DemoLiquidity';

/** Issue #592 / CTO 6361475787: internal demo liquidity from already-credited demo funds. */
const LP = '00000000-0000-4000-8000-00000000a11d';

const env = (extra: Record<string, string> = {}) => ({ DEMO_LIQUIDITY_ENABLED: 'true', DEMO_LIQUIDITY_ACCOUNT_ID: LP, DEMO_LIQUIDITY_PAIRS: 'BTC/USDT, eth/usdt', ...extra }) as NodeJS.ProcessEnv;
const config = (extra: Record<string, string> = {}) => demoLiquidityConfig(env(extra)).config!;
const fresh = (bid = '60000', ask = '60010', extra: Partial<DemoReferenceQuote> = {}): DemoReferenceQuote => ({ bid, ask, fetchedAt: Date.now(), stale: false, ...extra });

describe('demoLiquidityConfig', () => {
  it('is off unless explicitly enabled, and then only with a complete configuration', () => {
    expect(demoLiquidityConfig({} as NodeJS.ProcessEnv)).toEqual({ config: null });
    expect(demoLiquidityConfig({ DEMO_LIQUIDITY_ENABLED: '1', DEMO_LIQUIDITY_ACCOUNT_ID: LP, DEMO_LIQUIDITY_PAIRS: 'BTC/USDT' } as NodeJS.ProcessEnv)).toEqual({ config: null });
    const parsed = config();
    expect(parsed).toMatchObject({ accountId: LP, spreadBps: 10, maxQuoteAgeMs: 10000, maxReferenceSpreadBps: 100 });
    expect([...parsed.pairs]).toEqual(['BTC/USDT', 'ETH/USDT']);
    expect(parsed.maxOrderQuote.toFixed()).toBe('1000');
  });

  it.each([
    [{ DEMO_LIQUIDITY_ACCOUNT_ID: 'owner' }, 'ACCOUNT_ID'],
    [{ DEMO_LIQUIDITY_PAIRS: '' }, 'PAIRS'],
    [{ DEMO_LIQUIDITY_PAIRS: 'BTC/USDT,VTA/USDT' }, 'VTA/USDT'],
    [{ DEMO_LIQUIDITY_PAIRS: 'NRX/USDT' }, 'NRX/USDT'],
    [{ DEMO_LIQUIDITY_PAIRS: 'AITH/USDT' }, 'AITH/USDT'],
    [{ DEMO_LIQUIDITY_PAIRS: 'BTC-USDT' }, 'BTC-USDT'],
    [{ DEMO_LIQUIDITY_SPREAD_BPS: '0' }, 'SPREAD'],
    [{ DEMO_LIQUIDITY_SPREAD_BPS: '10.5' }, 'SPREAD'],
    [{ DEMO_LIQUIDITY_MAX_QUOTE_AGE_MS: '600000' }, 'AGE'],
    [{ DEMO_LIQUIDITY_MAX_REFERENCE_SPREAD_BPS: '5000' }, 'REFERENCE_SPREAD'],
    [{ DEMO_LIQUIDITY_MAX_ORDER_QUOTE: '-5' }, 'ORDER_QUOTE'],
    [{ DEMO_LIQUIDITY_MAX_ORDER_QUOTE: '1e6' }, 'ORDER_QUOTE'],
    // A native Cross wallet is valued from DemoBalance: never used as inventory.
    [{ PRIVATE_TRADING_OWNER_ID: LP }, 'native'],
    [{ PRIVATE_TRADING_TEST_USER_IDS: `00000000-0000-4000-8000-000000000001, ${LP}` }, 'native'],
  ])('a malformed or unsafe value keeps it off: %j', (extra, problem) => {
    const result = demoLiquidityConfig(env(extra as Record<string, string>));
    expect(result.config).toBeNull();
    expect(result.problem).toContain(problem);
  });
});

describe('checkReference / liquidityQuote', () => {
  const inventory = { base: new BigNumber('1'), quote: new BigNumber('100000') };

  it('prices a buyer at the reference ask plus the spread (rounded up), a seller at the bid minus it (rounded down)', () => {
    const buy = liquidityQuote(config(), fresh('60000.1', '60010.1'), 'BUY', inventory)!;
    expect(buy.side).toBe('SELL');
    expect(buy.price.toFixed()).toBe('60070.111'); // 60010.1 × 1.001 = 60070.1101 → 8 digits, up
    expect(buy.quantity.toFixed()).toBe('0.01664721'); // 1000 / 60070.111, rounded down
    const sell = liquidityQuote(config(), fresh('60000.1', '60010.1'), 'SELL', inventory)!;
    expect(sell.side).toBe('BUY');
    expect(sell.price.toFixed()).toBe('59940.099'); // 60000.1 × 0.999 = 59940.0999 → 8 digits, down
    expect(sell.quantity.toFixed()).toBe('0.01668332');
    expect(sell.price.times(sell.quantity).lte(1000)).toBe(true);
  });

  it('never quotes more than the account holds available', () => {
    const buy = liquidityQuote(config(), fresh(), 'BUY', { base: new BigNumber('0.005'), quote: new BigNumber(0) })!;
    expect(buy.quantity.toFixed()).toBe('0.005');
    const sell = liquidityQuote(config(), fresh(), 'SELL', { base: new BigNumber(0), quote: new BigNumber('30') })!;
    expect(sell.price.times(sell.quantity).lte(30)).toBe(true);
    expect(liquidityQuote(config(), fresh(), 'BUY', { base: new BigNumber(0), quote: new BigNumber('1000') })).toBeNull();
    expect(liquidityQuote(config(), fresh(), 'SELL', { base: new BigNumber('1'), quote: new BigNumber(0) })).toBeNull();
  });

  it('fails closed on a missing, stale, future, invalid, crossed or too wide reference', () => {
    const now = Date.now();
    expect(checkReference(config(), null, now)).toEqual({ ok: false, reason: 'MISSING' });
    expect(checkReference(config(), fresh('1', '2', { stale: true }), now)).toEqual({ ok: false, reason: 'STALE' });
    expect(checkReference(config(), fresh('60000', '60010', { fetchedAt: now - 10_001 }), now)).toEqual({ ok: false, reason: 'STALE' });
    expect(checkReference(config(), fresh('60000', '60010', { fetchedAt: now + 5_000 }), now)).toEqual({ ok: false, reason: 'STALE' });
    expect(checkReference(config(), fresh('abc', '60010'), now)).toEqual({ ok: false, reason: 'INVALID' });
    expect(checkReference(config(), fresh('0', '60010'), now)).toEqual({ ok: false, reason: 'INVALID' });
    expect(checkReference(config(), fresh('60010', '60010'), now)).toEqual({ ok: false, reason: 'CROSSED' });
    expect(checkReference(config(), fresh('60000', '60700'), now)).toEqual({ ok: false, reason: 'TOO_WIDE' }); // > 1%
    expect(checkReference(config(), fresh('60000', '60010'), now)).toMatchObject({ ok: true });
    for (const reference of [null, fresh('60000', '60010', { stale: true }), fresh('60010', '60000')]) {
      expect(liquidityQuote(config(), reference, 'BUY', inventory)).toBeNull();
    }
  });
});

/** Fake Prisma with the demo tables, the account lookup and rollback, like DemoTradingService.test.ts. */
function makeFakePrisma(seed: Record<string, { available: string; locked: string }>, users: Record<string, { blockedAt: Date | null }> = { [LP]: { blockedAt: null } }) {
  const balances = new Map(Object.entries(seed));
  const orders = new Map<string, any>();
  const trades: any[] = [];
  const applyDelta = (current: string, change: any) => new BigNumber(current).plus(change.increment ?? new BigNumber(change.decrement ?? 0).negated()).toFixed();
  const tx: any = {
    user: { findUnique: jest.fn(async ({ where: { id } }: any) => users[id] ?? null) },
    demoBalance: {
      findMany: jest.fn(async ({ where }: any) => [...balances.entries()].filter(([key]) => key.startsWith(`${where.userId}:`)
        && (!where.asset || where.asset.in.includes(key.split(':')[1]))).map(([key, value]) => ({ asset: key.split(':')[1], ...value }))),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const key = `${where.userId}:${where.asset}`, row = balances.get(key);
        if (!row || (where.available?.gte !== undefined && new BigNumber(row.available).lt(where.available.gte))
          || (where.locked?.gte !== undefined && new BigNumber(row.locked).lt(where.locked.gte))) return { count: 0 };
        balances.set(key, { available: applyDelta(row.available, data.available), locked: applyDelta(row.locked, data.locked) });
        return { count: 1 };
      }),
      upsert: jest.fn(async ({ where: { userId_asset: { userId, asset } }, create, update }: any) => {
        const key = `${userId}:${asset}`, row = balances.get(key);
        balances.set(key, row ? { available: applyDelta(row.available, update.available), locked: applyDelta(row.locked, update.locked) }
          : { available: create.available, locked: create.locked ?? '0' });
      }),
    },
    $queryRaw: jest.fn(async () => [{ id: '1' }]),
    demoOrder: {
      create: jest.fn(async ({ data }: any) => { if (orders.has(data.id)) throw new Error('duplicate key'); orders.set(data.id, { createdAt: new Date(), updatedAt: new Date(), ...data }); }),
      findMany: jest.fn(async ({ where }: any) => [...orders.values()].filter(row => row.pair === where.pair
        && (!where.type || row.type === where.type) && where.status.in.includes(row.status)).map(row => ({ ...row }))),
      update: jest.fn(async ({ where: { id }, data }: any) => { if (!orders.has(id)) throw new Error('record not found'); Object.assign(orders.get(id), data); }),
      findUnique: jest.fn(async ({ where: { id } }: any) => (orders.has(id) ? { ...orders.get(id) } : null)),
    },
    demoTrade: {
      create: jest.fn(async ({ data }: any) => { trades.push({ executedAt: new Date(), ...data }); }),
      findMany: jest.fn(async ({ where }: any) => trades.filter(row => row.pair === where.pair && (where.OR
        ? where.OR.some((clause: any) => Object.entries(clause).some(([key, value]: any) => value.in.includes(row[key])))
        : row.takerOrderId === where.takerOrderId))),
    },
  };
  const prisma = { demoBalance: tx.demoBalance, $queryRaw: jest.fn(async () => [{ status: 'committed' }]), $transaction: jest.fn(async (fn: any) => {
    const saved = [balances, orders].map(map => structuredClone([...map.entries()]));
    const tradeCount = trades.length;
    try { return await fn(tx); } catch (error) {
      [balances, orders].forEach((map: Map<string, any>, i) => { map.clear(); for (const [key, value] of saved[i]) map.set(key, value); });
      trades.length = tradeCount; throw error;
    }
  }) } as any;
  return { prisma, balances, orders, trades };
}

const bal = (balances: Map<string, { available: string; locked: string }>, userId: string, asset: string) => {
  const b = balances.get(`${userId}:${asset}`);
  return { available: b?.available ?? '0', locked: b?.locked ?? '0' };
};
const total = (balances: Map<string, { available: string; locked: string }>, asset: string) => [...balances.entries()]
  .filter(([key]) => key.endsWith(`:${asset}`)).reduce((sum, [, b]) => sum.plus(b.available).plus(b.locked), new BigNumber(0)).toFixed();

function service(seed: Record<string, { available: string; locked: string }>, reference: () => Promise<DemoReferenceQuote | null> = async () => fresh(),
  extra: Partial<DemoLiquidityConfig> = {}, users?: Record<string, { blockedAt: Date | null }>) {
  const fake = makeFakePrisma(seed, users);
  const engine = new MatchingEngine();
  const source = jest.fn((_pair: string) => reference());
  const svc = new DemoTradingService(fake.prisma, engine, { liquidity: { config: { ...config(), ...extra }, reference: source } });
  return { ...fake, engine, svc, source };
}

describe('DemoTradingService with internal liquidity', () => {
  const funded = { 'taker:USDT': { available: '1000', locked: '0' }, 'taker:BTC': { available: '0.01', locked: '0' },
    [`${LP}:BTC`]: { available: '0.05', locked: '0' }, [`${LP}:USDT`]: { available: '3000', locked: '0' } };

  it('MARKET BUY on an empty book fills against the quote; both sides settle from DemoBalance, nothing is created', async () => {
    const { svc, balances, orders, engine } = service(funded);
    const before = { usdt: total(balances, 'USDT'), btc: total(balances, 'BTC') };
    const result = await svc.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber('0.01') });
    expect(result.order.status).toBe('FILLED');
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ makerUserId: LP, makerOrderId: liquidityOrderId(result.order.id) });
    expect(result.trades[0].price.toFixed()).toBe('60070.01'); // 60010 × 1.001
    expect(bal(balances, 'taker', 'BTC')).toEqual({ available: '0.02', locked: '0' });
    expect(bal(balances, 'taker', 'USDT')).toEqual({ available: '399.2999', locked: '0' }); // 1000 − 600.7001, buffer refunded
    expect(bal(balances, LP, 'BTC')).toEqual({ available: '0.04', locked: '0' });
    expect(bal(balances, LP, 'USDT')).toEqual({ available: '3600.7001', locked: '0' });
    expect({ usdt: total(balances, 'USDT'), btc: total(balances, 'BTC') }).toEqual(before);
    // The quote's receipt is a filled order; nothing of it rests.
    expect(orders.get(liquidityOrderId(result.order.id))).toMatchObject({ userId: LP, side: 'SELL', status: 'FILLED', originalQuantity: '0.01', remainingQuantity: '0' });
    expect(engine.getBook('BTC/USDT').getBook('SELL')).toHaveLength(0);
  });

  it('MARKET SELL fills against the bid quote', async () => {
    const { svc, balances } = service(funded);
    const result = await svc.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'SELL', type: 'MARKET', quantity: new BigNumber('0.01') });
    expect(result.order.status).toBe('FILLED');
    expect(result.trades[0].price.toFixed()).toBe('59940'); // 60000 × 0.999
    expect(bal(balances, 'taker', 'BTC')).toEqual({ available: '0', locked: '0' });
    expect(bal(balances, 'taker', 'USDT')).toEqual({ available: '1599.4', locked: '0' });
    expect(bal(balances, LP, 'USDT')).toEqual({ available: '2400.6', locked: '0' });
    expect(bal(balances, LP, 'BTC')).toEqual({ available: '0.06', locked: '0' });
  });

  it('a crossing LIMIT fills at the quote (the difference is refunded); a passive LIMIT rests and the quote never does', async () => {
    const { svc, balances, orders, engine } = service(funded);
    const crossing = await svc.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber('61000'), quantity: new BigNumber('0.001') });
    expect(crossing.order.status).toBe('FILLED');
    expect(crossing.trades[0].price.toFixed()).toBe('60070.01');
    expect(bal(balances, 'taker', 'USDT')).toEqual({ available: '939.92999', locked: '0' });
    const passive = await svc.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber('59000'), quantity: new BigNumber('0.001') });
    expect(passive.order.status).toBe('OPEN');
    expect(passive.trades).toHaveLength(0);
    expect(orders.has(liquidityOrderId(passive.order.id))).toBe(false);
    expect(engine.getBook('BTC/USDT').getBook('SELL')).toHaveLength(0);
    expect(engine.getBook('BTC/USDT').getBook('BUY').map(o => o.id)).toEqual([passive.order.id]);
    expect(bal(balances, 'taker', 'USDT')).toEqual({ available: '880.92999', locked: '59' });
  });

  it('a resting tester order at a better price keeps priority; the quote takes the rest', async () => {
    const { svc, balances } = service({ ...funded, 'maker:BTC': { available: '0.004', locked: '0' } });
    await svc.placeOrder({ userId: 'maker', pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber('60050'), quantity: new BigNumber('0.004') });
    const result = await svc.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber('0.01') });
    expect(result.trades.map(t => [t.makerUserId, t.price.toFixed(), t.quantity.toFixed()])).toEqual([['maker', '60050', '0.004'], [LP, '60070.01', '0.006']]);
    expect(bal(balances, 'maker', 'USDT').available).toBe('240.2');
  });

  it('caps one order at the per-order limit and at the inventory; the rest of a MARKET order is cancelled and refunded', async () => {
    const { svc, balances } = service(funded, undefined, { maxOrderQuote: new BigNumber('300') });
    const capped = await svc.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber('0.01') });
    expect(capped.order.status).toBe('CANCELLED');
    expect(capped.trades[0].quantity.toFixed()).toBe('0.00499417'); // 300 / 60070.01, rounded down
    expect(bal(balances, 'taker', 'USDT').locked).toBe('0');
    const low = service({ ...funded, [`${LP}:BTC`]: { available: '0.002', locked: '0' } });
    const result = await low.svc.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber('0.01') });
    expect(result.trades[0].quantity.toFixed()).toBe('0.002');
    expect(bal(low.balances, LP, 'BTC')).toEqual({ available: '0', locked: '0' });
    // Nothing left to quote: the ordinary «no liquidity» answer, nothing reserved.
    await expect(low.svc.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber('0.001') }))
      .rejects.toMatchObject({ code: 'NO_LIQUIDITY' });
    expect(bal(low.balances, 'taker', 'USDT').locked).toBe('0');
  });

  it.each([
    ['a stale reference', async () => fresh('60000', '60010', { stale: true })],
    ['an old reference', async () => fresh('60000', '60010', { fetchedAt: Date.now() - 60_000 })],
    ['no reference', async () => null],
    ['a failing reference read', async () => { throw new Error('feed down'); }],
    ['a too wide reference', async () => fresh('60000', '61000')],
  ])('%s: no quote — MARKET BUY is refused as before, MARKET SELL fills nothing, balances unchanged', async (_name, reference) => {
    const { svc, balances, orders } = service(funded, reference as () => Promise<DemoReferenceQuote | null>);
    const before = JSON.stringify([...balances.entries()]);
    await expect(svc.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber('0.001') }))
      .rejects.toMatchObject({ code: 'NO_LIQUIDITY' });
    const sell = await svc.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'SELL', type: 'MARKET', quantity: new BigNumber('0.001') });
    expect(sell.order.status).toBe('CANCELLED');
    expect(sell.trades).toHaveLength(0);
    expect(JSON.stringify([...balances.entries()])).toBe(before);
    expect([...orders.values()].filter(o => o.userId === LP)).toHaveLength(0);
  });

  it('only listed pairs, never against itself, never from a blocked or missing account', async () => {
    const unlisted = service({ ...funded, 'taker:SOL': { available: '0', locked: '0' } });
    await expect(unlisted.svc.placeOrder({ userId: 'taker', pair: 'SOL/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber('1') }))
      .rejects.toMatchObject({ code: 'NO_LIQUIDITY' });
    expect(unlisted.source).not.toHaveBeenCalled();
    const self = service(funded);
    await expect(self.svc.placeOrder({ userId: LP, pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber('0.001') }))
      .rejects.toMatchObject({ code: 'NO_LIQUIDITY' });
    expect(self.source).not.toHaveBeenCalled();
    for (const users of [{ [LP]: { blockedAt: new Date() } }, {}] as Record<string, { blockedAt: Date | null }>[]) {
      const { svc } = service(funded, undefined, {}, users);
      await expect(svc.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber('0.001') }))
        .rejects.toMatchObject({ code: 'NO_LIQUIDITY' });
    }
  });

  it('insufficient taker funds are refused before anything moves', async () => {
    const { svc, balances } = service({ ...funded, 'taker:USDT': { available: '50', locked: '0' } });
    const before = JSON.stringify([...balances.entries()]);
    await expect(svc.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber('0.001') }))
      .rejects.toMatchObject({ message: 'Insufficient USDT balance', code: 'INSUFFICIENT_BALANCE' });
    await expect(svc.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'SELL', type: 'MARKET', quantity: new BigNumber('0.02') }))
      .rejects.toMatchObject({ message: 'Insufficient BTC balance', code: 'INSUFFICIENT_BALANCE' });
    expect(JSON.stringify([...balances.entries()])).toBe(before);
  });

  it('a retry with the same request ID returns the committed fill and never takes a second quote', async () => {
    const { svc, balances, trades } = service(funded);
    const params = { userId: 'taker', pair: 'BTC/USDT', side: 'BUY' as const, type: 'MARKET' as const, quantity: new BigNumber('0.001'), requestId: '7a6f0e64-5f5f-4d0e-9f4e-1d1a7a0b0c01' };
    const first = await svc.placeOrder(params);
    const after = JSON.stringify([...balances.entries()]);
    const replay = await svc.placeOrder(params);
    expect('replayed' in replay).toBe(true);
    expect(replay.order.id).toBe(first.order.id);
    expect(replay.trades.map(t => t.id)).toEqual(first.trades.map(t => t.id));
    expect(trades).toHaveLength(1);
    expect(JSON.stringify([...balances.entries()])).toBe(after);
  });

  it('the inventory changing under the quote rolls the whole order back instead of overdrawing it', async () => {
    const { svc, balances, orders, trades } = service(funded);
    const realMany = (svc as any).prisma.demoBalance.findMany;
    // The quote was sized from a read that a concurrent writer has since spent.
    (svc as any).prisma.demoBalance.findMany = jest.fn(async (args: any) => (await realMany(args)).map((row: any) => row.asset === 'BTC' ? { ...row, available: '0.05' } : row));
    balances.set(`${LP}:BTC`, { available: '0.001', locked: '0' });
    const before = JSON.stringify([...balances.entries()]);
    await expect(svc.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber('0.01') }))
      .rejects.toMatchObject({ code: 'NO_LIQUIDITY' });
    expect(JSON.stringify([...balances.entries()])).toBe(before);
    expect(orders.size).toBe(0);
    expect(trades).toHaveLength(0);
  });
});
