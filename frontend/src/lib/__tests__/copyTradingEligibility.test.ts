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

test('watchlist is immediately available and makes no wallet portfolio request', async () => {
  await mount();
  expect(requests).toHaveLength(0);
  expect(listeners.size).toBe(0);
  expect(button().disabled).toBe(false);
  expect(button().textContent).toBe('Наблюдать за трейдером');
  expectNoDepositOrAction();
  await click();
  expect(toggleFollowing).toHaveBeenCalledTimes(1);
  expect(toggleFollowing).toHaveBeenCalledWith(trader.id);
  expect(toast.success.mock.calls[0][0]).toContain('Добавлено в наблюдение');
  expect(toast.success.mock.calls[0][1]?.description).toContain('копирование сделок не запущено');
  expect(document.querySelector('dialog')).toBeNull();
});

test('watchlist CTA has no retry, deposit or fake trading request', async () => {
  await mount();
  await click();
  expect(requests).toHaveLength(0);
  expect(document.querySelector('a[href="/wallet?action=deposit"]')).toBeNull();
  expect(toast.success).toHaveBeenCalledTimes(1);
  expect(toast.success.mock.calls[0][0]).not.toMatch(/Вы копируете|Копирование.*остановлено/);
});

test('StrictMode does not create duplicate portfolio reads or subscriptions', async () => {
  await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Page))); await flush(); });
  expect(requests).toHaveLength(0);
  expect(listeners.size).toBe(0);
  expect(button().disabled).toBe(false);
  await click();
  expect(toggleFollowing).toHaveBeenCalledTimes(1);
});
