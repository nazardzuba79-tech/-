import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { catalogueStore, filterAndSortAssets, defaultTradingPair, QUOTE_PRIORITY } from '../catalogueStore';
import { api } from '../api';
import type { CanonicalAsset } from '../api';

/**
 * Crypto Catalogue 500+ — the client half.
 *
 * The backend half (500+ assets held, a BOUNDED number of upstream calls,
 * collisions preserved, no fabricated pairs) is proven in
 * src/services/marketData/__tests__/CatalogueScale.test.ts. What can only
 * be proven here is that the browser does not undo it:
 *
 *   1. ONE request loads the whole catalogue, shared by every subscriber.
 *      Search, sort, filter and paging cost ZERO further requests — a
 *      keystroke must never reach a provider.
 *   2. The catalogue and the tradable set stay separate on screen. A Trade
 *      action exists only where a REAL VOLTEX market does; a data-only
 *      asset gets no pair, no matter how plausible "XYZ/USDT" would look.
 *   3. Nothing turns a missing figure into a zero — in the cells or in the
 *      sort comparators, where a null treated as 0 would float unpriced
 *      assets to the top of an ascending sort.
 *   4. The Spot and Futures pair lists are untouched. The catalogue is
 *      reference data; it must not have grown the executable instrument
 *      list to 500 entries.
 */

jest.mock('../api', () => ({
  api: { getAssetCatalogue: jest.fn() },
}));

const getAssetCatalogue = api.getAssetCatalogue as jest.Mock;

const frontend = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8').replace(/\r\n/g, '\n');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Source with comments stripped: the absence checks below are claims
 *  about executable code, and these files' doc comments deliberately name
 *  the things they leave out. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// ── Fixtures ────────────────────────────────────────────────────────────

function asset(over: Partial<CanonicalAsset> = {}): CanonicalAsset {
  return {
    id: 'cg:bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    logoUrl: 'btc.png',
    providers: { coingecko: 'bitcoin' },
    tradingPairs: ['BTC/USDT'],
    tradable: true,
    metadataSource: 'coingecko',
    rank: 1,
    ambiguous: false,
    collidingIds: [],
    market: { priceUsd: 50_000, changePercent24h: 2.5, marketCapUsd: 1e12, volume24hUsd: 3e10, circulatingSupply: 19e6 },
    ...over,
  } as CanonicalAsset;
}

/** A catalogue large enough that the "one request for everything" claim is
 *  not an accident of a two-row fixture. */
const CATALOGUE: CanonicalAsset[] = [
  asset(),
  asset({ id: 'cg:ethereum', symbol: 'ETH', name: 'Ethereum', rank: 2, tradingPairs: ['ETH/BTC', 'ETH/USDT', 'ETH/USD'],
          market: { priceUsd: 3_000, changePercent24h: -1.2, marketCapUsd: 4e11, volume24hUsd: 1e10, circulatingSupply: 120e6 } }),
  // Data-only: a real, ranked asset VOLTEX does not list. No pairs at all.
  asset({ id: 'cg:monero', symbol: 'XMR', name: 'Monero', rank: 3, tradable: false, tradingPairs: [],
          market: { priceUsd: 160, changePercent24h: 0.4, marketCapUsd: 3e9, volume24hUsd: 8e7, circulatingSupply: 18e6 } }),
  // Thin coin: the provider reported NOTHING. Not zeroes — nothing.
  asset({ id: 'cg:thin-coin', symbol: 'THIN', name: 'Thin Coin', rank: null, tradable: false, tradingPairs: [], market: null }),
  // Quiet coin: a REAL zero. Genuinely no volume in 24h, and that is a fact.
  asset({ id: 'cg:quiet-coin', symbol: 'QUIET', name: 'Quiet Coin', rank: 400, tradable: false, tradingPairs: [],
          market: { priceUsd: 0.5, changePercent24h: 0, marketCapUsd: 1e6, volume24hUsd: 0, circulatingSupply: 2e6 } }),
  ...Array.from({ length: 512 }, (_, i) =>
    asset({
      id: `cg:filler-${i}`,
      symbol: `F${i}`,
      name: `Filler ${i}`,
      rank: 10 + i,
      tradable: false,
      tradingPairs: [],
      market: { priceUsd: i + 1, changePercent24h: i % 7, marketCapUsd: 1e9 - i, volume24hUsd: 1e6 + i, circulatingSupply: null },
    })
  ),
];

function response(over: Record<string, unknown> = {}) {
  return {
    available: true,
    source: 'coingecko',
    fetchedAt: 1_700_000_000_000,
    stale: false,
    value: {
      assets: CATALOGUE,
      matched: CATALOGUE.length,
      catalogueTotal: CATALOGUE.length,
      tradableCount: CATALOGUE.filter((a) => a.tradable).length,
      collisions: [],
      metadataComplete: true,
      limit: 1000,
      offset: 0,
    },
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  catalogueStore._resetForTests();
  getAssetCatalogue.mockResolvedValue(response());
});

afterEach(() => {
  catalogueStore._resetForTests();
});

// ── One request, shared ─────────────────────────────────────────────────

describe('catalogue load', () => {
  it('loads the whole catalogue with ONE request for the whole tab', async () => {
    const seen: any[] = [];
    const off = [catalogueStore.subscribe((s) => seen.push(s)), catalogueStore.subscribe(() => {}), catalogueStore.subscribe(() => {})];
    await catalogueStore.refresh();

    expect(getAssetCatalogue).toHaveBeenCalledTimes(1);
    expect(catalogueStore._timerCount).toBe(1);
    expect(catalogueStore.getState().assets.length).toBeGreaterThanOrEqual(500);
    off.forEach((fn) => fn());
  });

  it('asks for the catalogue WITHOUT a search or sort — the query is client-side', async () => {
    const off = catalogueStore.subscribe(() => {});
    await catalogueStore.refresh();

    const options = getAssetCatalogue.mock.calls[0][0];
    expect(options.search).toBeUndefined();
    expect(options.sort).toBeUndefined();
    expect(options.limit).toBeGreaterThanOrEqual(1000);
    off();
  });

  it('coalesces concurrent consumers into a single in-flight request', async () => {
    const off = catalogueStore.subscribe(() => {});
    await Promise.all(Array.from({ length: 100 }, () => catalogueStore.refresh()));

    // 100 consumers, one request. The store's own subscribe fired the
    // first; every concurrent caller joined it.
    expect(getAssetCatalogue).toHaveBeenCalledTimes(1);
    off();
  });

  it('serves a late subscriber from memory with no new request', async () => {
    const off = catalogueStore.subscribe(() => {});
    await catalogueStore.refresh();
    expect(getAssetCatalogue).toHaveBeenCalledTimes(1);

    let delivered: unknown = null;
    const off2 = catalogueStore.subscribe((s) => { delivered = s; });
    expect(getAssetCatalogue).toHaveBeenCalledTimes(1);
    expect((delivered as any).assets.length).toBeGreaterThanOrEqual(500);
    off(); off2();
  });

  it('stops its timer when the last subscriber leaves', async () => {
    const off = catalogueStore.subscribe(() => {});
    await catalogueStore.refresh();
    expect(catalogueStore._timerCount).toBe(1);
    off();
    expect(catalogueStore._timerCount).toBe(0);
    expect(catalogueStore._subscriberCount).toBe(0);
  });

  it('keeps the last good catalogue on screen when a refresh fails', async () => {
    const off = catalogueStore.subscribe(() => {});
    await catalogueStore.refresh();
    const loaded = catalogueStore.getState().assets.length;

    getAssetCatalogue.mockRejectedValueOnce(new Error('network'));
    await catalogueStore.refresh();

    expect(catalogueStore.getState().status).toBe('error');
    // Not blanked, and above all not zero rows presented as the catalogue.
    expect(catalogueStore.getState().assets.length).toBe(loaded);
    off();
  });

  it('reports an unavailable catalogue as unavailable, not as an empty exchange', async () => {
    catalogueStore._resetForTests();
    getAssetCatalogue.mockResolvedValue({ available: false, reason: 'provider_unavailable', detail: 'coingecko down' });
    const off = catalogueStore.subscribe(() => {});
    await catalogueStore.refresh();

    const state = catalogueStore.getState();
    expect(state.status).toBe('unavailable');
    expect(state.reason).toBe('provider_unavailable');
    expect(state.catalogueTotal).toBe(0);
    off();
  });
});

// ── Search, sort, filter: all free ──────────────────────────────────────

describe('client-side query', () => {
  it('does not issue a request per keystroke', async () => {
    const off = catalogueStore.subscribe(() => {});
    await catalogueStore.refresh();
    getAssetCatalogue.mockClear();

    const assets = catalogueStore.getState().assets;
    for (const needle of ['b', 'bi', 'bit', 'bitc', 'bitco', 'bitcoi', 'bitcoin']) {
      filterAndSortAssets(assets, { search: needle });
    }
    // Seven keystrokes, zero requests.
    expect(getAssetCatalogue).not.toHaveBeenCalled();
  });

  it('searches by ticker AND by name', () => {
    expect(filterAndSortAssets(CATALOGUE, { search: 'btc' }).map((a) => a.symbol)).toContain('BTC');
    expect(filterAndSortAssets(CATALOGUE, { search: 'bitcoin' }).map((a) => a.symbol)).toContain('BTC');
    expect(filterAndSortAssets(CATALOGUE, { search: 'monero' }).map((a) => a.symbol)).toEqual(['XMR']);
  });

  it('filters to the VOLTEX-tradable subset without shrinking the catalogue', () => {
    const tradable = filterAndSortAssets(CATALOGUE, { tradableOnly: true });
    expect(tradable.every((a) => a.tradable)).toBe(true);
    expect(tradable).toHaveLength(2);
    // The catalogue itself is untouched — 500+ assets are still known.
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(500);
  });

  it('matches favourites by PAIR, the key the rest of the app stores', () => {
    // The spot terminal starred ETH/USDT. The catalogue must recognise it.
    const favorites = new Set(['ETH/USDT']);
    const starred = filterAndSortAssets(CATALOGUE, { favoritesOnly: true, favorites });
    expect(starred.map((a) => a.symbol)).toEqual(['ETH']);

    // A data-only asset has no market to have starred, so it never matches.
    expect(filterAndSortAssets(CATALOGUE, { favoritesOnly: true, favorites: new Set(['XMR']) })).toHaveLength(0);
  });

  it('sorts every column deterministically in both directions', () => {
    for (const sort of ['rank', 'marketCap', 'volume24h', 'price', 'change24h', 'symbol', 'name'] as const) {
      for (const direction of ['asc', 'desc'] as const) {
        const a = filterAndSortAssets(CATALOGUE, { sort, direction }).map((x) => x.id);
        const b = filterAndSortAssets([...CATALOGUE].reverse(), { sort, direction }).map((x) => x.id);
        // Same input set, same order — no dependence on arrival order.
        expect(a).toEqual(b);
        expect(a).toHaveLength(CATALOGUE.length);
      }
    }
  });

  it('sorts MISSING values last in BOTH directions', () => {
    for (const direction of ['asc', 'desc'] as const) {
      const rows = filterAndSortAssets(CATALOGUE, { sort: 'marketCap', direction });
      const thin = rows.findIndex((a) => a.symbol === 'THIN');
      expect(thin).toBe(rows.length - 1);
    }
  });

  it('keeps a REAL zero ranked as a zero, not as missing data', () => {
    const rows = filterAndSortAssets(CATALOGUE, { sort: 'volume24h', direction: 'asc' });
    const quiet = rows.findIndex((a) => a.symbol === 'QUIET');
    const thin = rows.findIndex((a) => a.symbol === 'THIN');
    // A genuine 0 sorts FIRST ascending; an unknown sorts last. They are
    // different facts and the table treats them differently.
    expect(quiet).toBe(0);
    expect(thin).toBeGreaterThan(quiet);
  });

  it('defaults to a rank-oriented ordering with the biggest asset first', () => {
    const rows = filterAndSortAssets(CATALOGUE, {});
    expect(rows.slice(0, 3).map((a) => a.symbol)).toEqual(['BTC', 'ETH', 'XMR']);
  });

  it('pages over the sorted set without re-querying anything', () => {
    const rows = filterAndSortAssets(CATALOGUE, { sort: 'rank' });
    const page1 = rows.slice(0, 50);
    const page2 = rows.slice(50, 100);
    expect(page1).toHaveLength(50);
    expect(page2).toHaveLength(50);
    // Disjoint and contiguous — no row shown twice, none skipped.
    expect(new Set([...page1, ...page2].map((a) => a.id)).size).toBe(100);
    expect(rows.slice(0, 100)).toEqual([...page1, ...page2]);
  });
});

// ── Catalogue is not the tradable set ───────────────────────────────────

describe('tradable gate', () => {
  it('gives a data-only asset NO pair to trade', () => {
    const xmr = CATALOGUE.find((a) => a.symbol === 'XMR')!;
    expect(xmr.tradable).toBe(false);
    // Not "XMR/USDT" — that market does not exist here.
    expect(defaultTradingPair(xmr)).toBeNull();
  });

  it('resolves a real pair under the documented quote priority', () => {
    const eth = CATALOGUE.find((a) => a.symbol === 'ETH')!;
    // Listed as ETH/BTC, ETH/USDT, ETH/USD. USDT outranks the others.
    expect(defaultTradingPair(eth)).toBe('ETH/USDT');
    expect(QUOTE_PRIORITY[0]).toBe('USDT');
    // Chosen FROM the asset's real pairs, never assembled from its ticker.
    expect(eth.tradingPairs).toContain(defaultTradingPair(eth));
  });

  it('falls back to a listed pair rather than inventing a preferred one', () => {
    // Only an unranked quote is listed. The pair is still real.
    expect(defaultTradingPair({ tradingPairs: ['ABC/GBP'] })).toBe('ABC/GBP');
    expect(defaultTradingPair({ tradingPairs: [] })).toBeNull();
  });

  it('renders a Trade control only behind that gate', () => {
    const source = code('src/pages/markets-bolt/CatalogueTable.tsx');
    // The one place the action is decided, and it reads the real pair list.
    expect(source).toContain('asset.tradable ? defaultTradingPair(asset) : null');
    expect(source).toMatch(/pair \? \(/);
    // No ticker-to-pair string building anywhere in the table.
    expect(source).not.toMatch(/`\$\{[^}]*symbol[^}]*\}\/USDT`/);
    expect(source).not.toMatch(/symbol \+ ['"`]\/USDT/);
  });
});

// ── No per-row work ─────────────────────────────────────────────────────

describe('render cost', () => {
  it('makes no API call, timer or subscription per row', () => {
    const table = code('src/pages/markets-bolt/CatalogueTable.tsx');
    const row = table.slice(table.indexOf('function CatalogueRow'));

    expect(row).not.toContain('api.');
    expect(row).not.toContain('useEffect');
    expect(row).not.toContain('setInterval');
    expect(row).not.toContain('fetch(');
  });

  it('takes each row icon from the batched catalogue metadata', () => {
    const table = code('src/pages/markets-bolt/CatalogueTable.tsx');
    // The logo travels with the asset — one catalogue request already
    // carried it. CryptoIcon keeps its own letter fallback for a missing
    // one, which is why no per-row lookup is needed.
    expect(table).toContain('imageUrl={asset.logoUrl}');
  });

  it('draws no sparkline column — 500+ of them is not free', () => {
    const table = code('src/pages/markets-bolt/CatalogueTable.tsx');
    expect(table).not.toContain('sparkline');
    expect(table).not.toContain('getCandles');
    expect(read('src/lib/catalogueStore.ts')).not.toContain('sparkline7d');
  });

  it('mounts a page of rows, not the whole catalogue', () => {
    const table = code('src/pages/markets-bolt/CatalogueTable.tsx');
    expect(table).toMatch(/const PER_PAGE = \d+;/);
    expect(table).toContain('rows.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE)');
    const perPage = Number(/const PER_PAGE = (\d+);/.exec(table)![1]);
    expect(perPage).toBeLessThanOrEqual(100);
  });
});

// ── Nothing became a zero ───────────────────────────────────────────────

describe('honest emptiness', () => {
  it('returns null rather than a zero for every unformattable figure', () => {
    const table = code('src/pages/markets-bolt/CatalogueTable.tsx');
    for (const fn of ['function usd(', 'function price(', 'function changePct(']) {
      const start = table.indexOf(fn);
      expect(start).toBeGreaterThan(-1);
      const body = table.slice(start, table.indexOf('\n}', start));
      expect(body).toContain('return null');
      expect(body).toContain('Number.isFinite');
    }
  });

  it('never coerces a missing figure with ?? 0', () => {
    expect(code('src/pages/markets-bolt/CatalogueTable.tsx')).not.toMatch(/\?\?\s*0\b/);
    expect(code('src/lib/catalogueStore.ts')).not.toMatch(/\?\?\s*0[,;)\s]/);
  });

  it('renders a dash for a missing cell', () => {
    const table = code('src/pages/markets-bolt/CatalogueTable.tsx');
    expect(table).toMatch(/const DASH = ['"]—['"]/);
    expect(table).toContain('?? DASH');
  });
});

// ── The executable instrument lists are untouched ───────────────────────

describe('spot and futures pair lists are unchanged', () => {
  /**
   * The catalogue is REFERENCE data. Growing it to 500+ assets must not
   * have grown what VOLTEX will execute. These fingerprints are of the
   * modules that decide that, and they were taken from the files as this
   * task found them.
   */
  const UNCHANGED: Record<string, string> = {
    // The shared pair registry and favourites store.
    'src/lib/pairList.ts': '4f9ea3cda06e73142565f2743914fe7858efe8efa5c2cf155ab653b509131a79',
    // The spot terminal's pair list.
    'src/components/PairListSidebar.tsx': '5d222e312c537849459a662d24c79c4938c6de4f9e06dc517f90f41ee49907c2',
    // The futures pair list.
    'src/components/FuturesPairList.tsx': '4a6488a56e6ea49730e1db9d2f4f5578f2e5410c78d620614e72b23a92e28c12',
  };

  it('does not derive tradable pairs from catalogue entries', () => {
    const store = code('src/lib/catalogueStore.ts');
    const table = code('src/pages/markets-bolt/CatalogueTable.tsx');
    for (const source of [store, table]) {
      // Nothing here builds, appends to, or writes the pair registry.
      expect(source).not.toContain('CORE_FUTURES_SYMBOLS =');
      expect(source).not.toMatch(/tradingPairs\s*=\s*\[/);
      expect(source).not.toMatch(/tradingPairs\.push/);
    }
  });

  it('leaves the pair-list modules byte-identical', () => {
    for (const [file, sha256] of Object.entries(UNCHANGED)) {
      expect({ file, sha256: digest(read(file)) }).toEqual({ file, sha256 });
    }
  });
});
