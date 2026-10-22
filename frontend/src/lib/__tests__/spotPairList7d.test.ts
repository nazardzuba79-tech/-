import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as pairHelpers from '../pairList';
import * as columnSort from '../marketColumnSort';
import * as changeHelpers from '../priceChange';
import * as spotBookHelpers from '../spotOrderBook';

/**
 * Spot terminal rail after the owner removed the 7d column (2026-10-04).
 *
 * The narrow execution rail shows identity + Price + 24h only. Seven-day
 * discovery remains on the full Markets page. A «Новые» sorter promotes
 * simulated/managed listings by their authoritative listingAt timestamp so
 * a newly-listed simulation can be found without remembering its ticker.
 */
const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const read = (path: string) => readFileSync(resolve(frontend, path), 'utf8');
const transpile = (path: string) => ts.transpileModule(read(path), { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;

describe('source boundaries', () => {
  test('terminal rail has no 7d column while Markets keeps it', () => {
    const sidebar = read('src/components/PairListSidebar.tsx');
    const markets = read('src/pages/markets-bolt/CatalogueTable.tsx');
    expect(sidebar).not.toContain('p-change-7d');
    expect(sidebar).not.toContain('useChange7d');
    expect(sidebar).not.toContain("data-sort-field=\"change7d\"");
    expect(sidebar).toContain("data-sort-field=\"new\"");
    expect(sidebar).toContain("t('markets.new')");
    expect(markets).toContain("'7d': { key: 'change7d', labelKey: 'markets.change7d' }");
  });

  test('newest sorting reuses listing metadata, not another market request', () => {
    const sidebar = read('src/components/PairListSidebar.tsx');
    expect(sidebar).toContain("const { assets: listedAssets } = useTestMarkets();");
    expect(sidebar).toContain('Date.parse(asset.listingAt)');
    expect(sidebar).toContain('listingAtByPair.get(a.pair)');
    expect(sidebar).not.toMatch(/fetch\(|getAssetCatalogue|catalogueStore/);
  });
});

describe('mounted compact Spot rail', () => {
  const React = req('react');
  const { act } = React;
  const { JSDOM } = req('jsdom');
  const ticker = (pair: string, lastPrice: string, changePercent24h: string, quoteVolume24h: string) =>
    [pair, { pair, lastPrice, changePercent24h, quoteVolume24h, bidPrice: lastPrice, askPrice: lastPrice,
      high24h: lastPrice, low24h: lastPrice, volume24h: '1' }] as const;
  const tickers = new Map([
    ticker('BTC/USDT', '84555.10', '0.06', '3000000000'),
    ticker('ETH/USDT', '2674.40', '-1.5', '2000000000'),
    ticker('NRX/USDT', '44.20', '5424.38', '1000'),
    ticker('VTA/USDT', '0.81', '10', '900'),
  ]);
  const listedAssets = [
    { pair: 'VTA/USDT', listingAt: '2026-09-28T14:00:00.000Z' },
    { pair: 'NRX/USDT', listingAt: '2026-10-03T18:00:00.000Z' },
  ];
  let dom: any, root: any, host: HTMLElement;

  beforeEach(async () => {
    dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/trade' });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
    host = document.getElementById('root')!;
    root = req('react-dom/client').createRoot(host);
    const output: any = {};
    new Function('exports', 'require', transpile('src/components/PairListSidebar.tsx'))(output, (name: string) => {
      if (name.endsWith('.css')) return {};
      if (name === 'react') return React;
      if (name === '../lib/useMarketData') return { useMarketTickers: () => ({ tickers, loading: false, error: false, stale: false, refresh: () => {} }) };
      if (name === '../lib/testMarketStore') return { useTestMarkets: () => ({ assets: listedAssets, loaded: true, error: false }) };
      if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key }) };
      if (name === '../lib/pairList') return pairHelpers;
      if (name === '../lib/useFavorites') return { useFavorites: () => ({ favorites: new Set<string>(), toggle: () => {} }) };
      if (name === '../lib/priceChange') return changeHelpers;
      if (name === '../lib/spotOrderBook') return spotBookHelpers;
      if (name === '../lib/marketColumnSort') return columnSort;
      if (name === './CryptoIcon') return { CryptoIcon: ({ symbol }: any) => React.createElement('i', { 'data-icon': symbol }) };
      return req(name);
    });
    await act(async () => root.render(React.createElement(output.PairListSidebar, { pair: 'BTC/USDT', onChange: () => {} })));
  });

  afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); });

  const order = () => Array.from(host.querySelectorAll('.pair-row[data-pair]')).map(node => node.getAttribute('data-pair'));
  const header = (field: string) => host.querySelector(`.pairs-sort [data-sort-field="${field}"]`) as HTMLButtonElement;
  const click = async (element: HTMLElement) => act(async () => element.click());

  test('shows only New / Price / 24h and keeps full ticker identity', () => {
    expect(Array.from(host.querySelectorAll('.pairs-sort button')).map(button => button.getAttribute('data-sort-field')))
      .toEqual(['new', 'price', 'change']);
    expect(host.querySelectorAll('.p-change-7d')).toHaveLength(0);
    for (const symbol of ['BTC', 'ETH', 'NRX', 'VTA']) {
      const row = host.querySelector(`.pair-row[data-pair="${symbol}/USDT"]`)!;
      expect(row.querySelector('.p-base')?.textContent).toBe(symbol);
      expect(row.querySelector(`[data-icon="${symbol}"]`)).not.toBeNull();
    }
  });

  test('New promotes listed simulations newest-first and toggles back to normal ranking', async () => {
    expect(order()).toEqual(['BTC/USDT', 'ETH/USDT', 'NRX/USDT', 'VTA/USDT']);
    await click(header('new'));
    expect(header('new').getAttribute('aria-pressed')).toBe('true');
    expect(order()).toEqual(['NRX/USDT', 'VTA/USDT', 'BTC/USDT', 'ETH/USDT']);
    await click(header('new'));
    expect(header('new').getAttribute('aria-pressed')).toBe('false');
    expect(order()).toEqual(['BTC/USDT', 'ETH/USDT', 'NRX/USDT', 'VTA/USDT']);
  });

  test('Price or 24h sorting exits New mode', async () => {
    await click(header('new'));
    await click(header('change'));
    expect(header('new').getAttribute('aria-pressed')).toBe('false');
    expect(header('change').getAttribute('aria-pressed')).toBe('true');
    expect(order()[0]).toBe('NRX/USDT');
  });
});

describe('240–340px rail geometry', () => {
  const css = read('src/components/SpotMarketControls.css');
  const start = css.indexOf('/* Compact Spot market rail:');
  const block = css.slice(start);

  test('one less numeric column gives the ticker and logo real space', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('grid-template-columns: minmax(0, 1fr) var(--spot-mk-price) var(--spot-mk-change);');
    expect(block).toContain('grid-template-columns: var(--spot-mk-icon) minmax(50px, 1fr) var(--spot-mk-price) var(--spot-mk-change);');
    expect(block).not.toContain('var(--spot-mk-change) var(--spot-mk-change)');
    expect(block).not.toContain('.p-icon { display: none; }');
    expect(block).toContain('--spot-mk-icon: 20px');
  });

  test('search still protects a fitting ticker and resize bounds stay 240–340', () => {
    expect(block).toMatch(/\.p-name \.p-base \{[\s\S]*flex-shrink: 0;[\s\S]*max-width: 100%;/);
    const page = read('src/pages/TradePage.tsx');
    expect(page).toContain('setMarketPanelWidth(Math.min(340, Math.max(240, nextWidth)))');
    expect(page).toContain('useState(258)');
    const sidebar = read('src/components/PairListSidebar.tsx');
    expect(sidebar).toContain('aria-valuemin={onResizeBy ? 240 : undefined} aria-valuemax={onResizeBy ? 340 : undefined}');
  });
});
