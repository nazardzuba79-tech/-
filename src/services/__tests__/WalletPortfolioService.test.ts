import { WalletPortfolioService } from '../WalletPortfolioService';
import { ADMIN_PROFILE_EMAIL, PROFILE_REFERENCE_DAY } from '../AdminPortfolioProfile';

const REFERENCE = new Date(`${PROFILE_REFERENCE_DAY}T12:00:00.000Z`);

const PROFILE_USER = { id: 'u-admin', role: 'ADMIN', email: ADMIN_PROFILE_EMAIL };
const OTHER_ADMIN = { id: 'u-admin2', role: 'ADMIN', email: 'ops@example.com' };
const NORMAL_USER = { id: 'u-normal', role: 'USER', email: 'trader@example.com' };

const TICKERS = [
  { pair: 'BTC/USDT', lastPrice: '106400' },
  { pair: 'ETH/USDT', lastPrice: '3412' },
  { pair: 'XRP/USDT', lastPrice: '2.4713' },
];

/**
 * A ledger holding a deliberately small, ordinary balance. Whatever the
 * presentation profile shows, this is what the account can actually spend —
 * and these tests exist to prove nothing writes over it.
 */
function prismaStub(overrides: Partial<Record<string, any>> = {}) {
  const balances = [{ asset: 'USDT', available: '250', locked: '0' }];
  const futuresBalances = [{ asset: 'USDT', available: '50', locked: '0' }];
  const balanceUpdate = jest.fn();
  const futuresUpdate = jest.fn();
  return {
    balance: {
      findMany: jest.fn().mockResolvedValue(balances),
      update: balanceUpdate,
      upsert: balanceUpdate,
      create: balanceUpdate,
      updateMany: balanceUpdate,
    },
    futuresBalance: {
      findMany: jest.fn().mockResolvedValue(futuresBalances),
      update: futuresUpdate,
      upsert: futuresUpdate,
      create: futuresUpdate,
      updateMany: futuresUpdate,
    },
    portfolioSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    deposit: { findMany: jest.fn().mockResolvedValue([]) },
    withdrawal: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  } as any;
}

function serviceFor(prisma: any, opts: { cfdConfigured?: boolean } = {}) {
  const marketData = { getTickers: jest.fn().mockResolvedValue(TICKERS) } as any;
  const cfdData = {
    isConfigured: () => opts.cfdConfigured ?? true,
    getTickers: jest.fn().mockResolvedValue([{ symbol: 'EURUSD', name: 'Euro', price: '1.08', changePercent24h: '0.1' }]),
  } as any;
  return { service: new WalletPortfolioService(prisma, marketData, cfdData), marketData, cfdData };
}

describe('wallet overview — the displayed Spot/Futures split', () => {
  it('shows an ordinary account its own real ledger, untouched', async () => {
    const { service } = serviceFor(prismaStub());
    const o = await service.overview(NORMAL_USER);

    // 250 USDT spot + 50 USDT futures, pegged at 1.
    expect(o.displayTotalUsd).toBeCloseTo(300, 6);
    expect(o.displaySpotUsd).toBeCloseTo(250, 6);
    expect(o.displayFuturesUsd).toBeCloseTo(50, 6);
    expect(o.displaySpotUsd).toBe(o.real.spotValueUsd);
    expect(o.displayFuturesUsd).toBe(o.real.futuresValueUsd);
  });

  it('splits the profile account 80/20 off its presentation total', async () => {
    const { service } = serviceFor(prismaStub());
    const o = await service.overview(PROFILE_USER);

    expect(o.displayTotalUsd).toBeCloseTo(o.presentation!.totalValueUsd, 6);
    expect(o.displaySpotUsd).toBeCloseTo(o.displayTotalUsd * 0.8, 6);
    expect(o.displayFuturesUsd).toBeCloseTo(o.displayTotalUsd * 0.2, 6);
  });

  it('always adds back to exactly the displayed total', async () => {
    const { service } = serviceFor(prismaStub());
    for (const user of [PROFILE_USER, NORMAL_USER, OTHER_ADMIN]) {
      const o = await service.overview(user);
      expect(o.displaySpotUsd + o.displayFuturesUsd).toBeCloseTo(o.displayTotalUsd, 6);
    }
  });

  it('never shows the profile account the legacy ledger figures underneath', async () => {
    const { service } = serviceFor(prismaStub());
    const o = await service.overview(PROFILE_USER);

    // The bug this replaced: a multi-million presentation total sitting above
    // a few hundred dollars of real spot and zero futures.
    expect(o.real.spotValueUsd).toBeCloseTo(250, 6);
    expect(o.displaySpotUsd).not.toBeCloseTo(o.real.spotValueUsd, 6);
    expect(o.displaySpotUsd).toBeGreaterThan(1_000_000);
    expect(o.displayFuturesUsd).toBeGreaterThan(1_000_000);
  });

  it('moves with live prices rather than any fixed amount', async () => {
    const cheap = serviceFor(prismaStub());
    const before = await cheap.service.overview(PROFILE_USER);

    // Same holdings, BTC doubled.
    const dear = serviceFor(prismaStub());
    dear.marketData.getTickers.mockResolvedValue(
      TICKERS.map((t) => (t.pair === 'BTC/USDT' ? { ...t, lastPrice: '212800' } : t))
    );
    const after = await dear.service.overview(PROFILE_USER);

    expect(after.displayTotalUsd).toBeGreaterThan(before.displayTotalUsd);
    expect(after.displaySpotUsd).toBeCloseTo(after.displayTotalUsd * 0.8, 6);
    expect(after.displayFuturesUsd).toBeCloseTo(after.displayTotalUsd * 0.2, 6);
    // Not a constant: the split tracked the revaluation.
    expect(after.displaySpotUsd).toBeGreaterThan(before.displaySpotUsd);
  });

  it('leaves a different admin on the real ledger split', async () => {
    const { service } = serviceFor(prismaStub());
    const o = await service.overview(OTHER_ADMIN);
    expect(o.presentation).toBeNull();
    expect(o.displaySpotUsd).toBe(o.real.spotValueUsd);
    expect(o.displayFuturesUsd).toBe(o.real.futuresValueUsd);
  });

  it('writes nothing while producing the split', async () => {
    const prisma = prismaStub();
    const { service } = serviceFor(prisma);
    await service.overview(PROFILE_USER);

    // The 80/20 figures are computed for the response and nowhere else.
    expect(prisma.balance.update).not.toHaveBeenCalled();
    expect(prisma.balance.upsert).not.toHaveBeenCalled();
    expect(prisma.balance.create).not.toHaveBeenCalled();
    expect(prisma.balance.updateMany).not.toHaveBeenCalled();
    expect(prisma.futuresBalance.update).not.toHaveBeenCalled();
    expect(prisma.futuresBalance.upsert).not.toHaveBeenCalled();
    expect(prisma.futuresBalance.create).not.toHaveBeenCalled();
    expect(prisma.futuresBalance.updateMany).not.toHaveBeenCalled();
  });
});

describe('wallet overview — who sees the presentation profile', () => {
  it('gives a normal user no presentation holdings at all', async () => {
    const { service } = serviceFor(prismaStub());
    const overview = await service.overview(NORMAL_USER);
    expect(overview.presentation).toBeNull();
    expect(overview.displayTotalUsd).toBeCloseTo(300, 6);
  });

  it('gives a different admin no presentation holdings either', async () => {
    const { service } = serviceFor(prismaStub());
    const overview = await service.overview(OTHER_ADMIN);
    expect(overview.presentation).toBeNull();
    expect(overview.displayTotalUsd).toBeCloseTo(300, 6);
  });

  it('gives the profile account its holdings, valued from live market data', async () => {
    const { service } = serviceFor(prismaStub());
    const overview = await service.overview(PROFILE_USER);
    expect(overview.presentation).not.toBeNull();
    const bySymbol = new Map(overview.presentation!.holdings.map((h) => [h.asset, h]));
    expect(bySymbol.get('BTC')!.valueUsd).toBeCloseTo(271 * 106400, 6);
    expect(bySymbol.get('ETH')!.valueUsd).toBeCloseTo(561 * 3412, 6);
    expect(bySymbol.get('XRP')!.valueUsd).toBeCloseTo(1_200_000 * 2.4713, 6);
    expect(bySymbol.get('USDT')!.valueUsd).toBeCloseTo(32_726_245, 6);
    expect(bySymbol.get('USDC')!.valueUsd).toBeCloseTo(1_200_000, 6);
    expect(bySymbol.get('EUR')!.valueUsd).toBeCloseTo(700_000 * 1.08, 6);
  });

  it('reports EUR as unpriced rather than zero when no CFD provider is configured', async () => {
    const { service } = serviceFor(prismaStub(), { cfdConfigured: false });
    const overview = await service.overview(PROFILE_USER);
    const eur = overview.presentation!.holdings.find((h) => h.asset === 'EUR')!;
    expect(eur.priceUsd).toBeNull();
    expect(eur.valueUsd).toBeNull();
  });

  it('prices nothing at zero when the market feed is down', async () => {
    const prisma = prismaStub();
    const marketData = { getTickers: jest.fn().mockRejectedValue(new Error('upstream down')) } as any;
    const cfdData = { isConfigured: () => false, getTickers: jest.fn() } as any;
    const service = new WalletPortfolioService(prisma, marketData, cfdData);
    const overview = await service.overview(PROFILE_USER);
    expect(overview.presentation!.holdings.find((h) => h.asset === 'BTC')!.priceUsd).toBeNull();
  });
});

describe('wallet overview — the presentation profile never touches the ledger', () => {
  it('reports the real spendable balances unchanged alongside the profile', async () => {
    const { service } = serviceFor(prismaStub());
    const overview = await service.overview(PROFILE_USER);
    // Real ledger: $250 spot + $50 futures. Not the profile's tens of millions.
    expect(overview.real.spotValueUsd).toBeCloseTo(250, 6);
    expect(overview.real.futuresValueUsd).toBeCloseTo(50, 6);
    expect(overview.real.totalValueUsd).toBeCloseTo(300, 6);
    // Each row carries the same quote the totals were summed from, so the
    // ledger can never contradict the header.
    expect(overview.real.spot).toEqual([
      { asset: 'USDT', available: '250', locked: '0', priceUsd: 1, valueUsd: 250 },
    ]);
    expect(overview.real.futures).toEqual([
      { asset: 'USDT', available: '50', locked: '0', priceUsd: 1, valueUsd: 50 },
    ]);
    expect(overview.real.spot.reduce((a, b) => a + (b.valueUsd ?? 0), 0)).toBeCloseTo(
      overview.real.spotValueUsd,
      6
    );
  });

  it('writes nothing to Balance', async () => {
    const prisma = prismaStub();
    const { service } = serviceFor(prisma);
    await service.overview(PROFILE_USER);
    await service.performance(PROFILE_USER, REFERENCE);
    expect(prisma.balance.update).not.toHaveBeenCalled();
    expect(prisma.balance.upsert).not.toHaveBeenCalled();
    expect(prisma.balance.create).not.toHaveBeenCalled();
    expect(prisma.balance.updateMany).not.toHaveBeenCalled();
  });

  it('writes nothing to FuturesBalance', async () => {
    const prisma = prismaStub();
    const { service } = serviceFor(prisma);
    await service.overview(PROFILE_USER);
    await service.performance(PROFILE_USER, REFERENCE);
    expect(prisma.futuresBalance.update).not.toHaveBeenCalled();
    expect(prisma.futuresBalance.upsert).not.toHaveBeenCalled();
    expect(prisma.futuresBalance.create).not.toHaveBeenCalled();
    expect(prisma.futuresBalance.updateMany).not.toHaveBeenCalled();
  });

  it('does not raise withdrawal capacity: withdrawable money is the ledger row', async () => {
    const { service } = serviceFor(prismaStub());
    const overview = await service.overview(PROFILE_USER);
    const spendableUsdt = Number(overview.real.spot.find((b) => b.asset === 'USDT')!.available);
    expect(spendableUsdt).toBe(250);
    // The presentation profile claims 32,726,245 USDT; none of it is here.
    expect(overview.real.spot.some((b) => Number(b.available) > 1000)).toBe(false);
  });

  it('does not raise spot buying power or futures margin', async () => {
    const { service } = serviceFor(prismaStub());
    const overview = await service.overview(PROFILE_USER);
    const spotPower = overview.real.spot.reduce((s, b) => s + Number(b.available), 0);
    const futuresMargin = overview.real.futures.reduce((s, b) => s + Number(b.available), 0);
    expect(spotPower).toBe(250);
    expect(futuresMargin).toBe(50);
    expect(overview.presentation!.totalValueUsd).toBeGreaterThan(1_000_000);
  });
});

describe('wallet performance — a normal account', () => {
  const snapshot = (date: string, value: string) => ({ createdAt: new Date(`${date}T09:00:00.000Z`), totalValueUsd: value });

  it('has no periods at all until there is history to measure', async () => {
    const { service } = serviceFor(prismaStub());
    const perf = await service.performance(NORMAL_USER, REFERENCE);
    for (const p of Object.values(perf.periods)) expect(p.available).toBe(false);
    expect(perf.startedOn).toBeNull();
  });

  it('reports a period honestly unavailable when the series is too short for it', async () => {
    const prisma = prismaStub({
      portfolioSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          snapshot('2026-08-20', '1000'),
          snapshot('2026-09-04', '1100'),
        ]),
      },
    });
    const { service } = serviceFor(prisma);
    const perf = await service.performance(NORMAL_USER, REFERENCE);
    // Fifteen days of history: enough to answer 7D, not 30D or anything
    // longer. Those come back unavailable rather than quietly reporting the
    // 15-day number as if it were a 30-day one.
    expect(perf.periods['7d'].available).toBe(true);
    expect(perf.periods['30d'].available).toBe(false);
    expect(perf.periods['90d'].available).toBe(false);
    expect(perf.periods['1y'].available).toBe(false);
    expect(perf.periods.all.available).toBe(true);
  });

  it('does not count a deposit as profit', async () => {
    const prisma = prismaStub({
      portfolioSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          snapshot('2026-08-26', '1000'),
          // Value doubled, but only because $1,000 was deposited that day.
          snapshot('2026-08-29', '2000'),
          snapshot('2026-09-04', '2000'),
        ]),
      },
      deposit: {
        findMany: jest.fn().mockResolvedValue([
          { asset: 'USDT', amount: '1000', createdAt: new Date('2026-08-29T10:00:00.000Z') },
        ]),
      },
    });
    const { service } = serviceFor(prisma);
    const perf = await service.performance(NORMAL_USER, REFERENCE);
    expect(perf.periods['7d'].percent).toBeCloseTo(0, 6);
    expect(perf.periods['7d'].absolutePnl).toBeCloseTo(0, 6);
  });

  it('does not count a withdrawal as a loss', async () => {
    const prisma = prismaStub({
      portfolioSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          snapshot('2026-08-26', '2000'),
          snapshot('2026-08-29', '1000'),
          snapshot('2026-09-04', '1000'),
        ]),
      },
      withdrawal: {
        findMany: jest.fn().mockResolvedValue([
          { asset: 'USDT', amount: '1000', status: 'SENT', createdAt: new Date('2026-08-29T10:00:00.000Z') },
        ]),
      },
    });
    const { service } = serviceFor(prisma);
    const perf = await service.performance(NORMAL_USER, REFERENCE);
    expect(perf.periods['7d'].percent).toBeCloseTo(0, 6);
  });

  it('only counts withdrawals that actually left — a pending one is still in the account', async () => {
    const prisma = prismaStub({
      portfolioSnapshot: {
        findMany: jest.fn().mockResolvedValue([snapshot('2026-08-26', '1000'), snapshot('2026-09-04', '1100')]),
      },
      withdrawal: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const { service } = serviceFor(prisma);
    await service.performance(NORMAL_USER, REFERENCE);
    expect(prisma.withdrawal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'SENT' }) })
    );
  });

  it('still reports real trading gains once flows are removed', async () => {
    const prisma = prismaStub({
      portfolioSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          snapshot('2026-08-26', '1000'),
          // +$1,000 deposited AND +$200 earned.
          snapshot('2026-08-29', '2200'),
          snapshot('2026-09-04', '2200'),
        ]),
      },
      deposit: {
        findMany: jest.fn().mockResolvedValue([
          { asset: 'USDT', amount: '1000', createdAt: new Date('2026-08-29T10:00:00.000Z') },
        ]),
      },
    });
    const { service } = serviceFor(prisma);
    const perf = await service.performance(NORMAL_USER, REFERENCE);
    // (2200 - 1000) / 1000 - 1 = +20%, not +120%.
    expect(perf.periods['7d'].percent).toBeCloseTo(20, 6);
  });

  it('keeps percentage, absolute PnL and chart endpoints in agreement', async () => {
    const prisma = prismaStub({
      portfolioSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          snapshot('2026-08-20', '5000'),
          snapshot('2026-08-28', '5400'),
          snapshot('2026-09-04', '6000'),
        ]),
      },
    });
    const { service } = serviceFor(prisma);
    const perf = await service.performance(NORMAL_USER, REFERENCE);
    const p = perf.periods['7d'];
    expect(p.available).toBe(true);
    expect(p.absolutePnl).toBeCloseTo(p.endEquity! - p.startEquity!, 9);
    expect(p.percent).toBeCloseTo((p.endEquity! / p.startEquity! - 1) * 100, 9);
    expect(p.points[0].equity).toBeCloseTo(p.startEquity!, 9);
    expect(p.points[p.points.length - 1].equity).toBeCloseTo(p.endEquity!, 9);
  });
});

describe('wallet performance — the profile account', () => {
  it('runs the generated series through the same period mathematics', async () => {
    const { service } = serviceFor(prismaStub());
    const perf = await service.performance(PROFILE_USER, REFERENCE);
    expect(perf.periods['7d'].percent).toBeCloseTo(28, 1);
    expect(perf.periods.all.percent).toBeCloseTo(2115, 1);
    for (const p of Object.values(perf.periods)) {
      expect(p.percent).toBeCloseTo((p.endEquity! / p.startEquity! - 1) * 100, 9);
    }
  });

  it('ends the series at the profile’s live valuation, not a stored number', async () => {
    const { service } = serviceFor(prismaStub());
    const [overview, perf] = await Promise.all([
      service.overview(PROFILE_USER),
      service.performance(PROFILE_USER, REFERENCE),
    ]);
    expect(perf.periods.all.endEquity).toBeCloseTo(overview.presentation!.totalValueUsd, 4);
  });

  it('leaves a different admin on their own real, empty history', async () => {
    const { service } = serviceFor(prismaStub());
    const perf = await service.performance(OTHER_ADMIN, REFERENCE);
    expect(perf.startedOn).toBeNull();
    for (const p of Object.values(perf.periods)) expect(p.available).toBe(false);
  });
});
