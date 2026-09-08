import {
  DerivedAnalyticsService,
  logReturns,
  pearson,
  sampleStdDev,
} from '../DerivedAnalyticsService';
import type { MarketCandle } from '../../KrakenMarketDataService';
import type { CoinRanking } from '../../CoinGeckoService';
import { available, unavailable } from '../../marketData/types';

/**
 * Statistics derived from series this system already holds.
 *
 * These are the modules with no provider bill attached, so the risk is not
 * a vendor outage — it is arithmetic quietly producing a plausible wrong
 * number. Every test below pins a value that can be computed by hand or
 * checked against a closed form, and the rest assert what the code refuses
 * to do: extrapolate a window it does not have the observations for,
 * correlate price levels instead of returns, or fold a missing return into
 * a sector as a zero.
 */

const HOUR = 3600;

/** A deterministic close series from explicit returns, so the expected
 *  volatility is a closed form rather than a recorded output. */
function candlesFromReturns(returns: number[], start = 100, t0 = 1_700_000_000): MarketCandle[] {
  const out: MarketCandle[] = [{ time: t0, open: start, high: start, low: start, close: start, volume: 1 }];
  let price = start;
  returns.forEach((r, i) => {
    price = price * Math.exp(r);
    out.push({ time: t0 + (i + 1) * HOUR, open: price, high: price, low: price, close: price, volume: 1 });
  });
  return out;
}

function gatewayWith(series: Record<string, MarketCandle[] | null>) {
  const calls: string[] = [];
  const gateway = {
    getCandles: jest.fn(async (pair: string) => {
      calls.push(pair);
      const candles = series[pair];
      if (!candles) return unavailable('provider_unavailable', 'down');
      return available({ value: candles, source: 'kraken' as const, fetchedAt: 1_700_000_000_000, stale: false });
    }),
  } as any;
  return { gateway, calls };
}

// ── The maths, in isolation ─────────────────────────────────────────

describe('primitives', () => {
  it('computes log returns and skips a non-positive close rather than substituting one', () => {
    const candles: MarketCandle[] = [
      { time: 1, open: 0, high: 0, low: 0, close: 100, volume: 0 },
      { time: 2, open: 0, high: 0, low: 0, close: 110, volume: 0 },
      { time: 3, open: 0, high: 0, low: 0, close: 0, volume: 0 },
      { time: 4, open: 0, high: 0, low: 0, close: 121, volume: 0 },
    ];
    const r = logReturns(candles);
    expect(r).toHaveLength(1);
    expect(r[0]).toBeCloseTo(Math.log(110 / 100), 12);
  });

  it('is a SAMPLE standard deviation, and undefined below two observations', () => {
    // Known series: [2,4,4,4,5,5,7,9] has population sd 2, sample sd ~2.138.
    expect(sampleStdDev([2, 4, 4, 4, 5, 5, 7, 9])!).toBeCloseTo(2.13809, 4);
    expect(sampleStdDev([5])).toBeNull();
    expect(sampleStdDev([])).toBeNull();
  });

  it('returns exactly +1 and -1 for perfectly correlated and anticorrelated series', () => {
    const a = [0.01, -0.02, 0.03, -0.01, 0.005];
    expect(pearson(a, a.map((v) => v * 3))!).toBeCloseTo(1, 12);
    expect(pearson(a, a.map((v) => -v * 3))!).toBeCloseTo(-1, 12);
  });

  it('is null — not zero — when a series has no variance', () => {
    // A flat series has an undefined correlation; reporting 0 would claim
    // "uncorrelated", which is a different statement.
    expect(pearson([0.01, -0.01, 0.02], [0, 0, 0])).toBeNull();
    expect(pearson([1], [1])).toBeNull();
  });
});

// ── Realized volatility ─────────────────────────────────────────────

describe('realized volatility', () => {
  it('annualizes the standard deviation of hourly log returns', async () => {
    // 720 alternating ±1% hourly returns. Mean is exactly 0, so the
    // SAMPLE standard deviation is 0.01 * sqrt(n/(n-1)) — the closed form
    // below pins the n-1 convention as well as the annualisation.
    const returns = Array.from({ length: 720 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
    const { gateway } = gatewayWith({ 'BTC/USDT': candlesFromReturns(returns) });
    const section = await new DerivedAnalyticsService(gateway).getRealizedVolatility('BTC/USDT');
    if (!section.available) throw new Error('expected available');

    const n = 720;
    const expected = 0.01 * Math.sqrt(n / (n - 1)) * Math.sqrt(24 * 365) * 100;
    const thirty = section.value.windows.find((w) => w.window === '30d')!;
    expect(thirty.annualizedPercent!).toBeCloseTo(expected, 9);
    expect(thirty.samples).toBe(720);
    expect(section.value.method).toBe('log_return_stddev_annualized');
    expect(section.value.interval).toBe('1h');
  });

  it('reports all three windows with their own sample counts', async () => {
    const returns = Array.from({ length: 720 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
    const { gateway } = gatewayWith({ 'BTC/USDT': candlesFromReturns(returns) });
    const section = await new DerivedAnalyticsService(gateway).getRealizedVolatility('BTC/USDT');
    if (!section.available) throw new Error('expected available');
    expect(section.value.windows.map((w) => [w.window, w.samples])).toEqual([
      ['24h', 24],
      ['7d', 168],
      ['30d', 720],
    ]);
  });

  it('leaves a window null when it has too few real observations', async () => {
    // 30 hourly candles: 24h has its 24 returns, 7d and 30d do not.
    const returns = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 0.005 : -0.004));
    const { gateway } = gatewayWith({ 'BTC/USDT': candlesFromReturns(returns) });
    const section = await new DerivedAnalyticsService(gateway).getRealizedVolatility('BTC/USDT');
    if (!section.available) throw new Error('expected available');

    const byWindow = Object.fromEntries(section.value.windows.map((w) => [w.window, w.annualizedPercent]));
    expect(byWindow['24h']).not.toBeNull();
    // Not 0, and not extrapolated from the short window.
    expect(byWindow['7d']).toBeNull();
    expect(byWindow['30d']).toBeNull();
  });

  it('is unavailable — not zero — when no window has enough history', async () => {
    const { gateway } = gatewayWith({ 'BTC/USDT': candlesFromReturns([0.01, -0.01, 0.02]) });
    const section = await new DerivedAnalyticsService(gateway).getRealizedVolatility('BTC/USDT');
    expect(section.available).toBe(false);
    expect(section).not.toHaveProperty('value');
  });

  it('propagates an unavailable candle series rather than inventing one', async () => {
    const { gateway } = gatewayWith({ 'BTC/USDT': null });
    const section = await new DerivedAnalyticsService(gateway).getRealizedVolatility('BTC/USDT');
    expect(section.available).toBe(false);
  });

  it('never calls itself implied volatility', () => {
    const source = require('fs').readFileSync(require('path').resolve(__dirname, '../DerivedAnalyticsService.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/impliedVolatility|implied_volatility/i);
  });
});

// ── Correlations ────────────────────────────────────────────────────

describe('crypto correlations', () => {
  const base = Array.from({ length: 400 }, (_, i) => Math.sin(i / 7) / 100);

  it('correlates RETURNS, not price levels', async () => {
    // Two series that both drift strongly upward but whose RETURNS are
    // anticorrelated. A price-level correlation would report ~+1; a return
    // correlation reports the truth.
    const up = base.map((r) => r + 0.02);
    const down = base.map((r) => -r + 0.02);
    const { gateway } = gatewayWith({
      'BTC/USDT': candlesFromReturns(up),
      'ETH/USDT': candlesFromReturns(down),
    });
    const section = await new DerivedAnalyticsService(gateway).getCorrelations(['BTC/USDT', 'ETH/USDT']);
    if (!section.available) throw new Error('expected available');
    expect(section.value.pairs[0].correlation).toBeCloseTo(-1, 6);
    expect(section.value.method).toBe('pearson_log_returns');
  });

  it('reports +1 for a perfectly co-moving pair, with its sample count and window', async () => {
    const { gateway } = gatewayWith({
      'BTC/USDT': candlesFromReturns(base),
      'ETH/USDT': candlesFromReturns(base.map((r) => r * 2)),
    });
    const section = await new DerivedAnalyticsService(gateway).getCorrelations(['BTC/USDT', 'ETH/USDT']);
    if (!section.available) throw new Error('expected available');
    const pair = section.value.pairs[0];
    expect(pair.correlation).toBeCloseTo(1, 6);
    expect(pair.samples).toBe(400);
    expect(section.value.lookbackHours).toBe(720);
    expect(section.value.interval).toBe('1h');
  });

  it('drops a pair with too little overlap instead of reporting a thin coefficient', async () => {
    const { gateway } = gatewayWith({
      'BTC/USDT': candlesFromReturns(base),
      // Only 50 shared hours — below the 240 minimum.
      'ETH/USDT': candlesFromReturns(base.slice(0, 50)),
    });
    const section = await new DerivedAnalyticsService(gateway).getCorrelations(['BTC/USDT', 'ETH/USDT']);
    expect(section.available).toBe(false);
    expect(section).not.toHaveProperty('value');
  });

  it('aligns on timestamp, so a gap never becomes a one-hour return', async () => {
    const a = candlesFromReturns(base);
    // Remove a block from the middle of the second series: the shared
    // hours are still plentiful, but the returns must be computed only
    // across CONSECUTIVE shared hours.
    const b = candlesFromReturns(base.map((r) => r * 2)).filter((c, i) => i < 100 || i > 140);
    const { gateway } = gatewayWith({ 'BTC/USDT': a, 'ETH/USDT': b });
    const section = await new DerivedAnalyticsService(gateway).getCorrelations(['BTC/USDT', 'ETH/USDT']);
    if (!section.available) throw new Error('expected available');
    const pair = section.value.pairs[0];
    // Still a perfect relationship, and the sample count reflects the gap.
    expect(pair.correlation).toBeCloseTo(1, 6);
    expect(pair.samples).toBeLessThan(400);
  });

  it('needs two usable assets, and says so rather than returning an empty matrix', async () => {
    const { gateway } = gatewayWith({ 'BTC/USDT': candlesFromReturns(base), 'ETH/USDT': null });
    const section = await new DerivedAnalyticsService(gateway).getCorrelations(['BTC/USDT', 'ETH/USDT']);
    expect(section.available).toBe(false);
  });

  it('is labelled crypto-only, never global cross-asset', () => {
    const source = require('fs').readFileSync(require('path').resolve(__dirname, '../DerivedAnalyticsService.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/globalAsset|macroCorrelation|gold|equities|SPX/i);
  });
});

// ── Sector rotation ─────────────────────────────────────────────────

describe('sector rotation', () => {
  function coin(over: Partial<CoinRanking>): CoinRanking {
    return {
      id: 'x',
      symbol: 'X',
      rank: 1,
      name: 'X',
      image: '',
      categories: ['DEFI'],
      price: 1,
      changePercent24h: 1,
      changePercent7d: null,
      changePercent30d: null,
      marketCap: 1_000,
      volume24h: 0,
      sparkline7d: [],
      circulatingSupply: null,
      market: null,
      ...over,
    } as unknown as CoinRanking;
  }
  const catalogue = (rows: CoinRanking[]) => ({ value: rows, fetchedAt: 1_700_000_000_000, stale: false });
  const service = new DerivedAnalyticsService({} as any);

  it('market-cap weights when every contributor reports a cap', async () => {
    const section = await service.getSectorRotation(
      catalogue([
        coin({ symbol: 'A', changePercent24h: 10, marketCap: 900 }),
        coin({ symbol: 'B', changePercent24h: 0, marketCap: 100 }),
        coin({ symbol: 'C', changePercent24h: 0, marketCap: 0.0001 }),
      ])
    );
    if (!section.available) throw new Error('expected available');
    const defi = section.value.sectors.find((s) => s.category === 'DEFI')!;
    expect(defi.weighting).toBe('market_cap');
    // 10 * 0.9 + 0 * 0.1 ≈ 9, not the equal-weighted 3.33.
    expect(defi.changePercent24h).toBeCloseTo(9, 2);
    expect(defi.constituents).toBe(3);
  });

  it('falls back to equal weighting and SAYS so when a cap is missing', async () => {
    const section = await service.getSectorRotation(
      catalogue([
        coin({ symbol: 'A', changePercent24h: 9, marketCap: 900 }),
        coin({ symbol: 'B', changePercent24h: 3, marketCap: null as never }),
        coin({ symbol: 'C', changePercent24h: 3, marketCap: 100 }),
      ])
    );
    if (!section.available) throw new Error('expected available');
    const defi = section.value.sectors.find((s) => s.category === 'DEFI')!;
    expect(defi.weighting).toBe('equal');
    expect(defi.changePercent24h).toBeCloseTo(5, 6);
  });

  it('EXCLUDES a constituent with no reported return instead of folding it in as zero', async () => {
    const section = await service.getSectorRotation(
      catalogue([
        coin({ symbol: 'A', changePercent24h: 6, marketCap: 100 }),
        coin({ symbol: 'B', changePercent24h: 6, marketCap: 100 }),
        coin({ symbol: 'C', changePercent24h: 6, marketCap: 100 }),
        coin({ symbol: 'D', changePercent24h: null, marketCap: 100 }),
      ])
    );
    if (!section.available) throw new Error('expected available');
    const defi = section.value.sectors.find((s) => s.category === 'DEFI')!;
    // Four coins in the sector, three contributed. A zero for D would have
    // dragged this to 4.5.
    expect(defi.constituents).toBe(3);
    expect(defi.changePercent24h).toBeCloseTo(6, 6);
  });

  it('keeps a REAL zero sector return as zero', async () => {
    const section = await service.getSectorRotation(
      catalogue([
        coin({ symbol: 'A', changePercent24h: 0, marketCap: 100 }),
        coin({ symbol: 'B', changePercent24h: 0, marketCap: 100 }),
        coin({ symbol: 'C', changePercent24h: 0, marketCap: 100 }),
      ])
    );
    if (!section.available) throw new Error('expected available');
    expect(section.value.sectors[0].changePercent24h).toBe(0);
  });

  it('drops a sector below the constituent minimum rather than reporting one coin as a sector', async () => {
    const section = await service.getSectorRotation(
      catalogue([
        coin({ symbol: 'A', categories: ['AI'], changePercent24h: 50, marketCap: 100 }),
        coin({ symbol: 'B', categories: ['DEFI'], changePercent24h: 1, marketCap: 100 }),
        coin({ symbol: 'C', categories: ['DEFI'], changePercent24h: 1, marketCap: 100 }),
        coin({ symbol: 'D', categories: ['DEFI'], changePercent24h: 1, marketCap: 100 }),
      ])
    );
    if (!section.available) throw new Error('expected available');
    expect(section.value.sectors.map((s) => s.category)).toEqual(['DEFI']);
  });

  it('carries the catalogue\'s own fetch time and staleness, not the computation\'s', async () => {
    const section = await service.getSectorRotation({
      value: [
        coin({ symbol: 'A', changePercent24h: 1, marketCap: 100 }),
        coin({ symbol: 'B', changePercent24h: 1, marketCap: 100 }),
        coin({ symbol: 'C', changePercent24h: 1, marketCap: 100 }),
      ],
      fetchedAt: 1_600_000_000_000,
      stale: true,
    });
    if (!section.available) throw new Error('expected available');
    expect(section.fetchedAt).toBe(1_600_000_000_000);
    expect(section.stale).toBe(true);
  });

  it('is unavailable on an empty catalogue rather than an empty sector list', async () => {
    expect((await service.getSectorRotation(catalogue([]))).available).toBe(false);
  });
});
