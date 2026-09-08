import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import ts from 'typescript';
import * as presentation from '../cfdPresentation';
import * as math from '../futuresMath';

const root = resolve(__dirname, '../../..');
const req = createRequire(resolve(root, 'package.json'));
const React = req('react');
const read = (file: string) => readFileSync(resolve(root, 'src', file), 'utf8');
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const pending = () => new Promise<any>(() => {});
const rows = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'].map(symbol =>
  ({ symbol, name: symbol, price: symbol === 'XAUUSD' ? '2400.125' : '1.12345', changePercent24h: '0.23' }));
const nodes = (tree: any): any[] => Array.isArray(tree) ? tree.flatMap(nodes)
  : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = (tree: any): string => Array.isArray(tree) ? tree.map(text).join('')
  : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null ? '' : String(tree);

/** Same isolated real-TSX hook/callback architecture as Futures preservation tests.
 * API fixtures stay in tests; no request can leave this harness. */
function mount(file: string, options: any = {}) {
  let index = 0;
  const hooks: any[] = [], effects: (() => void)[] = [], components: Record<string, any> = {};
  const react = { ...React,
    useState(initial: any) { const at = index++; if (!(at in hooks)) hooks[at] = typeof initial === 'function' ? initial() : initial;
      return [hooks[at], (value: any) => { hooks[at] = typeof value === 'function' ? value(hooks[at]) : value; }]; },
    useRef(initial: any) { const at = index++; return hooks[at] ??= { current: initial }; },
    useCallback(fn: any, deps: any[]) { const at = index++, old = hooks[at];
      if (!old || deps.some((d, i) => d !== old.deps[i])) hooks[at] = { fn, deps }; return hooks[at].fn; },
    useEffect(fn: any, deps: any[]) { const at = index++, old = hooks[at];
      if (!old || deps.some((d, i) => d !== old.deps[i])) { hooks[at] = { deps }; effects.push(() => { old?.cleanup?.(); hooks[at].cleanup = fn(); }); } },
  };
  const api = new Proxy(options.api ?? {}, { get: (obj, key: string) => obj[key] ?? pending });
  const compiled = ts.transpileModule(read(file), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const output: any = {};
  new Function('require', 'exports', 'window', compiled)((name: string) => {
    if (name === 'react') return react;
    if (name.endsWith('/api')) return { api, ApiError: Error };
    if (name.endsWith('/i18n')) return { useLanguage: () => ({ t: (key: string) => key, lang: 'en' }) };
    if (name.endsWith('/toast')) return { useToast: () => ({ success: jest.fn(), error: jest.fn() }) };
    if (name.endsWith('/cfdPresentation')) return presentation;
    if (name.endsWith('/futuresMath')) return math;
    if (name.endsWith('/priceChange')) return { parseChangePercent: Number };
    if (name.endsWith('/useCfdTickers')) return { useCfdTickers: () => options.feed };
    if (name.endsWith('/krakenSocket')) return { krakenSocket: { subscribeBook: () => () => {} } };
    if (name.endsWith('/tradingMode')) return { rememberTradingMode: jest.fn() };
    if (name === 'react-router-dom') return { useSearchParams: () => [options.params] };
    if (name.endsWith('.css')) return {};
    if (name === './Skeleton') { components.SkeletonRow ??= () => null; return { SkeletonRow: components.SkeletonRow }; }
    if (name.startsWith('./') || name.startsWith('../components/')) {
      const label = name.split('/').pop()!; components[label] ??= () => null; return { [label]: components[label] };
    }
    return req(name);
  }, output, { setInterval, clearInterval });
  return { components, render(props = {}) { index = 0; const fn: any = Object.values(output).find(value => typeof value === 'function'); const tree = fn(props); effects.splice(0).forEach(fn => fn()); return tree; } };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test.each([
  ['XAUUSD', '2400.12', '2,400.12'], ['EURUSD', '1.12345', '1.12345'], ['GBPUSD', '1.30123', '1.30123'],
  ['USDJPY', '149.123', '149.123'], ['AUDUSD', '0.65123', '0.65123'], ['USDCAD', '1.34123', '1.34123'],
])('%s retains appropriate displayed precision', (symbol, value, expected) => expect(presentation.formatCfdPrice(value, symbol)).toBe(expected));
test('invalid/missing reference prices are not fabricated', () => {
  for (const value of ['', 'NaN', 'Infinity', '-1', '0']) expect(presentation.formatCfdPrice(value, 'EURUSD')).toBe('—');
});
test.each(['?market=cfd', '?market=cfd&symbol=XAUUSD', '?market=cfd&symbol=EURUSD', '?market=cfd&symbol=USDJPY', '?market=cfd&symbol=INVALID'])
('TradePage %s renders only the real CFD three-column terminal', query => {
  const options = { params: new URLSearchParams(query), feed: { tickers: rows, configured: true, loadError: false, reload: jest.fn() } };
  const page = mount('pages/TradePage.tsx', options), tree = page.render(), all = nodes(tree);
  expect(tree.props.className).toBe('trade-terminal cfd-terminal');
  const symbol = query.includes('EURUSD') ? 'EURUSD' : query.includes('USDJPY') ? 'USDJPY' : 'XAUUSD';
  for (const component of ['CfdChart', 'CfdOrderForm', 'CfdInstrumentList', 'CfdTickerBar']) {
    expect(all.find(n => n.type === page.components[component]).props.symbol).toBe(symbol);
  }
  expect(all.some(n => n.type === page.components.OrderBookPanel)).toBe(false);
  expect(all.find(n => n.type === page.components.Nav).props).toMatchObject({ staticTicker: true, tickerFitToWidth: true });
  expect(all.some(n => n.type === page.components.ConnectionBanner)).toBe(true);
});
test('manual instruments survive ticker polls; URL, Spot/CFD and back/forward update without remount', () => {
  const options = { params: new URLSearchParams('?market=cfd&symbol=EURUSD'), feed: { tickers: rows, configured: true } };
  const page = mount('pages/TradePage.tsx', options);
  const selected = () => nodes(page.render()).find(n => n.type === page.components.CfdChart).props.symbol;
  page.render();
  nodes(page.render()).find(n => n.type === page.components.CfdInstrumentList).props.onChange('GBPUSD');
  expect(selected()).toBe('GBPUSD');
  options.feed = { ...options.feed, tickers: rows.map(r => ({ ...r })) };
  expect(selected()).toBe('GBPUSD');
  options.params = new URLSearchParams('?market=cfd&symbol=USDJPY'); page.render(); expect(selected()).toBe('USDJPY');
  options.params = new URLSearchParams(''); page.render(); expect(page.render().props.className).toBe('trade-terminal spot-terminal');
  options.params = new URLSearchParams('?market=cfd&symbol=EURUSD'); page.render(); expect(selected()).toBe('EURUSD');
  options.params = new URLSearchParams('?market=cfd&symbol=BOGUS'); page.render(); expect(selected()).toBe('XAUUSD');
});
test('provider subset and unloaded feed both have a safe instrument fallback', () => {
  expect(presentation.resolveCfdSymbol('INVALID', [])).toBe('XAUUSD');
  expect(presentation.resolveCfdSymbol('EURUSD', [])).toBe('EURUSD');
  expect(presentation.resolveCfdSymbol('INVALID', [rows[1]])).toBe('EURUSD');
});
test('instrument loading, unconfigured and error/retry remain distinct; no fabricated instrument rows', () => {
  const list = mount('components/CfdInstrumentList.tsx'), retry = jest.fn();
  const props = { symbol: 'XAUUSD', tickers: [], configured: true, loadError: false, onRetry: retry, onChange: jest.fn() };
  expect(nodes(list.render(props)).filter(n => n.type === list.components.SkeletonRow)).toHaveLength(7);
  expect(nodes(list.render(props)).filter(n => n.type === 'button')).toHaveLength(0); // no manufactured prices
  expect(text(list.render({ ...props, configured: false }))).toContain('trade.cfdUnavailable');
  const failed = list.render({ ...props, loadError: true });
  nodes(failed).find(n => n.type === 'button').props.onClick(); expect(retry).toHaveBeenCalledTimes(1);
  expect(text(failed)).toContain('trade.loadPairsError');
});
test('real ticker hook keeps 60s polling and exposes retry without replacing its data source', async () => {
  const getCfdTickers = jest.fn().mockRejectedValueOnce(new Error('provider')).mockResolvedValue({ configured: false, tickers: [] });
  const hook = mount('lib/useCfdTickers.ts', { api: { getCfdTickers } });
  hook.render(); await tick(); expect(hook.render().loadError).toBe(true);
  hook.render().reload(); await tick(); expect(hook.render()).toMatchObject({ configured: false, loadError: false, tickers: [] });
  jest.advanceTimersByTime(60000); expect(getCfdTickers).toHaveBeenCalledTimes(3);
});
/**
 * Malformed CFD payloads.
 *
 * A 200 whose `tickers` is not an array used to flow straight into state,
 * and `resolveCfdSymbol` read `.length` off it on the next render — which
 * took the whole Trade page down through the error boundary. These assert
 * the two halves of the fix: the page survives, and it never invents data
 * to survive with.
 */
const feedFor = async (payload: any) => {
  const getCfdTickers = jest.fn().mockResolvedValue(payload);
  const hook = mount('lib/useCfdTickers.ts', { api: { getCfdTickers } });
  hook.render(); await tick();
  return hook.render();
};

test.each([
  ['tickers missing entirely', {}],
  ['tickers null', { configured: true, tickers: null }],
  ['tickers an object', { configured: true, tickers: { XAUUSD: '2400' } }],
  ['tickers a string', { configured: true, tickers: 'XAUUSD' }],
  ['whole body null', null],
  ['whole body a string', 'service unavailable'],
  ['rows present but none usable', { configured: true, tickers: [null, 42, {}, { name: 'Gold' }] }],
])('malformed response (%s) surfaces the error state instead of crashing', async (_label, payload) => {
  const state = await feedFor(payload);
  // Always an array, so resolveCfdSymbol and the list can never throw.
  expect(Array.isArray(state.tickers)).toBe(true);
  expect(state.tickers).toEqual([]);
  expect(state.loadError).toBe(true);
  // Not an assertion that CFD is unconfigured — that would be a claim this
  // response does not support.
  expect(state.configured).toBe(true);
  // And the value the crash came from is safe to read.
  expect(() => presentation.resolveCfdSymbol('XAUUSD', state.tickers)).not.toThrow();
  expect(presentation.resolveCfdSymbol('XAUUSD', state.tickers)).toBe('XAUUSD');
});

test('a malformed refresh keeps the last good instrument rows on screen', async () => {
  const getCfdTickers = jest.fn()
    .mockResolvedValueOnce({ configured: true, tickers: rows })
    .mockResolvedValue({ configured: true, tickers: undefined });
  const hook = mount('lib/useCfdTickers.ts', { api: { getCfdTickers } });
  hook.render(); await tick();
  expect(hook.render().tickers.map((t: any) => t.symbol)).toEqual(rows.map(r => r.symbol));

  hook.render().reload(); await tick();
  const state = hook.render();
  // Last good data preserved, not blanked and not replaced with nonsense.
  expect(state.tickers.map((t: any) => t.symbol)).toEqual(rows.map(r => r.symbol));
  expect(state.tickers[0].price).toBe('2400.125');
  expect(state.loadError).toBe(true);
});

test('a well-formed empty list is truth, not an error', async () => {
  const state = await feedFor({ configured: false, tickers: [] });
  expect(state.tickers).toEqual([]);
  expect(state.loadError).toBe(false);
  expect(state.configured).toBe(false);
});

test('unusable rows are dropped without fabricating a price for them', async () => {
  const state = await feedFor({
    configured: true,
    tickers: [
      { symbol: 'XAUUSD', name: 'Gold', price: '2400.125', changePercent24h: '0.23' },
      { symbol: '', name: 'No symbol', price: '1.1' },
      { symbol: 'EURUSD', name: 'Euro', price: null },
      { symbol: 'GBPUSD', name: 'Pound', price: 'not-a-number' },
      null,
    ],
  });
  expect(state.tickers).toHaveLength(1);
  expect(state.tickers[0]).toEqual({ symbol: 'XAUUSD', name: 'Gold', price: '2400.125', changePercent24h: '0.23' });
  // The dropped rows are absent, not present with a manufactured 0.
  expect(JSON.stringify(state.tickers)).not.toContain('"price":"0"');
  expect(state.loadError).toBe(false);
});

test('a real zero and a numeric price survive; an unknown 24h change stays absent', async () => {
  const state = await feedFor({
    configured: true,
    tickers: [
      { symbol: 'XAUUSD', name: 'Gold', price: '0', changePercent24h: '0' },
      { symbol: 'EURUSD', name: 'Euro', price: 1.12345, changePercent24h: null },
    ],
  });
  // Zero is a fact the server is entitled to report.
  expect(state.tickers[0]).toEqual({ symbol: 'XAUUSD', name: 'Gold', price: '0', changePercent24h: '0' });
  // Unknown change is ABSENT — the contract that makes it render as a dash
  // rather than as 0.00%.
  expect(state.tickers[1]).toEqual({ symbol: 'EURUSD', name: 'Euro', price: '1.12345' });
  expect('changePercent24h' in state.tickers[1]).toBe(false);
});

test('a row without a name falls back to its symbol rather than an empty label', async () => {
  const state = await feedFor({ configured: true, tickers: [{ symbol: 'USDJPY', price: '155.25' }] });
  expect(state.tickers[0]).toEqual({ symbol: 'USDJPY', name: 'USDJPY', price: '155.25' });
});

test('MARKET/ISOLATED form uses original sizing, leverage, USDT margin and exact open payload', async () => {
  const config = { minLeverage: 1, maxLeverage: 100, highLeverageWarningThreshold: 20, leverageTiers: [{ notionalCap: 50000, maxLeverage: 100, maintenanceMarginRate: .004 }] };
  const openCfdPosition = jest.fn().mockResolvedValue({}), getFuturesBalances = jest.fn().mockResolvedValue([{ asset: 'USDT', available: '100' }]);
  const form = mount('components/CfdOrderForm.tsx', { api: { getCfdConfig: async () => config, getFuturesBalances, openCfdPosition } });
  const onPlaced = jest.fn(), props = { symbol: 'EURUSD', ticker: rows[1], onPlaced };
  form.render(props); await tick(); let tree = form.render(props);
  expect(text(tree)).toContain('trade.market'); expect(text(tree)).toContain('futures.isolated');
  expect(text(tree)).not.toMatch(/trade.limit|futures.cross|reduceOnly/);
  const slider = nodes(tree).find(n => n.type === form.components.LeverageSlider);
  expect(slider.props).toMatchObject({ min: 1, max: 100, warningThreshold: 20 }); slider.props.onChange(5);
  tree = form.render(props);
  const percents = nodes(tree).filter(n => n.props?.className?.startsWith('cfd-percentBtn'));
  expect(percents.map(n => text(n))).toEqual(['0%', '25%', '50%', '75%', '100%']);
  percents[2].props.onClick(); tree = form.render(props);
  expect(nodes(tree).find(n => n.type === 'input').props.value).toBe(((100 * .5 * 5) / 1.12345).toFixed(6));
  nodes(tree).find(n => text(n) === 'futures.sellShort' && n.type === 'button').props.onClick();
  tree = form.render(props); nodes(tree).find(n => n.type === 'input').props.onChange({ target: { value: '2.345678' } });
  tree = form.render(props); nodes(tree).find(n => n.type === 'form').props.onSubmit({ preventDefault: jest.fn() });
  expect(nodes(form.render(props)).find(n => n.props?.type === 'submit').props.disabled).toBe(true);
  await tick(); expect(openCfdPosition).toHaveBeenCalledWith({ symbol: 'EURUSD', side: 'SELL', quantity: '2.345678', leverage: 5 });
  expect(onPlaced).toHaveBeenCalledTimes(1); expect(nodes(form.render(props)).find(n => n.type === 'input').props.value).toBe('');
});
test('order error and unavailable-price submission state remain visible', async () => {
  const form = mount('components/CfdOrderForm.tsx', { api: { openCfdPosition: async () => { throw new Error('New account leverage restriction'); } } });
  const props = { symbol: 'XAUUSD', ticker: rows[0], onPlaced: jest.fn() };
  nodes(form.render(props)).find(n => n.type === 'form').props.onSubmit({ preventDefault: jest.fn() }); await tick();
  expect(nodes(form.render(props)).find(n => n.props?.role === 'alert').props.children).toBe('New account leverage restriction');
  expect(nodes(form.render({ ...props, ticker: undefined })).find(n => n.props?.type === 'submit').props.disabled).toBe(true);
});
test('positions/history preserve polling, close API, closing state, error and liquidation status', async () => {
  let finish: any;
  const closeCfdPosition = jest.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const position = { id: 'local-test-position', symbol: 'EURUSD', side: 'LONG', leverage: 10, size: '1', entryPrice: '1.1', markPrice: '1.2', liquidationPrice: '1', unrealizedPnl: '.1', roe: '1', realizedPnl: '-1', status: 'LIQUIDATED' };
  const getCfdPositions = jest.fn().mockResolvedValue([position]), getCfdPositionHistory = jest.fn().mockResolvedValue([position]);
  const panel = mount('components/CfdPositionsPanel.tsx', { api: { getCfdPositions, getCfdPositionHistory, closeCfdPosition } });
  panel.render({ refreshKey: 0 }); await tick(); let tree = panel.render({ refreshKey: 0 });
  nodes(tree).find(n => n.props?.className === 'cfd-closeBtn').props.onClick();
  expect(closeCfdPosition).toHaveBeenCalledWith('local-test-position');
  expect(nodes(panel.render({ refreshKey: 0 })).find(n => n.props?.className === 'cfd-closeBtn').props.disabled).toBe(true);
  finish({}); await tick(); panel.render({ refreshKey: 0 }); await tick();
  jest.advanceTimersByTime(4000); expect(getCfdPositions.mock.calls.length).toBeGreaterThanOrEqual(3);
  tree = panel.render({ refreshKey: 0 }); nodes(tree).find(n => n.props?.id === 'cfd-tab-history').props.onClick();
  panel.render({ refreshKey: 0 }); await tick(); tree = panel.render({ refreshKey: 0 });
  expect(getCfdPositionHistory).toHaveBeenCalledTimes(1); expect(text(tree)).toContain('LIQUIDATED');
  nodes(tree).find(n => n.props?.id === 'cfd-tab-open').props.onClick(); panel.render({ refreshKey: 0 }); await tick();
  closeCfdPosition.mockRejectedValueOnce(new Error('close rejected'));
  nodes(panel.render({ refreshKey: 0 })).find(n => n.props?.className === 'cfd-closeBtn').props.onClick(); await tick();
  expect(text(panel.render({ refreshKey: 0 }))).toContain('close rejected');
});
test.each([
  ['components/CfdOrderForm.tsx', '7ea457d76586624fac990ed610747461b3817fd4295a7cbe1a0bbb4a1f759b46'],
  ['components/CfdPositionsPanel.tsx', 'adb8a3d3e11a7ca16b8f47a06853b014e947e9a3cc0f4e7b7790fb8b85c33102'],
  ['pages/TradePage.tsx', 'c7397a4659e93fb98d1e50e956a2795b63726d6ae7768e81787fbe4adf86aac0'],
])('%s preserves original financial callbacks/hooks or complete Spot JSX from bfaf522', (file, expected) => {
  const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = sf.statements.find(n => ts.isFunctionDeclaration(n) && n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) as ts.FunctionDeclaration;
  const statements = [...fn.body!.statements], selected = file.includes('TradePage') ? statements.filter(ts.isReturnStatement).slice(-1) : statements.filter(n => !ts.isReturnStatement(n));
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.CarriageReturnLineFeed });
  const serialized = selected.map(n => printer.printNode(ts.EmitHint.Unspecified, n, sf)).join('\n').replace(/\r\n/g, '\n');
  expect(createHash('sha256').update(serialized).digest('hex')).toBe(expected);
});
test('all CSS selectors are scoped and chart stays on the unchanged real TradingView mapping', () => {
  const selectors: string[] = []; req('postcss').parse(read('pages/trade-terminal/CfdTerminal.css')).walkRules((rule: any) => selectors.push(...rule.selectors));
  expect(selectors.every(s => s.startsWith('.cfd-terminal ') || s.startsWith('.trade-terminal.cfd-terminal'))).toBe(true);
  const chart = read('components/CfdChart.tsx');
  for (const symbol of rows.map(r => r.symbol)) expect(chart).toContain(`${symbol}: '${symbol === 'XAUUSD' ? 'OANDA' : 'FX'}:${symbol}'`);
  expect(chart).toContain('https://s3.tradingview.com/tv.js'); expect(chart).toContain('autosize: true');
  expect(chart).toContain('[symbol, lang, containerId]');
  const executable = ts.createPrinter({ removeComments: true }).printFile(ts.createSourceFile('chart.tsx', chart, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  expect(executable).not.toMatch(/candles|orderBook|volume|funding|openInterest/);
});
test('CFD reference-price disclaimer matches the unchanged 60-second poll in every language', () => {
  const disclaimers = read('lib/i18n.tsx').split('\n').filter(line => line.includes("'trade.cfdPriceDisclaimer':"));
  expect(disclaimers).toHaveLength(7);
  expect(disclaimers.every(line => line.includes('60') && !line.includes('30'))).toBe(true);
  expect(read('lib/useCfdTickers.ts')).toContain('const POLL_MS = 60_000');
});
