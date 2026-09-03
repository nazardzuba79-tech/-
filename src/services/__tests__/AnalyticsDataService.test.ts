import { AnalyticsDataService } from '../AnalyticsDataService';
import BigNumber from 'bignumber.js';

/**
 * All doubles, no network, no database — the point of these tests is the
 * honesty contract: real sections carry real values, and everything without
 * a source says so explicitly instead of returning zero.
 */
function makeService(overrides: Partial<Record<string, any>> = {}) {
  const prisma = {
    fundingRateRecord: {
      findFirst: jest.fn().mockResolvedValue({
        rate: new BigNumber('0.0001'),
        markPrice: new BigNumber('60000'),
        indexPrice: new BigNumber('59990'),
        appliedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    },
    futuresPosition: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { size: new BigNumber('2.5') } }),
    },
    ...(overrides.prisma as object),
  } as any;

  const coinGecko = {
    getGlobalMarket: jest.fn().mockResolvedValue({
      totalVolume24hUsd: 76_000_000_000,
      totalMarketCapUsd: 2_400_000_000_000,
      btcDominancePercent: 54.2,
      ethDominancePercent: 12.8,
      marketCapChangePercent24h: 2.1,
    }),
    ...(overrides.coinGecko as object),
  } as any;

  const fearGreed = {
    getIndex: jest.fn().mockResolvedValue({ value: 71, classification: 'Greed', updatedAt: 1735689600 }),
    ...(overrides.fearGreed as object),
  } as any;

  const markPriceService = {
    getMarkPrice: jest.fn().mockResolvedValue(new BigNumber('60000')),
    getIndexPrice: jest.fn().mockResolvedValue(new BigNumber('59990')),
    ...(overrides.markPriceService as object),
  } as any;

  const marketRegistry = {
    list: jest.fn().mockReturnValue(['BTC/USDT']),
    ...(overrides.marketRegistry as object),
  } as any;

  return new AnalyticsDataService(prisma, coinGecko, fearGreed, markPriceService, marketRegistry);
}

describe('AnalyticsDataService', () => {
  it('reports the market overview from real CoinGecko global data', async () => {
    const snapshot = await makeService().getSnapshot();
    expect(snapshot.sections.marketOverview).toEqual({
      available: true,
      totalMarketCapUsd: 2_400_000_000_000,
      totalVolume24hUsd: 76_000_000_000,
      btcDominancePercent: 54.2,
      ethDominancePercent: 12.8,
      marketCapChangePercent24h: 2.1,
      source: 'coingecko',
    });
  });

  it('reports the published Fear & Greed reading', async () => {
    const snapshot = await makeService().getSnapshot();
    expect(snapshot.sections.sentiment).toMatchObject({ available: true, value: 71, classification: 'Greed', source: 'alternative.me' });
  });

  it('reports this venue\'s own funding and open interest, scoped as such', async () => {
    const snapshot = await makeService().getSnapshot();

    expect(snapshot.sections.funding).toMatchObject({
      available: true,
      source: 'voltex_futures',
      latest: [{ symbol: 'BTC/USDT', rate: '0.0001' }],
    });
    expect(snapshot.sections.openInterest).toMatchObject({
      available: true,
      scope: 'venue', // never presented as a market-wide figure
      contracts: [{ symbol: 'BTC/USDT', openInterestBase: '2.5', openInterestUsd: '150000' }],
    });
  });

  it('marks a section unavailable — with no numbers at all — when its provider fails', async () => {
    const service = makeService({ coinGecko: { getGlobalMarket: jest.fn().mockRejectedValue(new Error('429')) } });
    const snapshot = await service.getSnapshot();

    expect(snapshot.sections.marketOverview).toEqual({
      available: false,
      reason: 'provider_unavailable',
      detail: 'CoinGecko global market data is unavailable.',
    });
    // A failing provider degrades one section, never the whole payload.
    expect(snapshot.sections.sentiment).toMatchObject({ available: true });
  });

  it('reports no_data — not a zero rate — when no funding interval has settled', async () => {
    const service = makeService({ prisma: { fundingRateRecord: { findFirst: jest.fn().mockResolvedValue(null) } } });
    const snapshot = await service.getSnapshot();
    expect(snapshot.sections.funding).toEqual({
      available: false,
      reason: 'no_data',
      detail: 'No funding interval has settled yet.',
    });
  });

  it('omits open interest USD value rather than inventing one when there is no mark price', async () => {
    const service = makeService({ markPriceService: { getMarkPrice: jest.fn().mockResolvedValue(null), getIndexPrice: jest.fn().mockResolvedValue(null) } });
    const snapshot = await service.getSnapshot();

    expect(snapshot.sections.openInterest).toMatchObject({
      available: true,
      contracts: [{ symbol: 'BTC/USDT', openInterestBase: '2.5', openInterestUsd: null }],
    });
    // And with no index price at all, mark prices are unavailable rather
    // than a list of zeros.
    expect(snapshot.sections.markPrices).toMatchObject({ available: false, reason: 'provider_unavailable' });
  });

  it('never fabricates the metrics this system has no source for', async () => {
    const snapshot = await makeService().getSnapshot();
    for (const key of ['liquidations', 'longShortRatio', 'marketWideOpenInterest', 'etfFlows', 'exchangeFlows', 'whaleActivity'] as const) {
      const section = snapshot.sections[key];
      expect(section.available).toBe(false);
      expect(section).toMatchObject({ reason: 'unsupported_metric' });
      // No value-carrying keys at all — nothing a UI could plot as zero.
      expect(Object.keys(section).sort()).toEqual(['available', 'detail', 'reason']);
    }
  });

  it('includes provider health so an operator can tell "down" from "unsupported"', async () => {
    const snapshot = await makeService().getSnapshot();
    expect(Array.isArray(snapshot.providers)).toBe(true);
    for (const provider of snapshot.providers) {
      expect(provider).toHaveProperty('state');
      expect(provider).toHaveProperty('healthy');
      // Never leaks a URL, key or internal error string.
      expect(Object.keys(provider).sort()).toEqual(['healthy', 'lastSuccessAt', 'provider', 'rateLimitHits', 'state']);
    }
  });
});
