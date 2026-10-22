import BigNumber from 'bignumber.js';
import { walletDelegate } from '../../test-utils/walletDelegate';
import { FundingRateService, fundingBoundaryAt, msUntilNextFundingBoundary } from '../FundingRateService';
import { MarkPriceService } from '../MarkPriceService';
import { VOLTEX_FUNDING } from '../../config/voltexFunding';

/** A fake transaction client that keeps the records it was given, so a
 * second run can see what an earlier one settled (the same SELECT the
 * service makes after taking its advisory lock). */
function makeFakePrisma(positions: any[], balances: Record<string, { available: string; locked: string }> = {}) {
  const balanceMap = new Map(Object.entries(balances));
  const fundingPayments: any[] = [];
  const fundingRateRecords: any[] = [];
  const locks: string[] = [];

  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => { locks.push(String(values[0])); return [{}]; }),
    fundingRateRecord: {
      findFirst: jest.fn(async ({ where }: any) => fundingRateRecords.find((r) => r.symbol === where.symbol
        && r.appliedAt.getTime() >= where.appliedAt.gte.getTime() && r.appliedAt.getTime() < where.appliedAt.lt.getTime()) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const record = { id: 'r' + fundingRateRecords.length, ...data };
        fundingRateRecords.push(record);
        return record;
      }),
    },
    futuresPosition: {
      findMany: jest.fn(async () => positions.filter((p) => p.status === 'OPEN').map((p) => ({ ...p }))),
    },
    fundingPayment: {
      create: jest.fn(async ({ data }: any) => {
        fundingPayments.push(data);
      }),
    },
    futuresBalance: walletDelegate(balanceMap),
  };

  const prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) } as any;
  return { prisma, balanceMap, fundingPayments, fundingRateRecords, locks };
}

function marks(indexPrice: string, markPrice: string) {
  const svc = new MarkPriceService({ getTicker: jest.fn().mockResolvedValue({ lastPrice: indexPrice }) } as any);
  jest.spyOn(svc, 'getMarkPrice').mockResolvedValue(new BigNumber(markPrice));
  jest.spyOn(svc, 'getIndexPrice').mockResolvedValue(new BigNumber(indexPrice));
  return svc;
}

const H8 = 8 * 60 * 60 * 1000;
const BOUNDARY = new Date('2026-10-17T00:00:00.000Z');
const twoSides = () => [
  { id: 'p1', userId: 'long-user', symbol: 'BTC/USDT', side: 'LONG', size: '2', status: 'OPEN' },
  { id: 'p2', userId: 'short-user', symbol: 'BTC/USDT', side: 'SHORT', size: '2', status: 'OPEN' },
];
const wallets = () => ({ 'long-user:USDT': { available: '10000', locked: '0' }, 'short-user:USDT': { available: '10000', locked: '0' } });

describe('VOLTEX fixed funding on real futures positions', () => {
  it('ships the owner rates: LONG pays 0.01%, SHORT receives 0.04% per 8h', () => {
    expect(VOLTEX_FUNDING).toEqual({ version: 'VOLTEX_FIXED_V2', longCashflow: '-0.0001', shortCashflow: '0.0004' });
  });

  it('LONG is debited quantity × mark × 0.01%, SHORT credited × 0.04%, whatever the mark/index premium', async () => {
    const { prisma, balanceMap, fundingPayments } = makeFakePrisma(twoSides(), wallets());
    // A large premium would have moved the old formula; the fixed rates ignore it.
    const service = new FundingRateService(prisma, marks('60000', '61000'), undefined, undefined, () => new Date(BOUNDARY.getTime() + 1500));

    await service.settleFundingForSymbol('BTC/USDT');

    // notional 2 × 61000 = 122000: LONG −12.2, SHORT +48.8
    expect(fundingPayments).toEqual([
      expect.objectContaining({ positionId: 'p1', amount: '-12.2', rate: '-0.0001' }),
      expect.objectContaining({ positionId: 'p2', amount: '48.8', rate: '0.0004' }),
    ]);
    expect(balanceMap.get('long-user:USDT')!.available).toBe('9987.8');
    expect(balanceMap.get('short-user:USDT')!.available).toBe('10048.8');
  });

  it('settles a boundary once: a second instance, a restart or an early timer at the same boundary pays nothing', async () => {
    const { prisma, balanceMap, fundingPayments, fundingRateRecords, locks } = makeFakePrisma(twoSides(), wallets());
    const at = (ms: number) => new FundingRateService(prisma, marks('60000', '60000'), undefined, undefined, () => new Date(ms));

    await at(BOUNDARY.getTime() + 10).settleFundingForSymbol('BTC/USDT');          // instance A
    expect(await at(BOUNDARY.getTime() + 250).settleFundingForSymbol('BTC/USDT')).toBeNull(); // instance B, same boundary
    expect(await at(BOUNDARY.getTime() + H8 - 1).settleFundingForSymbol('BTC/USDT')).toBeNull(); // a restart late in the interval

    expect(fundingPayments).toHaveLength(2);
    expect(fundingRateRecords).toHaveLength(1);
    expect(fundingRateRecords[0].appliedAt).toEqual(BOUNDARY);
    expect(balanceMap.get('long-user:USDT')!.available).toBe('9988');
    expect(balanceMap.get('short-user:USDT')!.available).toBe('10048');
    // every run serialises on the same (symbol, boundary) lock
    expect(new Set(locks)).toEqual(new Set([`futures-funding:BTC/USDT:${BOUNDARY.getTime()}`]));
  });

  it('settles the next boundary again, at the then-held size, and never re-prices the earlier payment', async () => {
    const positions = twoSides();
    const { prisma, fundingPayments } = makeFakePrisma(positions, wallets());
    const at = (ms: number) => new FundingRateService(prisma, marks('60000', '60000'), undefined, undefined, () => new Date(ms));

    await at(BOUNDARY.getTime()).settleFundingForSymbol('BTC/USDT');
    const first = fundingPayments.map((p) => ({ ...p }));
    positions[0].size = '1';            // the long halves its position
    positions[1].status = 'CLOSED';     // the short closes before the next boundary
    await at(BOUNDARY.getTime() + H8).settleFundingForSymbol('BTC/USDT');

    expect(fundingPayments.slice(0, 2)).toEqual(first);
    expect(fundingPayments.slice(2)).toEqual([expect.objectContaining({ positionId: 'p1', amount: '-6', rate: '-0.0001' })]);
  });

  it('settles nothing and invents no price when the mark or index is unavailable', async () => {
    const { prisma, fundingPayments, fundingRateRecords } = makeFakePrisma(twoSides(), wallets());
    const markPriceService = { getMarkPrice: jest.fn().mockResolvedValue(null), getIndexPrice: jest.fn().mockResolvedValue(null) } as any;
    const service = new FundingRateService(prisma, markPriceService);

    expect(await service.settleFundingForSymbol('BTC/USDT')).toBeNull();
    expect(fundingPayments).toHaveLength(0);
    expect(fundingRateRecords).toHaveLength(0);
  });
});

describe('fundingBoundaryAt', () => {
  it('is the latest 00/08/16 UTC boundary at or before the run', () => {
    expect(fundingBoundaryAt(new Date('2026-10-17T08:00:00.000Z')).toISOString()).toBe('2026-10-17T08:00:00.000Z');
    expect(fundingBoundaryAt(new Date('2026-10-17T15:59:59.999Z')).toISOString()).toBe('2026-10-17T08:00:00.000Z');
    // a timer that fires a millisecond early belongs to the previous, already settled boundary
    expect(fundingBoundaryAt(new Date('2026-10-17T07:59:59.999Z')).toISOString()).toBe('2026-10-17T00:00:00.000Z');
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
