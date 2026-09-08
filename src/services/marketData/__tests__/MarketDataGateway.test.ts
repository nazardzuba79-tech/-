import { MarketDataGateway } from '../MarketDataGateway';
import { KrakenMarketDataService } from '../../KrakenMarketDataService';
import { CoinGeckoService } from '../../CoinGeckoService';
import { FearGreedService } from '../../FearGreedService';
import { CfdMarketDataService } from '../../CfdMarketDataService';
import { CapabilityUnsupportedError } from '../types';

/**
 * Every provider here is a mocked `fetch`. Nothing in this file touches a
 * network, and every retry policy is set to `{ retries: 0 }` so a mocked
 * failure fails immediately instead of spending the real backoff.
 *
 * The three properties these tests exist to hold:
 *
 *   1. A provider failure NEVER becomes a number. Not 0, not null coerced
 *      to 0, not an empty array a caller could sum to 0.
 *   2. A real zero survives as a real zero. The rule cuts both ways, and
 *      the second half is the easier one to break while fixing the first.
 *   3. Concurrent consumers collapse into one upstream request. This is
 *      the whole load argument for ~100 simultaneous users.
 */
describe('MarketDataGateway', () => {
  const NO_RETRY = { retries: 0 };

  function jsonResponse(body: unknown, ok = true, status = 200, headers: Record<string, string> = {}) {
    return {
      ok,
      status,
      json: () => Promise.resolve(body),
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    } as unknown as Response;
  }

  /** Kraken wire shapes, matching the fixtures the existing
   *  KrakenMarketDataService suite already uses. `altname` matters: it is
   *  the name the ticker walk batches by. */
  const krakenAssetPairs = {
    error: [],
    result: {
      XXBTZUSDT: { altname: 'XBTUSDT', wsname: 'XBT/USDT', base: 'XXBT', quote: 'USDT' },
      XETHZUSDT: { altname: 'ETHUSDT', wsname: 'ETH/USDT', base: 'XETH', quote: 'USDT' },
    },
  };
  const krakenTicker = (last: string, volume = '10') => ({
    a: [last, '1', '1'],
    b: [last, '1', '1'],
    c: [last, '0.5'],
    h: [last, last],
    l: [last, last],
    v: ['1', volume],
    p: [last, last],
    o: last,
  });

  function krakenFetch(overrides: { tickerBody?: unknown; failTickers?: boolean } = {}) {
    return jest.fn((url: string) => {
      if (url.includes('/AssetPairs')) return Promise.resolve(jsonResponse(krakenAssetPairs));
      if (url.includes('/Ticker')) {
        if (overrides.failTickers) return Promise.resolve(jsonResponse({ error: ['down'] }, false, 500));
        return Promise.resolve(
          jsonResponse(
            overrides.tickerBody ?? { error: [], result: { XBTUSDT: krakenTicker('50000'), ETHUSDT: krakenTicker('3000') } }
          )
        );
      }
      if (url.includes('/OHLC')) {
        return Promise.resolve(
          jsonResponse({
            error: [],
            result: { XBTUSDT: [[1700000000, '49000', '50500', '48800', '50000', '49900', '10', 5]], last: 1700000000 },
          })
        );
      }
      if (url.includes('/Depth')) {
        return Promise.resolve(
          jsonResponse({
            error: [],
            result: { XBTUSDT: { asks: [['51000', '1', 0]], bids: [['49000', '2', 0]] } },
          })
        );
      }
      if (url.includes('/Trades')) {
        return Promise.resolve(
          jsonResponse({ error: [], result: { XBTUSDT: [['50000', '0.5', 1700000000, 'b', 'l', '']], last: '1' } })
        );
      }
      return Promise.resolve(jsonResponse({ error: [], result: {} }));
    });
  }

  const globalBody = {
    data: {
      total_market_cap: { usd: 2_500_000_000_000 },
      total_volume: { usd: 90_000_000_000 },
      market_cap_percentage: { btc: 54.2, eth: 13.1 },
      market_cap_change_percentage_24h_usd: 1.4,
    },
  };

  function makeGateway(opts: {
    krakenFetchFn?: jest.Mock;
    coinGeckoFetchFn?: jest.Mock;
    fearGreedFetchFn?: jest.Mock;
    cfdKey?: string;
    cfdFetchFn?: jest.Mock;
  } = {}) {
    const kFetch = opts.krakenFetchFn ?? krakenFetch();
    const cgFetch = opts.coinGeckoFetchFn ?? jest.fn(() => Promise.resolve(jsonResponse(globalBody)));
    const fgFetch =
      opts.fearGreedFetchFn ??
      jest.fn(() => Promise.resolve(jsonResponse({ data: [{ value: '61', value_classification: 'Greed', timestamp: '1700000000' }] })));

    const kraken = new KrakenMarketDataService('https://kraken.test', kFetch as unknown as typeof fetch, NO_RETRY);
    const coinGecko = new CoinGeckoService('https://cg.test', cgFetch as unknown as typeof fetch, undefined, NO_RETRY);
    const fearGreed = new FearGreedService('https://fng.test', fgFetch as unknown as typeof fetch, NO_RETRY);
    const cfd = new CfdMarketDataService(
      opts.cfdKey,
      (opts.cfdFetchFn ?? jest.fn()) as unknown as typeof fetch,
      'https://td.test',
      NO_RETRY
    );
    return { gateway: new MarketDataGateway(kraken, coinGecko, fearGreed, cfd), kFetch, cgFetch, fgFetch };
  }

  // ── Freshness and provenance ────────────────────────────────────────

  it('labels every answer with its source and fetch time', async () => {
    const { gateway } = makeGateway();
    const tickers = await gateway.getTickers();

    expect(tickers.available).toBe(true);
    if (!tickers.available) throw new Error('unreachable');
    expect(tickers.source).toBe('kraken');
    expect(tickers.stale).toBe(false);
    expect(typeof tickers.fetchedAt).toBe('number');
    expect(tickers.fetchedAt).toBeGreaterThan(0);
  });

  it('marks a stale-served value as stale rather than presenting it as live', async () => {
    let failing = false;
    const kFetch = jest.fn((url: string) => {
      if (url.includes('/AssetPairs')) return Promise.resolve(jsonResponse(krakenAssetPairs));
      if (url.includes('/Ticker')) {
        if (failing) return Promise.resolve(jsonResponse({ error: ['boom'] }, false, 500));
        return Promise.resolve(
          jsonResponse({ error: [], result: { XBTUSDT: krakenTicker('50000'), ETHUSDT: krakenTicker('3000') } })
        );
      }
      return Promise.resolve(jsonResponse({ result: {} }));
    });
    const { gateway } = makeGateway({ krakenFetchFn: kFetch });

    const fresh = await gateway.getTickers();
    expect(fresh.available && fresh.stale).toBe(false);

    // Push past the 5s ticker TTL, then fail the refresh. Inside the 60s
    // stale budget the previous value is served — flagged.
    failing = true;
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    try {
      const stale = await gateway.getTickers();
      expect(stale.available).toBe(true);
      if (!stale.available) throw new Error('unreachable');
      expect(stale.stale).toBe(true);
      expect(stale.value.length).toBeGreaterThan(0);
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }
  });

  // ── Never a fake zero ───────────────────────────────────────────────

  it('returns an unavailable section with NO value-carrying fields when a provider fails', async () => {
    const { gateway } = makeGateway({ krakenFetchFn: krakenFetch({ failTickers: true }) });

    const result = await gateway.getTickers();

    expect(result.available).toBe(false);
    if (result.available) throw new Error('unreachable');
    expect(result.reason).toBe('provider_unavailable');
    // The anti-fake-zero guarantee, asserted structurally: there is no
    // field here a chart could plot, so a failure cannot become a 0.
    expect(Object.keys(result).sort()).toEqual(['available', 'detail', 'reason']);
    expect(result).not.toHaveProperty('value');
    expect(JSON.stringify(result)).not.toContain(':0');
  });

  it('preserves a REAL zero as zero', async () => {
    // A genuinely zero-volume market is a fact, not a missing value. The
    // rule that "no data is never 0" must not corrupt this direction.
    const zeroVolume = { error: [], result: { XBTUSDT: krakenTicker('50000', '0'), ETHUSDT: krakenTicker('3000', '0') } };
    const { gateway } = makeGateway({ krakenFetchFn: krakenFetch({ tickerBody: zeroVolume }) });

    const result = await gateway.getTickers();
    expect(result.available).toBe(true);
    if (!result.available) throw new Error('unreachable');
    const btc = result.value.find((t) => t.pair.startsWith('BTC'))!;
    expect(btc.volume24h).toBe('0');
    expect(btc.lastPrice).toBe('50000');
  });

  it('distinguishes an unknown pair (no_data) from a provider outage', async () => {
    const { gateway } = makeGateway();

    const unknown = await gateway.getTicker('NOPE/USDT');
    expect(unknown.available).toBe(false);
    if (unknown.available) throw new Error('unreachable');
    expect(unknown.reason).toBe('no_data');

    const { gateway: broken } = makeGateway({ krakenFetchFn: krakenFetch({ failTickers: true }) });
    const outage = await broken.getTicker('BTC/USDT');
    expect(outage.available).toBe(false);
    if (outage.available) throw new Error('unreachable');
    expect(outage.reason).toBe('provider_unavailable');
  });

  it('never leaks a provider URL, key or raw body into an unavailable detail', async () => {
    const { gateway } = makeGateway({
      cfdKey: 'super-secret-key',
      cfdFetchFn: jest.fn(() => Promise.resolve(jsonResponse({ message: 'bad key super-secret-key' }, false, 401))),
    });

    const result = await gateway.getCfdQuotes();
    expect(result.available).toBe(false);
    if (result.available) throw new Error('unreachable');
    expect(result.detail).not.toContain('super-secret-key');
    expect(result.detail).not.toContain('https://');
    expect(JSON.stringify(result)).not.toContain('super-secret-key');
  });

  // ── Snapshot composition ────────────────────────────────────────────

  it('degrades one snapshot section without failing the others', async () => {
    const { gateway } = makeGateway({
      coinGeckoFetchFn: jest.fn(() => Promise.resolve(jsonResponse({}, false, 503))),
    });

    const snapshot = await gateway.getSnapshot();

    expect(snapshot.tickers.available).toBe(true);
    expect(snapshot.sentiment.available).toBe(true);
    expect(snapshot.overview.available).toBe(false);
  });

  // ── Capability boundaries ───────────────────────────────────────────

  it('declares a capability routing table covering every provider it reads', async () => {
    const { gateway } = makeGateway();
    const caps = gateway.capabilities();

    expect(caps.find((c) => c.capability === 'candles')!.provider).toBe('kraken');
    expect(caps.find((c) => c.capability === 'market_overview')!.provider).toBe('coingecko');
    expect(caps.find((c) => c.capability === 'sentiment')!.provider).toBe('alternative.me');
    // The only key-bearing capability, and the table says so.
    expect(caps.find((c) => c.capability === 'cfd_quotes')!.requiresKey).toBe(true);
    expect(caps.filter((c) => c.capability !== 'cfd_quotes').every((c) => !c.requiresKey)).toBe(true);
  });

  it('reports cfd_quotes as unsupported until a key is configured', async () => {
    const { gateway: unconfigured } = makeGateway();
    expect(unconfigured.supports('cfd_quotes')).toBe(false);
    const result = await unconfigured.getCfdQuotes();
    expect(result.available).toBe(false);
    if (result.available) throw new Error('unreachable');
    // Not an outage: nobody has set this up. The UI shows those
    // differently and must be able to tell them apart.
    expect(result.reason).toBe('provider_not_configured');

    const { gateway: configured } = makeGateway({
      cfdKey: 'k',
      cfdFetchFn: jest.fn(() => Promise.resolve(jsonResponse({ 'XAU/USD': { symbol: 'XAU/USD', close: '2400', percent_change: '0.5' } }))),
    });
    expect(configured.supports('cfd_quotes')).toBe(true);
  });

  it('throws CapabilityUnsupportedError for a capability nothing can answer', () => {
    const { gateway } = makeGateway();
    // Cross-venue liquidation data has no provider. Asking is a
    // programming error, refused in one place.
    expect(() => (gateway as any).requireCapability('liquidations')).toThrow(CapabilityUnsupportedError);
  });

  // ── Concurrency / load ──────────────────────────────────────────────

  it('collapses 100 concurrent snapshot consumers into ONE upstream load per provider', async () => {
    const { gateway, kFetch, cgFetch, fgFetch } = makeGateway();

    const results = await Promise.all(Array.from({ length: 100 }, () => gateway.getSnapshot()));

    expect(results).toHaveLength(100);
    expect(results.every((r) => r.tickers.available && r.overview.available && r.sentiment.available)).toBe(true);

    // Kraken needs the pair list before it can walk tickers, so its floor
    // is 2 calls (AssetPairs + one batched Ticker), not 1 — but it is a
    // constant, not a multiple of the 100 consumers.
    expect(kFetch).toHaveBeenCalledTimes(2);
    expect(cgFetch).toHaveBeenCalledTimes(1);
    expect(fgFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps upstream calls bounded across mixed symbols and endpoints', async () => {
    const { gateway, kFetch } = makeGateway();

    // 100 consumers, each asking for a different mix — the shape of real
    // traffic rather than one hot key.
    await Promise.all(
      Array.from({ length: 100 }, (_, i) => {
        const pair = i % 2 === 0 ? 'BTC/USDT' : 'ETH/USDT';
        return Promise.all([
          gateway.getTicker(pair),
          gateway.getCandles('BTC/USDT', '15m', 300),
          gateway.getOrderBook('BTC/USDT', 50),
        ]);
      })
    );

    // AssetPairs + Ticker walk + OHLC + Depth = 4 distinct upstream
    // resources, each fetched once regardless of consumer count.
    expect(kFetch).toHaveBeenCalledTimes(4);
    const urls = kFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('/OHLC'))).toHaveLength(1);
    expect(urls.filter((u) => u.includes('/Depth'))).toHaveLength(1);
  });

  it('shares one candle series between consumers asking for different limits', async () => {
    const { gateway, kFetch } = makeGateway();

    await Promise.all([
      gateway.getCandles('BTC/USDT', '15m', 300),
      gateway.getCandles('BTC/USDT', '15m', 720),
      gateway.getCandles('BTC/USDT', '15m', 100),
    ]);

    expect(kFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/OHLC'))).toHaveLength(1);
  });

  it('does not fetch candle history for catalogue browsing', async () => {
    const { gateway, kFetch } = makeGateway();

    await gateway.getAssetCatalogue();
    await gateway.getTickers();

    // A 500-asset catalogue costs zero OHLC downloads. Only the selected
    // chart pays for candles.
    expect(kFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/OHLC'))).toHaveLength(0);
  });

  // ── Status ──────────────────────────────────────────────────────────

  it('reports provider health and catalogue size without throwing when a provider is down', async () => {
    const { gateway } = makeGateway({ coinGeckoFetchFn: jest.fn(() => Promise.resolve(jsonResponse({}, false, 503))) });

    const status = await gateway.getStatus();

    expect(Array.isArray(status.providers)).toBe(true);
    expect(status.capabilities.length).toBeGreaterThan(0);
    // CoinGecko down means a venue-only catalogue, not a 500.
    expect(status.catalogue).not.toBeNull();
    expect(status.catalogue!.metadataComplete).toBe(false);
  });
});
