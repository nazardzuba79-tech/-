import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as pairHelpers from '../pairList';
import * as columnSort from '../marketColumnSort';
import * as changeHelpers from '../priceChange';
import * as spotBookHelpers from '../spotOrderBook';
import * as testMarkets from '../testMarkets';
import * as listingsOrder from '../listingsOrder';

/**
 * Terminal «Рынки» rail (owner screenshot, 2026-11-04): the phone pane had
 * no way to see or sort what is about to trade. Listings still counting
 * down come from the shared listings store (never from the ticker feed):
 * «Скоро» lists them alone by nearest date with the date and the time left,
 * «Новые» puts them before the newest traded markets, a search finds them,
 * and tapping one opens its countdown rather than an empty ticket.
 */
const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { act } = React;
const { JSDOM } = req('jsdom');
const NOW = Date.parse('2026-11-04T06:00:00.000Z');

const transpile = (path: string) => ts.transpileModule(readFileSync(resolve(frontend, path), 'utf8'), { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;

const ticker = (pair: string, lastPrice: string, changePercent24h: string, quoteVolume24h: string) =>
  [pair, { pair, lastPrice, changePercent24h, quoteVolume24h, bidPrice: lastPrice, askPrice: lastPrice,
    high24h: lastPrice, low24h: lastPrice, volume24h: '1' }] as const;
const tickers = new Map([
  ticker('BTC/USDT', '84555.10', '0.06', '3000000000'),
  ticker('ETH/USDT', '2674.40', '-1.5', '2000000000'),
  ticker('VTA/USDT', '0.81', '10', '900'),
  // The fixture feed can still carry a pair whose listing has not opened; it must never show as a traded row.
  ticker('QVTR/USDT', '1.00', '0', '0'),
]);
const listing = (symbol: string, name: string, listingAt: string, phase: 'pre-listing' | 'live', extra: Record<string, unknown> = {}) => ({
  pair: `${symbol}/USDT`, symbol, name, quote: 'USDT', isTestAsset: true, isTradable: phase === 'live', status: '', listingArmed: true, listingAt, initialPrice: 1,
  managed: true, displayTimeZone: 'UTC', countdown: 'running', state: { phase, lastPrice: null, openPrice24h: null, change24hPercent: null, high24h: null, low24h: null, volume24h: null, quoteVolume24h: null, trades24h: 0 }, ...extra,
});
const listedAssets = [
  listing('VTA', 'VOLTORA', '2026-09-28T14:00:00.000Z', 'live'),
  listing('ECLV', 'ECLAVO', '2026-11-13T08:00:00.000Z', 'pre-listing', { countdown: 'paused', listingArmed: false }),
  listing('QVTR', 'QAVENTRA', '2026-11-06T11:00:00.000Z', 'pre-listing'),
  listing('TYVN', 'TYVN Network', '2026-11-04T06:40:00.000Z', 'pre-listing'),
];

describe('upcoming listings in the Spot market rail', () => {
  let dom: any, root: any, host: HTMLElement;
  const selected: unknown[][] = [];

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/trade' });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
    host = document.getElementById('root')!;
    root = req('react-dom/client').createRoot(host);
    const output: any = {};
    new Function('exports', 'require', transpile('src/components/PairListSidebar.tsx'))(output, (name: string) => {
      if (name.endsWith('.css')) return {};
      if (name === 'react') return React;
      if (name === '../lib/useMarketData') return { useMarketTickers: () => ({ tickers, loading: false, error: false, stale: false, refresh: () => {} }) };
      if (name === '../lib/testMarketStore') return { useTestMarkets: () => ({ assets: listedAssets, loaded: true, error: false, clockOffsetMs: 0 }) };
      if (name === '../lib/testMarkets') return testMarkets;
      if (name === '../lib/listingsOrder') return listingsOrder;
      if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key }) };
      if (name === '../lib/pairList') return pairHelpers;
      if (name === '../lib/useFavorites') return { useFavorites: () => ({ favorites: new Set<string>(), toggle: () => {} }) };
      if (name === '../lib/priceChange') return changeHelpers;
      if (name === '../lib/spotOrderBook') return spotBookHelpers;
      if (name === '../lib/marketColumnSort') return columnSort;
      if (name === './CryptoIcon') return { CryptoIcon: ({ symbol }: any) => React.createElement('i', { 'data-icon': symbol }) };
      return req(name);
    });
    selected.length = 0;
    await act(async () => root.render(React.createElement(output.PairListSidebar, { pair: 'BTC/USDT', onChange: (...args: unknown[]) => selected.push(args) })));
  });

  afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); jest.restoreAllMocks(); });

  const rows = () => Array.from(host.querySelectorAll('.pairs-list .pair-row')).map(node => `${node.getAttribute('data-pair')}${node.getAttribute('data-phase') ? ':soon' : ''}`);
  const click = async (element: Element | null) => { expect(element).not.toBeNull(); await act(async () => (element as HTMLElement).click()); };

  test('finds the full scheduled listing name with spaces, underscores or dashes', () => {
    const item = { pair: 'NRYIA/USDT', symbol: 'NRYIA', name: 'Neuryvia AI' };
    expect(testMarkets.matchesTestAssetSearch(item, 'NRYIA')).toBe(true);
    expect(testMarkets.matchesTestAssetSearch(item, 'Neuryvia AI')).toBe(true);
    expect(testMarkets.matchesTestAssetSearch(item, 'Neuryvia-AI')).toBe(true);
    expect(testMarkets.matchesTestAssetSearch(item, 'neuryvia_ai')).toBe(true);
    expect(testMarkets.matchesTestAssetSearch(item, 'unrelated')).toBe(false);
  });

  test('the default ranking lists traded markets only; a counting-down pair is never a traded row', () => {
    expect(rows()).toEqual(['BTC/USDT', 'ETH/USDT', 'VTA/USDT']);
    expect(host.querySelector('.pairs-tab[data-pairs-tab="soon"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('listings.sortSoon 3');
  });

  test('«Скоро» lists the countdowns alone, nearest first, with the date and the time left; a paused timer keeps its date', async () => {
    await click(host.querySelector('.pairs-tab[data-pairs-tab="soon"]'));
    expect(rows()).toEqual(['TYVN/USDT:soon', 'QVTR/USDT:soon', 'ECLV/USDT:soon']);
    const cell = (pair: string, selector: string) => host.querySelector(`.pair-row[data-pair="${pair}"] ${selector}`)?.textContent;
    expect(cell('TYVN/USDT', '[data-listing-eta]')).toBe('40 listings.unitMinute');
    expect(cell('QVTR/USDT', '[data-listing-eta]')).toBe('2 listings.unitDay 5 listings.unitHour');
    expect(cell('QVTR/USDT', '.p-listing-at')).toBe('06.11 11:00');
    expect(cell('ECLV/USDT', '[data-listing-eta]')).toBe('listings.sortSoon');
    expect(cell('ECLV/USDT', '.p-listing-at')).toBe('13.11 08:00');
    expect(host.querySelector('.pairs-tab[data-pairs-tab="soon"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.pairs-tab[aria-pressed="true"]:not([data-pairs-tab])')).toBeNull();
  });

  test('«Новые» puts the countdowns before the newest traded listing; a search finds a countdown', async () => {
    await click(host.querySelector('.pairs-sort [data-sort-field="new"]'));
    expect(rows()).toEqual(['TYVN/USDT:soon', 'QVTR/USDT:soon', 'ECLV/USDT:soon', 'VTA/USDT', 'BTC/USDT', 'ETH/USDT']);
    const input = host.querySelector('.pairs-search input') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'qaven');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    expect(rows()).toEqual(['QVTR/USDT:soon']);
    // The full name with its space, as the Markets search and qa-ai-candidate.cjs type it.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'TYVN Network');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    expect(rows()).toEqual(['TYVN/USDT:soon']);
  });

  test('opening a countdown tells the page it is upcoming', async () => {
    await click(host.querySelector('.pairs-tab[data-pairs-tab="soon"]'));
    await click(host.querySelector('.pair-row[data-pair="QVTR/USDT"] .pair-select'));
    expect(selected).toEqual([['QVTR/USDT', { upcoming: true }]]);
    const page = readFileSync(resolve(frontend, 'src/pages/TradePage.tsx'), 'utf8');
    expect(page).toContain("setMobileTab(options?.upcoming ? 'chart' : 'trade');");
  });
});
