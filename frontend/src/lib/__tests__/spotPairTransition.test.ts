import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as helpers from '../spotOrderBook';
import * as numberFormat from '../formatNumber';

const frontend = resolve(__dirname, '../../..');
const requireFrontend = createRequire(resolve(frontend, 'package.json'));
const React = requireFrontend('react');
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const pageSource = readFileSync(resolve(frontend, 'src/pages/TradePage.tsx'), 'utf8');
const parsed = ts.createSourceFile('TradePage.tsx', pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'visibleBook') declaration = `const ${node.getText(parsed)};`;
  ts.forEachChild(node, visit);
}
visit(parsed);
if (!declaration) throw new Error('Actual parent book provenance selection not found');
const selectVisible = new Function('book', 'pair', `${compile(declaration)}; return visibleBook;`);
const book = (pair: string, bid: string, ask: string) => ({ pair, bids: [{ price: bid, quantity: '20' }], asks: [{ price: ask, quantity: '30' }] });
const walk = (node: any, result: any[] = []): any[] => {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) { node.forEach(item => walk(item, result)); return result; }
  result.push(node); walk(node.props?.children, result); return result;
};

test('actual parent synchronously withholds mismatched depth before any new-pair effect', () => {
  const btc = book('BTC/USDT', '80000', '80010'), mog = book('MOG/USDT', '0.0000001090', '0.0000001091');
  expect(selectVisible(btc, 'BTC/USDT')).toBe(btc);
  expect(selectVisible(btc, 'MOG/USDT')).toEqual({ bids: [], asks: [] });
  expect(selectVisible(mog, 'BTC/USDT')).toEqual({ bids: [], asks: [] });
  expect(pageSource).toContain('setBook({ pair, bids: res.bids, asks: res.asks })');
  expect(pageSource).toContain('setBook({ pair, bids: snapshot.bids, asks: snapshot.asks })');
  expect(pageSource).toContain('bids={visibleBook.bids}'); expect(pageSource).toContain('asks={visibleBook.asks}');
});

test('actual stateful BTC → MOG → BTC book initializes grouping before paint and retains manual same-pair steps', () => {
  const state: any[] = [], effects: (() => void)[] = [];
  let index = 0;
  const output: Record<string, any> = {};
  const source = readFileSync(resolve(frontend, 'src/components/OrderBookPanel.tsx'), 'utf8');
  new Function('require', 'exports', compile(source))((name: string) => {
    if (name === 'react') return { ...React, memo: (fn: any) => fn,
      useMemo: (fn: any) => fn(), useEffect: (fn: () => void) => effects.push(fn),
      useRef: (initial: any) => { const at = index++; return state[at] ??= { current: initial }; },
      useState: (initial: any) => { const at = index++; if (!(at in state)) state[at] = typeof initial === 'function' ? initial() : initial;
        return [state[at], (value: any) => { state[at] = typeof value === 'function' ? value(state[at]) : value; }]; } };
    if (name === '../lib/spotOrderBook') return helpers;
    if (name === '../lib/formatNumber') return numberFormat;
    if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key }) };
    return requireFrontend(name);
  }, output);
  const render = (snapshot: ReturnType<typeof book>, pair = snapshot.pair) => {
    index = 0; effects.length = 0;
    const elements = walk(output.OrderBookPanel({ ...selectVisible(snapshot, pair), pair, spotPrecision: true }));
    return { select: elements.find(node => node.type === 'select'), rows: elements.filter(node => node.props?.side === 'BUY' || node.props?.side === 'SELL') };
  };
  const flush = () => effects.splice(0).forEach(effect => effect());
  const btc = book('BTC/USDT', '80000', '80010'), mog = book('MOG/USDT', '0.0000001090', '0.0000001091');
  let view = render(btc); flush();
  view.select.props.onChange({ target: { value: '10' } });
  expect(render(btc).select.props.value).toBe(10);
  expect(render(btc, 'MOG/USDT').rows).toEqual([]); flush();
  view = render(mog); // Intentionally assert BEFORE effects run.
  expect(view.select.props.value).toBe(helpers.defaultSpotGroupStep(0.00000010905));
  expect(view.select.props.value).toBeLessThan(0.000000001);
  expect(view.rows).toHaveLength(2);
  for (const row of view.rows) expect(row.props.level.price).toBeLessThan(0.000001);
  flush();
  const manual = helpers.spotGroupSteps(0.00000010905)[0];
  view.select.props.onChange({ target: { value: String(manual) } });
  expect(render(book('MOG/USDT', '0.0000001190', '0.0000001191')).select.props.value).toBe(manual); flush();
  expect(render(mog, 'BTC/USDT').rows).toEqual([]); flush();
  view = render(btc);
  expect(view.select.props.value).toBe(10);
  expect(view.rows).toHaveLength(2);
  expect(view.rows.every(row => row.props.level.price > 70000)).toBe(true);
});

function renderTicker(spotPrecision: boolean) {
  const output: Record<string, any> = {};
  const stats = { lastPrice: 0.0000001091, high24h: 0.0000001191, low24h: 0.0000000991,
    changePercent: 1, volume24h: 2000000, quoteVolume24h: 200 };
  new Function('require', 'exports', compile(readFileSync(resolve(frontend, 'src/components/TickerBar.tsx'), 'utf8')))((name: string) => {
    if (name === 'react') return { ...React, useEffect: () => {}, useState: () => [stats, () => {}] };
    if (name === '../lib/spotOrderBook') return helpers;
    if (name === '../lib/formatNumber') return numberFormat;
    if (name === '../lib/api') return { api: {} };
    if (name === '../lib/priceChange') return { parseChangePercent: Number };
    if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key }) };
    return requireFrontend(name);
  }, output);
  return requireFrontend('react-dom/server').renderToStaticMarkup(React.createElement(output.TickerBar, { pair: 'MOG/USDT', spotPrecision }));
}

test('Spot ticker displays real sub-six-decimal last/high/low prices instead of zero', () => {
  const html = renderTicker(true);
  for (const price of ['0.0000001091', '0.0000001191', '0.0000000991']) expect(html).toContain(price);
  expect(html).not.toContain('>0</span>');
});

test('default ticker formatter stays unchanged; only Spot header and Spot market-info opt in', () => {
  expect(renderTicker(false)).toContain('>0</span>');
  expect(pageSource).toContain('<TickerBar key={pair} pair={pair} spotPrecision');
  const source = readFileSync(resolve(frontend, 'src/components/OrderForm.tsx'), 'utf8');
  expect(source).toContain('formatSpotBookNumber(marketPrice)');
  expect(source).toContain('formatSpotBookNumber(marketStats.high24h)');
  expect(source).toContain('formatSpotBookNumber(marketStats.low24h)');
});
