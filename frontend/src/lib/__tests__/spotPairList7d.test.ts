import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { filterAndSortPairs, TickerRow } from '../pairList';
import * as pairHelpers from '../pairList';
import * as change7dHelpers from '../change7d';
import { change7dBySymbol, pairChange7d } from '../change7d';
import * as columnSort from '../marketColumnSort';
import * as changeHelpers from '../priceChange';
import * as spotBookHelpers from '../spotOrderBook';

/**
 * Spot market list «Цена · 24ч % · 7д %» (owner, 2026-10-03).
 *
 * The seven-day column reads the SAME verified source as the Futures list
 * (the catalogue's `market.changePercent7d`, unique identities only), shows
 * «—» for an unknown week — never 0% — sorts on its own figure, and leaves
 * the 24h and price cells exactly as they were.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const read = (path: string) => readFileSync(resolve(frontend, path), 'utf8');
const asset = (symbol: string, week: number | null, extra: Partial<{ ambiguous: boolean; collidingIds: string[] }> = {}) => ({
  id: symbol.toLowerCase(), symbol, name: symbol, logoUrl: null, providers: {}, tradingPairs: [], tradable: true,
  metadataSource: 'qa', rank: 1, ambiguous: false, collidingIds: [] as string[], ...extra,
  market: { priceUsd: null, changePercent24h: null, changePercent7d: week, marketCapUsd: null, volume24hUsd: null, circulatingSupply: null },
});

describe('the seven-day source', () => {
  it('takes only unique catalogue identities with a finite week, keyed by symbol', () => {
    const values = change7dBySymbol([
      asset('btc', 3.21), asset('ETH', -5.674), asset('NEAR', 9.99, { ambiguous: true }),
      asset('ONE', 4, { collidingIds: ['harmony-other'] }), asset('ZEC', null), asset('BAD', Number.NaN),
    ] as never);
    expect([...values]).toEqual([['BTC', 3.21], ['ETH', -5.674]]);
  });

  it('gives a pair its week only when the pair is quoted in dollars', () => {
    const values = new Map([['BTC', 3.21]]);
    for (const pair of ['BTC/USDT', 'BTC/USD', 'BTC/USDC', 'btc/usdt']) expect(pairChange7d(pair, values)).toBe(3.21);
    // A USD return is not a EUR or BTC pair's own change.
    for (const pair of ['BTC/EUR', 'BTC/ETH', 'BTC', '/USDT']) expect(pairChange7d(pair, values)).toBeNull();
    expect(pairChange7d('ETH/USDT', values)).toBeNull();
  });
});

describe('sorting by «7д %»', () => {
  const row = (pair: string, change = '1', volume = '100'): TickerRow => ({ pair, lastPrice: '2', quoteVolume24h: volume, changePercent24h: change });
  // 24h order is the reverse of the 7d order, so either one leaking into
  // the other shows up as a wrong sequence.
  const rows = [row('A/USDT', '-3'), row('B/USDT', '-2'), row('C/USDT', '9'), row('D/USDT', '1'), row('E/USDT', '5')];
  const weeks = new Map<string, number | null>([['A/USDT', 30], ['B/USDT', 10], ['C/USDT', -20], ['D/USDT', null], ['E/USDT', null]]);
  const base = { search: '', quoteFilter: null, favoritesOnly: false, favorites: new Set<string>(), stableSort: true,
    change7d: (pair: string) => weeks.get(pair) ?? null };
  const order = (sortField: 'change' | 'change7d', sortDir: 1 | -1) =>
    filterAndSortPairs(rows, { ...base, sortField, sortDir }).map(item => item.pair);

  it('descending and ascending on the week itself, unknown weeks last both ways', () => {
    expect(order('change7d', -1)).toEqual(['A/USDT', 'B/USDT', 'C/USDT', 'D/USDT', 'E/USDT']);
    expect(order('change7d', 1)).toEqual(['C/USDT', 'B/USDT', 'A/USDT', 'D/USDT', 'E/USDT']);
  });

  it('24h sorting ignores the week, and the week ignores 24h', () => {
    expect(order('change', -1)).toEqual(['C/USDT', 'E/USDT', 'D/USDT', 'B/USDT', 'A/USDT']);
    expect(order('change', 1)).toEqual(['A/USDT', 'B/USDT', 'D/USDT', 'E/USDT', 'C/USDT']);
    // Same rows, the week alone changed: the 24h order does not move.
    const flipped = new Map([...weeks].map(([pair, week]) => [pair, week === null ? null : -week]));
    expect(filterAndSortPairs(rows, { ...base, change7d: pair => flipped.get(pair) ?? null, sortField: 'change', sortDir: -1 })
      .map(item => item.pair)).toEqual(order('change', -1));
  });

  it('equal weeks tie on the pair name and the live input is not mutated', () => {
    const before = JSON.stringify(rows);
    const same = { ...base, change7d: () => 1 };
    expect(filterAndSortPairs([...rows].reverse(), { ...same, sortField: 'change7d', sortDir: -1 }).map(item => item.pair))
      .toEqual(['A/USDT', 'B/USDT', 'C/USDT', 'D/USDT', 'E/USDT']);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe('the mounted Spot list', () => {
  const React = req('react');
  const { act } = React;
  const { JSDOM } = req('jsdom');
  const ticker = (pair: string, lastPrice: string, changePercent24h: string, quoteVolume24h: string) =>
    [pair, { pair, lastPrice, changePercent24h, quoteVolume24h, bidPrice: lastPrice, askPrice: lastPrice, high24h: lastPrice, low24h: lastPrice, volume24h: '1' }] as const;
  // One Map instance for every render, as the shared store hands out.
  const tickers = new Map([
    ticker('BTC/USDT', '84555.10', '0.06', '3000000000'),
    ticker('ETH/USDT', '2674.40', '-1.5', '2000000000'),
    ticker('SOL/USDT', '119.08', '4', '1000000000'),
    ticker('NEAR/USDT', '4.6', '2', '500000000'),
    ticker('NIGHT/USDT', '0.05', '-3', '400000000'),
    ticker('LTC/USDT', '68.87', '', '300000000'),
    ticker('BTC/USD', '84560', '0.07', '900000000'),
    ticker('BTC/EUR', '72101', '-0.1', '800000000'),
  ]);
  const catalogue = [asset('BTC', 3.21), asset('ETH', -5.674), asset('SOL', 145.67), asset('NEAR', 9.99, { ambiguous: true }),
    asset('LTC', -0.004)];
  let dom: any, root: any, host: HTMLElement, subscribers = 0;
  const transpile = (path: string) => ts.transpileModule(read(path), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

  beforeEach(async () => {
    dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/trade' });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
    host = document.getElementById('root')!;
    root = req('react-dom/client').createRoot(host);
    subscribers = 0;
    // The real hook, over a stand-in for the shared catalogue store.
    const hook: any = {};
    new Function('exports', 'require', transpile('src/lib/useChange7d.ts'))(hook, (name: string) => {
      if (name === 'react') return React;
      if (name === './change7d') return change7dHelpers;
      if (name === './catalogueStore') return { catalogueStore: { subscribe: (listener: any) => {
        subscribers += 1; listener({ assets: catalogue }); return () => { subscribers -= 1; };
      } } };
      throw new Error(`unexpected import ${name}`);
    });
    const output: any = {};
    new Function('exports', 'require', transpile('src/components/PairListSidebar.tsx'))(output, (name: string) => {
      if (name.endsWith('.css')) return {};
      if (name === 'react') return React;
      if (name === '../lib/useMarketData') return { useMarketTickers: () => ({ tickers, loading: false, error: false, stale: false, refresh: () => {} }) };
      if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key }) };
      if (name === '../lib/pairList') return pairHelpers;
      if (name === '../lib/useFavorites') return { useFavorites: () => ({ favorites: new Set<string>(), toggle: () => {} }) };
      if (name === '../lib/priceChange') return changeHelpers;
      if (name === '../lib/spotOrderBook') return spotBookHelpers;
      if (name === '../lib/marketColumnSort') return columnSort;
      if (name === '../lib/change7d') return change7dHelpers;
      if (name === '../lib/useChange7d') return hook;
      if (name === './CryptoIcon') return { CryptoIcon: () => null };
      return req(name);
    });
    await act(async () => root.render(React.createElement(output.PairListSidebar, { pair: 'BTC/USDT', onChange: () => {} })));
  });
  afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); });

  const order = () => Array.from(host.querySelectorAll('.pair-row[data-pair]')).map(node => node.getAttribute('data-pair'));
  const cell = (pair: string, period: '24h' | '7d') =>
    host.querySelector(`.pair-row[data-pair="${pair}"] ${period === '7d' ? '.p-change-7d' : '.p-change:not(.p-change-7d)'}`) as HTMLElement;
  const header = (field: string) => host.querySelector(`.pairs-sort [data-sort-field="${field}"]`) as HTMLButtonElement;
  const click = async (element: HTMLElement) => act(async () => element.click());

  it('renders «Цена · 24ч % · 7д %» with signed, coloured weeks', () => {
    expect(Array.from(host.querySelectorAll('.pairs-sort button')).map(button => button.getAttribute('data-sort-field')))
      .toEqual(['price', 'change', 'change7d']);
    expect(header('change7d').textContent).toContain('markets.change7d');
    expect(cell('BTC/USDT', '7d').textContent).toBe('+3.21%');
    expect(cell('BTC/USDT', '7d').className).toBe('p-change p-change-7d up');
    expect(cell('ETH/USDT', '7d').textContent).toBe('-5.67%');
    expect(cell('ETH/USDT', '7d').className).toBe('p-change p-change-7d down');
    // Rounded before the sign is chosen, exactly like the 24h cell.
    expect(cell('LTC/USDT', '7d').textContent).toBe('+0.00%');
    // A three-digit week steps down a size instead of overrunning its column.
    expect(cell('SOL/USDT', '7d').textContent).toBe('+145.67%');
    expect(cell('SOL/USDT', '7d').hasAttribute('data-compact')).toBe(true);
    expect(cell('BTC/USDT', '7d').hasAttribute('data-compact')).toBe(false);
    expect(subscribers).toBe(1);
  });

  it('an unknown week is «—» with no colour, never 0%', async () => {
    for (const pair of ['NEAR/USDT', 'NIGHT/USDT']) {
      expect(cell(pair, '7d').textContent).toBe('—');
      expect(cell(pair, '7d').className).toBe('p-change p-change-7d');
    }
    expect(host.textContent).not.toMatch(/(^|[^.\d])0%/);
    // The EUR pair's own week is not the asset's USD week; the USD pair's is.
    await click(Array.from(host.querySelectorAll('.pairs-tab')).find(tab => tab.textContent === 'EUR') as HTMLElement);
    expect(cell('BTC/EUR', '7d').textContent).toBe('—');
    await click(Array.from(host.querySelectorAll('.pairs-tab')).find(tab => tab.textContent === 'USD') as HTMLElement);
    expect(cell('BTC/USD', '7d').textContent).toBe('+3.21%');
  });

  it('«7д %» sorts descending, ascending, then back to the normal list; unknown weeks stay last', async () => {
    expect(order()).toEqual(['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'NEAR/USDT', 'NIGHT/USDT', 'LTC/USDT']);
    await click(header('change7d'));
    expect(header('change7d').getAttribute('aria-pressed')).toBe('true');
    expect(header('change7d').getAttribute('data-sort-dir')).toBe('-1');
    expect(order()).toEqual(['SOL/USDT', 'BTC/USDT', 'LTC/USDT', 'ETH/USDT', 'NEAR/USDT', 'NIGHT/USDT']);
    await click(header('change7d'));
    expect(header('change7d').getAttribute('data-sort-dir')).toBe('1');
    expect(order()).toEqual(['ETH/USDT', 'LTC/USDT', 'BTC/USDT', 'SOL/USDT', 'NEAR/USDT', 'NIGHT/USDT']);
    await click(header('change7d'));
    expect(header('change7d').getAttribute('aria-pressed')).toBe('false');
    expect(order()).toEqual(['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'NEAR/USDT', 'NIGHT/USDT', 'LTC/USDT']);
  });

  it('the 24h and price cells are untouched by the week, and 24h sorting ignores it', async () => {
    const snapshot = () => Object.fromEntries(order().map(pair => [pair!, [
      (host.querySelector(`.pair-row[data-pair="${pair}"] .p-price`) as HTMLElement).textContent, cell(pair!, '24h').textContent, cell(pair!, '24h').className]]));
    const before = snapshot();
    expect(before['BTC/USDT']).toEqual(['84,555.10', '+0.06%', 'p-change up']);
    expect(before['LTC/USDT']).toEqual(['68.87', '—', 'p-change']);
    // NEAR has no week; its 24h still reads as before.
    expect(before['NEAR/USDT'][1]).toBe('+2.00%');
    await click(header('change7d'));
    expect(snapshot()).toEqual(before);
    await click(header('change7d')); await click(header('change7d'));
    await click(header('change'));
    expect(order()).toEqual(['SOL/USDT', 'NEAR/USDT', 'BTC/USDT', 'ETH/USDT', 'NIGHT/USDT', 'LTC/USDT']);
    expect(header('change7d').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('the Spot panel keeps its 240–340px resize without overflow', () => {
  const css = read('src/components/SpotMarketControls.css');
  const block = css.slice(css.indexOf('/* «Цена · 24ч % · 7д %»'));
  const vars = (text: string) => Object.fromEntries([...text.matchAll(/--spot-mk-(\w+):\s*(\d+)px/g)].map(([, key, value]) => [key, Number(value)]));
  const narrow = vars(block.slice(0, block.indexOf('@container spot-markets (min-width: 300px)')));
  const wide = { ...narrow, ...vars(block.slice(block.indexOf('@container spot-markets (min-width: 300px)'), block.indexOf('.pairs-sort {'))) };

  it('header and rows share one set of tracks and the same gap', () => {
    expect(block).toContain('container: spot-markets / inline-size');
    expect(block).toContain('grid-template-columns: minmax(0, 1fr) var(--spot-mk-price) var(--spot-mk-change) var(--spot-mk-change);');
    expect(block).toContain('grid-template-columns: var(--spot-mk-icon) minmax(28px, 1fr) var(--spot-mk-price) var(--spot-mk-change) var(--spot-mk-change);');
    expect([...block.matchAll(/gap: var\(--spot-mk-gap\)/g)].length).toBeGreaterThanOrEqual(3);
    // Overflow, if any remains, is visible as an ellipsis — not a cut number.
    expect(block).toMatch(/:is\(\.p-price, \.p-change\) \{\s*min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/);
    expect(block).toContain('.p-change[data-compact]');
  });

  it('every width from 240 to 340px leaves the pair at least 28px and the figures their measured width', () => {
    // Row padding is the reference's 8px a side.
    expect(read('src/pages/trade-terminal/MarketReferenceTerminal.css'))
      .toContain('.pairs-list .pair-row { min-height:35px; grid-template-columns:14px 20px minmax(28px,1fr) 76px 66px; gap:4px; padding:0 8px;');
    // Measured in Chromium at these fonts: "84,555.10" 58px at 11px / 63px
    // at 12px; "+12.34%" 49px at 10.5px / 50px at 11px.
    expect(narrow.price).toBeGreaterThanOrEqual(58); expect(narrow.change).toBeGreaterThanOrEqual(49);
    expect(wide.price).toBeGreaterThanOrEqual(63); expect(wide.change).toBeGreaterThanOrEqual(50);
    for (let width = 240; width <= 340; width++) {
      const v = width >= 300 ? wide : narrow;
      const icon = width < 250 ? 0 : v.icon + v.gap;
      const name = width - 16 - v.star - v.gap - icon - v.price - 2 * v.change - 3 * v.gap;
      expect({ width, nameAtLeast28: name >= 28 }).toEqual({ width, nameAtLeast28: true });
    }
    expect(block).toContain('@container spot-markets (max-width: 249.98px)');
    expect(block).toMatch(/max-width: 249\.98px\) \{[^@]*\.p-icon \{ display: none; \}/);
  });

  it('the resize bounds are still 240 and 340', () => {
    const page = read('src/pages/TradePage.tsx');
    expect(page).toContain('setMarketPanelWidth(Math.min(340, Math.max(240, nextWidth)))');
    expect(page).toContain('useState(258)');
    const sidebar = read('src/components/PairListSidebar.tsx');
    expect(sidebar).toContain('aria-valuemin={onResizeBy ? 240 : undefined} aria-valuemax={onResizeBy ? 340 : undefined}');
  });
});
