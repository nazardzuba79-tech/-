// Integration baseline: fresh main ac2d583 + approved archive f1836a7 + Pro 0a76da5.
// Financial behavior is independently covered by nativeHistoricalCurrent, nativeLiveProjection,
// calculatorMath, nativeQuoteReadOnly and mounted Futures Pro/order/close-all tests.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import { readLocale } from '../../../test-utils/i18nSource';
import ts from 'typescript';
import * as numbers from '../formatNumber';
import * as changes from '../priceChange';
import * as futuresReference from '../futuresReference';

const root = resolve(__dirname, '../../../..');
const req = createRequire(resolve(root, 'frontend/package.json'));
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const source = read('frontend/src/components/FuturesTickerBar.tsx');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

// Baselines re-taken at the Market Data Gateway migration (see
// docs/MARKET_DATA_ARCHITECTURE.md). What changed in these three files is
// exactly one thing: the 24h REFERENCE spot figures (last/change/high/low/
// volume/turnover) now come from the shared market-data store instead of
// each component running its own poll.
//
// What did NOT change, and what the behavioural tests below still prove:
// mark price, the settled funding rate and this venue's own open interest
// are still read from the futures services, per symbol, exactly as before.
// No external venue's derivatives metric is read here, and the seven-block
// header hierarchy is untouched.
test('VOLTEX derivatives reads (mark, index, funding) stay on the futures services', () => {
  // The per-symbol VOLTEX loop, isolated from the separate external
  // market-stats effect beside it.
  const voltexLoop = source.slice(
    source.indexOf('  useEffect(() => {', source.indexOf('  const { t }')),
    source.indexOf('  }, [symbol]);')
  );
  // The VOLTEX financial reads are still here, still per symbol.
  expect(voltexLoop).toContain('api\n        .getFuturesMarkPrice(symbol)');
  expect(voltexLoop).toContain('.getFuturesFundingRate(symbol, 1)');
  // And no external venue's data may enter this loop or substitute for
  // one of its figures.
  expect(voltexLoop).not.toMatch(/binance|bybit|okx|deribit|bitget|MarketStats/i);
});
// Re-taken for Futures Real Derivatives Market Stats. The reads block
// changed in exactly two ways: a new effect reading the tracked external
// derivatives endpoint for the header's two MARKET-reference cells, and
// the removal of the internal `getFuturesOpenInterest` read, which now
// had no cell to render into. The VOLTEX reads this suite protects —
// mark price, index price and the settled funding rate — are byte-
// unchanged inside the per-symbol loop, as the behavioural test above
// re-proves against the loop in isolation.
// Re-taken again for the /futures/config dedup. The reads block changed in
// exactly one way, and it is asserted below rather than only hashed: the
// funding interval is read from the ONE shared store instead of this
// component's own `api.getFuturesConfig()` mount effect, because a cold
// /futures fetched that static endpoint three times over. The VOLTEX
// reads this suite exists to protect — mark price, index price and the
// settled funding rate — are byte-unchanged, as the behavioural tests
// above re-prove.
// Re-taken again for the instrument cluster's asset caption. The reads
// block changed in exactly one way, asserted by name below rather than only
// hashed: one display-metadata read for the name that sits under the pair,
// through the same batched store `CryptoIcon` already uses. It is not a
// financial read and adds no request — the store coalesces it with the
// icon's own ask. The VOLTEX reads this suite exists to protect — mark
// price, index price and the settled funding rate — are byte-unchanged,
// as the behavioural tests above re-prove.
// Exact perpetual display replaces spot references; financial reads remain protected above.
test('market-data reads use perpetual references and preserve financial inputs', () => {
  const reads = source.slice(source.indexOf('  const { t }'), source.indexOf('  return ('));
  // What the re-take is allowed to have changed, pinned so the digest
  // cannot be advanced again for something else without deleting these.
  expect(reads).toContain('useFuturesConfig().config?.fundingIntervalHours ?? null');
  expect(reads).not.toContain('getFuturesConfig');
  // The caption's read, pinned by name so this re-take is bounded to it.
  expect(reads).toContain("useAssetMetadata([baseAsset])[baseAsset.toUpperCase()]?.name ?? null");
  // And it must stay display-only: no price, size or money enters here.
  expect(reads).not.toMatch(/assetMetadata[^;]*(price|balance|position|margin)/i);
  // What it is not allowed to have changed.
  for (const read of ['getFuturesMarkPrice', 'getFuturesFundingRate']) {
    expect(reads).toContain(read);
  }
  // Previous digest, before the caption's read: 27318636…a152e.
  expect(hash(reads)).toBe('4282c42238bdc970045e119a94f31a9892ee27002cc3f7532403ebe047bbb765');
});
test('funding countdown implementation is unchanged', () => {
  expect(hash(source.slice(source.indexOf('const NextFundingCountdown'))))
    .toBe('304d4757ab9cc6874c85026ca77405d7074d066934ea856e5d6133756b5f5032');
});
test.each([
  // Admin console only: add overview/config response fields and remove unused
  // admin Product methods. Prefix before admin methods and support suffix are
  // byte-identical to main ab564ae; all Futures/Spot/request/auth code is intact.
  ['frontend/src/lib/api.ts', '3c53bdec366ac73a6db5a4df35a4ca235660915222a87b9431319d47dc838972'],
  ['src/api/routes/futures.ts', '3eff9ba113edc85e3b44dd88cb876cd88e09ce99412353ed85221bdadbd2bc19'],
  ['frontend/src/components/TickerBar.tsx', 'f0ec1548e89eb9abb5841a4196bd4ae1e4dbe8680f5a00645995029d71d26c27'],
  // api.ts re-taken for Analytics Live V1: purely ADDITIVE (+57/-0) —
  // getAnalyticsOverview and its response types. Every futures method,
  // including the index-price and internal open-interest reads this suite
  // protects, is byte-unchanged, and src/api/routes/futures.ts below is
  // still at its original fingerprint.
  //
  // Re-taken again for Analytics Phase 2 (+143/-1). The single deleted
  // line is getAnalyticsOverview gaining an optional `asset` parameter;
  // everything else is ADDITIVE external-derivatives and derived-metric
  // types for the Analytics page. `markPrice`/`indexPrice` appear in the
  // new VenueBasis shape, which describes an EXTERNAL venue's contract —
  // the futures index-price and internal open-interest methods this suite
  // protects are byte-unchanged, and src/api/routes/futures.ts below is
  // still at its original fingerprint.
  //
  // Re-taken again for Crypto Catalogue 500+ (+38/-2). The change is
  // confined to the catalogue types and getAssetCatalogue's query
  // parameters: AssetMarketSnapshot added, CanonicalAsset given `market`,
  // and AssetCatalogueResponse's `total` renamed to `matched` (it always
  // meant "rows passing the filter", and the catalogue view needs that
  // distinct from catalogueTotal). No futures, index-price, open-interest
  // or spot method is touched — the reads this suite protects are still
  // byte-identical, and src/api/routes/futures.ts below is still at its
  // original fingerprint.
  //
  // Re-taken again for Futures Real Derivatives Market Stats (+13/-0).
  // Purely ADDITIVE: the FuturesMarketStats response type and the
  // getFuturesMarketStats reader for GET /market/derivatives/:baseAsset.
  // getFuturesOpenInterest, getFuturesMarkPrice, getFuturesFundingRate
  // and every spot method are byte-unchanged — the internal open-interest
  // endpoint keeps its client, its route (still at the original
  // fingerprint below) and its Analytics consumer; only the HEADER
  // stopped using it for the MARKET figure.
  //
  // Re-taken again for the Futures account store (+35/-0). Purely
  // ADDITIVE apart from two lines: `setToken` and `clearToken` each gained
  // a `notifySessionChange()` call. The rest is the new `onSessionChange`
  // subscription used by lib/futuresAccountStore to drop authenticated
  // account state when the session changes — module-level caches outlive
  // the components that read them, because a logout here is a route change
  // rather than a reload.
  //
  // NOTHING about a request changed: not `request()`, not a URL, not a
  // header, not the Authorization token, not `handleUnauthorized`. Every
  // futures method this suite protects — getFuturesMarkPrice,
  // getFuturesOpenInterest, getFuturesFundingRate — and every spot method
  // is byte-unchanged, and src/api/routes/futures.ts below is still at its
  // original fingerprint.
  //
  // BOTH re-taken for real Futures TP/SL. api.ts is +46/-0 — not one line
  // removed or edited: two response interfaces, a `protection` field on the
  // getFuturesPositions response TYPE, and three readers/mutators for
  // GET/PUT/DELETE /futures/positions/:id/protection. futures.ts is +74/-1,
  // and the single removed line is `marketRegistry: FuturesMarketRegistry`
  // gaining a trailing comma because a sixth router parameter follows it.
  //
  // Advanced again by the TP/SL REVIEW FOLLOW-UP. api.ts is now +49/-0 —
  // still not one line removed or edited, the addition being a `revision`
  // compare-and-swap token on the protection trigger type. futures.ts is
  // +96/-2: the second deletion is `import { Router } from 'express'`
  // gaining `Response` for the shared protection error mapper, alongside
  // the trailing comma already noted above. The follow-up adds the 409
  // PROTECTION_TRIGGERING / 503 MARK_PRICE_UNAVAILABLE contract and nothing
  // else touching this suite's subject.
  //
  // Re-taken again for the simulation-only guard. futures.ts gains exactly
  // two things: an import of `isSimulationOnlyUser`, and a module-scope
  // `refuseSimulationOnly(req,res)` called as the FIRST line of the six
  // routes that can move money or rest liquidity — POST /futures/orders,
  // DELETE /futures/orders/:orderId, POST .../close, PUT and DELETE
  // .../protection, POST /futures/transfer. It returns 403 for the pinned
  // private-trading owner and false for everyone else, so no other user's
  // path changes by a single branch.
  //
  // It is a WRITE guard. Not one read this suite protects is inside it, and
  // the routes below are untouched.
  //
  // Every read this suite exists to protect is untouched in both files:
  // getFuturesMarkPrice / GET /futures/mark-price/:symbol,
  // getFuturesOpenInterest / GET /futures/open-interest/:symbol,
  // getFuturesFundingRate / GET /futures/funding-rate/:symbol, the order
  // book route, `request()`, the Authorization header, `handleUnauthorized`
  // and every spot method. The protection routes are new paths under
  // /futures/positions and reach none of them.
])('%s remains intact (index API, internal OI, Spot)', (path, expected) => {
  // TickerBar's pair-selector chevron stopped being a "\u25bc" glyph that CSS
  // hid with `font-size:0`. On an inline <span> the width and height in that
  // rule did not apply, so its two rotated borders drew a stray pale stroke
  // beside the pair name — the artifact this header work was asked to
  // remove. It is now drawn once, for every terminal, in
  // TerminalPresentationPolish.css. Restoring the old element here keeps
  // this fingerprint covering the BEHAVIOUR it exists for: any other change
  // to this file, including anything that touches a read or a handler,
  // still trips it.
  const normalized = path === 'frontend/src/components/TickerBar.tsx'
    ? read(path).replace('<span className="pair-arrow" aria-hidden="true" />', '<span className="pair-arrow">\u25bc</span>')
    : read(path);
  // Only the CFD read-response TYPE changes: nullable price + quote metadata.
  // Restore that exact line for this fingerprint of all existing API behavior.
  const source = path === 'frontend/src/lib/api.ts' ? read(path).replace(
    "tickers: import('../components/CfdInstrumentList').CfdTickerRow[];",
    'tickers: { symbol: string; name: string; price: string; changePercent24h: string }[];'
  ).replace("  getFuturesUniverse: () =>\n    request<import('./futuresDiscovery').FuturesUniverse>('/market/universe?type=linear_perpetual'),\n\n", '') : normalized;
  expect(hash(source)).toBe(expected);
});

function mount(overrides: Record<string, any> = {}, countdown = false) {
  let cursor = 0;
  const hooks: any[] = [], effects: (() => void)[] = [];
  // The 24h reference figures moved from this component's own
  // getExternalTicker call to the shared market-data store; the FIXTURE
  // VALUES ARE IDENTICAL, so every rendered-output assertion below still
  // asserts exactly what it did before.
  // `__ticker` lets a case vary the quote without touching any other
  // fixture; every existing assertion still runs against the values above.
  const referenceTicker = {
    lastPrice: '72345.67', changePercent24h: '2.34', high24h: '73000', low24h: '70000',
    volume24h: '123456', quoteVolume24h: '987654321',
    ...(overrides.__ticker ?? {}),
  };
  // Tracked EXTERNAL derivatives statistics — the header's two
  // market-reference figures. `getFuturesOpenInterest` is deliberately
  // absent: this component no longer reads VOLTEX's own open interest,
  // because the cell asks about the market, not this venue's book.
  const marketStats = {
    available: true, source: 'binance', fetchedAt: 0, stale: false,
    value: {
      baseAsset: 'BTC',
      turnover24hUsd: 987654321, turnoverVenues: ['binance', 'okx'],
      openInterestBase: 1.23456789, openInterestUsd: null,
      openInterestBaseVenues: ['binance'], openInterestUsdVenues: [],
    },
  };
  const api = {
    getFuturesConfig: jest.fn(async () => ({ fundingIntervalHours: 8 })),
    getFuturesMarkPrice: jest.fn(async () => ({ markPrice: '72340.12', indexPrice: '71999.88' })),
    getFuturesFundingRate: jest.fn(async () => ({ history: [{ rate: '0.00003' }] })),
    getFuturesMarketStats: jest.fn(async () => marketStats),
    ...overrides,
  };

  /**
   * The header reads `/futures/config` through the one shared store now
   * rather than its own mount effect (see lib/futuresConfigStore). The stub
   * resolves the SAME `getFuturesConfig` this harness already defines — and
   * still honours an override — so the funding interval driving the
   * countdown below is exactly the one this test supplies.
   */
  let sharedFuturesConfig: any = null;
  void Promise.resolve(api.getFuturesConfig()).then((c: any) => { sharedFuturesConfig = c; }).catch(() => {});
  const futuresConfigModule = {
    useFuturesConfig: () => ({
      config: sharedFuturesConfig,
      loading: sharedFuturesConfig === null,
      failed: false,
      loaded: sharedFuturesConfig !== null,
    }),
  };
  const react = { ...req('react'), memo: (fn: any) => fn,
    useState(initial: any) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], (value: any) => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }];
    },
    useEffect(fn: any, deps: any[]) {
      const i = cursor++, previous = hooks[i];
      if (!previous || deps.some((v, n) => !Object.is(v, previous.deps[n]))) {
        hooks[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); hooks[i].cleanup = fn(); });
      }
    },
  };
  const output: any = {};
  const compiled = ts.transpileModule(source + '\nexport { NextFundingCountdown };', {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', compiled)((name: string) => {
    if (name === './FuturesTurnover') {
      const child: any = {};
      const childCode = ts.transpileModule(readFileSync(resolve(root, 'frontend/src/components/FuturesTurnover.tsx'), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      new Function('require','exports','window',childCode)((dependency: string) => {
        if (dependency === 'react') return react;
        if (dependency.endsWith('/useLiveMarket')) return { useLiveMarket: () => ({status:'disabled',rows:new Map(),revision:0}) };
        if (dependency.endsWith('/terminalPresentation')) return require('../terminalPresentation');
        if (dependency.endsWith('/formatNumber')) return numbers;
        return req(dependency);
      }, child, {setInterval,clearInterval});
      return child;
    }
    // The instrument artwork. Stubbed rather than evaluated: it resolves a
    // remote icon URL and falls back to a letter avatar, none of which this
    // suite is about — but it must render SOMETHING, so the header's cell
    // order and text assertions still see the real child count.
    if (name === './CryptoIcon') return { CryptoIcon: ({ symbol }: { symbol: string }) => react.createElement('img', { alt: symbol }) };
    if (name === 'react') return react;
    if (name === '../lib/api') return { api };
    if (name === '../lib/futuresConfigStore') return futuresConfigModule;
    if (name === '../lib/futuresReference') return futuresReference;
    if (name === '../lib/useFuturesReference') return { useFuturesReference: () => new Map(overrides.__noTicker ? [] : [
      ['BTC/USDT', Object.fromEntries(Object.entries(referenceTicker).map(([key, value]) => [key, key === 'pair' ? value : Number(value)]))],
    ]) };
    if (name === '../lib/useMarketData') {
      return {
        useMarketTicker: (_pair: string) => ({
          ticker: overrides.__noTicker ? null : referenceTicker,
          loading: false, error: false, stale: false,
        }),
      };
    }
    if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key }) };
    // Display metadata for the asset caption under the pair. `overrides`
    // can name the asset so a test can assert the caption; the default is
    // "the catalogue does not know this symbol", which is the state the
    // caption must survive by rendering nothing rather than a guess.
    if (name === '../lib/assetMetadataStore') return {
      useAssetMetadata: (symbols: string[]) => overrides.__assetName
        ? Object.fromEntries(symbols.map(s => [s.toUpperCase(),
          { id: `cg:${s.toLowerCase()}`, name: overrides.__assetName, logoUrl: null }]))
        : {},
    };
    if (name === '../lib/formatNumber') return numbers;
    if (name === '../lib/priceChange') return changes;
    return req(name);
  }, output);
  return { api, render(props: any = { symbol: 'BTC/USDT' }) {
    cursor = 0;
    const tree = output[countdown ? 'NextFundingCountdown' : 'FuturesTickerBar'](props);
    effects.splice(0).forEach(fn => fn());
    return tree;
  } };
}
function nodes(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
}
function text(tree: any): string {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree == null || typeof tree === 'boolean') return '';
  if (tree.type?.name === 'FuturesTurnover') return text(tree.type(tree.props));
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-08T03:22:43Z')); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('visible metrics follow price, market, derivatives order, with the mark as the only secondary price', async () => {
  // ONE SECONDARY REFERENCE PRICE, and this test changed to say so.
  //
  // It previously required the index beside the mark, on the reasoning that
  // a mark quoted without the index it is anchored to cannot be judged. In
  // practice the two agree to within a few ticks, so on the face of the
  // terminal they read as the same number printed twice — noise in the row
  // a trader scans most often. The mark is what a position is actually
  // marked against, so the mark is the figure that keeps the slot.
  //
  // PRESENTATION ONLY. `indexPrice` is still fetched and still held in the
  // component's state; /futures/mark-price returns both and MarkPriceService
  // still computes both. The byte-for-byte source guard over this file's
  // reads (see the derivatives-reads test above) is unchanged and still
  // passes, which is what proves the data path was not touched.
  //
  // Everything else this test guards is unchanged: seven cells, no venue is
  // named, base volume is still not shown, an unknown figure is still a
  // dash, and the funding countdown still carries its interval.
  const component = mount(); component.render(); await flush();
  const tree = component.render();
  const blocks = nodes(tree).filter(n => n.props.className?.split(' ').includes('ticker-item'));
  expect(blocks).toHaveLength(7);
  // Last price, then the mark as the NUMBER ALONE. The owner's terminal
  // pack drops the "Маркировочная цена:" prefix from the face of the
  // header: the figure directly under the last price is the mark, and the
  // label only repeated what its position says.
  expect(text(blocks[0])).toBe('72,345.6772,340.12');
  // Dropped from the VISIBLE text only. It still carries its label for
  // assistive tech and on hover, so the figure is not anonymous.
  const markCell = nodes(blocks[0]).find(n => n.props.className === 'futures-secondary-price');
  expect(markCell).toBeDefined();
  expect(nodes(markCell).find(n => n.props['aria-label'])?.props['aria-label']).toBe('futures.markPrice');
  expect(blocks.slice(1).map(b => text(nodes(b).find(n => n.props.className === 'label')))).toEqual([
    'futures.headerChange24h', 'futures.headerHigh24h', 'futures.headerLow24h',
    // The two market-reference cells name the unit they actually show —
    // the contract's quote currency for turnover — and nothing else. No
    // upstream venue is named anywhere in this header.
    'futures.headerTurnover24h (USDT)', 'futures.openInterest (BTC)', 'futures.headerFunding',
  ]);
  // AND THE INDEX IS NOT ANYWHERE IN THE HEADER — a stronger statement
  // than the one it replaces, because it forbids the figure coming back in
  // any cell rather than only describing where it used to sit.
  expect(nodes(tree).find(n => n.props['data-metric'] === 'index')).toBeUndefined();
  expect(text(tree)).not.toContain('71,999.88');
  expect(text(tree)).not.toContain('futures.indexPrice');
  // Base volume still does not render, and no upstream venue is named.
  expect(text(tree)).not.toMatch(/volume24h|123,456/);
  expect(text(tree)).toContain('987.65M');
  expect(text(blocks[6])).toContain('0.0030% / ');
  expect(nodes(blocks[6]).find(n => typeof n.type === 'function')?.props.intervalHours).toBe(8);
});
const oiStats = (value: Record<string, unknown>) =>
  jest.fn(async () => ({ available: true, source: 'binance', fetchedAt: 0, stale: false,
    value: { baseAsset: 'ETH', turnover24hUsd: null, turnoverVenues: [], ...value } }));

// The figure is whatever the market published, rendered in the unit it
// was published in — a real 0 stays 0, a tiny real size is not rounded
// away, and a notional is never printed under a base-currency label.
//
// Every expectation below is the COMPLETE text of the cell, so a venue
// name reappearing anywhere in it would fail these outright.
test.each([
  [{ openInterestBase: 0, openInterestUsd: 999999, openInterestBaseVenues: ['binance'], openInterestUsdVenues: ['binance'] },
    'futures.openInterest (ETH)0'],
  [{ openInterestBase: 1.23456789, openInterestUsd: 999999, openInterestBaseVenues: ['binance', 'okx'], openInterestUsdVenues: ['binance'] },
    'futures.openInterest (ETH)1.23456789'],
  [{ openInterestBase: 0.000000001, openInterestUsd: null, openInterestBaseVenues: ['okx'], openInterestUsdVenues: [] },
    'futures.openInterest (ETH)0.000000001'],
  // No venue reported base units — the cell falls back to the notional
  // AND relabels to the quote currency, so the unit on screen is the unit
  // of the number.
  [{ openInterestBase: null, openInterestUsd: 4_200_000_000, openInterestBaseVenues: [], openInterestUsdVenues: ['okx'] },
    'futures.openInterest (USDT)4.2B'],
])('open interest renders the market figure %#, in its own unit and with no venue named', async (value, expected) => {
  const component = mount({ getFuturesMarketStats: oiStats(value) });
  component.render({ symbol: 'ETH/USDT' }); await flush();
  const tree = component.render({ symbol: 'ETH/USDT' });
  const block = nodes(tree).find(n => n.props.className === 'ticker-item' && text(n).startsWith('futures.openInterest'));
  expect(text(block)).toBe(expected);
  expect(component.api.getFuturesMarketStats).toHaveBeenCalledWith('ETH');
});

test('unavailable data stays unavailable rather than becoming fake zero', async () => {
  const component = mount({
    getFuturesMarketStats: async () => ({ available: false, reason: 'provider_unavailable' }),
    getFuturesFundingRate: async () => ({ history: [] }),
  });
  component.render(); await flush();
  const tree = component.render();
  expect(text(tree)).toContain('futures.openInterest (USDT)—');
  expect(text(tree)).toContain('futures.headerTurnover24h (USDT)—');
  expect(text(tree)).toContain('futures.headerFunding— / ');
});

test('the header names no upstream venue, in any state', async () => {
  for (const overrides of [
    {},
    { getFuturesMarketStats: async () => ({ available: false, reason: 'provider_unavailable' }) },
    { getFuturesMarketStats: async () => { throw new Error('offline'); } },
  ]) {
    const component = mount(overrides);
    component.render(); await flush();
    expect(text(component.render())).not.toMatch(/binance|okx|kraken|coingecko|marketSource/i);
  }
});

test('a provider read that throws leaves the cells empty, never zeroed', async () => {
  const component = mount({ getFuturesMarketStats: async () => { throw new Error('offline'); } });
  component.render(); await flush();
  const tree = component.render();
  expect(text(tree)).toContain('futures.openInterest (USDT)—');
  expect(text(tree)).toContain('futures.headerTurnover24h (USDT)—');
});
test('countdown uses actual clock, ticks and rolls over at the existing UTC boundary', () => {
  const component = mount({}, true);
  expect(text(component.render({ intervalHours: 8 }))).toBe('04:37:17');
  jest.advanceTimersByTime(1000);
  expect(text(component.render({ intervalHours: 8 }))).toBe('04:37:16');
  jest.setSystemTime(new Date('2026-09-08T07:59:59Z'));
  jest.advanceTimersByTime(1000);
  expect(text(component.render({ intervalHours: 8 }))).toBe('08:00:00');
});
test.each([null, 0, -1])('invalid funding interval %s has no invented countdown', intervalHours => {
  expect(text(mount({}, true).render({ intervalHours }))).toBe('—');
});
test('symbol selector keyboard behavior is preserved', () => {
  const onSelectSymbol = jest.fn(), preventDefault = jest.fn();
  const tree = mount().render({ symbol: 'BTC/USDT', onSelectSymbol });
  const selector = nodes(tree).find(n => n.props.className === 'pair-selector');
  selector.props.onKeyDown({ key: 'Enter', preventDefault });
  expect(onSelectSymbol).toHaveBeenCalledTimes(1);
  expect(preventDefault).toHaveBeenCalledTimes(1);
});
test('professional RU terminology is additive and does not reuse Spot volume labels', () => {
  // Russian is the eager locale and lives in its own file now.
  const dictionary = readLocale('ru');
  // «Ставка финансирования», not «Ставка / Отсчет до финансирования»: the
  // owner asked for the shorter label, and the countdown it used to name is
  // still rendered beside the rate — the slash was naming a second figure
  // the row already shows. What this guard exists to protect is that the
  // Futures header has its OWN derivatives terminology and does not fall
  // back on Spot's volume wording, which is unchanged.
  for (const label of ['Изменение за 24ч', 'Макс. за 24ч', 'Мин. за 24ч', 'Оборот за 24ч', 'Ставка финансирования', 'Маркировочная цена']) {
    expect(dictionary).toContain(label);
  }
  expect(source).not.toContain("t('trade.volume24h')");
});

/**
 * The 24h change cell shows the move in QUOTE currency AND the percent, as
 * the owner's terminal pack asks: `+387.10 (+0.87%)`, `-387.10 (-0.87%)`.
 *
 * The absolute figure is DERIVED, because the feed publishes a last price
 * and a percent but no previous close. The recovery is exact algebra —
 * `last * p / (100 + p)` — so it agrees with the percent printed beside it
 * by construction rather than by a second, independently fetched number
 * that could disagree with it.
 */
describe('24h change shows the quote move beside the percent', () => {
  // Found by what the cell IS rather than by where it sits: the strip
  // gained an index cell ahead of this one, and a test that knows the
  // change figure by its ordinal breaks every time a metric is added
  // without telling anyone anything true about the change figure.
  const changeCell = (tree: any) => nodes(tree)
    .filter(n => n.props.className?.split(' ').includes('ticker-item'))
    .map(cell => nodes(cell).find(n => n.props.className?.includes('change')))
    .find(Boolean);
  const changeText = (ticker?: Record<string, string>) => {
    const component = mount(ticker ? { __ticker: ticker } : {});
    return text(changeCell(component.render()));
  };

  it('prints the gain in quote currency and the percent, both signed', () => {
    // 72,345.67 at +2.34% opened at 72,345.67 / 1.0234, so the move is
    // 72,345.67 * 2.34 / 102.34 = 1,654.18 — not a rounded invention.
    expect(changeText()).toBe('+1,654.18 (+2.34%)');
  });

  it('prints a fall with one minus on each figure, never a bare percent', () => {
    expect(changeText({ lastPrice: '70000', changePercent24h: '-1.5' })).toBe('-1,065.99 (-1.50%)');
  });

  it('still prints the percent when the absolute move cannot be computed', () => {
    // A -100% move means the open was zero: the division is undefined, so
    // the quote figure is dropped rather than guessed, and the percent —
    // which IS published — still renders.
    expect(changeText({ lastPrice: '0', changePercent24h: '-100' })).toBe('(-100.00%)');
  });

  it('reports no change at all rather than a zero when there is no quote', () => {
    const component = mount({ __noTicker: true });
    expect(text(changeCell(component.render()))).toBe('—');
  });
});

/**
 * THE TOP-LEFT INSTRUMENT CLUSTER.
 *
 * The owner's reference builds this corner as one block: list button, a
 * large asset mark, and a two-line identity. Geometry is proven in a real
 * browser by `scripts/qa-futures-topbar-cluster.cjs`, which measures the
 * mark, the gaps inside the cluster against the gap to the first statistic,
 * and every part's optical centre. What is pinned HERE is the structure
 * those measurements depend on, and the honesty of the caption.
 */
describe('the instrument cluster is one node, and its caption is real', () => {
  it('holds the list button, the mark and the identity inside one container', () => {
    const body = source.slice(source.indexOf('  return ('));
    expect(body).toContain('className="pair-cluster"');
    // Order inside the cluster, as the reference has it.
    const cluster = body.slice(body.indexOf('className="pair-cluster"'));
    expect(cluster.indexOf('className="pair-markets-btn"'))
      .toBeLessThan(cluster.indexOf('className="pair-selector"'));
    expect(cluster.indexOf('className="pair-selector"'))
      .toBeLessThan(cluster.indexOf('<CryptoIcon'));
    expect(cluster.indexOf('<CryptoIcon'))
      .toBeLessThan(cluster.indexOf('className="pair-identity"'));
  });

  it('gives the mark the larger size the reference asks for', () => {
    expect(source).toContain('<CryptoIcon symbol={baseAsset} size={archive ? 24 : 28} />');
    expect(source).not.toContain('size={20}');
  });

  it('stacks the pair over the asset name, in that order', () => {
    const identity = source.slice(source.indexOf('className="pair-identity"'),
      source.indexOf('className="pair-arrow"'));
    expect(identity.indexOf('className="pair-name"')).toBeGreaterThan(-1);
    expect(identity.indexOf('className="pair-name"'))
      .toBeLessThan(identity.indexOf('className="pair-asset"'));
    expect(identity).toContain('{symbol}');
    expect(identity).toContain('assetName ?? baseAsset');
  });

  it('never invents a name: an unknown asset renders an empty caption', () => {
    // No fallback string, no base ticker standing in for a name, no dash
    // pretending to be one. `?? null` and nothing else.
    expect(source).toContain("?.name ?? null");
    expect(source).not.toMatch(/assetName\s*(\|\||\?\?)\s*['"`]/);
    // Unknown by default in this fixture, so this is the real render.
    const unknown = mount().render();
    const text = JSON.stringify(unknown);
    expect(text).toContain('pair-asset');
    expect(text).not.toContain('Bitcoin');
  });

  it('prints the catalogue name when the catalogue has one', () => {
    const named = mount({ __assetName: 'Bitcoin' }).render();
    expect(JSON.stringify(named)).toContain('Bitcoin');
  });
});
