import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { isVerifiedEmptyAccountResource } from '../terminalAccountPanel';
import * as spotPresentation from '../../components/spotOrderPresentation';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { act } = React;
const { createRoot } = req('react-dom/client');
const { JSDOM } = req('jsdom');
const read = (path: string) => readFileSync(resolve(frontend, 'src', path), 'utf8');
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

const resource = (data: readonly unknown[] | null, overrides = {}) => ({ data, loaded: data !== null, loading: false, failed: false, ...overrides });

test.each([
  [resource(null), false],
  [resource(null, { loaded: true, failed: true }), false],
  [resource([], { loaded: false }), false],
  [resource([], { loading: true }), false],
  [resource([], { failed: true }), false],
  [resource([{}]), false],
  [resource([]), true],
  [resource([], { refreshing: true }), true],
])('only a verified empty resource may fold: %p', (state, expected) => {
  expect(isVerifiedEmptyAccountResource(state as ReturnType<typeof resource>)).toBe(expected);
});

let dom: any, root: any, container: HTMLElement;
const previous: Record<string, any> = {};
beforeEach(() => {
  jest.useFakeTimers();
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
  for (const key of ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT']) {
    previous[key] = (globalThis as any)[key];
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key] });
  }
  container = dom.window.document.getElementById('root');
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  jest.clearAllTimers(); jest.useRealTimers();
  dom.window.close();
  for (const key of Object.keys(previous)) {
    if (previous[key] === undefined) delete (globalThis as any)[key];
    else Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: previous[key] });
  }
});

function modules(api: object) {
  const cache = new Map<string, any>();
  const compile = (file: string): any => {
    if (cache.has(file)) return cache.get(file);
    const output: any = {};
    const code = ts.transpileModule(read(file), { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    new Function('require', 'exports', code)((name: string) => {
      if (name.endsWith('/api')) return { api, ApiError: Error };
      if (name.endsWith('/i18n')) return { useLanguage: () => ({ t: (key: string) => key, lang: 'en' }), localeOf: () => 'en-US' };
      if (name.endsWith('/toast')) return { useToast: () => ({ success: () => {}, error: () => {} }) };
      if (name === './spotOrderPresentation') return spotPresentation;
      if (name === './SpotOrdersView') return compile('components/SpotOrdersView.tsx');
      if (name.endsWith('.css')) return {};
      return req(name);
    }, output);
    cache.set(file, output);
    return output;
  };
  return {
    useCompactAccountPanel: compile('lib/useCompactAccountPanel.ts').useCompactAccountPanel,
    AccountPanelToggle: compile('components/AccountPanelToggle.tsx').AccountPanelToggle,
    OpenOrdersPanel: compile('components/OpenOrdersPanel.tsx').OpenOrdersPanel,
  };
}

function spotHarness(getMyOrders: any) {
  const mod = modules({ getMyOrders });
  function App() {
    const [count, setCount] = React.useState(null);
    const panel = mod.useCompactAccountPanel(count === 0, 'spot:BTC/USDT:open');
    return React.createElement('section', { 'data-compact': panel.compact },
      panel.canCompact && React.createElement(mod.AccountPanelToggle, { compact: panel.compact, onToggle: panel.toggle, controls: 'body' }),
      React.createElement('div', { id: 'body', hidden: panel.compact },
        React.createElement(mod.OpenOrdersPanel, { pair: 'BTC/USDT', refreshKey: 0, onAccountCount: setCount })));
  }
  return App;
}
const compact = () => container.querySelector('section')!.getAttribute('data-compact') === 'true';
const order = { id: 'actual-order', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', status: 'OPEN', price: '50000', originalQuantity: '1', remainingQuantity: '1', triggerPrice: null, ocoGroupId: null, createdAt: '2026-09-14T10:00:00Z' };

test('Spot empty body folds, stays mounted and polls, then reveals a newly arrived order', async () => {
  const getMyOrders = jest.fn().mockResolvedValueOnce([]).mockResolvedValue([order]);
  const App = spotHarness(getMyOrders);
  await act(async () => { root.render(React.createElement(App)); await tick(); });
  expect(compact()).toBe(true);
  expect(container.querySelector('#body')!.hasAttribute('hidden')).toBe(true);
  expect(container.querySelector('.spot-orders-panel')).not.toBeNull();
  expect(getMyOrders).toHaveBeenCalledWith('PENDING_TRIGGER,OPEN,PARTIALLY_FILLED');
  await act(async () => { jest.advanceTimersByTime(4000); await tick(); });
  expect(getMyOrders).toHaveBeenCalledTimes(2);
  expect(compact()).toBe(false);
  expect(container.querySelector('#body')!.hasAttribute('hidden')).toBe(false);
  expect(container.querySelector('[data-order-id="actual-order"]')).not.toBeNull();
});

test('an empty Spot table can be manually revealed and folded with an accessible control', async () => {
  const App = spotHarness(jest.fn().mockResolvedValue([]));
  await act(async () => { root.render(React.createElement(App)); await tick(); });
  expect(compact()).toBe(true);
  const toggle = () => container.querySelector('.terminal-account-toggle') as HTMLButtonElement;
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(toggle().getAttribute('aria-label')).toBe('trade.expandAccountPanel');
  await act(async () => toggle().click());
  expect(compact()).toBe(false);
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  await act(async () => toggle().click());
  expect(compact()).toBe(true);
});

test('a failed Spot refresh immediately restores its error and retry, even after confirmed empty data', async () => {
  const getMyOrders = jest.fn().mockResolvedValueOnce([]).mockRejectedValue(new Error('unavailable'));
  const App = spotHarness(getMyOrders);
  await act(async () => { root.render(React.createElement(App)); await tick(); });
  expect(compact()).toBe(true);
  await act(async () => { jest.advanceTimersByTime(4000); await tick(); });
  expect(compact()).toBe(false);
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('trade.loadOrdersError');
  expect(container.querySelector('.terminal-account-retry')).not.toBeNull();
});

test('Spot does not fold a pair with no rows when another pair has an actual open order', async () => {
  const App = spotHarness(jest.fn().mockResolvedValue([{ ...order, pair: 'ETH/USDT' }]));
  await act(async () => { root.render(React.createElement(App)); await tick(); });
  expect(compact()).toBe(false);
  expect(container.querySelector('.terminal-account-toggle')).toBeNull();
});

test('unknown initial Spot reads never become a compact zero-order result', async () => {
  const App = spotHarness(jest.fn(() => new Promise(() => {})));
  await act(async () => { root.render(React.createElement(App)); await tick(); });
  expect(compact()).toBe(false);
  expect(container.textContent).toContain('trade.loading');
});

test('Futures requires both successful empty resources and reveals new positions, orders or read failures', async () => {
  const mod = modules({});
  function App({ orders, positions }: any) {
    const empty = isVerifiedEmptyAccountResource(orders) && isVerifiedEmptyAccountResource(positions);
    const panel = mod.useCompactAccountPanel(empty, 'futures:positions');
    return React.createElement('section', { 'data-compact': panel.compact }, React.createElement('div', { hidden: panel.compact }, 'positions'));
  }
  const render = async (orders: any, positions: any) => act(async () => { root.render(React.createElement(App, { orders, positions })); await tick(); });
  await render(resource([]), resource(null)); expect(compact()).toBe(false);
  await render(resource([]), resource([])); expect(compact()).toBe(true);
  await render(resource([order]), resource([])); expect(compact()).toBe(false);
  await render(resource([]), resource([])); expect(compact()).toBe(true);
  await render(resource([]), resource([{ id: 'new-position' }])); expect(compact()).toBe(false);
  await render(resource([]), resource([])); expect(compact()).toBe(true);
  await render(resource([], { failed: true }), resource([])); expect(compact()).toBe(false);
});

test('real terminal pages preserve tab navigation and mounted readers while the body is compact', () => {
  const spot = read('pages/TradePage.tsx'), futures = read('pages/FuturesPage.tsx');
  expect(spot).toContain('onAccountCount={setAccountOpenOrderCount}');
  expect(spot).toContain('<div className="account-tab-content" hidden={bottomTab !== \'open\'}>');
  expect(spot).toContain('accountPanel.reveal(`spot:${pair}:${tab.id}`)');
  // Public/Real futures keeps the same readers; only the owner's simulation view (which never shows
  // the real account panel) skips polling the real account. The server decides which it is, so the
  // suppression now reads the access verdict instead of a `?demo=1` query parameter.
  expect(futures).toContain('useFuturesAccount(native.requested?{}:{ orders: 5000, positions: 4000 })');
  expect(futures).toContain('accountPanel.reveal(`futures:${tab.id}`)');
  for (const page of [spot, futures]) expect(page).toContain('hidden={accountPanel.compact}');
});
