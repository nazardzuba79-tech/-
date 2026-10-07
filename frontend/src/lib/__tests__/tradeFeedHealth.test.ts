import * as aithPublication from '../../../../src/shared/aithPublication';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as activity from '../browserActivity';
import * as freshness from '../bookFreshness';
import * as testMarkets from '../testMarkets';
import * as cfdPresentation from '../cfdPresentation';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { act } = React, { JSDOM } = req('jsdom');
const compile = (path: string) => ts.transpileModule(
  readFileSync(resolve(frontend, 'src', path), 'utf8').replace(/import\.meta\.env\.VITE_SIMULATION_PREVIEW/g, 'undefined'),
  { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const ordinaryBook = (pair = 'BTC/USDT') => ({ pair, bids: [{ price: '100', quantity: '2' }], asks: [{ price: '101', quantity: '3' }], asOf: Date.now(), status: 'live' });
const cfdRow = { symbol: 'XAUUSD', price: '2400', status: 'sampled', stale: false };
let dom: any, root: any, host: HTMLElement, Page: any, query: URLSearchParams;
let readBook: jest.Mock, fetchMock: jest.Mock, cfdFeed: any, renderedBook: any;
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const krakenSubscribe = jest.fn((listener: (status: string) => void) => { listener('disconnected'); return () => {}; });

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(Date.UTC(2026, 8, 30, 12));
  dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true, url: 'https://fixture.invalid/trade' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.setTimeout = setTimeout; dom.window.clearTimeout = clearTimeout;
  dom.window.setInterval = setInterval; dom.window.clearInterval = clearInterval;
  host = document.getElementById('root')!;
  root = req('react-dom/client').createRoot(host);
  query = new URLSearchParams('pair=BTC%2FUSDT');
  readBook = jest.fn((pair: string) => Promise.resolve(ordinaryBook(pair)));
  cfdFeed = { tickers: [cfdRow], configured: true, loadError: false, reload: jest.fn() };
  renderedBook = null;
  krakenSubscribe.mockClear();
  // The real test-market store receives a synthetic public feed. Any other
  // transport is refused; this suite cannot reach a production API or DB.
  fetchMock = jest.fn(async (url: string) => {
    if (url !== '/api/v1/market/test-assets') throw new Error(`Unexpected fixture request: ${url}`);
    return { ok: true, json: async () => ({ serverTime: Date.now(), assets: [{
      pair: 'VTA/USDT', symbol: 'VTA', name: 'VOLTORA', quote: 'USDT', isTestAsset: true, isTradable: false,
      listingArmed: true, listingAt: '2026-09-28T15:00:00Z', initialPrice: 0.01,
      state: { phase: 'live', lastPrice: 1, openPrice24h: 1, change24hPercent: 0, high24h: 1, low24h: 1,
        volume24h: 100, quoteVolume24h: 100, serverTime: Date.now() },
    }] }) };
  });
  globalThis.fetch = fetchMock as any;
  const loaded: Record<string, any> = {};
  const empty = React.forwardRef(() => null);
  const child = new Proxy({}, { get: () => empty });
  const evaluate = (file: string): any => {
    if (loaded[file]) return loaded[file];
    const output: any = {}; loaded[file] = output;
    new Function('exports', 'require', compile(file))(output, (name: string) => {
      if (name === 'react') return React;
      if (name.endsWith('/browserActivity')) return activity;
      if (name.endsWith('/i18n')) return { useLanguage: () => ({ t: (key: string) => key, lang: 'en' }) };
      if (name.endsWith('/bookFreshness')) return freshness;
      if (name.endsWith('/testMarkets')) return testMarkets;
      if (name.endsWith('/testMarketStore')) return evaluate('lib/testMarketStore.ts');
      if (name.endsWith('/nrxMarket')) return {
        NRX_EDGE_BASE: 'https://fixture.invalid', isNrxPair: (pair: string) => pair === 'NRX/USDT',
        isEdgeMarketPair: (pair: string) => pair === 'NRX/USDT', isEdgeMarketUrl: () => false,
        fetchNrxPublic: async () => ({ serverTime: Date.now(), assets: [] }),
      };
      if (name.endsWith('/api')) return { API_BASE: '/api/v1' };
      if (name.endsWith('/spotPublicMarket')) return { readSpotPublicBook: (...args: any[]) => readBook(...args) };
      if (name.endsWith('/useMarketData')) return { useMarketData: () => ({ loaded: true, status: 'ready', tickers: new Map([['BTC/USDT', {}], ['ETH/USDT', {}]]) }) };
      if (name.endsWith('/useCfdTickers')) return { useCfdTickers: () => cfdFeed };
      if (name.endsWith('/cfdPresentation')) return cfdPresentation;
      if (name.endsWith('/tradingMode')) return { rememberTradingMode: () => {} };
      if (name.endsWith('/useCompactAccountPanel')) return evaluate('lib/useCompactAccountPanel.ts');
      if (name.endsWith('/krakenSocket')) return { krakenSocket: { getStatus: () => 'disconnected', subscribeStatus: krakenSubscribe } };
      if (name === 'react-router-dom') return { useSearchParams: () => [query, () => {}] };
      // Phone header switch (rendered through the stubbed Nav) and its pure helpers.
      if (name === '../components/TerminalMarketSwitch') return { TerminalMarketSwitch: () => null };
      if (name === '../lib/terminalMarketSwitch') return jest.requireActual('../terminalMarketSwitch');
      if (name.endsWith('/ConnectionBanner')) return evaluate('components/ConnectionBanner.tsx');
      if (name.endsWith('/OrderBookPanel')) return { OrderBookPanel: (props: any) => { renderedBook = props; return null; } };
      if (name.endsWith('/NrxBookTabs')) return { NrxBookTabs: ({ children }: any) => children };
      if (name.endsWith('.css')) return {};
      if (name.startsWith('../components/')) return child;
      return (name === '../../../src/shared/aithPublication' ? aithPublication : req(name));
    });
    return output;
  };
  Page = evaluate('pages/TradePage.tsx').TradePage;
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
  jest.clearAllTimers(); jest.useRealTimers();
});
const render = async (next?: string) => {
  if (next !== undefined) query = new URLSearchParams(next);
  await act(async () => { root.render(React.createElement(Page)); });
};
const advance = async (ms: number) => { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); };
const visible = async (hidden: boolean) => { await act(async () => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new dom.window.Event('visibilitychange'));
}); };

test('healthy HTTP Spot does not report an unused Kraken socket; real loss retains the book and recovery clears the warning', async () => {
  await render();
  const lastGood = renderedBook.bids;
  await advance(freshness.RECONNECT_GRACE_MS);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(krakenSubscribe).not.toHaveBeenCalled();
  expect(readBook).toHaveBeenCalledTimes(1);
  readBook.mockRejectedValue(new Error('fixture book unavailable'));
  await advance(60_000 - freshness.RECONNECT_GRACE_MS);
  await advance(freshness.RECONNECT_GRACE_MS);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelector('[data-connection-state]')?.hasAttribute('hidden')).toBe(true);
  expect(renderedBook.bids).toBe(lastGood);
  readBook.mockImplementation((pair: string) => Promise.resolve(ordinaryBook(pair)));
  await advance(60_000 - freshness.RECONNECT_GRACE_MS);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(readBook).toHaveBeenCalledTimes(3);
});

test('CFD connection warning follows the selected quote feed and its actual recovery', async () => {
  await render('market=cfd');
  await advance(freshness.RECONNECT_GRACE_MS);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(krakenSubscribe).not.toHaveBeenCalled();
  expect(readBook).not.toHaveBeenCalled();
  cfdFeed = { ...cfdFeed, loadError: true };
  await render(); await advance(freshness.RECONNECT_GRACE_MS);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelector('[data-connection-state]')?.hasAttribute('hidden')).toBe(true);
  expect(cfdFeed.tickers[0].price).toBe('2400');
  cfdFeed = { ...cfdFeed, loadError: false };
  await render();
  expect(host.querySelector('[role="status"]')).toBeNull();
});

test('switching VTA to CFD stops the actual five-second simulation reader until Spot is selected again', async () => {
  await render('pair=VTA%2FUSDT');
  await advance(10_000);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  await render('market=cfd');
  const before = fetchMock.mock.calls.length;
  await advance(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(before);
  await render('');
  expect(fetchMock).toHaveBeenCalledTimes(before + 1);
  await advance(5_000);
  expect(fetchMock).toHaveBeenCalledTimes(before + 2);
});

test('a hung public book read reaches its deadline, releases the lock and recovers at the unchanged next poll', async () => {
  await render();
  let hungSignal: AbortSignal | undefined;
  readBook.mockImplementationOnce((_pair: string, signal: AbortSignal) => new Promise((_resolve, reject) => {
    hungSignal = signal;
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  await advance(60_000);
  await advance(12_000);
  expect(hungSignal?.aborted).toBe(true);
  await advance(freshness.RECONNECT_GRACE_MS);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelector('[data-connection-state]')?.hasAttribute('hidden')).toBe(true);
  await advance(60_000 - 12_000 - freshness.RECONNECT_GRACE_MS);
  expect(readBook).toHaveBeenCalledTimes(3);
  expect(host.querySelector('[role="status"]')).toBeNull();
});

test('hidden and unmounted Spot abort their pending display read; a late old-pair failure cannot poison the new feed', async () => {
  let pendingSignal: AbortSignal | undefined;
  let rejectOld: (error: Error) => void = () => {};
  readBook.mockImplementationOnce((_pair: string, signal: AbortSignal) => new Promise((_resolve, reject) => { pendingSignal = signal; rejectOld = reject; }));
  await render();
  await visible(true);
  expect(pendingSignal?.aborted).toBe(true);
  await render('pair=ETH%2FUSDT');
  await visible(false);
  await act(async () => { rejectOld(new Error('late old-pair failure')); });
  await advance(freshness.RECONNECT_GRACE_MS);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(renderedBook.pair).toBe('ETH/USDT');
  readBook.mockImplementationOnce((_pair: string, signal: AbortSignal) => new Promise((_resolve, reject) => {
    pendingSignal = signal;
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  await advance(60_000 - freshness.RECONNECT_GRACE_MS);
  await act(async () => root.unmount());
  expect(pendingSignal?.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});
