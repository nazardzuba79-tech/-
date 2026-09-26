import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { isVerifiedEmptyAccountResource } from '../terminalAccountPanel';
import * as spotPresentation from '../../components/spotOrderPresentation';
import { customerErrorText } from '../customerError';

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
  // These cases model an actively viewed tab, not JSDOM's default prerender.
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
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
      // The real display boundary: the panel's failure text is composed
      // there now, so a stub would let the two drift apart.
      if (name.endsWith('/customerError')) return { customerErrorText };
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
/** Whether the fold is even OFFERED — the guard that keeps live rows visible. */
const canCompact = () => container.querySelector('section')!.getAttribute('data-can-compact') === 'true';
const order = { id: 'actual-order', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', status: 'OPEN', price: '50000', originalQuantity: '1', remainingQuantity: '1', triggerPrice: null, ocoGroupId: null, createdAt: '2026-09-14T10:00:00Z' };

/**
 * THE PANEL OPENS OPEN. This suite used to assert the opposite, and the
 * change is the owner's: a terminal that folded its own orders panel
 * whenever the account happened to be empty greeted every new account with
 * the chart at full height and the tab row collapsed to a 44px strip.
 * Nobody asked for that. Folding is now a user action and only a user
 * action; everything else this suite pinned — readers stay mounted, polling
 * continues, new activity and errors reveal the body — is unchanged and
 * still asserted below.
 */
test('Spot empty body stays OPEN, stays mounted and polls, and shows a newly arrived order', async () => {
  const getMyOrders = jest.fn().mockResolvedValueOnce([]).mockResolvedValue([order]);
  const App = spotHarness(getMyOrders);
  await act(async () => { root.render(React.createElement(App)); await tick(); });
  expect(compact()).toBe(false);
  expect(container.querySelector('#body')!.hasAttribute('hidden')).toBe(false);
  expect(container.querySelector('.spot-orders-panel')).not.toBeNull();
  expect(getMyOrders).toHaveBeenCalledWith('PENDING_TRIGGER,OPEN,PARTIALLY_FILLED');
  await act(async () => { jest.advanceTimersByTime(4000); await tick(); });
  expect(getMyOrders).toHaveBeenCalledTimes(2);
  expect(compact()).toBe(false);
  expect(container.querySelector('#body')!.hasAttribute('hidden')).toBe(false);
  expect(container.querySelector('[data-order-id="actual-order"]')).not.toBeNull();
});

test('a body the user folded stays mounted and polling, and reopens on new activity', async () => {
  const getMyOrders = jest.fn().mockResolvedValueOnce([]).mockResolvedValue([order]);
  const App = spotHarness(getMyOrders);
  await act(async () => { root.render(React.createElement(App)); await tick(); });
  const toggle = () => container.querySelector('.terminal-account-toggle') as HTMLButtonElement;
  await act(async () => toggle().click());
  expect(compact()).toBe(true);
  expect(container.querySelector('#body')!.hasAttribute('hidden')).toBe(true);
  // Folded is a display state only: the reader is still there and still asking.
  expect(container.querySelector('.spot-orders-panel')).not.toBeNull();
  await act(async () => { jest.advanceTimersByTime(4000); await tick(); });
  expect(getMyOrders).toHaveBeenCalledTimes(2);
  // An order arriving while folded is exactly what must not stay hidden.
  expect(compact()).toBe(false);
  expect(container.querySelector('[data-order-id="actual-order"]')).not.toBeNull();
});

test('an empty Spot table can be folded and reopened with an accessible control', async () => {
  const App = spotHarness(jest.fn().mockResolvedValue([]));
  await act(async () => { root.render(React.createElement(App)); await tick(); });
  expect(compact()).toBe(false);
  const toggle = () => container.querySelector('.terminal-account-toggle') as HTMLButtonElement;
  // Open on arrival, and the control offers to fold rather than to reveal.
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  expect(toggle().getAttribute('aria-label')).toBe('trade.collapseAccountPanel');
  await act(async () => toggle().click());
  expect(compact()).toBe(true);
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(toggle().getAttribute('aria-label')).toBe('trade.expandAccountPanel');
  await act(async () => toggle().click());
  expect(compact()).toBe(false);
});

test('a failed Spot refresh immediately restores its error and retry, even from a folded panel', async () => {
  const getMyOrders = jest.fn().mockResolvedValueOnce([]).mockRejectedValue(new Error('unavailable'));
  const App = spotHarness(getMyOrders);
  await act(async () => { root.render(React.createElement(App)); await tick(); });
  await act(async () => (container.querySelector('.terminal-account-toggle') as HTMLButtonElement).click());
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
    return React.createElement('section', { 'data-compact': panel.compact, 'data-can-compact': panel.canCompact },
      React.createElement('div', { hidden: panel.compact }, 'positions'));
  }
  const render = async (orders: any, positions: any) => act(async () => { root.render(React.createElement(App, { orders, positions })); await tick(); });
  // Open in every state, because folding is now the user's decision. What
  // this still pins is the OFFER: the control appears only once both reads
  // have come back verifiably empty, so a panel holding live positions, or
  // one that has not answered yet, can never be folded away.
  await render(resource([]), resource(null)); expect(compact()).toBe(false); expect(canCompact()).toBe(false);
  await render(resource([]), resource([])); expect(compact()).toBe(false); expect(canCompact()).toBe(true);
  await render(resource([order]), resource([])); expect(compact()).toBe(false); expect(canCompact()).toBe(false);
  await render(resource([]), resource([{ id: 'new-position' }])); expect(compact()).toBe(false); expect(canCompact()).toBe(false);
  await render(resource([], { failed: true }), resource([])); expect(compact()).toBe(false); expect(canCompact()).toBe(false);
});

test('real terminal pages preserve tab navigation and mounted readers while the body is compact', () => {
  const spot = read('pages/TradePage.tsx'), futures = read('pages/FuturesPage.tsx');
  expect(spot).toContain('onAccountCount={setAccountOpenOrderCount}');
  expect(spot).toContain('<div className="account-tab-content" hidden={bottomTab !== \'open\'}>');
  expect(spot).toContain('accountPanel.reveal()');
  // Public/Real futures keeps the same readers; only the owner's simulation view (which never shows
  // the real account panel) skips polling the real account. What decides that is the engine seam
  // itself — `nativeExecution` is non-null exactly while this account is bound to the simulation
  // engine — rather than a `?demo=1` query parameter or a second flag that could disagree with it.
  expect(futures).toContain('useFuturesAccount(nativeExecution?{}:{ orders: 5000, positions: 4000 })');
  expect(futures).toContain('accountPanel.reveal()');
  for (const page of [spot, futures]) expect(page).toContain('hidden={accountPanel.compact}');
});

function setTabVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new dom.window.Event('visibilitychange'));
}

test('mounted Spot reader pauses for a hidden hour and refreshes once immediately on return', async () => {
  const getMyOrders = jest.fn().mockResolvedValue([order]);
  const App = spotHarness(getMyOrders);
  await act(async () => { root.render(React.createElement(App)); await tick(); });
  expect(getMyOrders).toHaveBeenCalledTimes(1);
  await act(async () => { setTabVisibility('hidden'); jest.advanceTimersByTime(3_600_000); await tick(); });
  expect(getMyOrders).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-order-id="actual-order"]')).not.toBeNull();
  await act(async () => { setTabVisibility('visible'); await tick(); });
  expect(getMyOrders).toHaveBeenCalledTimes(2);
  await act(async () => { setTabVisibility('visible'); await tick(); });
  expect(getMyOrders).toHaveBeenCalledTimes(2);
  await act(async () => { jest.advanceTimersByTime(4000); await tick(); });
  expect(getMyOrders).toHaveBeenCalledTimes(3);
});

test('a Spot reader mounted hidden does not fetch until the tab is shown', async () => {
  setTabVisibility('hidden');
  const getMyOrders = jest.fn().mockResolvedValue([order]);
  const App = spotHarness(getMyOrders);
  await act(async () => { root.render(React.createElement(App)); jest.advanceTimersByTime(3_600_000); await tick(); });
  expect(getMyOrders).not.toHaveBeenCalled();
  expect(container.textContent).toContain('trade.loading');
  await act(async () => { setTabVisibility('visible'); await tick(); });
  expect(getMyOrders).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-order-id="actual-order"]')).not.toBeNull();
});
