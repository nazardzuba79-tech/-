import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const sourceRoot = process.env.COPY_ELIGIBILITY_SOURCE || frontend;
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { act } = React;
const { createRoot } = req('react-dom/client');
const { JSDOM } = req('jsdom');
const trader = { id: 'VX-TEST', name: 'Test trader', performanceFee: 0.1 };
const marketplace = { settled: true, nazar: {}, ksenia: {}, identities: [] };
const globalKeys = ['window', 'document', 'HTMLElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'] as const;
const originalGlobals = new Map(globalKeys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
type Request = { session: string | null; resolve: (value: unknown) => void; reject: (error: Error) => void };
let session: string | null;
let requests: Request[];
let listeners: Set<() => void>;
let dom: any, root: any, host: HTMLElement;
const toggleFollowing = jest.fn();
const toast = { success: jest.fn() };
const api = {
  getToken: () => session,
  onSessionChange: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  api: { getPortfolioHistory: () => new Promise((resolve, reject) => requests.push({ session, resolve, reject })) },
};

// Real page, provider, Copy click handler and dialog, with real React effects.
// Only account transport, unrelated page chrome/strategy graphs and the existing
// local Following action are substituted. No API, financial or network writes.
const cache = new Map<string, any>();
let CopyButton: any;
function load(file: string): any {
  for (const suffix of ['', '.tsx', '.ts']) {
    if (existsSync(file + suffix) && statSync(file + suffix).isFile()) { file += suffix; break; }
  }
  if (cache.has(file)) return cache.get(file);
  const exports: any = {}; cache.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const requireFrom = (name: string): any => {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('/api')) return api;
    if (name.endsWith('/Nav')) return { Nav: () => null };
    if (name.endsWith('/Footer')) return { Footer: () => null };
    if (name === 'sonner') return { Toaster: () => null, toast };
    if (name === 'react-router-dom') return { Link: ({ to, children, ...props }: any) => React.createElement('a', { href: to, ...props }, children) };
    if (name.endsWith('/useCopyMarketplace')) return { useCopyMarketplace: () => marketplace };
    if (name.endsWith('/traders')) return { nazarTrader: trader };
    if (name.endsWith('/syntheticCopyTrading')) return { syntheticNazaraTrader: () => trader };
    if (name.endsWith('/kseniaCopyTrading')) return { kseniaTrader: () => trader, KSENIA_TRADER_ID: 'VX-KSENIA', withStrategyIdentityVerification: (value: any) => value };
    if (name.endsWith('/components')) return { Marketplace: () => React.createElement(CopyButton, { trader }), Profile: () => React.createElement(CopyButton, { trader }) };
    if (name.endsWith('/FeaturedAvatarContext')) return { FeaturedAvatarProvider: ({ children }: any) => children };
    if (name.endsWith('/StrategySocials')) return { StrategySocialProvider: ({ children }: any) => children };
    if (name.endsWith('/DemoRoiContext')) return { DemoRoiProvider: ({ children }: any) => children };
    return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
  };
  new Function('exports', 'require', code)(exports, requireFrom);
  return exports;
}

let Page: any;
beforeAll(() => {
  const source = readFileSync(resolve(sourceRoot, 'src/pages/copy-trading-bolt/components.tsx'), 'utf8');
  const ast = ts.createSourceFile('components.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'CopyButton')!;
  const code = ts.transpileModule(declaration.getText(ast) + '\nexports.CopyButton = CopyButton;', { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const context = load(resolve(sourceRoot, 'src/pages/copy-trading-bolt/CopyEligibilityContext.tsx'));
  const dialog = load(resolve(sourceRoot, 'src/pages/copy-trading-bolt/CopyDepositDialog.tsx'));
  const dependencies = {
    useState: React.useState, useEffect: React.useEffect,
    useCopyEligibility: context.useCopyEligibility,
    useFollowing: () => ({ following: new Set(), toggleFollowing }),
    useCopyMarketplace: () => marketplace,
    nazarTrader: { id: 'VX-001' }, CopyDepositDialog: dialog.CopyDepositDialog,
    Check: () => null, toast,
  };
  const exports: any = {};
  new Function('exports', 'require', ...Object.keys(dependencies), code)(exports, req, ...Object.values(dependencies));
  CopyButton = exports.CopyButton;
  Page = load(resolve(sourceRoot, 'src/pages/CopyTradingPage.tsx')).CopyTradingPage;
});

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/copy-trading', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  session = 'viewer-a'; requests = []; listeners = new Set();
  toggleFollowing.mockClear(); toast.success.mockClear();
  host = document.getElementById('root')!; root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  expect(listeners.size).toBe(0);
  dom.window.close();
  for (const key of globalKeys) {
    const descriptor = originalGlobals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key];
  }
});

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const mount = async () => act(async () => { root.render(React.createElement(Page)); await flush(); });
const button = () => host.querySelector('button') as HTMLButtonElement;
const click = async (element = button()) => act(async () => { element.click(); await flush(); });
const resolveRequest = async (value: unknown, index = requests.length - 1) => act(async () => { requests[index].resolve(value); await flush(); });
const point = (value: unknown) => ({ points: [{ date: '2026-10-30T00:00:00.000Z', totalValueUsd: value }] });
const expectNoDepositOrAction = () => {
  expect(document.querySelector('dialog')).toBeNull();
  expect(document.querySelector('a[href="/wallet?action=deposit"]')).toBeNull();
  expect(toggleFollowing).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
};

test('pending portfolio read disables Copy without claiming the deposit is insufficient', async () => {
  await mount();
  expect(requests).toHaveLength(1);
  expect(button().disabled).toBe(true);
  expect(button().textContent).toBe('Загрузка…');
  await click(); expectNoDepositOrAction();
});

test('503 settles to a retry action, without a deposit/top-up instruction', async () => {
  await mount();
  await act(async () => { requests[0].reject(Object.assign(new Error('HTTP/1.1 503 service unavailable'), { status: 503 })); await flush(); });
  expect(button().textContent).toBe('Повторить проверку');
  expect(button().disabled).toBe(false);
  expectNoDepositOrAction();
  await click();
  expect(requests).toHaveLength(2);
  expect(button().disabled).toBe(true);
  expectNoDepositOrAction();
});

test('a null latest valuation stays unavailable instead of becoming a zero deposit', async () => {
  await mount(); await resolveRequest(point(null));
  expect(button().textContent).toBe('Повторить проверку');
  await click(); expectNoDepositOrAction();
});

test('a confirmed zero keeps the existing deposit dialog only after a Copy click', async () => {
  await mount(); await resolveRequest(point('0'));
  expect(button().textContent).toBe('Наблюдать за трейдером');
  expectNoDepositOrAction(); await click();
  expect(document.querySelector('dialog')?.textContent).toContain('при депозите от $10 000.');
  expect(document.querySelector('a[href="/wallet?action=deposit"]')).not.toBeNull();
  expect(toggleFollowing).not.toHaveBeenCalled();
});

test('the confirmed 10000 boundary preserves the existing local Following action', async () => {
  await mount(); await resolveRequest(point('10000')); await click();
  expect(toggleFollowing).toHaveBeenCalledTimes(1);
  expect(toggleFollowing).toHaveBeenCalledWith(trader.id);
  expect(toast.success).toHaveBeenCalledTimes(1);
  expect(toast.success.mock.calls[0][0]).toContain('Добавлено в наблюдение');
  expect(toast.success.mock.calls[0][1]?.description).toMatch(/сделки не копируются|копирование сделок не запущено/);
  expect(document.querySelector('dialog')).toBeNull();
});

test.each([undefined, '', ' ', false, true, NaN, Infinity, -Infinity, -1, '-1', 'NaN', 'Infinity', '0x2710', {}, []])(
  'invalid latest valuation %p cannot become a zero or an eligible deposit', async value => {
    await mount(); await resolveRequest(point(value));
    expect(button().textContent).toBe('Повторить проверку');
    expectNoDepositOrAction();
  });

test.each([null, {}, { points: null }, { points: {} }, { points: [] }, { points: [null] }, { points: [{}] }])(
  'missing or malformed portfolio history %p stays unavailable', async payload => {
    await mount(); await resolveRequest(payload);
    expect(button().textContent).toBe('Повторить проверку'); expectNoDepositOrAction();
  });

test.each([0, '0.00', 9999.99, '9999.99', '9e3'])(
  'confirmed valid amount %p below 10000 keeps the deposit requirement', async value => {
    await mount(); await resolveRequest(point(value)); await click();
    expect(document.querySelector('dialog')?.textContent).toContain('при депозите от $10 000.');
    expect(toggleFollowing).not.toHaveBeenCalled();
  });

test('an unavailable latest row cannot reuse an older apparently eligible row', async () => {
  await mount(); await resolveRequest({ points: [point('20000').points[0], point(null).points[0]] });
  expect(button().textContent).toBe('Повторить проверку'); expectNoDepositOrAction();
});

test('retry is one in-flight read even if the old button receives two clicks', async () => {
  await mount(); await resolveRequest(point(null));
  const retryButton = button();
  await act(async () => { retryButton.click(); retryButton.click(); await flush(); });
  expect(requests).toHaveLength(2);
  expect(button().disabled).toBe(true); expectNoDepositOrAction();
  await resolveRequest(point('10000')); await click();
  expect(toggleFollowing).toHaveBeenCalledTimes(1);
});

test('a session change immediately fences the old ready button before React commits', async () => {
  await mount(); await resolveRequest(point('20000'));
  const oldButton = button();
  await act(async () => {
    session = 'viewer-b'; listeners.forEach(listener => listener());
    oldButton.click();
    expect(toggleFollowing).not.toHaveBeenCalled();
    await flush();
  });
  expect(requests).toHaveLength(2);
  expect(requests[1].session).toBe('viewer-b');
  expect(button().disabled).toBe(true); expectNoDepositOrAction();
  await resolveRequest(point('0')); await click();
  expect(document.querySelector('dialog')).not.toBeNull();
  expect(toggleFollowing).not.toHaveBeenCalled();
});

test('the former session cannot open a stale deposit dialog or keep one open', async () => {
  await mount(); await resolveRequest(point('0')); await click();
  expect(document.querySelector('dialog')).not.toBeNull();
  const oldButton = button();
  await act(async () => {
    session = 'viewer-b'; listeners.forEach(listener => listener()); oldButton.click(); await flush();
  });
  expectNoDepositOrAction();
  await resolveRequest(point('0'));
  expect(document.querySelector('dialog')).toBeNull();
});

test('a late eligible response from the previous session cannot replace the current zero', async () => {
  await mount();
  await act(async () => { session = 'viewer-b'; listeners.forEach(listener => listener()); await flush(); });
  await resolveRequest(point('0'), 1);
  await resolveRequest(point('20000'), 0);
  await click();
  expect(document.querySelector('dialog')).not.toBeNull();
  expect(toggleFollowing).not.toHaveBeenCalled();
});

test('a previous session failure cannot erase the current confirmed eligibility', async () => {
  await mount();
  await act(async () => { session = 'viewer-b'; listeners.forEach(listener => listener()); await flush(); });
  await resolveRequest(point('10000'), 1);
  await act(async () => { requests[0].reject(new Error('Failed to fetch')); await flush(); });
  expect(button().textContent).toBe('Наблюдать за трейдером'); await click();
  expect(toggleFollowing).toHaveBeenCalledTimes(1);
});

test('A to B to A invalidates the original response even when the token matches again', async () => {
  await mount();
  await act(async () => { session = 'viewer-b'; listeners.forEach(listener => listener()); await flush(); });
  await act(async () => { session = 'viewer-a'; listeners.forEach(listener => listener()); await flush(); });
  expect(requests).toHaveLength(3);
  await resolveRequest(point('20000'), 0);
  expect(button().disabled).toBe(true); expectNoDepositOrAction();
  await resolveRequest(point('0'), 2); await click();
  expect(document.querySelector('dialog')).not.toBeNull();
  expect(toggleFollowing).not.toHaveBeenCalled();
});

test('logout discards the pending account read; late sign-in starts a fresh check', async () => {
  await mount();
  await act(async () => { session = null; listeners.forEach(listener => listener()); await flush(); });
  await resolveRequest(point('20000'), 0); await click();
  expect(requests).toHaveLength(1); expectNoDepositOrAction();
  await act(async () => { session = 'viewer-b'; listeners.forEach(listener => listener()); await flush(); });
  expect(requests).toHaveLength(2); expect(button().disabled).toBe(true);
  await resolveRequest(point('10000'), 1); await click();
  expect(toggleFollowing).toHaveBeenCalledTimes(1);
});

test('an anonymous transient page never requests account history or enables Copy', async () => {
  session = null; await mount(); await click();
  expect(requests).toHaveLength(0); expectNoDepositOrAction();
});

test('StrictMode cleanup invalidates its abandoned request and keeps one session subscription', async () => {
  await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Page))); await flush(); });
  expect(listeners.size).toBe(1);
  expect(requests).toHaveLength(2);
  await resolveRequest(point('20000'), 0);
  expect(button().disabled).toBe(true); expectNoDepositOrAction();
  await resolveRequest(point('0'), 1); await click();
  expect(document.querySelector('dialog')).not.toBeNull();
  expect(toggleFollowing).not.toHaveBeenCalled();
});
