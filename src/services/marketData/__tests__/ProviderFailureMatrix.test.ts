import { CfdMarketDataService, ExternalCfdDataError } from '../../CfdMarketDataService';
import { ArbitrageService } from '../../ArbitrageService';
import { KrakenMarketDataService } from '../../KrakenMarketDataService';
import { providerHealthRegistry } from '../ProviderHealth';
import { CfdQuoteUnavailable } from '../cfd/CfdQuote';
import { CFD_REFERENCE_CATALOG } from '../cfd/catalog';

/**
 * The failure matrix for the two providers this task moved onto the shared
 * primitives: Twelve Data (CFD quotes) and Binance/OKX (arbitrage).
 *
 * Both previously hand-rolled `{data, expiresAt}` with a bare `fetch`: no
 * request deduplication, no retry policy, no Retry-After handling, no
 * circuit breaker and no health registration. Twelve Data is the one
 * metered provider in the system — an 8-credits-per-minute free tier —
 * which made it the one place an unprotected retry loop costs money.
 *
 * Everything here is deterministic. `sleep` is a no-op and the clock is
 * injected where timing matters, so no test waits on a real backoff and
 * none touches a network.
 */
describe('provider failure matrix', () => {
  /** No real waiting: retries are exercised, their delays are not. */
  const FAST = { sleep: () => Promise.resolve() };

  function response(body: unknown, ok = true, status = 200, headers: Record<string, string> = {}) {
    return {
      ok,
      status,
      json: () => Promise.resolve(body),
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    } as unknown as Response;
  }

  const goldQuote = {
    'XAU/USD': { symbol: 'XAU/USD', close: '2400.10', percent_change: '0.42' },
  };

  // The service caps credits at the Basic plan's 8 per minute whatever it is
  // given (d9567fea7), and a reference batch spends every available credit. The
  // retry and circuit rows therefore run on one-credit execution requests for a
  // synthetic entitled symbol: the same HTTP client and the same health object.
  function cfd(fetchFn: jest.Mock, policy: Record<string, unknown> = FAST) {
    return new CfdMarketDataService('test-key', fetchFn as unknown as typeof fetch, 'https://td.test', policy, {creditsPerMinute:100,creditsPerDay:10000});
  }
  function execution(fetchFn: jest.Mock, policy: Record<string, unknown> = FAST) {
    return new CfdMarketDataService('test-key', fetchFn as unknown as typeof fetch, 'https://td.test', policy,
      {entitledSymbols:['XAUUSD'], executionSymbols:['XAUUSD']});
  }
  const twelveData = () => providerHealthRegistry.get('twelvedata')!.snapshot();
  /** Built at call time, so a moved clock still gets a fresh provider timestamp. */
  const liveGold = () => response({ 'XAU/USD': { ...goldQuote['XAU/USD'], timestamp: Math.floor(Date.now() / 1000) } });

  /** Every outbound Twelve Data request, in order: endpoint + query entries in URL order, duplicates kept. */
  const requests = (fetchFn: jest.Mock) => (fetchFn.mock.calls as unknown[][]).map(([url]) => {
    const parsed = new URL(String(url));
    return { endpoint: parsed.origin + parsed.pathname, query: [...parsed.searchParams.entries()] };
  });
  const quoteOf = (symbol: string) => ({ endpoint: 'https://td.test/quote', query: [['symbol', symbol], ['apikey', 'test-key']] });
  const XAU = quoteOf('XAU/USD');
  /** The reference batch of `size` symbols starting at a catalog position. */
  const batch = (from: number, size = 8) => quoteOf(Array.from({ length: size },
    (_, n) => CFD_REFERENCE_CATALOG[(from + n) % CFD_REFERENCE_CATALOG.length].providerSymbol).join(','));

  const rejection = (attempt: Promise<unknown>) => attempt.then(() => { throw new Error('expected a refusal'); }, (error: unknown) => error);
  /** An execution refusal is typed and coded, never a bare Error. */
  async function refused(attempt: Promise<unknown>) {
    const error = await rejection(attempt);
    expect(error).toBeInstanceOf(CfdQuoteUnavailable);
    expect(error).toMatchObject({ code: 'cfd_quote_temporarily_unavailable', reason: 'unavailable_or_stale' });
  }
  /** The reference path reports provider trouble as its sanitized error. */
  async function providerError(attempt: Promise<unknown>, message: string) {
    const error = await rejection(attempt);
    expect(error).toBeInstanceOf(ExternalCfdDataError);
    expect((error as Error).message).toBe(message);
  }

  // ── Twelve Data / CFD ───────────────────────────────────────────────

  it('retries a temporary 5xx and succeeds', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(response({}, false, 503))
      .mockImplementationOnce(() => Promise.resolve(liveGold()));

    const quote = await execution(fetchFn).getFreshQuote('XAUUSD');

    expect(requests(fetchFn)).toEqual([XAU, XAU]);
    expect(quote).toMatchObject({ status: 'live', lastDecimal: '2400.10' });
  });

  it('a reference batch spends the whole Basic minute, so its retries are denied before HTTP', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response({}, false, 503));
    const service = cfd(fetchFn);

    await providerError(service.getTickers(), 'Failed to reach Twelve Data');
    expect(requests(fetchFn)).toEqual([batch(0)]);
    expect((await service.diagnostics()).credits).toMatchObject({ perMinute: 8, minuteUsed: 8 });
    // Inside the minute the cached failure is reported again without HTTP.
    await providerError(service.getTickers(), 'Failed to reach Twelve Data');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('the reference path sends nothing for 60s even when the minute budget has room again', async () => {
    let now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const fetchFn = jest.fn().mockResolvedValue(response({}, false, 503));
      const service = execution(fetchFn);

      await refused(service.getFreshQuote('XAUUSD')); // 1 attempt + 2 retries = 3 credits
      now += 10_000;
      await providerError(service.getTickers(), 'Failed to reach Twelve Data'); // the 5 credits left
      expect(requests(fetchFn)).toEqual([XAU, XAU, XAU, batch(0, 5)]);

      now += 59_999; // the execution credits have expired, so 3 are free: the cadence still holds
      expect((await service.diagnostics()).credits).toMatchObject({ minuteUsed: 5 });
      await providerError(service.getTickers(), 'Failed to reach Twelve Data');
      expect(fetchFn).toHaveBeenCalledTimes(4);

      now += 1; // a full minute after the batch: the next 8 symbols in rotation
      await providerError(service.getTickers(), 'Failed to reach Twelve Data');
      expect(requests(fetchFn)).toEqual([XAU, XAU, XAU, batch(0, 5), batch(5)]);
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }
  });

  it('honours Retry-After on a 429 instead of hammering a metered provider', async () => {
    // A Retry-After longer than the retry budget stops immediately rather
    // than burning further credits against a provider that just said no.
    const fetchFn = jest.fn().mockResolvedValue(response({}, false, 429, { 'retry-after': '120' }));
    const service = cfd(fetchFn);

    await expect(service.getTickers()).rejects.toThrow(/HTTP 429/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries a transport timeout within a bounded budget, never unbounded', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));

    await refused(execution(fetchFn).getFreshQuote('XAUUSD'));
    // 1 initial attempt + the default 2 retries. Bounded, by construction.
    expect(requests(fetchFn)).toEqual([XAU, XAU, XAU]);
    expect(twelveData()).toMatchObject({ state: 'CLOSED', consecutiveFailures: 1 });
  });

  it('opens the circuit after repeated failures and then stops calling the provider', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('down'));
    // retries:0 so each getFreshQuote() call is exactly one outbound attempt,
    // making the 4-failure threshold easy to count.
    const service = execution(fetchFn, { retries: 0 });

    for (let i = 0; i < 4; i++) {
      await refused(service.getFreshQuote('XAUUSD'));
    }
    expect(requests(fetchFn)).toEqual([XAU, XAU, XAU, XAU]);
    expect(twelveData().state).toBe('OPEN');

    // Circuit is OPEN: neither the execution nor the reference path reaches the network.
    await refused(service.getFreshQuote('XAUUSD'));
    await providerError(service.getTickers(), 'CFD provider unavailable');
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('recovers through a HALF_OPEN probe once the cooldown elapses', async () => {
    // ProviderHealth reads the wall clock (the service constructs it with
    // production defaults, which is the thing under test), so the clock is
    // moved rather than injected.
    let now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const probeStates: string[] = [];
      const fetchFn = jest
        .fn()
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('down'))
        .mockImplementation(() => { probeStates.push(twelveData().state); return Promise.resolve(liveGold()); });
      const service = execution(fetchFn, { retries: 0 });

      for (let i = 0; i < 4; i++) await refused(service.getFreshQuote('XAUUSD'));
      expect(twelveData().state).toBe('OPEN');
      await refused(service.getFreshQuote('XAUUSD'));
      expect(fetchFn).toHaveBeenCalledTimes(4);

      // Past the 30s cooldown the next call is admitted while HALF_OPEN, and
      // its success closes the circuit.
      now += 31_000;
      const recovered = await service.getFreshQuote('XAUUSD');
      expect(probeStates).toEqual(['HALF_OPEN']);
      expect(recovered).toMatchObject({ status: 'live', lastDecimal: '2400.10' });
      expect(requests(fetchFn)).toEqual([XAU, XAU, XAU, XAU, XAU]);
      expect(twelveData().state).toBe('CLOSED');
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }
  });

  it('serves the last good quote when a refresh fails inside the stale budget', async () => {
    const realNow = Date.now;
    let now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const fetchFn = jest.fn().mockResolvedValueOnce(response(goldQuote)).mockRejectedValue(new Error('down'));
      const service = cfd(fetchFn, { retries: 0 });

      await service.getTickers();
      now += 65_000; // past the 60s TTL, inside the 120s stale budget

      const stale = await service.getTickersWithMeta();
      expect(stale.stale).toBe(true);
      expect(stale.value.find((t) => t.symbol === 'XAUUSD')!.price).toBe('2400.10');
    } finally {
      (Date.now as jest.Mock).mockRestore();
      expect(Date.now).toBe(realNow);
    }
  });

  it('stops serving once the stale budget expires rather than aging a price indefinitely', async () => {
    let now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const fetchFn = jest.fn().mockResolvedValueOnce(response(goldQuote)).mockRejectedValue(new Error('down'));
      const service = cfd(fetchFn, { retries: 0 });

      await service.getTickers();
      now += 10 * 60_000; // far past TTL + stale budget

      await expect(service.getTickers()).rejects.toThrow();
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }
  });

  it('propagates a cold-cache failure instead of returning an empty list', async () => {
    // The dangerous alternative: `catch { return [] }`, which a caller
    // would render as "no instruments" — indistinguishable from a real
    // empty market.
    const fetchFn = jest.fn().mockRejectedValue(new Error('down'));
    await expect(cfd(fetchFn, { retries: 0 }).getTickers()).rejects.toThrow();
  });

  it('collapses concurrent CFD callers into ONE metered request', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(goldQuote));
    const service = cfd(fetchFn);

    await Promise.all(Array.from({ length: 25 }, () => service.getTickers()));

    // 25 consumers, 1 credit. On an 8-credits/minute budget this is the
    // difference between fitting and being cut off.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('skips a malformed symbol without failing the batch, and never invents a price', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      response({
        'XAU/USD': { symbol: 'XAU/USD', close: '2400.10', percent_change: '0.42' },
        'EUR/USD': { symbol: 'EUR/USD', status: 'error', message: 'plan gated' },
      })
    );

    const tickers = await cfd(fetchFn).getTickers();

    expect(tickers.map((t) => t.symbol)).toEqual(['XAUUSD']);
    // The failed symbol is absent, not present with a zero price.
    expect(tickers.find((t) => t.symbol === 'EURUSD')).toBeUndefined();
  });

  it('omits an unreported 24h change rather than reporting it as 0%', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      response({ 'XAU/USD': { symbol: 'XAU/USD', close: '2400.10' } })
    );

    const gold = (await cfd(fetchFn).getTickers()).find((t) => t.symbol === 'XAUUSD')!;

    expect(gold.price).toBe('2400.10');
    // An unknown change is unknown. "0" would read as "flat", which is a
    // different and false claim.
    expect(gold.changePercent24h).toBeUndefined();
  });

  it('keeps a REAL zero 24h change as zero', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      response({ 'XAU/USD': { symbol: 'XAU/USD', close: '2400.10', percent_change: '0' } })
    );

    const gold = (await cfd(fetchFn).getTickers()).find((t) => t.symbol === 'XAUUSD')!;
    expect(gold.changePercent24h).toBe('0');
  });

  it('returns an empty list without a network call when no key is configured', async () => {
    const fetchFn = jest.fn();
    const service = new CfdMarketDataService(undefined, fetchFn as unknown as typeof fetch, 'https://td.test');

    expect(await service.getTickers()).toEqual([]);
    expect(service.isConfigured()).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // ── Binance / OKX / arbitrage ───────────────────────────────────────

  function arbitrage(fetchFn: jest.Mock, krakenTickers: unknown[] = []) {
    const kraken = { getTickers: jest.fn().mockResolvedValue(krakenTickers) } as unknown as KrakenMarketDataService;
    return new ArbitrageService(kraken, fetchFn as unknown as typeof fetch, 'https://binance.test', 'https://okx.test', FAST);
  }

  const binanceRows = [
    { symbol: 'BTCUSDT', price: '50000' },
    { symbol: 'ETHUSDT', price: '3000' },
  ];
  const okxRows = { data: [{ instId: 'BTC-USDT', last: '50500' }, { instId: 'ETH-USDT', last: '3010' }] };

  it('computes a spread from two live venues and records both sources and a timestamp', async () => {
    const fetchFn = jest.fn((url: string) =>
      Promise.resolve(response(url.includes('binance') ? binanceRows : okxRows))
    );

    const opportunities = await arbitrage(fetchFn).getOpportunities();
    const btc = opportunities.find((o) => o.pair === 'BTC/USDT')!;

    expect(btc.buyExchange).toBe('Binance');
    expect(btc.sellExchange).toBe('OKX');
    expect(btc.sources).toEqual(['Binance', 'OKX']);
    // A spread without a time is not an opportunity.
    expect(btc.observedAt).toBeGreaterThan(0);
  });

  it('omits a pair with only ONE live venue rather than synthesizing a spread', async () => {
    // OKX down: every pair drops to a single Binance quote. A comparison
    // needs two sides, so the honest answer is "nothing to report".
    const fetchFn = jest.fn((url: string) =>
      url.includes('binance') ? Promise.resolve(response(binanceRows)) : Promise.reject(new Error('okx down'))
    );

    await expect(arbitrage(fetchFn).getOpportunities()).rejects.toThrow(/No exchange price data/);
  });

  it('keeps Binance and OKX circuits independent', async () => {
    // Binance failing must not stop OKX being read — a shared circuit
    // would silently reduce every comparison to one venue.
    const fetchFn = jest.fn((url: string) =>
      url.includes('binance')
        ? Promise.resolve(response({}, false, 500))
        : Promise.resolve(response(okxRows))
    );
    const kraken = {
      getTickers: jest.fn().mockResolvedValue([{ pair: 'BTC/USDT', lastPrice: '49000' }]),
    } as unknown as KrakenMarketDataService;
    const service = new ArbitrageService(
      kraken,
      fetchFn as unknown as typeof fetch,
      'https://binance.test',
      'https://okx.test',
      FAST
    );

    const opportunities = await service.getOpportunities();
    const btc = opportunities.find((o) => o.pair === 'BTC/USDT')!;

    // Kraken + OKX still make a real two-venue comparison.
    expect(btc.sources).toEqual(['Kraken', 'OKX']);
    expect(btc.sources).not.toContain('Binance');
  });

  it('collapses concurrent arbitrage callers into ONE sweep of each venue', async () => {
    const fetchFn = jest.fn((url: string) =>
      Promise.resolve(response(url.includes('binance') ? binanceRows : okxRows))
    );
    const service = arbitrage(fetchFn);

    await Promise.all(Array.from({ length: 50 }, () => service.getOpportunities()));

    // One Binance call + one OKX call, for 50 consumers.
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('serves the last good comparison inside the stale budget, then fails honestly', async () => {
    let now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      let healthy = true;
      const fetchFn = jest.fn((url: string) => {
        if (!healthy) return Promise.reject(new Error('down'));
        return Promise.resolve(response(url.includes('binance') ? binanceRows : okxRows));
      });
      const service = arbitrage(fetchFn);

      await service.getOpportunities();
      healthy = false;

      now += 15_000; // past the 10s TTL, inside the 30s stale budget
      const stale = await service.getOpportunities();
      expect(stale.find((o) => o.pair === 'BTC/USDT')).toBeDefined();

      now += 60_000; // past the stale budget
      await expect(service.getOpportunities()).rejects.toThrow();
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }
  });

  it('tolerates a malformed OKX payload without producing a fabricated quote', async () => {
    const fetchFn = jest.fn((url: string) =>
      Promise.resolve(response(url.includes('binance') ? binanceRows : { data: null }))
    );

    // Binance alone is one venue — not enough for a comparison.
    await expect(arbitrage(fetchFn).getOpportunities()).rejects.toThrow(/No exchange price data/);
  });
});
