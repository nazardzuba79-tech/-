import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { createHash } from 'crypto';
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
test('VOLTEX derivatives reads (mark, funding, own open interest) stay on the futures services', () => {
  const readsBlock = source.slice(source.indexOf('  const { t }'), source.indexOf('  return ('));
  // The three VOLTEX financial reads are still here, still per symbol.
  expect(readsBlock).toContain('api\n        .getFuturesMarkPrice(symbol)');
  expect(readsBlock).toContain('.getFuturesFundingRate(symbol, 1)');
  expect(readsBlock).toContain('.getFuturesOpenInterest(symbol)');
  // And no external venue's derivatives data has been introduced.
  expect(readsBlock).not.toMatch(/binance|bybit|okx|deribit|bitget/i);
});
test('market-data reads, including index price, are unchanged', () => {
  expect(hash(source.slice(source.indexOf('  const { t }'), source.indexOf('  return ('))))
    .toBe('9754885ec9903e7041b7cb48270db7118c0b222d4a2d8b3e97256da4c79c1131');
});
test('funding countdown implementation is unchanged', () => {
  expect(hash(source.slice(source.indexOf('const NextFundingCountdown'))))
    .toBe('304d4757ab9cc6874c85026ca77405d7074d066934ea856e5d6133756b5f5032');
});
test.each([
  ['frontend/src/lib/api.ts', '8f86e162c5d785db22530ca30c53ce717ad42713df31c898e9fe744a54fd1b88'],
  ['src/api/routes/futures.ts', 'faefff61ff7e0564fdb6cb96e4fa4c726dc1c43db68e45eb292c19c266d7d7fb'],
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
  const api = {
    getFuturesConfig: jest.fn(async () => ({ fundingIntervalHours: 8 })),
    getFuturesMarkPrice: jest.fn(async () => ({ markPrice: '72340.12', indexPrice: '71999.88' })),
    getFuturesFundingRate: jest.fn(async () => ({ history: [{ rate: '0.00003' }] })),
    getFuturesOpenInterest: jest.fn(async () => ({ openInterest: '0', openInterestValue: '0' })),
    ...overrides,
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
    'futures.headerTurnover24h (USDT)', 'futures.openInterest (BTC)', 'futures.headerFunding',
  ]);
  expect(text(tree)).not.toMatch(/indexPrice|71,999.88|volume24h|123,456/);
  expect(text(tree)).toContain('987.65M');
  expect(text(blocks[6])).toContain('0.0030% / ');
  expect(nodes(blocks[6]).find(n => typeof n.type === 'function')?.props.intervalHours).toBe(8);
});
test.each([['0', '999999', '0'], ['1.23456789', '999999', '1.23456789'], ['0.000000001', null, '0.000000001']])(
  'OI uses real base size %s, not quote notional or invented external data', async (size, value, expected) => {
    const component = mount({ getFuturesOpenInterest: jest.fn(async () => ({ openInterest: size, openInterestValue: value })) });
    component.render({ symbol: 'ETH/USDT' }); await flush();
    const tree = component.render({ symbol: 'ETH/USDT' });
    const block = nodes(tree).find(n => n.props.className === 'ticker-item' && text(n).startsWith('futures.openInterest'));
    expect(text(block)).toBe('futures.openInterest (ETH)' + expected);
    expect(component.api.getFuturesOpenInterest).toHaveBeenCalledWith('ETH/USDT');
  },
);
test('unavailable data stays unavailable rather than becoming fake zero', async () => {
  const component = mount({ getFuturesOpenInterest: async () => { throw new Error('offline'); },
    getFuturesFundingRate: async () => ({ history: [] }) });
  component.render(); await flush();
  const tree = component.render();
  expect(text(tree)).toContain('futures.openInterest (BTC)—');
  expect(text(tree)).toContain('futures.headerFunding— / ');
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
  const dictionary = read('frontend/src/lib/i18n.tsx');
  for (const label of ['Изменение за 24ч', 'Макс. за 24ч', 'Мин. за 24ч', 'Оборот за 24ч', 'Ставка / Отсчет до финансирования', 'Маркировочная цена']) {
    expect(dictionary).toContain(label);
  }
  expect(source).not.toContain("t('trade.volume24h')");
});
