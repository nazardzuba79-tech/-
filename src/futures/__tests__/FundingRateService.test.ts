import BigNumber from 'bignumber.js';
import { FundingRateService, msUntilNextFundingBoundary } from '../FundingRateService';
import { MarkPriceService } from '../MarkPriceService';

function makeFakePrisma(positions: any[], balances: Record<string, { available: string; locked: string }> = {}) {
  const balanceMap = new Map(Object.entries(balances));
  const fundingPayments: any[] = [];
  const fundingRateRecords: any[] = [];

  const tx = {
    fundingRateRecord: {
      create: jest.fn(async ({ data }: any) => {
        const record = { id: 'r' + fundingRateRecords.length, ...data };
        fundingRateRecords.push(record);
        return record;
      }),
    },
    futuresPosition: {
      findMany: jest.fn(async () => positions.map((p) => ({ ...p }))),
    },
    fundingPayment: {
      create: jest.fn(async ({ data }: any) => {
        fundingPayments.push(data);
      }),
    },
    futuresBalance: {
      upsert: jest.fn(async ({ where: { userId_asset: { userId, asset } }, create }: any) => {
        const key = `${userId}:${asset}`;
        if (!balanceMap.has(key)) balanceMap.set(key, { available: create.available, locked: create.locked });
        return { ...balanceMap.get(key)! };
      }),
      update: jest.fn(async ({ where: { userId_asset: { userId, asset } }, data }: any) => {
        const key = `${userId}:${asset}`;
        const existing = balanceMap.get(key)!;
        balanceMap.set(key, { available: data.available, locked: existing.locked });
      }),
    },
  };

  const prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) } as any;
  return { prisma, balanceMap, fundingPayments, fundingRateRecords };
}

function makeMarkPriceService(indexPrice: string, markPrice: string) {
  const svc = new MarkPriceService({ getTicker: jest.fn().mockResolvedValue({ lastPrice: indexPrice }) } as any);
  jest.spyOn(svc, 'getMarkPrice').mockResolvedValue(new BigNumber(markPrice));
  jest.spyOn(svc, 'getIndexPrice').mockResolvedValue(new BigNumber(indexPrice));
  return svc;
}

describe('FundingRateService.computeFundingRate', () => {
  it('is positive (longs pay) when the futures mark trades at a premium to index', () => {
    const svc = new FundingRateService({} as any, {} as any);
    const rate = svc.computeFundingRate(new BigNumber(60100), new BigNumber(60000));
    expect(rate.isGreaterThan(0)).toBe(true);
  });

  it('is negative (shorts pay) when the futures mark trades at a discount to index', () => {
    const svc = new FundingRateService({} as any, {} as any);
    const rate = svc.computeFundingRate(new BigNumber(59900), new BigNumber(60000));
    expect(rate.isLessThan(0)).toBe(true);
  });

  it('is capped at ±0.75% even for an extreme premium', () => {
    const svc = new FundingRateService({} as any, {} as any);
    const rate = svc.computeFundingRate(new BigNumber(90000), new BigNumber(60000));
    expect(rate.toNumber()).toBeCloseTo(0.0075, 10);
  });
});

describe('FundingRateService.settleFundingForSymbol', () => {
  it('debits longs and credits shorts when funding is positive', async () => {
    const positions = [
      { id: 'p1', userId: 'long-user', symbol: 'BTC/USDT', side: 'LONG', size: '1', status: 'OPEN' },
      { id: 'p2', userId: 'short-user', symbol: 'BTC/USDT', side: 'SHORT', size: '1', status: 'OPEN' },
    ];
    const { prisma, balanceMap, fundingPayments } = makeFakePrisma(positions, {
      'long-user:USDT': { available: '10000', locked: '0' },
      'short-user:USDT': { available: '10000', locked: '0' },
    });
    const markPriceService = makeMarkPriceService('60000', '60100'); // premium -> positive rate
    const service = new FundingRateService(prisma, markPriceService);

    await service.settleFundingForSymbol('BTC/USDT');

    const rate = fundingPayments[0].rate;
    expect(new BigNumber(rate).isGreaterThan(0)).toBe(true);

    const longBal = new BigNumber(balanceMap.get('long-user:USDT')!.available);
    const shortBal = new BigNumber(balanceMap.get('short-user:USDT')!.available);
    expect(longBal.isLessThan(10000)).toBe(true); // long paid
    expect(shortBal.isGreaterThan(10000)).toBe(true); // short received
    // zero-sum between the two positions (both notional 1*60100)
    expect(longBal.minus(10000).plus(shortBal.minus(10000)).toNumber()).toBeCloseTo(0, 8);
  });

  it('returns null instead of fabricating a rate when the index price is unavailable', async () => {
    const { prisma } = makeFakePrisma([]);
    const markPriceService = {
      getMarkPrice: jest.fn().mockResolvedValue(null),
      getIndexPrice: jest.fn().mockResolvedValue(null),
    } as any;
    const service = new FundingRateService(prisma, markPriceService);

    const result = await service.settleFundingForSymbol('BTC/USDT');
    expect(result).toBeNull();
  });
});

describe('msUntilNextFundingBoundary', () => {
  it('returns 0 < delay <= 8h and lands exactly on a UTC 00/08/16 boundary', () => {
    const now = new Date('2026-08-22T05:37:12.123Z');
    const delay = msUntilNextFundingBoundary(now);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(8 * 60 * 60 * 1000);

    const boundary = new Date(now.getTime() + delay);
    expect(boundary.getUTCHours() % 8).toBe(0);
    expect(boundary.getUTCMinutes()).toBe(0);
    expect(boundary.getUTCSeconds()).toBe(0);
    expect(boundary.getUTCMilliseconds()).toBe(0);
  });

  it('schedules a full 8h out when `now` is exactly on a boundary', () => {
    const now = new Date('2026-08-22T08:00:00.000Z');
    expect(msUntilNextFundingBoundary(now)).toBe(8 * 60 * 60 * 1000);
  });
});
