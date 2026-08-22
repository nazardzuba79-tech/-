import BigNumber from 'bignumber.js';
import { LiquidationEngine } from '../LiquidationEngine';
import { MarkPriceService } from '../MarkPriceService';

function makeFakePrisma(positions: any[], balances: Record<string, { available: string; locked: string }> = {}) {
  const positionMap = new Map(positions.map((p) => [p.id, { realizedPnl: '0', ...p }]));
  const balanceMap = new Map(Object.entries(balances));
  const insuranceFund = new Map<string, string>();
  const insuranceLedger: any[] = [];

  const tx = {
    futuresPosition: {
      findUnique: jest.fn(async ({ where: { id } }: any) => (positionMap.has(id) ? { ...positionMap.get(id) } : null)),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        Object.assign(positionMap.get(id), data);
        return { ...positionMap.get(id) };
      }),
    },
    futuresBalance: {
      upsert: jest.fn(async ({ where: { userId_asset: { userId, asset } }, create }: any) => {
        const key = `${userId}:${asset}`;
        if (!balanceMap.has(key)) balanceMap.set(key, { available: create.available, locked: create.locked });
        return { ...balanceMap.get(key)! };
      }),
      update: jest.fn(async ({ where: { userId_asset: { userId, asset } }, data }: any) => {
        balanceMap.set(`${userId}:${asset}`, { available: data.available, locked: data.locked });
      }),
    },
    insuranceFund: {
      upsert: jest.fn(async ({ where: { asset }, create }: any) => {
        if (!insuranceFund.has(asset)) insuranceFund.set(asset, create.balance);
        return { asset, balance: insuranceFund.get(asset)! };
      }),
      update: jest.fn(async ({ where: { asset }, data }: any) => {
        insuranceFund.set(asset, data.balance);
      }),
    },
    insuranceFundLedger: {
      create: jest.fn(async ({ data }: any) => {
        insuranceLedger.push(data);
      }),
    },
  };

  const findManyOpen = jest.fn(async () => Array.from(positionMap.values()).filter((p) => p.status === 'OPEN'));
  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    futuresPosition: { findMany: findManyOpen },
  } as any;

  return { prisma, positionMap, balanceMap, insuranceFund, insuranceLedger };
}

function makeMarkPriceService(price: string) {
  const svc = new MarkPriceService({} as any);
  jest.spyOn(svc, 'getMarkPrice').mockResolvedValue(new BigNumber(price));
  return svc;
}

describe('LiquidationEngine.checkAndLiquidate', () => {
  it('liquidates a LONG position whose mark price has fallen to/through its liquidation price', async () => {
    const positions = [
      {
        id: 'p1',
        userId: 'u1',
        symbol: 'BTC/USDT',
        side: 'LONG',
        size: '1',
        entryPrice: '60000',
        leverage: 10,
        initialMargin: '6000',
        liquidationPrice: '54300',
        status: 'OPEN',
      },
    ];
    const { prisma, positionMap, balanceMap } = makeFakePrisma(positions, { 'u1:USDT': { available: '4000', locked: '6000' } });
    const engine = new LiquidationEngine(prisma, makeMarkPriceService('54000')); // through the liq price

    const count = await engine.checkAndLiquidate();

    expect(count).toBe(1);
    expect(positionMap.get('p1').status).toBe('LIQUIDATED');
    // locked margin fully released from the user's wallet either way
    expect(balanceMap.get('u1:USDT')!.locked).toBe('0');
  });

  it('does not liquidate a LONG position whose mark price is still above its liquidation price', async () => {
    const positions = [
      {
        id: 'p1',
        userId: 'u1',
        symbol: 'BTC/USDT',
        side: 'LONG',
        size: '1',
        entryPrice: '60000',
        leverage: 10,
        initialMargin: '6000',
        liquidationPrice: '54300',
        status: 'OPEN',
      },
    ];
    const { prisma, positionMap } = makeFakePrisma(positions, { 'u1:USDT': { available: '4000', locked: '6000' } });
    const engine = new LiquidationEngine(prisma, makeMarkPriceService('58000'));

    const count = await engine.checkAndLiquidate();

    expect(count).toBe(0);
    expect(positionMap.get('p1').status).toBe('OPEN');
  });

  it('routes a surplus (execution better than bankruptcy price) to the insurance fund as a contribution', async () => {
    // entry 60000, 10x -> bankruptcy price = 54000. Liquidated at 54300
    // (worse than entry, better than bankruptcy) leaves leftover margin.
    const positions = [
      {
        id: 'p1',
        userId: 'u1',
        symbol: 'BTC/USDT',
        side: 'LONG',
        size: '1',
        entryPrice: '60000',
        leverage: 10,
        initialMargin: '6000',
        liquidationPrice: '54300',
        status: 'OPEN',
      },
    ];
    const { prisma, insuranceFund, insuranceLedger } = makeFakePrisma(positions, { 'u1:USDT': { available: '0', locked: '6000' } });
    const engine = new LiquidationEngine(prisma, makeMarkPriceService('54300'));

    await engine.checkAndLiquidate();

    // realized pnl = (54300 - 60000) * 1 = -5700; marginBalance = 6000 - 5700 = 300 (surplus)
    expect(new BigNumber(insuranceFund.get('USDT')!).toNumber()).toBeCloseTo(300, 6);
    expect(insuranceLedger[0].reason).toBe('LIQUIDATION_SURPLUS');
  });

  it('routes a shortfall (execution worse than bankruptcy price) to the insurance fund as a payout', async () => {
    // Liquidated at 50000 — well past bankruptcy (54000) — a real loss beyond margin.
    const positions = [
      {
        id: 'p1',
        userId: 'u1',
        symbol: 'BTC/USDT',
        side: 'LONG',
        size: '1',
        entryPrice: '60000',
        leverage: 10,
        initialMargin: '6000',
        liquidationPrice: '54300',
        status: 'OPEN',
      },
    ];
    const { prisma, insuranceFund, insuranceLedger } = makeFakePrisma(positions, { 'u1:USDT': { available: '0', locked: '6000' } });
    const engine = new LiquidationEngine(prisma, makeMarkPriceService('50000'));

    await engine.checkAndLiquidate();

    // realized pnl = (50000 - 60000) * 1 = -10000; marginBalance = 6000 - 10000 = -4000 (shortfall)
    expect(new BigNumber(insuranceFund.get('USDT')!).toNumber()).toBeCloseTo(-4000, 6);
    expect(insuranceLedger[0].reason).toBe('LIQUIDATION_SHORTFALL');
  });

  it('skips a symbol instead of liquidating when mark price is unavailable', async () => {
    const positions = [
      {
        id: 'p1',
        userId: 'u1',
        symbol: 'BTC/USDT',
        side: 'LONG',
        size: '1',
        entryPrice: '60000',
        leverage: 10,
        initialMargin: '6000',
        liquidationPrice: '54300',
        status: 'OPEN',
      },
    ];
    const { prisma, positionMap } = makeFakePrisma(positions, { 'u1:USDT': { available: '0', locked: '6000' } });
    const markPriceService = { getMarkPrice: jest.fn().mockResolvedValue(null) } as any;
    const engine = new LiquidationEngine(prisma, markPriceService);

    const count = await engine.checkAndLiquidate();

    expect(count).toBe(0);
    expect(positionMap.get('p1').status).toBe('OPEN');
  });

  it('liquidates a SHORT position whose mark price has risen to/through its liquidation price', async () => {
    const positions = [
      {
        id: 'p1',
        userId: 'u1',
        symbol: 'BTC/USDT',
        side: 'SHORT',
        size: '1',
        entryPrice: '60000',
        leverage: 10,
        initialMargin: '6000',
        liquidationPrice: '65700',
        status: 'OPEN',
      },
    ];
    const { prisma, positionMap } = makeFakePrisma(positions, { 'u1:USDT': { available: '0', locked: '6000' } });
    const engine = new LiquidationEngine(prisma, makeMarkPriceService('66000'));

    const count = await engine.checkAndLiquidate();

    expect(count).toBe(1);
    expect(positionMap.get('p1').status).toBe('LIQUIDATED');
  });
});
