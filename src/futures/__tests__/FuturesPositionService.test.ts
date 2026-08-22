import BigNumber from 'bignumber.js';
import { v4 as uuidv4 } from 'uuid';
import { FuturesPositionService } from '../FuturesPositionService';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';
import { MarkPriceService } from '../MarkPriceService';

/** Same fake-Prisma-transaction-client pattern as OrderService.test.ts,
 * extended with the futures-specific tables (position/balance/order). */
function makeFakePrisma(opts?: {
  balances?: Record<string, { available: string; locked: string }>;
  userCreatedAt?: Date;
}) {
  const balances = new Map(Object.entries(opts?.balances ?? {}));
  const orders = new Map<string, any>();
  const positions = new Map<string, any>();
  const userCreatedAt = opts?.userCreatedAt ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1yr-old account by default

  const tx = {
    user: {
      findUnique: jest.fn(async () => ({ id: 'u', createdAt: userCreatedAt })),
    },
    futuresBalance: {
      findUnique: jest.fn(async ({ where: { userId_asset: { userId, asset } } }: any) => {
        const b = balances.get(`${userId}:${asset}`);
        return b ? { ...b } : null;
      }),
      update: jest.fn(async ({ where: { userId_asset: { userId, asset } }, data }: any) => {
        balances.set(`${userId}:${asset}`, { available: data.available, locked: data.locked });
      }),
      upsert: jest.fn(async ({ where: { userId_asset: { userId, asset } }, create }: any) => {
        const key = `${userId}:${asset}`;
        if (!balances.has(key)) balances.set(key, { available: create.available, locked: create.locked });
        return { ...balances.get(key)! };
      }),
    },
    futuresOrder: {
      create: jest.fn(async ({ data }: any) => {
        orders.set(data.id, { ...data });
      }),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        Object.assign(orders.get(id), data);
      }),
      findUnique: jest.fn(async ({ where: { id } }: any) => (orders.has(id) ? { ...orders.get(id) } : null)),
    },
    futuresPosition: {
      findFirst: jest.fn(async ({ where }: any) => {
        for (const p of positions.values()) {
          if (
            p.userId === where.userId &&
            p.symbol === where.symbol &&
            p.marginType === where.marginType &&
            p.status === where.status
          ) {
            return { ...p };
          }
        }
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const id = uuidv4();
        const row = { id, realizedPnl: '0', ...data };
        positions.set(id, row);
        return { ...row };
      }),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        Object.assign(positions.get(id), data);
        return { ...positions.get(id) };
      }),
    },
    trade: {
      create: jest.fn(async () => {}),
    },
  };

  const prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) } as any;
  return { prisma, balances, orders, positions };
}

function bal(balances: Map<string, { available: string; locked: string }>, userId: string, asset: string) {
  const b = balances.get(`${userId}:${asset}`);
  return { available: new BigNumber(b?.available ?? '0'), locked: new BigNumber(b?.locked ?? '0') };
}

function makeMarkPriceService(price = '60000') {
  return new MarkPriceService({ getTicker: jest.fn().mockResolvedValue({ lastPrice: price }) } as any);
}

describe('FuturesPositionService.placeOrder', () => {
  it('opens a new LONG position and locks exactly the initial margin', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances, positions } = makeFakePrisma({
      balances: { 'maker:USDT': { available: '100000', locked: '0' }, 'taker:USDT': { available: '10000', locked: '0' } },
    });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });

    // initial_margin = notional / leverage = 60000 / 10 = 6000
    const takerBal = bal(balances, 'taker', 'USDT');
    expect(takerBal.locked.toString()).toBe('6000');
    expect(takerBal.available.toString()).toBe('4000');

    const position = Array.from(positions.values()).find((p: any) => p.userId === 'taker');
    expect(position.side).toBe('LONG');
    expect(position.size).toBe('1');
    expect(position.entryPrice).toBe('60000');
    // notional 60000 sits in the 2nd tier (>50k cap), mmr = 0.005:
    // liq_price = entry * (1 - 1/10 + mmr) = 60000 * (0.9 + 0.005) = 54300
    expect(new BigNumber(position.liquidationPrice).toNumber()).toBeCloseTo(54300, 6);
  });

  it('averages entry price when increasing an existing same-direction position', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances, positions } = makeFakePrisma({
      balances: {
        'maker1:USDT': { available: '100000', locked: '0' },
        'maker2:USDT': { available: '100000', locked: '0' },
        'taker:USDT': { available: '100000', locked: '0' },
      },
    });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    await service.placeOrder({ userId: 'maker1', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });

    await service.placeOrder({ userId: 'maker2', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(62000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(62000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });

    const position = Array.from(positions.values()).find((p: any) => p.userId === 'taker' && p.status === 'OPEN');
    expect(position.size).toBe('2');
    // average entry = (1*60000 + 1*62000) / 2 = 61000
    expect(new BigNumber(position.entryPrice).toNumber()).toBeCloseTo(61000, 6);

    const takerBal = bal(balances, 'taker', 'USDT');
    // margin = 6000 + 6200 = 12200
    expect(takerBal.locked.toString()).toBe('12200');
  });

  it('partially reduces a position, releasing proportional margin and crediting realized PnL', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances, positions } = makeFakePrisma({
      balances: { 'maker:USDT': { available: '100000', locked: '0' }, 'taker:USDT': { available: '10000', locked: '0' } },
    });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    // taker opens LONG 1 BTC @ 60000, 10x -> margin 6000
    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });

    // taker reduces by 0.4 BTC at a higher price (61000) via a SELL, reduceOnly
    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(61000), quantity: new BigNumber(0.4), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(61000), quantity: new BigNumber(0.4), leverage: 10, marginType: 'ISOLATED', reduceOnly: true });

    const position = Array.from(positions.values()).find((p: any) => p.userId === 'taker' && p.status === 'OPEN');
    expect(position.size).toBe('0.6');
    expect(position.entryPrice).toBe('60000'); // unchanged on a reduce

    // realized pnl = (61000 - 60000) * 0.4 = 400
    expect(new BigNumber(position.realizedPnl).toNumber()).toBeCloseTo(400, 6);

    // released margin = 6000 * (0.4/1) = 2400; taker started with 10000,
    // locked 6000 (available 4000), then released 2400 margin + 400 pnl.
    const takerBal = bal(balances, 'taker', 'USDT');
    expect(takerBal.locked.toString()).toBe('3600'); // 6000 - 2400
    expect(takerBal.available.toString()).toBe('6800'); // 4000 + 2400 + 400
  });

  it('fully closes a position on an exact-size opposite fill', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances, positions } = makeFakePrisma({
      balances: { 'maker:USDT': { available: '100000', locked: '0' }, 'taker:USDT': { available: '10000', locked: '0' } },
    });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });

    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(58000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(58000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED', reduceOnly: true });

    const position = Array.from(positions.values()).find((p: any) => p.userId === 'taker');
    expect(position.status).toBe('CLOSED');
    expect(position.size).toBe('0');
    // realized pnl = (58000 - 60000) * 1 = -2000 (a loss)
    expect(new BigNumber(position.realizedPnl).toNumber()).toBeCloseTo(-2000, 6);

    const takerBal = bal(balances, 'taker', 'USDT');
    expect(takerBal.locked.toString()).toBe('0');
    // 10000 - 6000 (margin locked) + 6000 (released) - 2000 (loss) = 8000
    expect(takerBal.available.toString()).toBe('8000');
  });

  it('flips from LONG to SHORT when the opposite fill exceeds the existing position size', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances, positions } = makeFakePrisma({
      balances: { 'maker:USDT': { available: '100000', locked: '0' }, 'taker:USDT': { available: '20000', locked: '0' } },
    });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    // taker opens LONG 1 BTC @ 60000
    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });

    // taker sells 1.5 BTC @ 61000 (not reduceOnly) -> closes the 1 BTC long, opens 0.5 BTC short
    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(61000), quantity: new BigNumber(1.5), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(61000), quantity: new BigNumber(1.5), leverage: 10, marginType: 'ISOLATED' });

    const open = Array.from(positions.values()).find((p: any) => p.userId === 'taker' && p.status === 'OPEN');
    const closed = Array.from(positions.values()).find((p: any) => p.userId === 'taker' && p.status === 'CLOSED');
    expect(closed.realizedPnl).not.toBe('0');
    expect(open.side).toBe('SHORT');
    expect(open.size).toBe('0.5');
    expect(open.entryPrice).toBe('61000');
  });

  it('rejects a reduceOnly order that would exceed the current position size', async () => {
    const engine = new MatchingEngine();
    const { prisma } = makeFakePrisma({ balances: { 'taker:USDT': { available: '10000', locked: '0' } } });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    await expect(
      service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED', reduceOnly: true })
    ).rejects.toThrow('reduceOnly order would exceed the current position size');
  });

  it('rejects leverage above the tier cap for the position notional', async () => {
    const engine = new MatchingEngine();
    const { prisma } = makeFakePrisma({ balances: { 'taker:USDT': { available: '1000000', locked: '0' } } });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    // notional = 10 * 60000 = 600000 -> tier cap is 20x (250k-1M bracket)
    await expect(
      service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(10), leverage: 50, marginType: 'ISOLATED' })
    ).rejects.toThrow(/Max leverage/);
  });

  it('rejects leverage above 10x for a new account (< 30 days old)', async () => {
    const engine = new MatchingEngine();
    const { prisma } = makeFakePrisma({
      balances: { 'taker:USDT': { available: '10000', locked: '0' } },
      userCreatedAt: new Date(), // brand new account
    });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    await expect(
      service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(0.1), leverage: 20, marginType: 'ISOLATED' })
    ).rejects.toThrow(/New accounts are limited/);
  });

  it('rejects when available margin balance is insufficient', async () => {
    const engine = new MatchingEngine();
    const { prisma } = makeFakePrisma({ balances: { 'taker:USDT': { available: '100', locked: '0' } } });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    await expect(
      service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' })
    ).rejects.toThrow('Insufficient USDT margin balance');
  });

  it('rejects a MARKET order with no resting liquidity instead of fake-filling', async () => {
    const engine = new MatchingEngine();
    const { prisma } = makeFakePrisma({ balances: { 'taker:USDT': { available: '10000', locked: '0' } } });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    await expect(
      service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' })
    ).rejects.toThrow('No liquidity available for this market order');
  });

  it('records every trade with MarkPriceService so mark price reflects real internal activity', async () => {
    const engine = new MatchingEngine();
    const { prisma } = makeFakePrisma({
      balances: { 'maker:USDT': { available: '100000', locked: '0' }, 'taker:USDT': { available: '10000', locked: '0' } },
    });
    const markPriceService = makeMarkPriceService('60000');
    const spy = jest.spyOn(markPriceService, 'recordFuturesTrade');
    const service = new FuturesPositionService(prisma, engine, markPriceService);

    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60500), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60500), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });

    expect(spy).toHaveBeenCalledWith('BTC/USDT', expect.any(BigNumber));
  });
});
