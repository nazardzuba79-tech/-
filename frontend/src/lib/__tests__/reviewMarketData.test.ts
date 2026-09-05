import { createReviewMarketDataClient, isReviewMarketRead, rollingChangePercent24h } from '../reviewMarketData';
import { reviewReadPath } from '../reviewPolicy';

const pairs = {
  XXBTZUSD: { altname: 'XBTUSD', wsname: 'XBT/USD', status: 'online' },
  XBTUSDT: { altname: 'XBTUSDT', wsname: 'XBT/USDT', status: 'online' },
  XDGUSDC: { altname: 'XDGUSDC', wsname: 'XDG/USDC' },
  ETHZEUR: { altname: 'ETHEUR', wsname: 'ETH/EUR' },
};
const ticker = (price = '102') => ({ c: [price, '1'], b: ['101', '1', '1'], a: ['103', '1', '1'], h: ['104', '110'], l: ['99', '90'], v: ['2', '10'], p: ['100', '99'], o: '100' });
function mockProvider(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    AssetPairs: pairs,
    Ticker: { XXBTZUSD: ticker('102'), XBTUSDT: ticker('104'), XDGUSDC: ticker('0.1') },
    Depth: { XXBTZUSD: { bids: [['100', '2', 1000], ['101', '3', 1001]], asks: [['104', '4', 1000], ['103', '5', 1001]] } },
    OHLC: { XXBTZUSD: [[120, '1', '4', '1', '3', '2', '5', 2], [60, '1', '3', '1', '2', '2', '0', 1]], last: 120 },
    Trades: { XXBTZUSD: [['100', '1', 10.5, 'b', 'm', '', 123], ['101', '2', 11, 's', 'l', '', 124]], last: '11000000000' },
    ...overrides,
  };
  const fetchFn = jest.fn(async (url: string) => {
    const parsed = new URL(url);
    const endpoint = parsed.pathname.split('/').pop()!;
    const referenceOpen = Math.floor(Date.now() / 1000 / 300) * 300 - 86400 - 300;
    const result = endpoint === 'OHLC' && parsed.searchParams.get('interval') === '5' && !overrides.OHLC
      ? { XBTUSD: [[referenceOpen, '100', '100', '100', '100', '100', '1', 1]], last: referenceOpen }
      : data[endpoint];
    return { ok: true, status: 200, json: async () => ({ error: [], result }) };
  }) as jest.Mock;
  const client = createReviewMarketDataClient({ fetchFn: fetchFn as typeof fetch });
  return { client, fetchFn };
}

describe('review public-market boundary', () => {
  test.each([
    '/market/external/symbols', '/market/external/tickers', '/market/external/tickers/BTC-USDT',
    '/market/external/orderbook/BTC-USD?limit=200', '/market/external/candles/ETH-EUR?interval=1h&limit=720',
    '/market/external/trades/DOGE-USDC?limit=60',
  ])('allows exact public GET %s', path => expect(isReviewMarketRead(path)).toBe(true));

  test.each([
    '/me', '/orders', '/orders/me', '/auth/login', '/card/application/me', '/wallet/overview',
    '/market/external/rankings', '/market/external/featured-trader',
    'https://api.kraken.com/0/public/Ticker', 'https://api.voltextech.net/api/v1/market/external/tickers',
    '//api.kraken.com/0/public/Ticker', '/market/external/../tickers', '/market/external/tickers/BTC%2FUSD',
    '/market/external/tickers/BTC-USD?url=https://evil.example', '/market/external/tickers/BTC-USD#private',
    '/market/external/symbols/BTC-USD', '/market/external/tickers?pair=BTCUSD',
    '/market/external/orderbook/BTC-USD?limit=0', '/market/external/orderbook/BTC-USD?limit=201',
    '/market/external/orderbook/BTC-USD?limit=1&limit=2', '/market/external/orderbook/BTC-USD?limit=1e2',
    '/market/external/candles/BTC-USD?interval=__proto__', '/market/external/candles/BTC-USD?interval=3m',
    '/market/external/candles/BTC-USD?limit=1001', '/market/external/trades/BTC-USD?since=123',
  ])('denies %s without any fetch', async path => {
    const { client, fetchFn } = mockProvider();
    expect(isReviewMarketRead(path)).toBe(false);
    await expect(client.read(path)).rejects.toThrow('not permitted');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])('denies method %s including on public data', async method => {
    const { client, fetchFn } = mockProvider();
    expect(isReviewMarketRead('/market/external/tickers', method)).toBe(false);
    await expect(client.read('/market/external/tickers', { method })).rejects.toThrow('not permitted');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test.each([{ headers: { Authorization: 'Bearer secret' } }, { credentials: 'include' }, { body: '{}' }, { redirect: 'follow' }])('never accepts caller credentials or custom request options %j', async options => {
    const { client, fetchFn } = mockProvider();
    await expect(client.read('/market/external/tickers', options as RequestInit)).rejects.toThrow('not permitted');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('retains the old strictly isolated synthetic sample policy', () => {
    expect(reviewReadPath('/copy-trading/synthetic')).toBe('/review-synthetic.json');
    expect(reviewReadPath('/market/external/tickers')).toBeNull();
    expect(reviewReadPath('/copy-trading/synthetic/advance', 'POST')).toBeNull();
  });
});

describe('real Kraken response normalization', () => {
  it('normalizes only asset aliases and preserves distinct native USD/USDT markets', async () => {
    const { client, fetchFn } = mockProvider();
    const symbols = await client.read('/market/external/symbols') as any;
    expect(symbols.symbols).toContainEqual({ pair: 'BTC/USD', baseAsset: 'BTC', quoteAsset: 'USD' });
    expect(symbols.symbols).toContainEqual({ pair: 'DOGE/USDC', baseAsset: 'DOGE', quoteAsset: 'USDC' });
    const usd = await client.read('/market/external/tickers/BTC-USD') as any;
    const usdt = await client.read('/market/external/tickers/BTC-USDT') as any;
    expect(usd.ticker.lastPrice).toBe('102');
    expect(usdt.ticker.lastPrice).toBe('104');
    expect(usd.ticker).toMatchObject({ quoteVolume24h: '990.00', changePercent24h: '2.0000', high24h: '110', low24h: '90', volume24h: '10' });
    expect(fetchFn).toHaveBeenCalledTimes(4); // AssetPairs + all Ticker + separate native-market reference histories
    for (const [url, options] of fetchFn.mock.calls) {
      expect(new URL(url).origin).toBe('https://api.kraken.com');
      expect(new URL(url).pathname).toMatch(/^\/0\/public\//);
      expect(options).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
      expect(options.headers).toBeUndefined();
    }
  });

  it('omits unavailable tickers rather than manufacturing zero values', async () => {
    const { client } = mockProvider({ Ticker: { XXBTZUSD: ticker(), XBTUSDT: ticker('NaN') } });
    expect((await client.read('/market/external/tickers') as any).tickers).toHaveLength(1);
    await expect(client.read('/market/external/tickers/BTC-USDT')).rejects.toThrow('invalid numeric');
  });

  it('sorts real depth and uses the selected native market upstream', async () => {
    const { client, fetchFn } = mockProvider();
    const result = await client.read('/market/external/orderbook/BTC-USDT?limit=1') as any;
    expect(result).toMatchObject({ source: 'kraken', pair: 'BTC/USDT', bids: [{ price: '101', quantity: '3' }], asks: [{ price: '103', quantity: '5' }] });
    expect(fetchFn.mock.calls[1][0]).toBe('https://api.kraken.com/0/public/Depth?pair=XBTUSDT&count=1');
  });

  it('preserves real OHLCV values, sorts seconds and never pads history', async () => {
    const { client, fetchFn } = mockProvider();
    const result = await client.read('/market/external/candles/BTC-USD?interval=1h&limit=1000') as any;
    expect(result.candles).toEqual([
      { time: 60, open: 1, high: 3, low: 1, close: 2, volume: 0 },
      { time: 120, open: 1, high: 4, low: 1, close: 3, volume: 5 },
    ]);
    expect(fetchFn.mock.calls[1][0]).toContain('interval=60');
  });

  it('converts public trade side/time/ID and returns newest first', async () => {
    const { client } = mockProvider();
    expect((await client.read('/market/external/trades/BTC-USD?limit=1') as any).trades).toEqual([{ id: '124', price: '101', quantity: '2', side: 'SELL', time: 11000 }]);
  });

  it('rejects unknown pairs before fetching quotes or order books', async () => {
    const { client, fetchFn } = mockProvider();
    await expect(client.read('/market/external/orderbook/FAKE-USD')).rejects.toThrow('unknown pair');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('single-pair rolling 24h reference', () => {
  const end = 200_000_100;
  const asOf = (end + 86400 + 120) * 1000;
  it('uses the newest completed close before the real cutoff, not the future bucket or UTC open', () => {
    expect(rollingChangePercent24h(110, [
      { time: end - 600, close: 80 }, { time: end - 300, close: 100 }, { time: end, close: 200 },
    ], asOf)).toBeCloseTo(10);
  });
  it('accepts an exact cutoff and returns genuine negative or zero changes', () => {
    expect(rollingChangePercent24h(90, [{ time: end - 300, close: 100 }], (end + 86400) * 1000)).toBeCloseTo(-10);
    expect(rollingChangePercent24h(100, [{ time: end - 300, close: 100 }], asOf)).toBe(0);
  });
  it('does not fabricate a percentage for missing, gapped, future or invalid history', () => {
    for (const rows of [[], [{ time: end - 600, close: 100 }], [{ time: end, close: 100 }], [{ time: end - 300, close: 0 }]]) {
      expect(rollingChangePercent24h(110, rows, asOf)).toBeNull();
    }
    expect(rollingChangePercent24h(NaN, [{ time: end - 300, close: 100 }], asOf)).toBeNull();
  });
  it('returns empty single-pair change when history is insufficient, while preserving price and list convention', async () => {
    const { client } = mockProvider({ OHLC: { XBTUSD: [], last: 1 } });
    expect((await client.read('/market/external/tickers/BTC-USD') as any).ticker).toMatchObject({ lastPrice: '102', changePercent24h: '', changeReference: 'ROLLING_24H_5M' });
    expect((await client.read('/market/external/tickers') as any).tickers[0].changePercent24h).toBe('2.0000');
  });
  it('caches a single-pair 5m reference for sixty seconds without per-market list fan-out', async () => {
    const { fetchFn } = mockProvider();
    let now = Date.now();
    const client = createReviewMarketDataClient({ fetchFn: fetchFn as typeof fetch, now: () => now });
    await client.read('/market/external/tickers');
    expect(fetchFn.mock.calls.filter(([url]) => url.includes('/OHLC'))).toHaveLength(0);
    await client.read('/market/external/tickers/BTC-USD');
    now += 6000;
    await client.read('/market/external/tickers/BTC-USD');
    expect(fetchFn.mock.calls.filter(([url]) => url.includes('/OHLC'))).toHaveLength(1);
    now += 60000;
    await client.read('/market/external/tickers/BTC-USD');
    expect(fetchFn.mock.calls.filter(([url]) => url.includes('/OHLC'))).toHaveLength(2);
  });
});

describe('bounded public request lifecycle', () => {
  it('deduplicates in-flight callers, caches to TTL and retains true cached snapshot time', async () => {
    const { fetchFn } = mockProvider();
    let now = 1000;
    const client = createReviewMarketDataClient({ fetchFn: fetchFn as typeof fetch, now: () => now });
    const path = '/market/external/orderbook/BTC-USD';
    const [first, second] = await Promise.all([client.read(path), client.read(path)]) as any[];
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(first).toEqual(second);
    now = 2000;
    expect((await client.read(path) as any).timestamp).toBe(1000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    now = 3001;
    expect((await client.read(path) as any).timestamp).toBe(3001);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('rejects rate limits and invalid provider payloads without successful fallback', async () => {
    for (const response of [
      { ok: false, status: 429 },
      { ok: true, json: async () => ({ error: ['EGeneral:Unavailable'], result: {} }) },
      { ok: true, json: async () => ({ error: [], result: null }) },
    ]) {
      const fetchFn = jest.fn().mockResolvedValue(response);
      const client = createReviewMarketDataClient({ fetchFn });
      await expect(client.read('/market/external/symbols')).rejects.toThrow('unavailable');
      await expect(client.read('/market/external/symbols')).rejects.toThrow('unavailable');
      expect(fetchFn).toHaveBeenCalledTimes(1); // short negative cache
    }
  });

  it('times out even when an injected fetch does not implement abort', async () => {
    jest.useFakeTimers();
    const fetchFn = jest.fn(() => new Promise<Response>(() => {}));
    const client = createReviewMarketDataClient({ fetchFn, timeoutMs: 50 });
    const result = expect(client.read('/market/external/symbols')).rejects.toThrow('timed out');
    await jest.advanceTimersByTimeAsync(51);
    await result;
    expect((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
    jest.useRealTimers();
  });

  it('evicts old cache entries instead of growing with arbitrary pairs/limits', async () => {
    const { fetchFn } = mockProvider();
    const client = createReviewMarketDataClient({ fetchFn: fetchFn as typeof fetch });
    for (let limit = 1; limit <= 70; limit += 1) await client.read(`/market/external/orderbook/BTC-USD?limit=${limit}`);
    const count = fetchFn.mock.calls.length;
    await client.read('/market/external/orderbook/BTC-USD?limit=1');
    expect(fetchFn.mock.calls.length).toBe(count + 1);
  });

  it('bounds simultaneous upstream requests while allowing shared in-flight reads', async () => {
    const { fetchFn } = mockProvider();
    const client = createReviewMarketDataClient({ fetchFn: fetchFn as typeof fetch });
    await client.read('/market/external/symbols');
    const releases: (() => void)[] = [];
    fetchFn.mockImplementation(() => new Promise(resolve => {
      releases.push(() => resolve({ ok: true, json: async () => ({ error: [], result: { XBTUSD: { bids: [], asks: [] } } }) }));
    }));
    const reads = Array.from({ length: 20 }, (_, index) => client.read(`/market/external/orderbook/BTC-USD?limit=${index + 1}`));
    const outcomes = Promise.allSettled(reads);
    // Let cached-symbol awaits reach their bounded public fetches.
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(releases).toHaveLength(12);
    releases.forEach(release => release());
    const results = await outcomes;
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(12);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(8);
  });
});
