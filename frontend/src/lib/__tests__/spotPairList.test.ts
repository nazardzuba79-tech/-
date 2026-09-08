import { filterAndSortPairs, TickerRow } from '../pairList';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as pairHelpers from '../pairList';
import * as spotBookHelpers from '../spotOrderBook';

const row = (pair: string, price = '2', volume = '100', change = '1'): TickerRow => ({ pair, lastPrice: price, quoteVolume24h: volume, changePercent24h: change });
const base = { search: '', quoteFilter: null, favoritesOnly: false, favorites: new Set<string>(), stableSort: true };

test.each(['price', 'volume', 'change'] as const)('equal %s values have deterministic pair ties without mutating live input', field => {
  const rows = [row('Z/USDT'), row('A/USDT'), row('M/USDT')], before = JSON.stringify(rows);
  for (const dir of [-1, 1] as const) {
    const result = filterAndSortPairs(rows, { ...base, sortField: field, sortDir: dir });
    expect(result.map(item => item.pair)).toEqual(['A/USDT', 'M/USDT', 'Z/USDT']);
    expect(filterAndSortPairs([...rows].reverse(), { ...base, sortField: field, sortDir: dir })).toEqual(result);
  }
  expect(JSON.stringify(rows)).toBe(before);
});

test.each(['price', 'volume', 'change'] as const)('invalid %s values stay last in both directions', field => {
  const rows = [row('A/USDT', 'NaN', '', 'Infinity'), row('B/USDT', '3', '100', '-3'), row('C/USDT', '1', '200', '5')];
  for (const dir of [-1, 1] as const) {
    const result = filterAndSortPairs(rows, { ...base, sortField: field, sortDir: dir });
    expect(result[result.length - 1].pair).toBe('A/USDT');
    expect(result.slice(0, 2).map(item => item.pair)).toEqual(field === 'price'
      ? dir === -1 ? ['B/USDT', 'C/USDT'] : ['C/USDT', 'B/USDT']
      : dir === -1 ? ['C/USDT', 'B/USDT'] : ['B/USDT', 'C/USDT']);
  }
});

test('existing default consumers retain original stable input order on equal values', () => {
  const rows = [row('Z/USDT'), row('A/USDT')];
  expect(filterAndSortPairs(rows, { ...base, stableSort: false })).toEqual(rows);
});

test('quote filters, cross-quote search, favorites and alpha direction still compose', () => {
  const rows = [row('BTC/USDT'), row('BTC/EUR'), row('ETH/USD'), row('SOL/USDC')];
  expect(filterAndSortPairs(rows, { ...base, quoteFilter: 'USDC' }).map(item => item.pair)).toEqual(['SOL/USDC']);
  expect(filterAndSortPairs(rows, { ...base, quoteFilter: 'USDT', search: 'btc/', favoritesOnly: true,
    favorites: new Set(['BTC/EUR']) }).map(item => item.pair)).toEqual(['BTC/EUR']);
  expect(filterAndSortPairs(rows, { ...base, sortField: 'symbol', sortDir: -1 }).map(item => item.pair))
    .toEqual(['SOL/USDC', 'ETH/USD', 'BTC/USDT', 'BTC/EUR']);
});

test('actual market source retains approved geometry and exposes real keyboard controls', () => {
  const source = readFileSync(resolve(__dirname, '../../components/PairListSidebar.tsx'), 'utf8');
  expect(source).toContain("const REFERENCE_QUOTE_FILTERS = ['USDT', 'USD', 'USDC', 'EUR']");
  expect(source).toContain('stableSort: true');
  expect(source).toContain('SORT_SNAPSHOT_INTERVAL_MS = 20000');
  expect(source).toContain('className="pair-select"');
  expect(source).toContain('aria-pressed={favorites.has(tk.pair)}');
  expect(source).toContain("role={onResizeBy ? 'separator' : undefined}");
  expect(source).toContain("onResizeBy(event.key === 'ArrowLeft' ? -10 : 10)");
  // Duplicate/out-of-order request protection is now structural rather
  // than hand-rolled: the panel subscribes to the shared market-data store
  // (lib/marketDataStore), which runs ONE timer and ONE in-flight request
  // for the whole tab — so a second concurrent request, and therefore an
  // out-of-order response, cannot exist. That is strictly stronger than
  // the `requestPending`/`requestSequence` guards it replaces, and is
  // proven in lib/__tests__/marketDataStore.test.ts.
  expect(source).toContain('useMarketTickers(4000)');
  expect(source).not.toContain('setInterval');
  expect(source).not.toContain('api.getExternalTickers');
  expect(source).not.toContain('api.getExternalRankings');
  expect(source).toContain("event.key !== '/'");
  expect(source).not.toContain('useSpotPeriodReferences');
  const css = readFileSync(resolve(__dirname, '../../components/SpotMarketControls.css'), 'utf8');
  expect(css).not.toContain('display: contents');
  expect(css).toContain('grid-column: 2 / -1');
  expect(css).toContain('grid-template-columns: subgrid');
  expect(css).toContain('21px minmax(50px, 1fr) 60px 42px');
});

test('actual controls keep native favourite separate from pair selection and resize by keyboard', () => {
  const frontend = resolve(__dirname, '../../..');
  const req = createRequire(resolve(frontend, 'package.json'));
  const React = req('react');
  const source = readFileSync(resolve(frontend, 'src/components/PairListSidebar.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const fixture = [row('BTC/USDT'), row('ETH/USDT'), row('MOG/USDT', '0.000000123456'),
    row('COQ/USDT', '0.000000234567'), row('BTT/USDT', '0.000000345678')];
  const favorite = jest.fn(), changed = jest.fn(), resized = jest.fn();
  const output: Record<string, any> = {};
  new Function('require', 'exports', compiled)((name: string) => {
    if (name.endsWith('.css')) return {};
    if (name === 'react') return { ...React, forwardRef: (fn: any) => fn, useEffect: () => {}, useMemo: (fn: any) => fn(),
      useImperativeHandle: () => {}, useRef: (value: any) => ({ current: value }),
      useState: (value: any) => [Array.isArray(value) ? fixture : typeof value === 'function' ? value() : value, () => {}] };
    if (name === '../lib/pairList') return pairHelpers;
    if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key }) };
    if (name === '../lib/useFavorites') return { useFavorites: () => ({ favorites: new Set(['BTC/USDT']), toggle: favorite }) };
    if (name === '../lib/spotOrderBook') return spotBookHelpers;
    if (name === '../lib/priceChange') return { parseChangePercent: Number };
    if (name === '../lib/api') return { api: {} };
    if (name === '../lib/useMarketData') {
      return { useMarketTickers: () => ({ tickers: new Map(), loading: false, error: false, stale: false, refresh: () => {} }) };
    }
    if (name === './CryptoIcon') return { CryptoIcon: () => null };
    return req(name);
  }, output);
  const tree = output.PairListSidebar({ pair: 'ETH/USDT', onChange: changed, onResizeBy: resized, marketWidth: 258 }, null);
  const elements: any[] = [];
  const walk = (node: any) => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(walk); return; }
    elements.push(node); walk(node.props?.children); };
  walk(tree);
  const priceTexts = elements.filter(node => node.props?.className === 'p-price').map(node => node.props.children);
  for (const actualPrice of ['0.000000123456', '0.000000234567', '0.000000345678']) {
    expect(priceTexts).toContain(actualPrice);
  }
  expect(priceTexts).not.toContain('0');
  const star = elements.find(node => node.type === 'button' && node.props?.['aria-label'] === 'trade.favorites: BTC/USDT');
  expect(star.props['aria-pressed']).toBe(true);
  const stopPropagation = jest.fn();
  star.props.onClick({ stopPropagation });
  expect(stopPropagation).toHaveBeenCalledTimes(1); expect(favorite).toHaveBeenCalledWith('BTC/USDT');
  expect(changed).not.toHaveBeenCalled();
  const select = elements.find(node => node.type === 'button' && node.props?.className === 'pair-select' && node.props['aria-label'] === 'BTC/USDT');
  select.props.onClick(); expect(changed).toHaveBeenCalledWith('BTC/USDT');
  const separator = elements.find(node => node.props?.role === 'separator');
  expect(separator.props.tabIndex).toBe(0); expect(separator.props['aria-valuenow']).toBe(258);
  const preventDefault = jest.fn();
  for (const key of ['ArrowLeft', 'ArrowRight', 'Enter']) separator.props.onKeyDown({ key, preventDefault });
  expect(resized.mock.calls).toEqual([[-10], [10]]); expect(preventDefault).toHaveBeenCalledTimes(2);
  for (const button of elements.filter(node => node.type === 'button')) {
    expect(React.Children.toArray(button.props.children).some((child: any) => child?.type === 'button')).toBe(false);
  }
});
