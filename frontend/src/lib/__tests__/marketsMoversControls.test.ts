import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { filterAndSortAssets, defaultTradingPair } from '../catalogueStore';
import { joinReferenceAssets, referenceValues } from '../referenceAssets';

jest.mock('../api', () => ({ api: { getAssetCatalogue: jest.fn() } }));

// Exercise the production table and real selectors, not an imitation of the
// period buttons. These figures are isolated test fixtures, never market data.
const front = resolve(__dirname, '../../..');
const req = createRequire(resolve(front, 'package.json'));
const React = req('react');
const { act } = React;
const { JSDOM } = req('jsdom');
const makeAsset = (symbol: string, rank: number, d7: number | null, d30: number | null, pairs: string[] = []) => ({
  id: `fixture:${symbol}`, symbol, name: `${symbol} fixture`, rank, logoUrl: null,
  tradingPairs: pairs, tradable: pairs.length > 0, providers: {},
  ambiguous: false, collidingIds: [], metadataSource: 'fixture',
  market: { priceUsd: rank + 1, changePercent24h: rank === 1 ? -2 : 3,
    changePercent7d: d7, changePercent30d: d30, marketCapUsd: 10000 - rank,
    volume24hUsd: 1000, circulatingSupply: 100 },
});
const assets = [
  makeAsset('BTC', 1, 12, -9, ['BTC/USD']),
  makeAsset('ETH', 2, -21, 35, ['ETH/USDT']),
  makeAsset('ZERO', 3, 0, 0), makeAsset('UNKNOWN', 4, null, null),
  ...Array.from({ length: 1500 }, (_, i) => makeAsset(`ZTAIL${String(i).padStart(4, '0')}`, i + 5, null, null)),
];
const live = new Map();
let dom: any, root: any, host: HTMLElement, Table: any, state: any;
let props: any;
const trade = jest.fn();
const favorite = jest.fn();

beforeEach(async () => {
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/markets' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  host = document.getElementById('root')!;
  root = req('react-dom/client').createRoot(host);
  state = { assets, catalogueTotal: assets.length, tradableCount: 2, status: 'ready',
    loaded: true, metadataComplete: true, meta: { source: 'fixture', fetchedAt: Date.now(), stale: false }, refresh: jest.fn() };
  const output: any = {};
  const code = ts.transpileModule(readFileSync(resolve(front, 'src/pages/markets-bolt/CatalogueTable.tsx'), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('exports', 'require', code)(output, (name: string) => {
    if (name === './CatalogueTable.css') return {};
    if (name.endsWith('/i18n')) return { useLanguage: () => ({ t: (key: string) => key }) };
    if (name.endsWith('/CryptoIcon')) return { CryptoIcon: () => null };
    if (name.endsWith('/catalogueStore')) return { useCatalogue: () => state, filterAndSortAssets, defaultTradingPair };
    if (name.endsWith('/useLiveMarket')) return { useLiveMarket: () => ({ rows: live, status: 'live' }) };
    if (name.endsWith('/referenceAssets')) return { joinReferenceAssets, referenceValues };
    return req(name);
  });
  Table = output.CatalogueTable;
  props = { search: '', favorites: new Set(['ETH/USDT']), onTrade: trade, onToggleFavorite: favorite };
  trade.mockClear(); favorite.mockClear();
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); });
async function render() { await act(async () => root.render(React.createElement(Table, props))); }
async function click(selector: string, index = 0) {
  const button = host.querySelectorAll(selector)[index] as HTMLButtonElement | undefined;
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
const symbols = () => Array.from(host.querySelectorAll('tbody .vx-cat-symbol')).map(n => n.textContent?.trim());
const change = (symbol: string) => Array.from(host.querySelectorAll('tbody tr'))
  .find(n => n.querySelector('.vx-cat-symbol')?.textContent?.trim() === symbol)?.querySelectorAll('td')[5]?.textContent;

it.each([['7d', 1, 'BTC', 'ETH'], ['30d', 2, 'ETH', 'BTC']])(
  '%s switches the displayed percentages and gainers/losers ordering', async (_period, index, gainer, loser) => {
    await click('.vx-cat-change-periods button', index as number);
    expect(symbols()[0]).toBe(gainer);
    expect(host.querySelector('.vx-cat-change-direction button[aria-pressed="true"]')?.textContent).toContain('catalogue.gainers');
    expect(change('ZERO')).toBe('+0.00%');
    expect(change('UNKNOWN')).toBe('—');
    expect(change('BTC')).toBe(index === 1 ? '+12.00%' : '-9.00%');
    await click('.vx-cat-change-direction button', 1);
    expect(symbols()[0]).toBe(loser);
    expect(symbols()[1]).toBe('ZERO');
    expect(host.querySelector('.vx-cat-change-direction button[aria-pressed="true"]')?.textContent).toContain('catalogue.losers');
    await click('.vx-cat-change-periods button', 0);
    expect(change('BTC')).toBe('-2.00%');
  }
);

it('preserves search, tradable/favorite filters, real trade routing and rank while switching periods', async () => {
  await click('.vx-cat-filters button', 1);
  await click('.vx-cat-change-periods button', 2);
  expect(symbols()).toEqual(['ETH', 'BTC']);
  props = { ...props, search: 'btc' }; await render();
  expect(symbols()).toEqual(['BTC']);
  expect(host.querySelector('tbody .vx-cat-rank')?.textContent).toBe('1');
  await click('.vx-cat-trade');
  expect(trade).toHaveBeenCalledWith('BTC/USD');
  await click('.vx-cat-star button');
  expect(favorite).toHaveBeenCalledWith('BTC/USD');
  props = { ...props, search: '' }; await render();
  await click('.vx-cat-filters button', 2);
  await click('.vx-cat-change-periods button', 1);
  expect(symbols()).toEqual(['ETH']);
  await click('.vx-cat-filters button', 0);
  props = { ...props, search: 'UNKNOWN' }; await render();
  expect(host.querySelector('.vx-cat-trade')).toBeNull();
  expect(host.querySelector('.vx-cat-dataonly')).not.toBeNull();
});

it('paginates 1504 assets and resets to the first page when changing period', async () => {
  expect(host.querySelectorAll('tbody tr')).toHaveLength(50);
  await click('button[aria-label="catalogue.nextPage"]');
  expect(host.querySelector('.vx-cat-showing')?.textContent).toContain('51–100');
  await click('.vx-cat-change-periods button', 1);
  expect(host.querySelector('.vx-cat-showing')?.textContent).toContain('1–50');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(50);
  expect(symbols()[0]).toBe('BTC');
});

it('keeps confirmed period values visible during a failed background refresh', async () => {
  await click('.vx-cat-change-periods button', 2);
  const before = symbols();
  state = { ...state, status: 'error' };
  await render();
  expect(symbols()).toEqual(before);
  expect(change('ETH')).toBe('+35.00%');
  expect(host.querySelector('.vx-cat-source')?.textContent).toContain('markets.loadError');
});
