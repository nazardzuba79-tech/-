import { WalletPortfolioService } from '../WalletPortfolioService';

const REFERENCE = new Date('2026-09-04T12:00:00.000Z');

/**
 * The account that used to carry a hardcoded holdings profile. It is an
 * ordinary admin here, and these tests exist to keep it one: the owner's
 * authoritative figures come from the native account model, and nothing in
 * this service may grow a second set of them again.
 */
const OWNER = { id: 'u-admin', role: 'ADMIN', email: 'voltex.crypto@gmail.com' };
const OTHER_ADMIN = { id: 'u-admin2', role: 'ADMIN', email: 'ops@example.com' };
const NORMAL_USER = { id: 'u-normal', role: 'USER', email: 'trader@example.com' };

const TICKERS = [
  { pair: 'BTC/USDT', lastPrice: '106400' },
  { pair: 'ETH/USDT', lastPrice: '3412' },
  { pair: 'XRP/USDT', lastPrice: '2.4713' },
];

/**
 * A ledger holding a deliberately small, ordinary balance: what the account
 * can actually spend. These tests exist to prove nothing writes over it and
 * nothing reports a different number in its place.
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

describe('wallet overview — every account sees its own real ledger', () => {
  it('shows an ordinary account its own real ledger, untouched', async () => {
    const { service } = serviceFor(prismaStub());
    const o = await service.overview(NORMAL_USER);

    // 250 USDT spot + 50 USDT futures, pegged at 1.
    expect(o.real.totalValueUsd).toBeCloseTo(300, 6);
    expect(o.real.spotValueUsd).toBeCloseTo(250, 6);
    expect(o.real.futuresValueUsd).toBeCloseTo(50, 6);
  });

  it.each([
    ['the owner account', OWNER],
    ['another admin', OTHER_ADMIN],
    ['a normal user', NORMAL_USER],
  ])('gives %s the same ledger treatment and no profile of any kind', async (_label, user) => {
    const { service } = serviceFor(prismaStub());
    const o = await service.overview(user);

    // The bug this replaced: one account's Wallet total came from a list of
    // holdings written into the source, so it read tens of millions above a
    // ledger holding a few hundred dollars. There is no such list now, and
    // no account gets a different answer from this service than its ledger.
    expect(o.real.totalValueUsd).toBeCloseTo(300, 6);
    expect(o.real.spotValueUsd + o.real.futuresValueUsd).toBeCloseTo(o.real.totalValueUsd, 6);
    expect(Object.keys(o).sort()).toEqual(
      ['btcPriceUsd', 'real', 'unpricedAssets', 'valuationComplete'].sort()
    );
  });

  it('moves with live prices rather than any fixed amount', async () => {
    const cheap = serviceFor(prismaStub({ balance: { findMany: jest.fn().mockResolvedValue([{ asset: 'BTC', available: '2', locked: '0' }]) } }));
    const before = await cheap.service.overview(NORMAL_USER);

    const dear = serviceFor(prismaStub({ balance: { findMany: jest.fn().mockResolvedValue([{ asset: 'BTC', available: '2', locked: '0' }]) } }));
    dear.marketData.getTickers.mockResolvedValue(
      TICKERS.map((t) => (t.pair === 'BTC/USDT' ? { ...t, lastPrice: '212800' } : t))
    );
    const after = await dear.service.overview(NORMAL_USER);

    expect(before.real.spotValueUsd).toBeCloseTo(2 * 106400, 6);
    expect(after.real.spotValueUsd).toBeCloseTo(2 * 212800, 6);
  });

  it('writes nothing while producing the overview', async () => {
    const prisma = prismaStub();
    const { service } = serviceFor(prisma);
    await service.overview(OWNER);

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

describe('wallet overview — an unpriced holding is never a holding worth zero', () => {
  const withEur = () =>
    prismaStub({
      balance: {
        findMany: jest.fn().mockResolvedValue([
          { asset: 'USDT', available: '250', locked: '0' },
          { asset: 'EUR', available: '700000', locked: '0' },
        ]),
        update: jest.fn(), upsert: jest.fn(), create: jest.fn(), updateMany: jest.fn(),
      },
    });

  it('values EUR from the CFD provider when one is configured', async () => {
    const { service } = serviceFor(withEur());
    const o = await service.overview(NORMAL_USER);
    const eur = o.real.spot.find((b) => b.asset === 'EUR')!;
    expect(eur.priceUsd).toBeCloseTo(1.08, 6);
    expect(eur.valueUsd).toBeCloseTo(700_000 * 1.08, 6);
    expect(o.valuationComplete).toBe(true);
    expect(o.unpricedAssets).toEqual([]);
  });

  it('reports EUR as unpriced, and the total as incomplete, when no provider is configured', async () => {
    const { service } = serviceFor(withEur(), { cfdConfigured: false });
    const o = await service.overview(NORMAL_USER);
    const eur = o.real.spot.find((b) => b.asset === 'EUR')!;

    expect(eur.priceUsd).toBeNull();
    expect(eur.valueUsd).toBeNull();
    // Left out of the total rather than added as 0 — and SAID so, which is
    // the only thing that makes the total readable.
    expect(o.real.spotValueUsd).toBeCloseTo(250, 6);
    expect(o.valuationComplete).toBe(false);
    expect(o.unpricedAssets).toEqual(['EUR']);
  });

  it('prices nothing at zero when the market feed is down', async () => {
    const prisma = prismaStub({
      balance: {
        findMany: jest.fn().mockResolvedValue([{ asset: 'BTC', available: '2', locked: '0' }]),
        update: jest.fn(), upsert: jest.fn(), create: jest.fn(), updateMany: jest.fn(),
      },
    });
    const marketData = { getTickers: jest.fn().mockRejectedValue(new Error('upstream down')) } as any;
    const cfdData = { isConfigured: () => false, getTickers: jest.fn() } as any;
    const service = new WalletPortfolioService(prisma, marketData, cfdData);
    const o = await service.overview(NORMAL_USER);

    expect(o.real.spot.find((b) => b.asset === 'BTC')!.priceUsd).toBeNull();
    expect(o.real.spot.find((b) => b.asset === 'BTC')!.valueUsd).toBeNull();
    expect(o.real.spotValueUsd).toBe(0);
    expect(o.valuationComplete).toBe(false);
    expect(o.unpricedAssets).toEqual(['BTC']);
  });

  it('does not call a zero balance unknown — there is no value to miss', async () => {
    const prisma = prismaStub({
      balance: {
        findMany: jest.fn().mockResolvedValue([{ asset: 'DOGE', available: '0', locked: '0' }]),
        update: jest.fn(), upsert: jest.fn(), create: jest.fn(), updateMany: jest.fn(),
      },
    });
    const { service } = serviceFor(prisma);
    const o = await service.overview(NORMAL_USER);
    expect(o.valuationComplete).toBe(true);
    expect(o.unpricedAssets).toEqual([]);
  });
});

describe('wallet overview — the ledger is reported exactly as it stands', () => {
  it('reports the real spendable balances, row by row, in agreement with the totals', async () => {
    const { service } = serviceFor(prismaStub());
    const overview = await service.overview(OWNER);
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
    await service.overview(OWNER);
    await service.performance(OWNER, REFERENCE);
    expect(prisma.balance.update).not.toHaveBeenCalled();
    expect(prisma.balance.upsert).not.toHaveBeenCalled();
    expect(prisma.balance.create).not.toHaveBeenCalled();
    expect(prisma.balance.updateMany).not.toHaveBeenCalled();
  });

  it('writes nothing to FuturesBalance', async () => {
    const prisma = prismaStub();
    const { service } = serviceFor(prisma);
    await service.overview(OWNER);
    await service.performance(OWNER, REFERENCE);
    expect(prisma.futuresBalance.update).not.toHaveBeenCalled();
    expect(prisma.futuresBalance.upsert).not.toHaveBeenCalled();
    expect(prisma.futuresBalance.create).not.toHaveBeenCalled();
    expect(prisma.futuresBalance.updateMany).not.toHaveBeenCalled();
  });

  it('does not raise withdrawal capacity: withdrawable money is the ledger row', async () => {
    const { service } = serviceFor(prismaStub());
    const overview = await service.overview(OWNER);
    const spendableUsdt = Number(overview.real.spot.find((b) => b.asset === 'USDT')!.available);
    expect(spendableUsdt).toBe(250);
    expect(overview.real.spot.some((b) => Number(b.available) > 1000)).toBe(false);
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

describe('wallet performance — no account gets a generated history', () => {
  it.each([
    ['the owner account', OWNER],
    ['another admin', OTHER_ADMIN],
  ])('leaves %s on its own real, empty history', async (_label, user) => {
    const { service } = serviceFor(prismaStub());
    const perf = await service.performance(user, REFERENCE);
    // A curve with returns written into the source used to stand in for one
    // account's history here. A generated return is not a return.
    expect(perf.startedOn).toBeNull();
    for (const p of Object.values(perf.periods)) expect(p.available).toBe(false);
  });

  it('measures the owner off stored snapshots exactly like everyone else', async () => {
    const snapshot = (date: string, value: string) => ({ createdAt: new Date(`${date}T09:00:00.000Z`), totalValueUsd: value });
    const prisma = prismaStub({
      portfolioSnapshot: {
        findMany: jest.fn().mockResolvedValue([snapshot('2026-08-28', '1000'), snapshot('2026-09-04', '1100')]),
      },
    });
    const { service } = serviceFor(prisma);
    const perf = await service.performance(OWNER, REFERENCE);
    expect(perf.periods['7d'].available).toBe(true);
    expect(perf.periods['7d'].percent).toBeCloseTo(10, 6);
  });
});
