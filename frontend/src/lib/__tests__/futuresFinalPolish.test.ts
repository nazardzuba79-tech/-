import * as terminalPresentation from '../terminalPresentation';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as bookMath from '../spotOrderBook';
import * as futuresMath from '../futuresMath';
import * as assetReads from '../../components/spotOrderPresentation';
import { LEVERAGE_TIERS } from '../../../../src/config/futuresConfig';

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

  /**
   * `/futures/config` is read through the one shared store now, not from a
   * mount effect in each component (see lib/futuresConfigStore). The stub
   * below resolves the SAME `getFuturesConfig` this test already provides,
   * on the same tick the old effect settled on — so every assertion runs
   * against exactly the config it always did, from exactly the render it
   * always did.
   */
  let sharedFuturesConfig: any = null;
  const stubbedConfigFetch = (overrides.api ?? {}).getFuturesConfig;
  if (stubbedConfigFetch) {
    void Promise.resolve(stubbedConfigFetch()).then((c: any) => { sharedFuturesConfig = c; }).catch(() => {});
  }
  const futuresConfigModule = {
    useFuturesConfig: () => ({
      config: sharedFuturesConfig,
      loading: sharedFuturesConfig === null,
      failed: false,
      loaded: sharedFuturesConfig !== null,
    }),
    futuresConfigStore: {
      getState: () => futuresConfigModule.useFuturesConfig(),
      ensure: () => {},
      load: () => Promise.resolve(sharedFuturesConfig),
      refresh: () => Promise.resolve(sharedFuturesConfig),
      subscribe: () => () => {},
    },
  };

  const react = { ...React, memo: (fn: any) => fn,
    useState(initial: any) {
      const i = index++;
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], (next: any) => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }];
    },
    useRef(initial: any) { const i = index++; return hooks[i] ?? (hooks[i] = { current: initial }); },
    useMemo(fn: any) { return fn(); },
    useCallback(fn: any, deps: any[]) {
      const i = index++, previous = hooks[i];
      if (!previous || deps.some((value, n) => !Object.is(value, previous.deps[n]))) hooks[i] = { deps, fn };
      return hooks[i].fn;
    },
    useEffect(fn: any, deps: any[]) {
      const i = index++, previous = hooks[i];
      if (!previous || deps.some((value, n) => !Object.is(value, previous.deps[n]))) {
        hooks[i] = { deps, cleanup: undefined };
        effects.push(() => { previous?.cleanup?.(); hooks[i].cleanup = fn(); });
      }
    },
  };
  // The futures account resources now come from ONE shared store
  // (lib/futuresAccountStore) rather than each component's own
  // `setInterval`. This shim reimplements the store's CONTRACT on top of
  // the same `api` proxy these tests already stub, so every assertion below
  // still exercises the real component against the real API surface: same
  // endpoints, same call counts, same Spot/Futures separation. The store
  // itself is covered separately by futuresAccountStore.test.ts.
  const blankResource = () => ({ data: null, loading: false, refreshing: false, failed: false, loaded: false, fetchedAt: 0 });
  const accountFetchers: Record<string, () => Promise<any>> = {
    balances: () => api.getFuturesBalances(),
    positions: () => api.getFuturesPositions(),
    orders: () => api.getMyFuturesOrders('OPEN,PARTIALLY_FILLED'),
    positionHistory: () => api.getFuturesPositionHistory(),
  };
  let accountState: any = {
    balances: blankResource(), positions: blankResource(),
    orders: blankResource(), positionHistory: blankResource(),
  };
  let publishAccount: (next: any) => void = () => {};
  // The real store keeps ONE in-flight request per resource and lets
  // concurrent callers join it. Without modelling that here, the shim would
  // count two calls where the app issues one.
  const accountInFlight: Record<string, Promise<any> | null> = {};
  const loadAccount = (keys: string[]) => keys.forEach(key => {
    if (accountInFlight[key]) return;
    accountInFlight[key] = accountFetchers[key]()
    .then((data: any) => {
      accountState = { ...accountState, [key]: { ...accountState[key], data, loaded: true, loading: false, refreshing: false, failed: false, fetchedAt: 1 } };
      publishAccount(accountState);
    })
    .catch(() => {
      accountState = { ...accountState, [key]: { ...accountState[key], loaded: true, loading: false, refreshing: false, failed: true } };
      publishAccount(accountState);
    })
    .finally(() => { accountInFlight[key] = null; });
  });
  const futuresAccountModule = {
    useFuturesAccount(wants: Record<string, number>) {
      const [state, setState] = react.useState(accountState);
      publishAccount = setState;
      const keys = Object.keys(wants ?? {});
      react.useEffect(() => { loadAccount(keys); }, [JSON.stringify(keys)]);
      return state;
    },
    refreshFuturesAccount: (keys?: string[]) => loadAccount(keys ?? Object.keys(accountFetchers)),
  };

  const output: any = {};
  const compiled = ts.transpileModule(source(file), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function('require', 'exports', 'window', compiled)((name: string) => {
    if (name === 'react') return react;
    if (name === '../lib/api') return { api, ApiError: Error };
    if (name === '../lib/useFuturesAccount') return futuresAccountModule;
    if (name === '../lib/futuresConfigStore') return futuresConfigModule;
    if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string, params?: any) => params ? `${key}:${JSON.stringify(params)}` : key }) };
    if (name === '../lib/toast') return { useToast: () => ({ success: jest.fn(), error: jest.fn() }) };
    if (name === '../lib/terminalPresentation') return terminalPresentation;
  if (name === '../lib/spotOrderBook') return bookMath;
    if (name === '../lib/formatNumber') return { formatPrice: String };
    if (name === '../lib/futuresMath') return futuresMath;
    if (name === './spotOrderPresentation') return assetReads;
    if (name === './SpotOrdersView') return { SpotAssetsView: () => null };
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
  }, output, { setTimeout, clearTimeout, setInterval, clearInterval, confirm: overrides.confirm ?? jest.fn(() => false) });
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
/**
 * FuturesMarginLeverage registers its outside-click / Escape listeners on
 * `document`, which this suite's `node` environment does not provide. The
 * listeners are only ever reachable from a real click in a real browser,
 * so the component is right not to guard them; the harness supplies the
 * global instead.
 */
const savedDocument = (globalThis as any).document;
beforeEach(() => {
  jest.useFakeTimers();
  (globalThis as any).document = { addEventListener: () => {}, removeEventListener: () => {} };
});
afterEach(() => {
  jest.useRealTimers();
  if (savedDocument === undefined) delete (globalThis as any).document;
  else (globalThis as any).document = savedDocument;
});

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
  const config = { minLeverage: 1, maxLeverage: 100,
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

const tierConfig = { minLeverage: 1, maxLeverage: 100, highLeverageWarningThreshold: 20,
  leverageTiers: JSON.parse(JSON.stringify(LEVERAGE_TIERS)) };
const props = { symbol: 'BTC/USDT', onPlaced: jest.fn() };

async function leverageForm() {
  const confirm = jest.fn((_message: string) => true), placed = jest.fn().mockResolvedValue({});
  const getMe = jest.fn().mockResolvedValue({ createdAt: new Date().toISOString() });
  const form = mount('components/FuturesOrderForm.tsx', { confirm, api: {
    getFuturesConfig: () => Promise.resolve(tierConfig), getMe,
    getFuturesBalances: () => Promise.resolve([{ asset: 'USDT', available: '1000000', locked: '0' }]),
    // A REAL empty account, answered by the server. These two were
    // previously left unstubbed (and so never resolved) because the form
    // coerced an unanswered request to an empty array — which is the
    // review finding this fixture now avoids relying on. The assertions
    // below are unchanged: an account that genuinely holds no position and
    // no working order projects exactly the candidate's own notional, the
    // same number the coercion used to produce.
    getFuturesPositions: () => Promise.resolve([]),
    getMyFuturesOrders: () => Promise.resolve([]),
    getFuturesMarkPrice: () => Promise.resolve({ markPrice: '50000' }), placeFuturesOrder: placed,
  } });
  form.render(props); await tick();
  const render = () => form.render(props);
  const part = (tree: any, name: string) => nodes(tree).find(n => n.type === form.components[name]);
  const change = (tree: any, placeholder: string, value: string) => nodes(tree).find(n => n.type === 'input' && n.props.placeholder === placeholder).props.onChange({ target: { value } });
  let tree = render(); change(tree, '0.00', '50000'); change(tree, '0.00000', '1'); tree = render();
  return { form, render, part, change, confirm, placed, getMe, tree };
}

// The panel's leverage control is now FuturesMarginLeverage — a compact
// popover instead of an inline slider — so the panel keeps exactly one
// persistent slider (position size). It exposes the SAME bounds under the
// same names (`min`, `max`) and reports the selection through
// `leverage`/`onLeverageChange`. Every value asserted below is unchanged:
// the same ceilings, the same selections, the same order payload, the same
// confirmation rule.
test.each([1, 5, 10, 20, 50, 100])('real form + leverage control select %dx and pass it unchanged to the order API', async leverage => {
  const f = await leverageForm();
  let control = f.part(f.tree, 'FuturesMarginLeverage');
  expect(control.props.min).toBe(1); expect(control.props.max).toBe(100);

  // Drive the REAL control: open its popover and click the chip, rather
  // than calling the callback directly.
  const widget = mount('components/FuturesMarginLeverage.tsx');
  const props = () => f.part(f.render(), 'FuturesMarginLeverage').props;
  widget.render(props());
  // Margin mode and leverage are two triggers now; the chips are behind
  // the leverage one.
  nodes(widget.render(props()))
    .filter(n => n.type === 'button' && n.props?.className?.includes?.('fo-mlTrigger'))[1]
    .props.onClick();
  const chip = nodes(widget.render(props())).find(
    n => n.props?.className?.includes?.('fo-mlChip') && [n.props.children].flat(2).join('') === `${leverage}x`
  );
  expect(chip).toBeDefined();
  chip.props.onClick();

  const tree = f.render(); control = f.part(tree, 'FuturesMarginLeverage');
  expect(control.props.leverage).toBe(leverage);
  // The control's own trigger reports the selection back to the trader.
  expect(JSON.stringify(widget.render(control.props))).toContain(`${leverage.toFixed(2)}x`);

  nodes(tree).find(n => n.type === 'form').props.onSubmit({ preventDefault: jest.fn() }); await tick();
  expect(f.placed).toHaveBeenCalledWith({ symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '50000', quantity: '1', leverage, marginType: 'ISOLATED', reduceOnly: false });
  expect(f.confirm).toHaveBeenCalledTimes(leverage >= 20 ? 1 : 0);
  if (leverage >= 20) expect(f.confirm.mock.calls[0][0]).toContain(`"leverage":${leverage}`);
  expect(f.getMe).not.toHaveBeenCalled();
  expect(source('components/FuturesOrderForm.tsx')).not.toMatch(/newAccount|accountCreatedAt|accountAgeDays/);
});

test.each([[50000, 100], [50000.01, 50], [250000, 50], [250000.01, 20], [1000000, 20], [1000000.01, 10], [5000000, 10], [5000000.01, 5]])(
  'form caps a %d USDT notional at %dx', async (notional, max) => {
    const f = await leverageForm(); f.part(f.tree, 'FuturesMarginLeverage').props.onLeverageChange(100);
    f.change(f.tree, '0.00', String(notional)); f.render();
    const control = f.part(f.render(), 'FuturesMarginLeverage');
    expect(control.props.max).toBe(max); expect(control.props.leverage).toBe(max);
    f.change(f.render(), '0.00', '50000');
    expect(f.part(f.render(), 'FuturesMarginLeverage').props.max).toBe(100);
  }
);

test('frontend projection includes positions and pending increases, but only the remainder of a flip', () => {
  const candidate = { side: 'BUY' as const, remainingQuantity: 1, price: 0.01 };
  expect(futuresMath.projectFuturesExposureNotional({
    position: { side: 'LONG', size: 4, entryPrice: 10000 },
    activeOrders: [{ side: 'BUY', remainingQuantity: 1, price: 10000 }],
    candidate,
  })).toBeCloseTo(50000.01, 8);
  expect(futuresMath.projectFuturesExposureNotional({
    position: null,
    activeOrders: [
      { side: 'BUY', remainingQuantity: 1, price: 25000 },
      { side: 'BUY', remainingQuantity: 1, price: 25000 },
    ],
    candidate,
  })).toBeCloseTo(50000.01, 8);
  expect(futuresMath.projectFuturesExposureNotional({
    position: { side: 'LONG', size: 4, entryPrice: 10000 },
    activeOrders: [],
    candidate: { side: 'SELL', remainingQuantity: 9.000001, price: 10000 },
  })).toBeCloseTo(50000.01, 8);
});

test('form leverage ceiling reflects the expected aggregate tier while reductions remain unclamped', async () => {
  const form = mount('components/FuturesOrderForm.tsx', { api: {
    getFuturesConfig: () => Promise.resolve(tierConfig),
    getFuturesBalances: () => Promise.resolve([{ asset: 'USDT', available: '1000000', locked: '400' }]),
    getFuturesMarkPrice: () => Promise.resolve({ markPrice: '10000' }),
    getFuturesPositions: () => Promise.resolve([{
      id: 'position', symbol: 'BTC/USDT', side: 'LONG', size: '4', entryPrice: '10000',
      leverage: 100, marginType: 'ISOLATED', initialMargin: '400', liquidationPrice: '9940',
      markPrice: '10000', unrealizedPnl: '0', roe: '0', openedAt: new Date().toISOString(),
    }]),
    getMyFuturesOrders: () => Promise.resolve([]),
  } });
  const formProps = { symbol: 'BTC/USDT', onPlaced: jest.fn() };
  form.render(formProps); await tick();
  let tree = form.render(formProps);
  nodes(tree).find(n => n.type === 'input' && n.props.placeholder === '0.00').props.onChange({ target: { value: '10000.01' } });
  nodes(tree).find(n => n.type === 'input' && n.props.placeholder === '0.00000').props.onChange({ target: { value: '1' } });
  tree = form.render(formProps);
  expect(nodes(tree).find(n => n.type === form.components.FuturesMarginLeverage).props.max).toBe(50);

  nodes(tree).find(n => n.type === 'button' && n.props.children === 'futures.sellShort').props.onClick();
  tree = form.render(formProps);
  expect(nodes(tree).find(n => n.type === form.components.FuturesMarginLeverage).props.max).toBe(100);
});

test('high-leverage cancellation does not send an order; Market/Short/Cross/Reduce Only payload stays intact', async () => {
  const f = await leverageForm(); f.part(f.tree, 'FuturesMarginLeverage').props.onLeverageChange(100);
  f.confirm.mockReturnValue(false);
  nodes(f.render()).find(n => n.type === 'form').props.onSubmit({ preventDefault: jest.fn() }); await tick();
  expect(f.placed).not.toHaveBeenCalled();
  let tree = f.render();
  nodes(tree).find(n => n.type === 'button' && n.props.children === 'trade.marketOrder').props.onClick();
  // Margin mode now lives in the same compact control as leverage.
  f.part(tree, 'FuturesMarginLeverage').props.onMarginTypeChange('CROSS');
  nodes(tree).find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  f.confirm.mockReturnValue(true); tree = f.render();
  // SHORT is no longer selected and then submitted — pressing Short IS the
  // submission. Same payload, reached the way a trader now reaches it.
  nodes(tree).find(n => n.type === 'button' && n.props.className === 'submit-btn sell').props.onClick(); await tick();
  expect(f.placed).toHaveBeenCalledWith({ symbol: 'BTC/USDT', side: 'SELL', type: 'MARKET', price: undefined, quantity: '1', leverage: 100, marginType: 'CROSS', reduceOnly: true });
});

test('Futures Assets uses only Futures balances; compact Spot keeps its original API', async () => {
  const futures = jest.fn().mockResolvedValue([{ asset: 'USDT', available: '123', locked: '7' }]);
  const spot = jest.fn().mockResolvedValue([{ asset: 'USDT', available: '999', locked: '0' }]);
  const panel = mount('components/AssetsPanel.tsx', { api: { getFuturesBalances: futures, getBalances: spot } });
  panel.render({ refreshKey: 0, wallet: 'futures' }); await tick();
  const tree = panel.render({ refreshKey: 0, wallet: 'futures' });
  expect(JSON.stringify(tree)).toContain('123.000000'); expect(JSON.stringify(tree)).toContain('130.000000');
  expect(spot).not.toHaveBeenCalled(); expect(futures).toHaveBeenCalledTimes(1);
  panel.render({ refreshKey: 1, wallet: 'futures' }); await tick();
  expect(futures).toHaveBeenCalledTimes(2); expect(spot).not.toHaveBeenCalled();
  const compact = mount('components/AssetsPanel.tsx', { api: { getFuturesBalances: futures, getBalances: spot } });
  compact.render({ refreshKey: 0, compact: true }); await tick();
  expect(spot).toHaveBeenCalledTimes(1); expect(futures).toHaveBeenCalledTimes(2);
  expect(source('pages/FuturesPage.tsx')).toContain('<AssetsPanel wallet="futures"');
  expect(source('pages/TradePage.tsx')).toContain('<AssetsPanel compact refreshKey={ordersRefreshKey} />');
});
