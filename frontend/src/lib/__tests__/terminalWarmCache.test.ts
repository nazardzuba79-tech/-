import {
  FUTURES_SYMBOLS_MAX_AGE_MS,
  LIVE_WARM_MAX_AGE_MS,
  SPOT_WARM_MAX_AGE_MS,
  readFuturesSymbolCache,
  readLiveQuoteCache,
  readSpotWarmCache,
  writeFuturesSymbolCache,
  writeLiveQuoteCache,
  writeSpotWarmCache,
} from '../terminalWarmCache';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
}

describe('terminal warm caches', () => {
  test('spot cache paints a recent real snapshot but expires quickly', () => {
    const storage = memoryStorage();
    const ticker = { pair: 'BTC/USDT', lastPrice: '75000', changePercent24h: '1.5', quoteVolume24h: '1000' } as any;
    writeSpotWarmCache({ tickers: [ticker], source: 'kraken', fetchedAt: 900 }, storage, 1_000);

    expect(readSpotWarmCache(storage, 1_001)).toEqual({ tickers: [ticker], source: 'kraken', fetchedAt: 900 });
    expect(readSpotWarmCache(storage, 1_000 + SPOT_WARM_MAX_AGE_MS + 1)).toBeNull();
  });

  test('futures symbol cache deduplicates and cannot promote malformed markets', () => {
    const storage = memoryStorage();
    writeFuturesSymbolCache(['BTC/USDT', 'ETH/USDT', 'BTC/USDT', 'BAD', 'SOL/USD'], storage, 2_000);

    expect(readFuturesSymbolCache(storage, 2_001)).toEqual(['BTC/USDT', 'ETH/USDT']);
    expect(readFuturesSymbolCache(storage, 2_000 + FUTURES_SYMBOLS_MAX_AGE_MS + 1)).toBeNull();
  });

  test('live quote cache is always restored as stale and expires quickly', () => {
    const storage = memoryStorage();
    const quote = {
      id: 'linear_perpetual:BTCUSDT', pair: 'BTC/USDT', symbol: 'BTCUSDT', providerSymbol: 'BTCUSDT', provider: 'bybit',
      marketType: 'linear_perpetual', baseAsset: 'BTC', quoteAsset: 'USDT', settleAsset: 'USDT',
      lastPrice: 75000, bidPrice: 74999, askPrice: 75001, high24h: 76000, low24h: 74000, volume24h: 12,
      quoteVolume24h: 900000, changePercent24h: 1.2, indexPrice: 75000, markPrice: 75000, fundingRate: 0.0001,
      fundingIntervalMinutes: 480, openInterest: 100, openInterestValue: 7_500_000,
      providerEventAt: 1_000, sequence: 1, receivedAt: 1_000, fetchedAt: 1_000, stale: false,
    } as any;
    writeLiveQuoteCache([quote], storage, 3_000);

    const restored = readLiveQuoteCache(storage, 3_001);
    expect(restored).toHaveLength(1);
    expect(restored?.[0]).toMatchObject({ id: quote.id, lastPrice: 75000, stale: true });
    expect(readLiveQuoteCache(storage, 3_000 + LIVE_WARM_MAX_AGE_MS + 1)).toBeNull();
  });
});
