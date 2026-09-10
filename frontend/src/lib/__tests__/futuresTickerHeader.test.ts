import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import { readLocale } from '../../../test-utils/i18nSource';
import ts from 'typescript';
import * as numbers from '../formatNumber';
import * as changes from '../priceChange';

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
test('market-data reads, including index price, are unchanged', () => {
  const reads = source.slice(source.indexOf('  const { t }'), source.indexOf('  return ('));
  // What the re-take is allowed to have changed, pinned so the digest
  // cannot be advanced again for something else without deleting these.
  expect(reads).toContain('useFuturesConfig().config?.fundingIntervalHours ?? null');
  expect(reads).not.toContain('getFuturesConfig');
  // What it is not allowed to have changed.
  for (const read of ['getFuturesMarkPrice', 'getFuturesFundingRate']) {
    expect(reads).toContain(read);
  }
  expect(hash(reads)).toBe('27318636dc7aaa60b1c29ff82bfaf892cbc2f2dbbeae15392b56c5d2592a152e');
});
test('funding countdown implementation is unchanged', () => {
  expect(hash(source.slice(source.indexOf('const NextFundingCountdown'))))
    .toBe('304d4757ab9cc6874c85026ca77405d7074d066934ea856e5d6133756b5f5032');
});
test.each([
  ['frontend/src/lib/api.ts', 'db231c6149eeddced615c050fcc3f86819fe40f259041cc21832bffe5831df3b'],
  ['src/api/routes/futures.ts', '57f05eb3cb0aad13eec2ef6658c93311cb179133f6907e9952f8b16560cfd831'],
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
  // Every read this suite exists to protect is untouched in both files:
  // getFuturesMarkPrice / GET /futures/mark-price/:symbol,
  // getFuturesOpenInterest / GET /futures/open-interest/:symbol,
  // getFuturesFundingRate / GET /futures/funding-rate/:symbol, the order
  // book route, `request()`, the Authorization header, `handleUnauthorized`
  // and every spot method. The protection routes are new paths under
  // /futures/positions and reach none of them.
])('%s remains intact (index API, internal OI, Spot)', (path, expected) => {
  expect(hash(read(path))).toBe(expected);
});

function mount(overrides: Record<string, any> = {}, countdown = false) {
  let cursor = 0;
  const hooks: any[] = [], effects: (() => void)[] = [];
  // The 24h reference figures moved from this component's own
  // getExternalTicker call to the shared market-data store; the FIXTURE
  // VALUES ARE IDENTICAL, so every rendered-output assertion below still
  // asserts exactly what it did before.
  const referenceTicker = {
    lastPrice: '72345.67', changePercent24h: '2.34', high24h: '73000', low24h: '70000',
    volume24h: '123456', quoteVolume24h: '987654321',
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
    if (name === 'react') return react;
    if (name === '../lib/api') return { api };
    if (name === '../lib/futuresConfigStore') return futuresConfigModule;
    if (name === '../lib/useMarketData') {
      return {
        useMarketTicker: (_pair: string) => ({
          ticker: overrides.__noTicker ? null : referenceTicker,
          loading: false, error: false, stale: false,
        }),
      };
    }
    if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key }) };
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
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-08T03:22:43Z')); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('visible metrics follow price, market, derivatives order without index or base volume', async () => {
  const component = mount(); component.render(); await flush();
  const tree = component.render();
  const blocks = nodes(tree).filter(n => n.props.className?.split(' ').includes('ticker-item'));
  expect(blocks).toHaveLength(7);
  expect(text(blocks[0])).toBe('72,345.67futures.markPrice: 72,340.12');
  expect(blocks.slice(1).map(b => text(nodes(b).find(n => n.props.className === 'label')))).toEqual([
    'futures.headerChange24h', 'futures.headerHigh24h', 'futures.headerLow24h',
    // The two market-reference cells name the unit they actually show —
    // the contract's quote currency for turnover — and nothing else. No
    // upstream venue is named anywhere in this header.
    'futures.headerTurnover24h (USDT)', 'futures.openInterest (BTC)', 'futures.headerFunding',
  ]);
  expect(text(tree)).not.toMatch(/indexPrice|71,999.88|volume24h|123,456/);
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
  for (const label of ['Изменение за 24ч', 'Макс. за 24ч', 'Мин. за 24ч', 'Оборот за 24ч', 'Ставка / Отсчет до финансирования', 'Маркировочная цена']) {
    expect(dictionary).toContain(label);
  }
  expect(source).not.toContain("t('trade.volume24h')");
});
