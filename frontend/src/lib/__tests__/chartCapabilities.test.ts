import { candleLoaderFor, candleSourceFor, chartCapabilities, quickTimeframesFor, resolveTimeframe, sourcePlans, type CandleLoaderTable } from '../chartCapabilities';
import { CHART_TIMEFRAMES, DEFAULT_QUICK_TIMEFRAMES, type ChartTimeframe } from '../chartTimeframes';
import { registerManagedListings, type TestAsset } from '../testMarkets';

const getFuturesCandles = jest.fn(async () => ({ candles: [] }));
const getSpotPublicCandles = jest.fn(async () => ({ candles: [] }));
const testMarketCandleLoader = jest.fn(async () => ({ candles: [] }));
const loaders: CandleLoaderTable = { futures: getFuturesCandles, spot: getSpotPublicCandles, testMarket: testMarketCandleLoader };

const listing = (pair: string, symbol: string): TestAsset => ({
  pair, symbol, name: symbol, quote: 'USDT', isTestAsset: true, isTradable: true, status: '', listingArmed: true, listingAt: '2026-10-13T15:00:00.000Z', initialPrice: 2,
  state: { phase: 'live', lastPrice: 21, openPrice24h: 2, change24hPercent: 950, high24h: 22, low24h: 2, volume24h: 1, quoteVolume24h: 1, serverTime: 0 }, managed: true, version: 3,
});

describe('one capability answer per market + instrument + source', () => {
  it('binds Futures to the venue loader, a test pair to the simulation loader and any other Spot pair to the public Spot loader', () => {
    expect(candleSourceFor('futures', 'BTC/USDT')).toBe('futures-public');
    expect(candleSourceFor('spot', 'BTC/USDT')).toBe('spot-public');
    expect(candleSourceFor('spot', 'VTA/USDT')).toBe('test-market');
    expect(candleSourceFor('spot', 'NRX/USDT')).toBe('test-market');
    expect(candleSourceFor('spot', 'AITH/USDT')).toBe('test-market');
    expect(candleLoaderFor('futures', 'BTC/USDT', loaders)).toBe(getFuturesCandles);
    expect(candleLoaderFor('spot', 'BTC/USDT', loaders)).toBe(getSpotPublicCandles);
    expect(candleLoaderFor('spot', 'AITH/USDT', loaders)).toBe(testMarketCandleLoader);
    expect(candleLoaderFor('spot', 'VTA/USDT', loaders)).toBe(testMarketCandleLoader);
  });
  it('lets the page\'s own loader serve the chart\'s own instrument, never another instrument beside it', () => {
    const replay = jest.fn(async () => ({ candles: [] }));
    expect(candleLoaderFor('futures', 'BTC/USDT', loaders, replay)).toBe(replay);
    expect(candleLoaderFor('spot', 'ETH/USDT', loaders, replay)).toBe(replay);
    // A test pair keeps the simulation even when the chart was bound to something else.
    expect(candleLoaderFor('spot', 'NRX/USDT', loaders, replay)).toBe(testMarketCandleLoader);
    // A compared instrument or a pane asks without the page's loader and gets the public one.
    expect(candleLoaderFor('spot', 'BTC/USDT', loaders)).toBe(getSpotPublicCandles);
  });
  it('recognises a managed listing once the catalogue registered it', () => {
    registerManagedListings([listing('ZXCV/USDT', 'ZXCV')]);
    expect(candleSourceFor('spot', 'ZXCV/USDT')).toBe('test-market');
    expect(chartCapabilities({ market: 'spot', pair: 'ZXCV/USDT', loaders }).loader).toBe(testMarketCandleLoader);
  });
  it('offers every catalogue interval on every workspace source, natively or built from the source\'s own lower bars', () => {
    for (const source of ['futures-public', 'spot-public', 'test-market'] as const) {
      const caps = chartCapabilities({ market: source === 'futures-public' ? 'futures' : 'spot', pair: source === 'test-market' ? 'AITH/USDT' : 'BTC/USDT', loaders });
      expect(caps.source).toBe(source);
      expect(caps.timeframes).toEqual(CHART_TIMEFRAMES);
    }
    const aith = chartCapabilities({ market: 'spot', pair: 'AITH/USDT', loaders });
    expect(aith.native).toEqual(['1m', '5m', '15m', '1h', '4h', '1d', '1w']);
    expect(aith.plans['1m']).toEqual({ kind: 'native' });
    expect(aith.plans['3m']).toEqual({ kind: 'derived', base: '1m', factor: 3 });
    expect(aith.plans['1M']).toEqual({ kind: 'derived', base: '1d', factor: 30 });
    expect(aith.rawLimit).toBe(1000);
    // The plain chart's endpoint is the only source that lacks intervals; it is never a workspace source.
    expect(chartCapabilities({ market: 'spot', pair: 'BTC/USDT', loaders, source: 'legacy' }).timeframes).not.toContain('1m');
    expect(sourcePlans('legacy')).toBe(sourcePlans('legacy'));
  });
});

describe('an interval asked for is shown as the nearest one the source serves', () => {
  const legacy = chartCapabilities({ market: 'spot', pair: 'BTC/USDT', loaders, source: 'legacy' });
  it('keeps an interval the source has and falls to the next longer one it has, then the next shorter', () => {
    expect(resolveTimeframe('1h', legacy)).toBe('1h');
    expect(resolveTimeframe('1m', legacy)).toBe('5m');
    expect(resolveTimeframe('3m', legacy)).toBe('5m');
    const onlyShort = { plans: { ...legacy.plans, '1M': { kind: 'unavailable' as const }, '1w': { kind: 'unavailable' as const }, '1d': { kind: 'unavailable' as const } }, timeframes: legacy.timeframes.filter(tf => !['1d', '1w', '1M'].includes(tf)) };
    expect(resolveTimeframe('1M', onlyShort)).toBe('12h');
  });
  it('returns the preference unchanged when nothing is available, so the chart can say so', () => {
    const none = { plans: Object.fromEntries(CHART_TIMEFRAMES.map(tf => [tf, { kind: 'unavailable' as const }])) as Record<ChartTimeframe, { kind: 'unavailable' }>, timeframes: [] as ChartTimeframe[] };
    expect(resolveTimeframe('4h', none)).toBe('4h');
  });
  it('filters the viewer\'s quick list for display without rewriting it', () => {
    const quick = [...DEFAULT_QUICK_TIMEFRAMES];
    expect(quickTimeframesFor(quick, legacy)).toEqual(['5m', '15m', '1h', '4h', '1d', '1w']);
    expect(quick).toEqual(DEFAULT_QUICK_TIMEFRAMES);
    expect(quickTimeframesFor(quick, chartCapabilities({ market: 'spot', pair: 'AITH/USDT', loaders }))).toEqual(DEFAULT_QUICK_TIMEFRAMES);
  });
});
