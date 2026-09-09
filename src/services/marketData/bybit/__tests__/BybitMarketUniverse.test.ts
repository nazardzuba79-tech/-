import { BybitMarketDataService, BybitMarketDataError } from '../BybitMarketDataService';
import { MarketUniverse, isExecutablePerpetualCandidate, isUsableSpotInstrument } from '../MarketUniverse';

/**
 * The Bybit market-universe adapter.
 *
 * Every assertion here is deterministic against fixtures. LIVE PROVIDER
 * VERIFICATION WAS NOT POSSIBLE: the sandbox egress proxy answers 403 to
 * CONNECT for api.bybit.com, so no real Bybit response was ever seen and
 * none of these counts is a claim about production.
 *
 * What the fixtures DO encode is the documented V5 contract: the
 * `{retCode, retMsg, result:{list, nextPageCursor}}` envelope, spot
 * without cursor pagination, linear with it, and `price24hPcnt` as a
 * FRACTION rather than a percentage.
 */

const ok = (list: unknown[], nextPageCursor: string | null = null) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ retCode: 0, retMsg: 'OK', result: { list, nextPageCursor } }),
});

const perp = (symbol: string, over: Record<string, unknown> = {}) => ({
  symbol,
  contractType: 'LinearPerpetual',
  status: 'Trading',
  baseCoin: symbol.replace(/USDT$|USDC$/, ''),
  quoteCoin: 'USDT',
  settleCoin: 'USDT',
  launchTime: '1584230400000',
  deliveryTime: '0',
  fundingInterval: 480,
  leverageFilter: { minLeverage: '1', maxLeverage: '100.00' },
  priceFilter: { tickSize: '0.10' },
  lotSizeFilter: { minOrderQty: '0.001', maxOrderQty: '1190', qtyStep: '0.001', minNotionalValue: '5' },
  ...over,
});

const spotRow = (symbol: string, over: Record<string, unknown> = {}) => ({
  symbol,
  baseCoin: symbol.replace(/USDT$/, ''),
  quoteCoin: 'USDT',
  status: 'Trading',
  priceFilter: { tickSize: '0.01' },
  lotSizeFilter: { basePrecision: '0.000001', minOrderQty: '0.000048', maxOrderQty: '71.7', minOrderAmt: '1', maxOrderAmt: '2000000' },
  ...over,
});

/** A fetch stub that routes by URL and counts every upstream call. */
function stub(routes: (url: string, calls: string[]) => any) {
  const calls: string[] = [];
  const fetchFn = jest.fn(async (url: string) => {
    calls.push(url);
    const result = routes(url, calls);
    if (result instanceof Error) throw result;
    return result;
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function service(routes: (url: string, calls: string[]) => any, now?: () => number) {
  const { fetchFn, calls } = stub(routes);
  return {
    svc: new BybitMarketDataService({ fetchFn, now, sleep: async () => {}, baseUrl: 'https://stub' }),
    calls,
  };
}

// ── 1-2. Instrument normalization ───────────────────────────────────

describe('instrument normalization', () => {
  it('normalizes a spot instrument from provider metadata, not the symbol string', async () => {
    const { svc } = service(() => ok([spotRow('BTCUSDT')]));
    const [row] = (await svc.listSpotInstruments()).value;
    expect(row.symbol).toBe('BTC/USDT');
    expect(row.providerSymbol).toBe('BTCUSDT');
    expect(row.marketType).toBe('spot');
    expect(row.baseAsset).toBe('BTC');
    expect(row.quoteAsset).toBe('USDT');
    // Spot has no settle asset. Null, never a fabricated 'USDT'.
    expect(row.settleAsset).toBeNull();
  });

  it('normalizes a linear perpetual including settle asset and funding cadence', async () => {
    const { svc } = service(() => ok([perp('BTCUSDT')]));
    const [row] = (await svc.listLinearInstruments()).value;
    expect(row.symbol).toBe('BTC/USDT');
    expect(row.marketType).toBe('linear_perpetual');
    expect(row.settleAsset).toBe('USDT');
    expect(row.fundingIntervalMinutes).toBe(480);
    expect(row.providerMaxLeverage).toBe(100);
    expect(row.launchTime).toBe(1584230400000);
    // deliveryTime "0" is ABSENT, not 1970.
    expect(row.deliveryTime).toBeNull();
  });

  it('rejects an instrument that does not publish its own base and quote', async () => {
    const { svc } = service(() => ok([{ symbol: 'WEIRDUSDT', status: 'Trading', contractType: 'LinearPerpetual' }]));
    expect((await svc.listLinearInstruments()).value).toEqual([]);
  });

  it('rejects an unrecognised contract type rather than assuming perpetual', async () => {
    const { svc } = service(() => ok([perp('XUSDT', { contractType: 'SomethingNew' })]));
    expect((await svc.listLinearInstruments()).value).toEqual([]);
  });
});

// ── 11. Filters ─────────────────────────────────────────────────────

describe('order-entry filters', () => {
  it('carries tickSize, qtyStep and the precisions they imply', async () => {
    const { svc } = service(() => ok([perp('BTCUSDT')]));
    const [{ filters }] = (await svc.listLinearInstruments()).value;
    expect(filters.tickSize).toBe(0.1);
    expect(filters.qtyStep).toBe(0.001);
    expect(filters.pricePrecision).toBe(1);
    expect(filters.qtyPrecision).toBe(3);
    expect(filters.minNotional).toBe(5);
  });

  it('reports an absent filter as null, never as zero', async () => {
    const { svc } = service(() => ok([perp('XUSDT', { priceFilter: {}, lotSizeFilter: {} })]));
    const [{ filters }] = (await svc.listLinearInstruments()).value;
    expect(filters.tickSize).toBeNull();
    expect(filters.qtyStep).toBeNull();
    expect(filters.pricePrecision).toBeNull();
    // The instrument is then not usable, precisely because those are null.
    expect(isUsableSpotInstrument({ ...(await svc.listLinearInstruments()).value[0], marketType: 'spot' })).toBe(false);
  });
});

// ── 3-5. Cursor pagination ──────────────────────────────────────────

describe('linear cursor pagination', () => {
  it('follows nextPageCursor past 500 instruments and terminates', async () => {
    const pages = [
      { rows: Array.from({ length: 500 }, (_, i) => perp(`A${i}USDT`)), cursor: 'c1' },
      { rows: Array.from({ length: 500 }, (_, i) => perp(`B${i}USDT`)), cursor: 'c2' },
      { rows: Array.from({ length: 137 }, (_, i) => perp(`C${i}USDT`)), cursor: null },
    ];
    let page = 0;
    const { svc, calls } = service(() => {
      const p = pages[page++];
      return ok(p.rows, p.cursor);
    });
    const universe = (await svc.listLinearInstruments()).value;
    expect(universe).toHaveLength(1137);
    // One request per PAGE, never per instrument.
    expect(calls).toHaveLength(3);
    expect(calls[1]).toContain('cursor=c1');
    expect(calls[0]).toContain('limit=1000');
  });

  it('terminates on an absent cursor without a second request', async () => {
    const { svc, calls } = service(() => ok([perp('BTCUSDT')], null));
    expect((await svc.listLinearInstruments()).value).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('terminates on an empty page even when a cursor is still returned', async () => {
    let n = 0;
    const { svc, calls } = service(() => (n++ === 0 ? ok([perp('BTCUSDT')], 'c1') : ok([], 'c2')));
    expect((await svc.listLinearInstruments()).value).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('refuses a repeating cursor instead of looping forever', async () => {
    const { svc } = service(() => ok([perp('BTCUSDT')], 'same'));
    await expect(svc.listLinearInstruments()).rejects.toThrow(/repeating pagination cursor/);
  });

  it('spot is fetched in ONE request and is never cursor-paginated', async () => {
    // Spot does not support cursors; a cursor in the body must not start a
    // second page.
    const { svc, calls } = service(() => ok([spotRow('BTCUSDT')], 'ignored-cursor'));
    expect((await svc.listSpotInstruments()).value).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});

// ── 6. Duplicates ───────────────────────────────────────────────────

describe('deduplication', () => {
  it('collapses exact duplicates deterministically', async () => {
    const { svc } = service(() => ok([perp('BTCUSDT'), perp('BTCUSDT')]));
    expect((await svc.listLinearInstruments()).value).toHaveLength(1);
  });

  it('keeps a perpetual and a dated future on the same pair as distinct instruments', async () => {
    const { svc } = service(() =>
      ok([perp('BTCUSDT'), perp('BTC-27JUN25', { contractType: 'LinearFutures', baseCoin: 'BTC', deliveryTime: '1751000000000' })])
    );
    const rows = (await svc.listLinearInstruments()).value;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.marketType).sort()).toEqual(['linear_futures', 'linear_perpetual']);
  });
});

// ── 7-10. Eligibility ───────────────────────────────────────────────

describe('executable-perpetual eligibility', () => {
  const build = (over: Record<string, unknown>) => {
    const { svc } = service(() => ok([perp('XUSDT', over)]));
    return svc.listLinearInstruments().then((r) => r.value[0]);
  };

  it('admits a Trading USDT-settled LinearPerpetual', async () => {
    expect(isExecutablePerpetualCandidate(await build({}))).toBe(true);
  });

  it('rejects PreLaunch', async () => {
    expect(isExecutablePerpetualCandidate(await build({ status: 'PreLaunch' }))).toBe(false);
  });

  it.each(['Delivering', 'Settling', 'Closed'])('rejects %s', async (status) => {
    expect(isExecutablePerpetualCandidate(await build({ status }))).toBe(false);
  });

  it('rejects a dated LinearFutures — VOLTEX has no expiry or delivery', async () => {
    expect(isExecutablePerpetualCandidate(await build({ contractType: 'LinearFutures' }))).toBe(false);
  });

  it('rejects a USDC-settled contract', async () => {
    expect(isExecutablePerpetualCandidate(await build({ quoteCoin: 'USDC', settleCoin: 'USDC' }))).toBe(false);
  });

  it('rejects a USDT-quoted contract that settles in something else', async () => {
    expect(isExecutablePerpetualCandidate(await build({ settleCoin: 'USDC' }))).toBe(false);
  });

  it('rejects an inverse contract', async () => {
    expect(isExecutablePerpetualCandidate(await build({ contractType: 'InversePerpetual' }))).toBe(false);
  });
});

// ── 12. Bulk tickers ────────────────────────────────────────────────

describe('bulk tickers', () => {
  it('fetches a whole category in one request and never per symbol', async () => {
    const rows = Array.from({ length: 800 }, (_, i) => ({
      symbol: `A${i}USDT`, lastPrice: '1.5', price24hPcnt: '0.021', turnover24h: '1000',
      volume24h: '10', highPrice24h: '2', lowPrice24h: '1', bid1Price: '1.49', ask1Price: '1.51',
      indexPrice: '1.499', markPrice: '1.5005', fundingRate: '0.0001', openInterest: '42',
    }));
    const { svc, calls } = service(() => ok(rows));
    const tickers = (await svc.getTickers('linear')).value;
    expect(tickers).toHaveLength(800);
    expect(calls).toHaveLength(1);
  });

  it('converts Bybit price24hPcnt from a FRACTION to a percentage', async () => {
    const { svc } = service(() => ok([{ symbol: 'BTCUSDT', lastPrice: '100', price24hPcnt: '0.021' }]));
    // 0.021 is +2.1%, not +0.021% and not +210%.
    expect((await svc.getTickers('linear')).value[0].changePercent24h).toBeCloseTo(2.1, 10);
  });

  it('carries a REAL zero through as zero', async () => {
    const { svc } = service(() => ok([{ symbol: 'FLATUSDT', lastPrice: '100', price24hPcnt: '0', turnover24h: '0' }]));
    const [row] = (await svc.getTickers('spot')).value;
    expect(row.changePercent24h).toBe(0);
    expect(row.quoteVolume24h).toBe(0);
  });

  it('reports an absent field as null rather than zero', async () => {
    const { svc } = service(() => ok([{ symbol: 'XUSDT', lastPrice: '100' }]));
    const [row] = (await svc.getTickers('spot')).value;
    expect(row.changePercent24h).toBeNull();
    expect(row.quoteVolume24h).toBeNull();
    expect(row.indexPrice).toBeNull();
    expect(row.lastPrice).toBe(100);
  });

  it('coalesces concurrent readers into a single upstream request', async () => {
    const { svc, calls } = service(() => ok([{ symbol: 'BTCUSDT', lastPrice: '1' }]));
    await Promise.all(Array.from({ length: 100 }, () => svc.getTickers('linear')));
    expect(calls).toHaveLength(1);
    expect(svc.upstreamRequestCount).toBe(1);
  });
});

// ── 13. Provider outage and geo-refusal ─────────────────────────────

describe('provider failure', () => {
  it('treats a non-zero retCode as failure even on HTTP 200', async () => {
    const { svc } = service(() => ({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ retCode: 10001, retMsg: 'params error', result: { list: [] } }),
    }));
    await expect(svc.listSpotInstruments()).rejects.toThrow(/retCode 10001/);
  });

  it('surfaces a regional refusal as a provider failure, not an empty universe', async () => {
    const { svc } = service(() => ({
      ok: false, status: 403, headers: { get: () => null }, text: async () => 'CloudFront blocked',
      json: async () => ({}),
    }));
    await expect(svc.listLinearInstruments()).rejects.toBeInstanceOf(BybitMarketDataError);
  });

  it('rejects a malformed body instead of reading it as zero instruments', async () => {
    const { svc } = service(() => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => null }));
    await expect(svc.listSpotInstruments()).rejects.toThrow(/malformed/);
  });
});

// ── 14. Stale-last-good ─────────────────────────────────────────────

describe('bounded stale-last-good', () => {
  it('serves the previous universe past its TTL when a refresh fails', async () => {
    let clock = 1_000_000;
    let mode: 'ok' | 'fail' = 'ok';
    const { svc } = service(
      () => (mode === 'ok' ? ok([perp('BTCUSDT')]) : new Error('provider down')),
      () => clock
    );
    expect((await svc.listLinearInstruments()).value).toHaveLength(1);

    clock += 20 * 60_000; // past the 15-minute TTL
    mode = 'fail';
    const served = await svc.listLinearInstruments();
    expect(served.value).toHaveLength(1);
    expect(served.stale).toBe(true);
  });
});

// ── 17-19. The universe never shrinks on failure ────────────────────

describe('MarketUniverse', () => {
  function universeWith(routes: (url: string, calls: string[]) => any, now?: () => number) {
    const { svc, calls } = service(routes, now);
    return { universe: new MarketUniverse(svc, { now }), calls, svc };
  }

  it('loads spot and linear together', async () => {
    const { universe } = universeWith((url) =>
      url.includes('category=spot') ? ok([spotRow('BTCUSDT')]) : ok([perp('ETHUSDT')])
    );
    const result = await universe.refresh();
    expect(result).toMatchObject({ ok: true, spotCount: 1, linearCount: 1 });
    expect(universe.spot()).toHaveLength(1);
    expect(universe.perpetualCandidates()).toHaveLength(1);
  });

  // Two layers protect the universe, and both are asserted separately.
  //
  // Layer 1 is the cache's bounded stale window: inside it, a failing
  // provider is absorbed entirely and the refresh still succeeds.
  it('absorbs a provider failure inside the stale window and still succeeds', async () => {
    let clock = 1_000_000;
    let fail = false;
    const { universe } = universeWith((url) => {
      if (fail) return new Error('403 from the provider');
      return url.includes('category=spot') ? ok([spotRow('BTCUSDT')]) : ok([perp('ETHUSDT')]);
    }, () => clock);

    await universe.refresh();
    clock += 20 * 60_000; // past the TTL, inside the 24h stale budget
    fail = true;
    expect((await universe.refresh()).ok).toBe(true);
    expect(universe.perpetualCandidates()).toHaveLength(1);
  });

  // Layer 2 is this class: once even the stale window is exhausted, the
  // refresh genuinely fails — and the previous universe STILL stands.
  // Hundreds of markets must never become an empty list.
  it('keeps the previous universe when the failure outlives the stale window', async () => {
    let clock = 1_000_000;
    let fail = false;
    const { universe } = universeWith((url) => {
      if (fail) return new Error('403 from the provider');
      return url.includes('category=spot') ? ok([spotRow('BTCUSDT')]) : ok([perp('ETHUSDT')]);
    }, () => clock);

    await universe.refresh();
    clock += 48 * 60 * 60_000; // well past the 24h stale budget
    fail = true;
    const result = await universe.refresh();
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(universe.spot()).toHaveLength(1);
    expect(universe.perpetualCandidates()).toHaveLength(1);
  });

  it('keeps the previous universe when the provider answers 200 with nothing', async () => {
    let clock = 1_000_000;
    let empty = false;
    const { universe } = universeWith((url) => {
      if (empty) return ok([]);
      return url.includes('category=spot') ? ok([spotRow('BTCUSDT')]) : ok([perp('ETHUSDT')]);
    }, () => clock);

    await universe.refresh();
    clock += 20 * 60_000; // force a real re-fetch
    empty = true;
    // A venue does not delist everything at once; a successful-looking
    // empty answer is far likelier to be an upstream fault.
    expect((await universe.refresh()).ok).toBe(false);
    expect(universe.perpetualCandidates()).toHaveLength(1);
  });

  it('reports "not loaded" before the first success rather than "no markets"', async () => {
    const { universe } = universeWith(() => new Error('down'));
    await universe.refresh();
    expect(universe.snapshot().loaded).toBe(false);
    expect(universe.snapshot().refreshedAt).toBeNull();
  });

  // ── 16. Request count for a 500+ universe ─────────────────────────
  it('builds a 1000+ instrument universe in a handful of requests, not one per market', async () => {
    const linearPages = [
      { rows: Array.from({ length: 1000 }, (_, i) => perp(`L${i}USDT`)), cursor: 'c1' },
      { rows: Array.from({ length: 200 }, (_, i) => perp(`M${i}USDT`)), cursor: null },
    ];
    let page = 0;
    const { universe, calls } = universeWith((url) => {
      if (url.includes('category=spot')) return ok(Array.from({ length: 700 }, (_, i) => spotRow(`S${i}USDT`)));
      const p = linearPages[page++];
      return ok(p.rows, p.cursor);
    });
    await universe.refresh();
    expect(universe.spot()).toHaveLength(700);
    expect(universe.perpetualCandidates()).toHaveLength(1200);
    // 1 spot + 2 linear pages = 3 upstream requests for 1900 instruments.
    expect(calls).toHaveLength(3);
  });
});
