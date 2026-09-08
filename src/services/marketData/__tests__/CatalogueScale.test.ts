import { AssetRegistry, defaultTradingPair } from '../AssetRegistry';
import { CoinGeckoService } from '../../CoinGeckoService';
import { KrakenMarketDataService } from '../../KrakenMarketDataService';
import { MarketDataGateway } from '../MarketDataGateway';
import { FearGreedService } from '../../FearGreedService';
import type { CoinRanking } from '../../CoinGeckoService';
import type { MarketSymbol } from '../../KrakenMarketDataService';

/**
 * Proof that the catalogue architecture actually holds 500+ assets, and
 * that holding them costs a bounded number of upstream requests.
 *
 * The two claims this file exists to make concrete:
 *
 *   1. **Scale is real.** 517 canonical assets, including deliberate ticker
 *      collisions, survive the join, the search, the sort and the paging
 *      without loss.
 *
 *   2. **Cost is NOT O(assets).** A cold load of 517 assets is a fixed
 *      handful of provider calls — two paged `/coins/markets` requests plus
 *      the category walk — not 517. And 100 concurrent consumers collapse
 *      onto the same fixed handful.
 *
 * Everything is deterministic: providers are mocked `fetch`es, retries are
 * disabled, and nothing here touches a network.
 */
describe('crypto catalogue at 500+ assets', () => {
  const NO_RETRY = { retries: 0 };

  function jsonResponse(body: unknown, ok = true, status = 200) {
    return {
      ok,
      status,
      json: () => Promise.resolve(body),
      headers: { get: () => null },
    } as unknown as Response;
  }

  /** 517 — deliberately not exactly 500, and not hardcoded downstream. */
  const CATALOGUE_SIZE = 517;

  /** CoinGecko `/coins/markets` rows, in the provider's own wire shape. */
  function marketRows(count: number) {
    const rows = Array.from({ length: count }, (_, i) => ({
      id: `coin-${i}`,
      symbol: `SY${i}`,
      name: `Coin Number ${i}`,
      image: `https://assets.test/coin-${i}.png`,
      market_cap_rank: i + 1,
      current_price: 1000 - i,
      price_change_percentage_24h: i % 3 === 0 ? -1.5 : 2.5,
      price_change_percentage_7d_in_currency: 3,
      price_change_percentage_30d_in_currency: 4,
      total_volume: 1_000_000 - i * 100,
      market_cap: 10_000_000_000 - i * 1_000_000,
      circulating_supply: 21_000_000 - i,
      sparkline_in_7d: { price: [1, 2, 3] },
    }));
    // Recognisable coins the search tests key on.
    rows[0] = { ...rows[0], id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' };
    rows[1] = { ...rows[1], id: 'ethereum', symbol: 'eth', name: 'Ethereum' };
    // A genuine ticker collision: two different coins reporting "BTC".
    rows[2] = { ...rows[2], id: 'wrapped-bitcoin-impostor', symbol: 'btc', name: 'Not Bitcoin' };
    // A row the provider reported with NO market figures at all. Must
    // survive as nulls, never as zeros.
    rows[3] = {
      ...rows[3],
      id: 'thin-coin',
      symbol: 'thin',
      name: 'Thin Coin',
      current_price: null,
      market_cap: null,
      total_volume: null,
      price_change_percentage_24h: null,
      circulating_supply: null,
    } as any;
    // A genuinely ZERO-volume market. Must survive as 0, not as null.
    rows[4] = { ...rows[4], id: 'quiet-coin', symbol: 'quiet', name: 'Quiet Coin', total_volume: 0 } as any;
    return rows;
  }

  /** Only a handful of the catalogue is actually tradable on VOLTEX. */
  const TRADABLE_PAIRS = ['BTC/USDT', 'BTC/USD', 'ETH/USDT', 'SY10/USDT', 'SY11/USDT', 'VENUEONLY/USDT'];

  function symbols(pairs: string[]): MarketSymbol[] {
    return pairs.map((pair) => {
      const [baseAsset, quoteAsset] = pair.split('/');
      return { pair, baseAsset, quoteAsset };
    });
  }

  /** A CoinGecko service backed by a counting mock fetch. */
  function coinGeckoWith(count: number) {
    const rows = marketRows(count);
    const fetchFn = jest.fn((url: string) => {
      if (url.includes('&category=')) return Promise.resolve(jsonResponse([]));
      const page = Number(new URL(url, 'https://x').searchParams.get('page') ?? '1');
      const perPage = Number(new URL(url, 'https://x').searchParams.get('per_page') ?? '250');
      return Promise.resolve(jsonResponse(rows.slice((page - 1) * perPage, page * perPage)));
    });
    return { service: new CoinGeckoService('https://cg.test', fetchFn as unknown as typeof fetch, undefined, NO_RETRY), fetchFn };
  }

  function registryWith(count: number, pairs = TRADABLE_PAIRS) {
    const { service, fetchFn } = coinGeckoWith(count);
    const listSymbols = jest.fn().mockResolvedValue(symbols(pairs));
    const registry = new AssetRegistry(service, { listSymbols });
    return { registry, fetchFn, listSymbols };
  }

  // ── Scale ────────────────────────────────────────────────────────────

  it('holds 500+ canonical assets without dropping any', async () => {
    const { registry } = registryWith(CATALOGUE_SIZE);
    const { value } = await registry.getCatalogue();

    // 517 CoinGecko coins minus the one lost to the BTC ticker collision
    // (recorded, not silently dropped — asserted below), plus the
    // venue-only asset Kraken lists that the catalogue does not cover.
    expect(value.total).toBeGreaterThanOrEqual(500);
    expect(value.total).toBe(CATALOGUE_SIZE - 1 + 1);
    expect(value.metadataComplete).toBe(true);
  });

  it('never loses a coin to a ticker collision', async () => {
    const { registry } = registryWith(CATALOGUE_SIZE);
    const { value } = await registry.getCatalogue();

    const btc = value.assets.find((a) => a.symbol === 'BTC')!;
    expect(btc.id).toBe('cg:bitcoin');
    expect(btc.ambiguous).toBe(true);
    // The loser is addressable rather than gone.
    expect(btc.collidingIds).toContain('cg:wrapped-bitcoin-impostor');
  });

  it('gives every one of the 500+ assets a namespaced canonical id', async () => {
    const { registry } = registryWith(CATALOGUE_SIZE);
    const { value } = await registry.getCatalogue();

    expect(value.assets.every((a) => a.id.includes(':'))).toBe(true);
    // Ids are unique even where symbols are not.
    expect(new Set(value.assets.map((a) => a.id)).size).toBe(value.assets.length);
  });

  // ── Catalogue vs tradable ───────────────────────────────────────────

  it('keeps the tradable set tiny while the catalogue is large', async () => {
    const { registry } = registryWith(CATALOGUE_SIZE);
    const { value } = await registry.getCatalogue();

    // The headline guarantee of the whole feature.
    expect(value.total).toBeGreaterThan(500);
    expect(value.tradableCount).toBe(5); // BTC, ETH, SY10, SY11, VENUEONLY
    expect(value.tradableCount).toBeLessThan(value.total / 50);
  });

  it('creates no trading pair that the venue did not list', async () => {
    const { registry } = registryWith(CATALOGUE_SIZE);
    const { value } = await registry.getCatalogue();

    const listed = new Set(TRADABLE_PAIRS);
    for (const asset of value.assets) {
      for (const pair of asset.tradingPairs) {
        expect(listed.has(pair)).toBe(true);
      }
      // A non-tradable asset has NO pairs and NO kraken mapping — nothing
      // a UI could turn into an order.
      if (!asset.tradable) {
        expect(asset.tradingPairs).toEqual([]);
        expect(asset.providers.kraken).toBeUndefined();
      }
    }
  });

  it('picks a default trading pair by documented quote priority, never by assuming USDT', async () => {
    // BTC lists against both USDT and USD here.
    expect(defaultTradingPair(['BTC/USD', 'BTC/USDT'])).toBe('BTC/USDT');
    expect(defaultTradingPair(['BTC/EUR', 'BTC/USD'])).toBe('BTC/USD');
    // An asset listed ONLY against a non-priority quote still resolves to a
    // real pair rather than a fabricated "/USDT" one.
    expect(defaultTradingPair(['XYZ/GBP'])).toBe('XYZ/GBP');
    // And an untradable asset resolves to nothing at all.
    expect(defaultTradingPair([])).toBeNull();
  });

  // ── Real zero vs unavailable ────────────────────────────────────────

  it('keeps a REAL zero as zero and a MISSING figure as null', async () => {
    const { registry } = registryWith(CATALOGUE_SIZE);
    const { value } = await registry.getCatalogue();

    const quiet = value.assets.find((a) => a.symbol === 'QUIET')!;
    expect(quiet.market!.volume24hUsd).toBe(0);

    const thin = value.assets.find((a) => a.symbol === 'THIN')!;
    expect(thin.market!.priceUsd).toBeNull();
    expect(thin.market!.marketCapUsd).toBeNull();
    expect(thin.market!.volume24hUsd).toBeNull();
    expect(thin.market!.changePercent24h).toBeNull();
  });

  it('gives a venue-only asset null market figures rather than zeros', async () => {
    const { registry } = registryWith(CATALOGUE_SIZE);
    const { value } = await registry.getCatalogue();

    const venueOnly = value.assets.find((a) => a.symbol === 'VENUEONLY')!;
    expect(venueOnly.tradable).toBe(true);
    expect(venueOnly.market).toBeNull();
    expect(venueOnly.logoUrl).toBeNull();
  });

  // ── Search / sort / paginate ────────────────────────────────────────

  it('searches by symbol and by name', async () => {
    const { registry } = registryWith(CATALOGUE_SIZE);

    const bySymbol = await registry.query({ search: 'btc' });
    expect(bySymbol.value.assets.some((a) => a.id === 'cg:bitcoin')).toBe(true);

    const byName = await registry.query({ search: 'Bitcoin' });
    expect(byName.value.assets.some((a) => a.id === 'cg:bitcoin')).toBe(true);

    const eth = await registry.query({ search: 'ethereum' });
    expect(eth.value.assets[0].symbol).toBe('ETH');
  });

  it('reports both the filtered count and the catalogue total', async () => {
    const { registry } = registryWith(CATALOGUE_SIZE);
    const result = await registry.query({ search: 'Bitcoin' });

    expect(result.value.matched).toBeLessThan(10);
    // So a UI can say "N of 517" rather than implying the catalogue shrank.
    expect(result.value.catalogueTotal).toBe(CATALOGUE_SIZE);
  });

  it('paginates deterministically with no overlap and no gaps', async () => {
    const { registry } = registryWith(CATALOGUE_SIZE);

    const seen: string[] = [];
    for (let offset = 0; offset < CATALOGUE_SIZE; offset += 100) {
      const page = await registry.query({ limit: 100, offset });
      seen.push(...page.value.assets.map((a) => a.id));
    }

    expect(seen.length).toBe(CATALOGUE_SIZE);
    expect(new Set(seen).size).toBe(CATALOGUE_SIZE);
  });

  it('sorts by market cap, volume, price, change, symbol and name', async () => {
    const { registry } = registryWith(CATALOGUE_SIZE);

    const byCap = await registry.query({ sort: 'marketCap', direction: 'desc', limit: 5 });
    const caps = byCap.value.assets.map((a) => a.market?.marketCapUsd ?? -Infinity);
    expect([...caps].sort((a, b) => b - a)).toEqual(caps);

    const byVolume = await registry.query({ sort: 'volume24h', direction: 'asc', limit: 5 });
    const vols = byVolume.value.assets.map((a) => a.market?.volume24hUsd);
    // The genuine 0 sorts FIRST ascending; the nulls do not displace it.
    expect(vols[0]).toBe(0);

    const bySymbol = await registry.query({ sort: 'symbol', direction: 'asc', limit: 3 });
    const syms = bySymbol.value.assets.map((a) => a.symbol);
    expect([...syms].sort()).toEqual(syms);
  });

  it('sorts missing values LAST in both directions, never as zero', async () => {
    const { registry } = registryWith(CATALOGUE_SIZE);

    for (const direction of ['asc', 'desc'] as const) {
      // The whole catalogue in one page — the rows carrying nulls sort to
      // the very end, where a truncated page would hide them.
      const page = await registry.query({ sort: 'marketCap', direction, limit: 1000 });
      const caps = page.value.assets.map((a) => a.market?.marketCapUsd ?? null);

      const firstNull = caps.findIndex((v) => v === null);
      const lastReal = caps.reduce<number>((last, v, i) => (v !== null ? i : last), -1);

      // Both kinds are present, so the ordering claim is meaningful.
      expect(firstNull).toBeGreaterThan(-1);
      expect(lastReal).toBeGreaterThan(-1);
      // Every null sits after every real figure. Treating null as 0 would
      // float unpriced assets to the top of an ascending sort.
      expect(firstNull).toBeGreaterThan(lastReal);
    }
  });

  it('defaults to a rank-oriented, best-first ordering', async () => {
    const { registry } = registryWith(CATALOGUE_SIZE);
    const page = await registry.query({ limit: 5 });
    const ranks = page.value.assets.map((a) => a.rank);

    // Best rank first, ascending. Rank 3 is absent because that fixture row
    // is the BTC ticket collision — recorded on Bitcoin's entry rather than
    // occupying a row of its own.
    expect(ranks).toEqual([1, 2, 4, 5, 6]);
    expect([...ranks].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(ranks);
  });

  it('filters to tradable assets without shrinking the reported catalogue', async () => {
    const { registry } = registryWith(CATALOGUE_SIZE);
    const page = await registry.query({ tradableOnly: true, limit: 500 });

    expect(page.value.assets.every((a) => a.tradable)).toBe(true);
    expect(page.value.matched).toBe(5);
    expect(page.value.catalogueTotal).toBe(CATALOGUE_SIZE);
  });

  // ── Upstream request cost ───────────────────────────────────────────

  it('loads 500+ assets in a BOUNDED number of upstream calls, not one per asset', async () => {
    const { registry, fetchFn, listSymbols } = registryWith(CATALOGUE_SIZE);

    await registry.getCatalogue();

    const urls = fetchFn.mock.calls.map((c) => String(c[0]));
    const marketPages = urls.filter((u) => !u.includes('&category=')).length;
    const categoryCalls = urls.filter((u) => u.includes('&category=')).length;

    // TOP_N / 250 = 3 paged requests. The decisive claim: the count is a
    // function of PAGE SIZE, not of asset count — 517 assets, 3 requests.
    expect(marketPages).toBe(3);
    // Seven categories, one call each — on their own 6-hour cache.
    expect(categoryCalls).toBe(7);
    expect(fetchFn).toHaveBeenCalledTimes(10);
    expect(listSymbols).toHaveBeenCalledTimes(1);
    // Emphatically not O(assets).
    expect(fetchFn.mock.calls.length).toBeLessThan(CATALOGUE_SIZE / 50);
  });

  it('collapses 100 concurrent catalogue consumers into ONE cold load', async () => {
    const { registry, fetchFn, listSymbols } = registryWith(CATALOGUE_SIZE);

    const results = await Promise.all(Array.from({ length: 100 }, () => registry.getCatalogue()));

    expect(results).toHaveLength(100);
    expect(results.every((r) => r.value.total > 500)).toBe(true);
    // 100 consumers, still 10 upstream calls.
    expect(fetchFn).toHaveBeenCalledTimes(10);
    expect(listSymbols).toHaveBeenCalledTimes(1);
  });

  it('serves 100 concurrent SEARCHES with no upstream traffic at all', async () => {
    const { registry, fetchFn } = registryWith(CATALOGUE_SIZE);
    await registry.getCatalogue();
    const afterWarm = fetchFn.mock.calls.length;

    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        registry.query({ search: `SY${i}`, sort: 'marketCap', limit: 50, offset: i })
      )
    );

    // Typing in a search box and paging a 500-row table costs ZERO
    // provider requests — it all runs over the cached join.
    expect(fetchFn.mock.calls.length).toBe(afterWarm);
  });

  it('does not re-walk the category endpoints when only the market snapshot expires', async () => {
    // The whole point of the differentiated TTLs: the cheap half can
    // refresh without paying for the expensive half.
    let now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const { service, fetchFn } = coinGeckoWith(CATALOGUE_SIZE);
      await service.getRankings();
      const categoriesFirst = fetchFn.mock.calls.filter((c) => String(c[0]).includes('&category=')).length;
      expect(categoriesFirst).toBe(7);

      // Past the 20-minute market TTL, inside the 6-hour category TTL.
      now += 21 * 60_000;
      await service.getRankings();

      const urls = fetchFn.mock.calls.map((c) => String(c[0]));
      expect(urls.filter((u) => !u.includes('&category=')).length).toBe(6); // 3 pages, twice
      expect(urls.filter((u) => u.includes('&category=')).length).toBe(7); // still 7
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }
  });

  // ── Degradation ─────────────────────────────────────────────────────

  it('serves a venue-only catalogue when CoinGecko is down, and never fabricates rows', async () => {
    const fetchFn = jest.fn(() => Promise.resolve(jsonResponse({}, false, 503)));
    const service = new CoinGeckoService('https://cg.test', fetchFn as unknown as typeof fetch, undefined, NO_RETRY);
    const listSymbols = jest.fn().mockResolvedValue(symbols(TRADABLE_PAIRS));
    const registry = new AssetRegistry(service, { listSymbols });

    const { value, source } = await registry.getCatalogue();

    expect(source).toBe('kraken');
    expect(value.metadataComplete).toBe(false);
    // Only what the venue really lists — five base assets, no invented
    // catalogue rows to fill the gap.
    expect(value.total).toBe(5);
    expect(value.assets.every((a) => a.market === null)).toBe(true);
  });

  // ── Gateway wiring ──────────────────────────────────────────────────

  it('exposes the catalogue through the gateway with provenance and freshness', async () => {
    const { service } = coinGeckoWith(CATALOGUE_SIZE);
    const krakenFetch = jest.fn(() => Promise.resolve(jsonResponse({ error: [], result: {} })));
    const kraken = new KrakenMarketDataService('https://kraken.test', krakenFetch as unknown as typeof fetch, NO_RETRY);
    const fearGreed = new FearGreedService('https://fng.test', jest.fn() as unknown as typeof fetch, NO_RETRY);
    const registry = new AssetRegistry(service, { listSymbols: jest.fn().mockResolvedValue(symbols(TRADABLE_PAIRS)) });
    const gateway = new MarketDataGateway(kraken, service, fearGreed, null, registry);

    const result = await gateway.queryAssets({ limit: 10 });

    expect(result.available).toBe(true);
    if (!result.available) throw new Error('unreachable');
    expect(result.source).toBe('coingecko');
    expect(typeof result.fetchedAt).toBe('number');
    expect(result.value.catalogueTotal).toBeGreaterThan(500);
    expect(result.value.assets).toHaveLength(10);
  });
});
