import { AnalyticsDataService } from '../AnalyticsDataService';
import BigNumber from 'bignumber.js';

/**
 * All doubles, no network, no database — the point of these tests is the
 * honesty contract: real sections carry real values with their provenance,
 * and everything without a source says so explicitly instead of returning
 * zero.
 *
 * Every assertion from the pre-gateway version of this suite survives
 * here; what changed is the shape they assert against. Market-wide figures
 * and sentiment now arrive through `MarketDataGateway` (so Analytics owns
 * no provider client of its own), and VOLTEX's own derivatives state is
 * one `derivatives` section rather than three parallel ones.
 */

/** Whatever the gateway's Availability<T> looks like on the wire. */
function ok<T>(value: T, source: string, fetchedAt = 1_700_000_000_000, stale = false) {
  return { available: true as const, value, source, fetchedAt, stale };
}
function fail(reason: string, detail: string) {
  return { available: false as const, reason, detail };
}

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

  const gateway = {
    getMarketOverview: jest.fn().mockResolvedValue(
      ok(
        {
          totalMarketCapUsd: 2_400_000_000_000,
          totalVolume24hUsd: 76_000_000_000,
          btcDominancePercent: 54.2,
          ethDominancePercent: 12.8,
          marketCapChangePercent24h: 2.1,
        },
        'coingecko'
      )
    ),
    getSentiment: jest
      .fn()
      .mockResolvedValue(ok({ value: 71, classification: 'Greed', updatedAt: 1735689600 }, 'alternative.me')),
    ...(overrides.gateway as object),
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

  return { service: new AnalyticsDataService(prisma, gateway, markPriceService, marketRegistry), gateway, prisma };
}

describe('AnalyticsDataService', () => {
  it('reports the market overview from real CoinGecko global data, with provenance', async () => {
    const snapshot = await makeService().service.getSnapshot();
    expect(snapshot.sections.marketOverview).toEqual({
      available: true,
      value: {
        totalMarketCapUsd: 2_400_000_000_000,
        totalVolume24hUsd: 76_000_000_000,
        btcDominancePercent: 54.2,
        ethDominancePercent: 12.8,
        marketCapChangePercent24h: 2.1,
      },
      source: 'coingecko',
      fetchedAt: 1_700_000_000_000,
      stale: false,
    });
  });

  it('reports the published Fear & Greed reading', async () => {
    const snapshot = await makeService().service.getSnapshot();
    expect(snapshot.sections.sentiment).toMatchObject({
      available: true,
      value: { value: 71, classification: 'Greed' },
      source: 'alternative.me',
    });
  });

  it('reads market data through the gateway rather than any provider of its own', async () => {
    // The structural guarantee behind "Analytics adds no polling": it has
    // no CoinGecko or Fear & Greed client to call, only the shared gateway
    // whose cache /markets already populates.
    const { service, gateway } = makeService();
    await service.getSnapshot();
    expect(gateway.getMarketOverview).toHaveBeenCalledTimes(1);
    expect(gateway.getSentiment).toHaveBeenCalledTimes(1);
  });

  it("reports this venue's own derivatives, scoped and sourced as such", async () => {
    const snapshot = await makeService().service.getSnapshot();

    expect(snapshot.sections.derivatives).toMatchObject({
      available: true,
      source: 'voltex',
      value: {
        // Never presented as a market-wide figure.
        scope: 'venue',
        contracts: [
          {
            symbol: 'BTC/USDT',
            openInterestBase: '2.5',
            openInterestUsd: '150000',
            fundingRate: '0.0001',
            markPrice: '60000',
            indexPrice: '59990',
          },
        ],
      },
    });
  });

  it('carries a funding interval and a real next-settlement boundary', async () => {
    const snapshot = await makeService().service.getSnapshot();
    if (!snapshot.sections.derivatives.available) throw new Error('expected derivatives');
    expect(snapshot.sections.derivatives.value.intervalHours).toBeGreaterThan(0);
    expect(snapshot.sections.derivatives.value.nextSettlementAt).toBeGreaterThan(Date.now());
  });

  it('marks a section unavailable — with no numbers at all — when its provider fails', async () => {
    const { service } = makeService({
      gateway: { getMarketOverview: jest.fn().mockResolvedValue(fail('provider_unavailable', 'CoinGecko is unavailable.')) },
    });
    const snapshot = await service.getSnapshot();

    expect(snapshot.sections.marketOverview).toEqual({
      available: false,
      reason: 'provider_unavailable',
      detail: 'CoinGecko is unavailable.',
    });
    // No value-carrying key at all — nothing a UI could plot as zero.
    expect(Object.keys(snapshot.sections.marketOverview).sort()).toEqual(['available', 'detail', 'reason']);
    // A failing provider degrades one section, never the whole payload.
    expect(snapshot.sections.sentiment).toMatchObject({ available: true });
    expect(snapshot.sections.derivatives).toMatchObject({ available: true });
  });

  it('reports a null funding rate — not a zero — when no interval has settled', async () => {
    const { service } = makeService({ prisma: { fundingRateRecord: { findFirst: jest.fn().mockResolvedValue(null) } } });
    const snapshot = await service.getSnapshot();

    if (!snapshot.sections.derivatives.available) throw new Error('expected derivatives');
    const contract = snapshot.sections.derivatives.value.contracts[0];
    // null renders as a dash. 0 would read as "funding is flat", which is
    // a different and false claim.
    expect(contract.fundingRate).toBeNull();
    expect(contract.fundingAppliedAt).toBeNull();
    // The rest of the contract is unaffected.
    expect(contract.openInterestBase).toBe('2.5');
  });

  it('omits open interest USD rather than inventing one when there is no mark price', async () => {
    const { service } = makeService({
      markPriceService: {
        getMarkPrice: jest.fn().mockResolvedValue(null),
        getIndexPrice: jest.fn().mockResolvedValue(null),
      },
    });
    const snapshot = await service.getSnapshot();

    if (!snapshot.sections.derivatives.available) throw new Error('expected derivatives');
    const contract = snapshot.sections.derivatives.value.contracts[0];
    expect(contract.openInterestBase).toBe('2.5');
    expect(contract.openInterestUsd).toBeNull();
    expect(contract.markPrice).toBeNull();
    expect(contract.indexPrice).toBeNull();
  });

  it('keeps a REAL zero open interest as zero', async () => {
    // A listed contract nobody has traded has genuinely zero open
    // interest. That is a fact about the market, and it must survive the
    // no-fake-zeros rule rather than being scrubbed to null.
    const { service } = makeService({
      prisma: { futuresPosition: { aggregate: jest.fn().mockResolvedValue({ _sum: { size: null } }) } },
    });
    const snapshot = await service.getSnapshot();

    if (!snapshot.sections.derivatives.available) throw new Error('expected derivatives');
    const contract = snapshot.sections.derivatives.value.contracts[0];
    expect(contract.openInterestBase).toBe('0');
    expect(contract.openInterestUsd).toBe('0');
  });

  it('reports no_data when nothing about a contract can be read', async () => {
    const { service } = makeService({
      prisma: {
        fundingRateRecord: { findFirst: jest.fn().mockRejectedValue(new Error('db down')) },
        futuresPosition: { aggregate: jest.fn().mockRejectedValue(new Error('db down')) },
      },
      markPriceService: {
        getMarkPrice: jest.fn().mockResolvedValue(null),
        getIndexPrice: jest.fn().mockResolvedValue(null),
      },
    });
    const snapshot = await service.getSnapshot();

    expect(snapshot.sections.derivatives.available).toBe(false);
    expect(Object.keys(snapshot.sections.derivatives).sort()).toEqual(['available', 'detail', 'reason']);
  });

  it('reports no_data when no contracts are listed', async () => {
    const { service } = makeService({ marketRegistry: { list: jest.fn().mockReturnValue([]) } });
    const snapshot = await service.getSnapshot();
    expect(snapshot.sections.derivatives).toMatchObject({ available: false, reason: 'no_data' });
    expect(snapshot.contracts).toEqual([]);
  });

  it('exposes the real listed contracts so the UI cannot hardcode an asset list', async () => {
    const { service } = makeService({ marketRegistry: { list: jest.fn().mockReturnValue(['BTC/USDT', 'ETH/USDT']) } });
    const snapshot = await service.getSnapshot();
    expect(snapshot.contracts).toEqual(['BTC/USDT', 'ETH/USDT']);
  });

  it('never fabricates the metrics this system has no source for', async () => {
    const snapshot = await makeService().service.getSnapshot();
    for (const key of [
      'liquidations',
      'liquidationHeatmap',
      'longShortRatio',
      'marketWideOpenInterest',
      'etfFlows',
      'exchangeFlows',
      'whaleActivity',
      'volatility',
      'futuresBasis',
      'correlations',
      'sectorRotation',
    ] as const) {
      const section = snapshot.unsupported[key];
      expect(section.available).toBe(false);
      expect(section).toMatchObject({ reason: 'unsupported_metric' });
      // No value-carrying keys at all — nothing a UI could plot as zero.
      expect(Object.keys(section).sort()).toEqual(['available', 'detail', 'reason']);
    }
  });

  it('keeps operational provider health OUT of the user-facing snapshot', async () => {
    // The access split is structural: getSnapshot() has no path to the
    // health registry, so a field filter cannot be widened by accident.
    const snapshot = await makeService().service.getSnapshot();
    expect(snapshot).not.toHaveProperty('providers');
    expect(JSON.stringify(snapshot)).not.toContain('rateLimitHits');
    expect(JSON.stringify(snapshot)).not.toContain('cooldownUntil');
    expect(JSON.stringify(snapshot)).not.toContain('consecutiveFailures');
  });

  it('exposes provider health only through the admin diagnostics call', async () => {
    const diagnostics = makeService().service.getDiagnostics();
    expect(Array.isArray(diagnostics.providers)).toBe(true);
    for (const provider of diagnostics.providers) {
      expect(provider).toHaveProperty('state');
      expect(provider).toHaveProperty('healthy');
      // Never leaks a URL, a key or an internal error string.
      expect(JSON.stringify(provider)).not.toMatch(/https?:\/\//);
    }
  });
});
