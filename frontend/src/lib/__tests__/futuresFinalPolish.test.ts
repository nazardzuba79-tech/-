import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as bookMath from '../spotOrderBook';
import * as futuresMath from '../futuresMath';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const source = (path: string) => readFileSync(resolve(frontend, 'src', path), 'utf8');
const pending = () => new Promise<any>(() => {});
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

/** Execute the real TSX callbacks with isolated hooks/API; no network or money writes. */
function mount(file: string, overrides: Record<string, any> = {}) {
  let index = 0;
  const hooks: any[] = [], effects: (() => void)[] = [];
  const components: Record<string, any> = {};
  const api = new Proxy(overrides.api ?? {}, { get: (target, key: string) => target[key] ?? pending });
  const react = { ...React, memo: (fn: any) => fn,
    useState(initial: any) {
      const i = index++;
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], (next: any) => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }];
    },
    useRef(initial: any) { const i = index++; return hooks[i] ?? (hooks[i] = { current: initial }); },
    useMemo(fn: any) { return fn(); }, useCallback(fn: any) { return fn; },
    useEffect(fn: any, deps: any[]) {
      const i = index++, previous = hooks[i];
      if (!previous || deps.some((value, n) => !Object.is(value, previous.deps[n]))) {
        hooks[i] = { deps, cleanup: undefined };
        effects.push(() => { previous?.cleanup?.(); hooks[i].cleanup = fn(); });
      }
    },
  };
  const output: any = {};
  const compiled = ts.transpileModule(source(file), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function('require', 'exports', 'window', compiled)((name: string) => {
    if (name === 'react') return react;
    if (name === '../lib/api') return { api, ApiError: Error };
    if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key }) };
    if (name === '../lib/toast') return { useToast: () => ({ success: jest.fn(), error: jest.fn() }) };
    if (name === '../lib/spotOrderBook') return bookMath;
    if (name === '../lib/formatNumber') return { formatPrice: String };
    if (name === '../lib/futuresMath') return futuresMath;
    if (name === '../lib/krakenSocket') return { krakenSocket: overrides.socket };
    if (name === '../lib/tradingMode') return { rememberTradingMode: jest.fn() };
    if (name === 'react-router-dom') return { useNavigate: () => jest.fn(), useSearchParams: () => [overrides.params] };
    if (name.endsWith('.css')) return {};
    if (name.startsWith('./') || name.startsWith('../components/')) {
      const label = name.split('/').pop()!;
      const component = components[label] ?? (components[label] = () => null);
      return { [label]: component };
    }
    return req(name);
  }, output, { setTimeout, clearTimeout, setInterval, clearInterval });
  return {
    components,
    render(props: any = {}) {
      index = 0;
      const tree = output[Object.keys(output)[0]](props);
      effects.splice(0).forEach(fn => fn());
      return tree;
    },
  };
}
function nodes(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
}
const level = (price: string, quantity = '1') => ({ price, quantity });
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test.each([
  ['BTC/USDT', '79100.1', '79100.2'], ['ETH/USDT', '2483.11', '2483.12'],
  ['XRP/USDT', '1.39351', '1.39352'], ['DOGE/USDT', '0.094321', '0.094322'],
])('%s uses dynamic selectable grouping and exact row-to-Limit prices', (pair, bid, ask) => {
  const component = mount('components/OrderBookPanel.tsx');
  const picked = jest.fn();
  const raw = { bids: [level(bid, '3.5')], asks: [level(ask, '2.25')] };
  const original = JSON.stringify(raw);
  const props = { ...raw, pair, spotPrecision: true, onPickPrice: picked };
  let tree = component.render(props);
  const select = nodes(tree).find(n => n.type === 'select');
  const steps = nodes(select).filter(n => n.type === 'option').map(n => n.props.value);
  expect(steps).toEqual(bookMath.spotGroupSteps((Number(bid) + Number(ask)) / 2));
  for (const step of [steps[0], steps[4], steps[5]]) {
    select.props.onChange({ target: { value: String(step) } });
    tree = component.render(props);
    const rows = nodes(tree).filter(n => typeof n.type === 'function' && n.props.spotStep !== undefined);
    expect(rows).toHaveLength(2);
    for (const element of rows) {
      const row = element.type(element.props);
      const expected = bookMath.spotLevelPrice(element.props.level.price, step);
      expect(Number(expected)).toBeGreaterThan(0);
      expect(Number(expected)).toBe(element.props.level.price);
      row.props.onClick();
      expect(picked).toHaveBeenLastCalledWith(expected);
      const preventDefault = jest.fn();
      row.props.onKeyDown({ key: 'Enter', preventDefault });
      expect(picked).toHaveBeenLastCalledWith(expected);
    }
  }
  expect(JSON.stringify(raw)).toBe(original);
});

test('Futures wires dynamic precision, rejects prior-pair REST and preserves repeated selection events', async () => {
  const requests: { symbol: string; resolve: (value: any) => void }[] = [];
  const listeners: { symbol: string; callback: (value: any) => void }[] = [];
  const params = new URLSearchParams();
  const page = mount('pages/FuturesPage.tsx', {
    params,
    api: { getExternalOrderBook: (symbol: string) => new Promise(resolve => requests.push({ symbol, resolve })) },
    socket: { subscribeBook: (symbol: string, callback: any) => { listeners.push({ symbol, callback }); return jest.fn(); } },
  });
  const part = (tree: any, name: string) => nodes(tree).find(n => n.type === page.components[name]);
  let tree = page.render();
  const btc = { bids: [level('79000.1')], asks: [level('79000.2')] };
  listeners[0].callback(btc);
  tree = page.render();
  expect(part(tree, 'OrderBookPanel').props.spotPrecision).toBe(true);
  expect(part(tree, 'OrderBookPanel').props.bids).toEqual(btc.bids);
  part(tree, 'FuturesPairList').props.onChange('DOGE/USDT');
  tree = page.render();
  expect(part(tree, 'OrderBookPanel').props.bids).toEqual([]);
  expect(part(tree, 'OrderBookPanel').key).toBe('DOGE/USDT');
  requests[0].resolve(btc); await tick();
  tree = page.render();
  expect(part(tree, 'OrderBookPanel').props.bids).toEqual([]);
  const doge = { bids: [level('0.094321')], asks: [level('0.094322')] };
  listeners[1].callback(doge);
  requests[1].resolve(btc); await tick(); // Delayed REST cannot overwrite newer WS.
  tree = page.render();
  expect(part(tree, 'OrderBookPanel').props.bids).toEqual(doge.bids);
  part(tree, 'OrderBookPanel').props.onPickPrice('0.09432');
  tree = page.render();
  expect(part(tree, 'FuturesOrderForm').props.pickedPrice).toBe('0.09432');
  expect(part(tree, 'FuturesOrderForm').props.pickedPriceSequence).toBe(1);
  part(tree, 'OrderBookPanel').props.onPickPrice('0.09432');
  tree = page.render();
  expect(part(tree, 'FuturesOrderForm').props.pickedPriceSequence).toBe(2);
});

test('only the translated leverage table is collapsed; repeat picks retain exact form price and select Limit', async () => {
  const config = { minLeverage: 1, maxLeverage: 100, newAccountMaxLeverage: 20, newAccountPeriodDays: 30,
    highLeverageWarningThreshold: 20, leverageTiers: [{ notionalCap: 50000, maxLeverage: 100, maintenanceMarginRate: 0.004 }] };
  const form = mount('components/FuturesOrderForm.tsx', { api: { getFuturesConfig: () => Promise.resolve(config) } });
  const props = { symbol: 'DOGE/USDT', onPlaced: jest.fn(), pickedPrice: '0.09432', pickedPriceSequence: 1 };
  form.render(props); await tick();
  let tree = form.render(props);
  const details = nodes(tree).find(n => n.type === 'details');
  expect(details.props.open).toBeUndefined();
  expect(nodes(details).find(n => n.type === 'summary').props.children).toBe('futures.leverageTiersTitle');
  expect(nodes(details).filter(n => n.type === 'table')).toHaveLength(1);
  expect(nodes(details).some(n => n.type === 'form' || n.type === form.components.FuturesAccountSummary)).toBe(false);
  const priceInput = () => nodes(tree).find(n => n.type === 'input' && n.props.placeholder === '0.00');
  expect(priceInput().props.value).toBe('0.09432');
  priceInput().props.onChange({ target: { value: '0.08' } });
  nodes(tree).find(n => n.type === 'button' && n.props.children === 'trade.marketOrder').props.onClick();
  tree = form.render(props);
  expect(priceInput()).toBeUndefined();
  form.render({ ...props, pickedPriceSequence: 2 });
  tree = form.render({ ...props, pickedPriceSequence: 2 });
  expect(priceInput().props.value).toBe('0.09432');
  expect(nodes(tree).some(n => n.type === form.components.FuturesAccountSummary)).toBe(true);
});
