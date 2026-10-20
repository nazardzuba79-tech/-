/**
 * History20 private test markets in the existing Spot terminal (owner and
 * allowlisted testers only): recognised by their reserved SIMUSDT pair shape,
 * read from the authenticated API with the session token, never from the
 * public edge or a venue, and forgotten when the session changes.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as testMarketHelpers from '../testMarkets';
import * as nrxHelpers from '../nrxMarket';
import * as aithPublication from '../../../../src/shared/aithPublication';
import { isEdgeMarketPair, isEdgeMarketUrl } from '../nrxMarket';
import {
  isKnownPrivateTestMarket, isManagedListingPair, isManagedTradablePair, isPrivateTestPair, isTestMarketPair, parseTestMarkets, registerPrivateTestMarkets,
} from '../testMarkets';
import { testMarketCandleLoader } from '../testMarketCandles';
import { readSpotPublicBook } from '../spotPublicMarket';

jest.mock('../api', () => ({ API_BASE: 'https://voltex-api.invalid/api/v1' }));
jest.mock('../testMarketStore', () => ({ fetchTestMarketJson: jest.fn(), fetchPrivateTestMarketJson: jest.fn() }));

const privateRow = (extra: Record<string, unknown> = {}) => ({
  pair: 'VHX07/SIMUSDT', symbol: 'VHX07', name: 'History20 private', quote: 'SIMUSDT', isTestAsset: true, isTradable: false, status: 'TEST · NOT TRADABLE',
  listingArmed: true, listingAt: '2026-11-02T00:00:00.000Z', initialPrice: 2, listingId: 'vhx07', version: 1, logo: null, displayTimeZone: 'UTC',
  state: { phase: 'live', lastPrice: 2.5, openPrice24h: 2.4, change24hPercent: 4, high24h: 2.6, low24h: 2.3, volume24h: 10, quoteVolume24h: 25, serverTime: 1 },
  provenance: { mode: 'HISTORY20_PRIVATE_TEST', settlement: 'SIMUSDT', withdrawable: false, rights: 'HISTORICAL_RIGHTS_UNVERIFIED', clock: 'REAL_TIME',
    label: 'Приватный тест History20: модельная цена, расчёты в SIMUSDT, вывод и обмен недоступны', scenarioId: 'VHX-07-SOL', source: null },
  ...extra,
});

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const compile = (file: string) => ts.transpileModule(readFileSync(file, 'utf8').replaceAll('import.meta.env.VITE_SIMULATION_PREVIEW', 'undefined'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

/** The real store, parser and registry; transport and session are fixtures. */
function realStore(read: (url: string, init: any) => { ok: boolean; status: number; body: unknown }, tracked?: Array<{ promise: Promise<unknown>; reportFailure: boolean }>) {
  const session = { token: null as string | null, listeners: new Set<() => void>() };
  const calls: Array<{ url: string; init: any }> = [];
  const document = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
  const fetch = async (url: string, init: any) => { calls.push({ url, init }); const r = read(url, init); return { ok: r.ok, status: r.status, json: async () => r.body }; };
  const activity: any = {};
  new Function('exports', 'document', 'globalThis', compile(resolve(frontend, 'src/lib/browserActivity.ts')))(activity, document, { fetch });
  // Record what the store hands to the wake barrier (the real tracker otherwise).
  if (tracked) activity.trackBrowserRead = (promise: Promise<unknown>, reportFailure = true) => { tracked.push({ promise, reportFailure }); return promise; };
  // Which display transport each read used: the reporting one can fail the wake barrier on a 401/403/5xx.
  const transports: string[] = [];
  for (const [name, kind] of [['browserFetch', 'reporting'], ['browserFallbackFetch', 'fallback']] as const) {
    const real = activity[name];
    activity[name] = (url: string, init: any) => { transports.push(kind); return real(url, init); };
  }
  const output: any = {};
  new Function('require', 'exports', 'document', 'fetch', compile(resolve(frontend, 'src/lib/testMarketStore.ts')))((name: string) => {
    if (name === './api') return { API_BASE: '/api/v1', getToken: () => session.token, onSessionChange: (fn: () => void) => { session.listeners.add(fn); return () => session.listeners.delete(fn); } };
    if (name === './testMarkets') return testMarketHelpers;
    // The edge is a fixture too: nothing here reaches a network.
    if (name === './nrxMarket') return { ...nrxHelpers, fetchNrxPublic: async (url: string) => { calls.push({ url, init: null }); return { serverTime: 1, assets: [] }; } };
    if (name === './browserActivity') return activity;
    if (name === '../../../src/shared/aithPublication') return aithPublication;
    return req(name);
  }, output, document, fetch);
  return { ...output, calls, transports, session, changeSession(token: string | null) { session.token = token; for (const fn of session.listeners) fn(); } };
}

afterEach(() => { registerPrivateTestMarkets([]); jest.clearAllMocks(); });

describe('History20 private test markets in the frontend', () => {
  test('the pair shape alone keeps a private market off the edge, before and after discovery', () => {
    for (const pair of ['VHX07/SIMUSDT', 'vhx99/simusdt']) expect(isPrivateTestPair(pair)).toBe(true);
    for (const pair of ['VHX07/USDT', 'QAX/SIMUSDT', 'VHX7/SIMUSDT', 'BTC/USDT']) expect(isPrivateTestPair(pair)).toBe(false);
    expect(isTestMarketPair('VHX07/SIMUSDT')).toBe(false);
    registerPrivateTestMarkets(parseTestMarkets({ serverTime: 1, assets: [privateRow()] }, 'private')!.assets);
    expect([isKnownPrivateTestMarket('VHX07/SIMUSDT'), isTestMarketPair('VHX07/SIMUSDT'), isManagedTradablePair('VHX07/SIMUSDT')]).toEqual([true, true, true]);
    expect([isManagedListingPair('VHX07/SIMUSDT'), isEdgeMarketPair('VHX07/SIMUSDT')]).toEqual([false, false]);
    for (const url of ['/api/v1/private-test/markets/VHX07-SIMUSDT/candles?interval=5m', '/api/v1/market/display/spot-book/VHX07-SIMUSDT']) expect(isEdgeMarketUrl(url)).toBe(false);
    registerPrivateTestMarkets([]);
    expect(isTestMarketPair('VHX07/SIMUSDT')).toBe(false);
  });

  test('parse: only the authenticated source yields a private market, with its provenance; a public source never does', () => {
    const body = { serverTime: 1, assets: [privateRow(), privateRow({ pair: 'QAX/SIMUSDT', symbol: 'QAX' }),
      privateRow({ pair: 'VHX08/SIMUSDT', provenance: { mode: 'HISTORY20_PRIVATE_TEST', settlement: 'SIMUSDT', withdrawable: true } })] };
    const parsed = parseTestMarkets(body, 'private')!.assets;
    expect(parsed.map((a) => a.pair)).toEqual(['VHX07/SIMUSDT']);
    expect(parsed[0]).toMatchObject({ privateTest: true, quote: 'SIMUSDT', isTradable: true, provenanceLabel: expect.stringContaining('SIMUSDT') });
    // The edge catalogue may never introduce one, even dressed as a managed listing.
    expect(parseTestMarkets({ serverTime: 1, assets: [privateRow({ managed: true })] })!.assets).toEqual([]);
  });

  test('the chart and the book of a private pair read the private API only, never the edge or a venue', async () => {
    const { fetchPrivateTestMarketJson, fetchTestMarketJson } = require('../testMarketStore');
    fetchPrivateTestMarketJson.mockResolvedValueOnce({ candles: [{ time: 1, open: 2, high: 3, low: 1, close: 2.5, volume: 1 }] });
    expect((await testMarketCandleLoader('VHX07/SIMUSDT', '5m', 10)).candles).toHaveLength(1);
    expect(fetchPrivateTestMarketJson).toHaveBeenLastCalledWith('https://voltex-api.invalid/api/v1/private-test/markets/VHX07-SIMUSDT/candles?interval=5m&limit=10', undefined);
    const realFetch = globalThis.fetch;
    globalThis.fetch = jest.fn() as never;
    try {
      fetchPrivateTestMarketJson.mockResolvedValueOnce({ pair: 'VHX07/SIMUSDT', bids: [], asks: [{ price: '7', quantity: '2', orders: 1 }], timestamp: 5 });
      expect(await readSpotPublicBook('VHX07/SIMUSDT')).toMatchObject({ bids: [], asks: [{ price: '7', quantity: '2' }], status: 'live' });
      expect(fetchPrivateTestMarketJson).toHaveBeenLastCalledWith('https://voltex-api.invalid/api/v1/private-test/markets/VHX07-SIMUSDT/orderbook', undefined);
      fetchPrivateTestMarketJson.mockResolvedValueOnce({ pair: 'VHX07/SIMUSDT', bids: [], asks: [], timestamp: 5 });
      expect((await readSpotPublicBook('VHX07/SIMUSDT')).status).toBe('unavailable');
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(fetchTestMarketJson).not.toHaveBeenCalled();
    } finally { globalThis.fetch = realFetch; }
  });

  test('the real store: the session token travels, credentials never; no session asks nothing; a 404 is nothing, not an error; a session change forgets', async () => {
    let status = 200;
    const store = realStore(() => ({ ok: status === 200, status, body: { serverTime: 1, assets: [privateRow()] } }));
    await expect(store.fetchPrivateTestMarketJson('/api/v1/private-test/markets')).rejects.toThrow('private_test_no_session');
    expect(store.calls).toHaveLength(0);
    store.session.token = 'session-token-fixture';
    await store.privateTestMarketStore.refresh();
    expect(store.calls[0]).toMatchObject({ url: '/api/v1/private-test/markets', init: { credentials: 'omit', cache: 'no-store', headers: { Authorization: 'Bearer session-token-fixture' } } });
    expect(store.privateTestMarketStore.getState()).toMatchObject({ loaded: true, error: false });
    expect(isKnownPrivateTestMarket('VHX07/SIMUSDT')).toBe(true);
    store.changeSession('another-session');
    expect(store.privateTestMarketStore.getState().assets).toEqual([]);
    expect(isKnownPrivateTestMarket('VHX07/SIMUSDT')).toBe(false);
    status = 404;
    await store.privateTestMarketStore.refresh();
    expect(store.privateTestMarketStore.getState()).toMatchObject({ loaded: true, error: false, assets: [] });
    expect(isKnownPrivateTestMarket('VHX07/SIMUSDT')).toBe(false);
  });

  test('a non-participant never holds the page in a wake error, and asks once per session (browser idle budget)', async () => {
    const tracked: Array<{ promise: Promise<unknown>; reportFailure: boolean }> = [];
    const store = realStore(() => ({ ok: false, status: 404, body: { error: 'unknown_pair' } }), tracked);
    store.session.token = 'session-token-fixture';
    await store.privateTestMarketStore.refresh();
    expect(tracked).toHaveLength(1);
    // The tracked read resolves (404 is an answer) and never reports a failure to the wake barrier.
    await expect(tracked[0].promise).resolves.toBeUndefined();
    expect(tracked[0].reportFailure).toBe(false);
    // Nor does its transport: an expired session's 401 or an outage on this optional list is not the page's failure.
    expect(store.transports).toEqual(['fallback']);
    expect(store.privateTestMarketStore.getState()).toMatchObject({ loaded: true, error: false, assets: [] });
    await store.privateTestMarketStore.refresh();
    expect(store.calls).toHaveLength(1);
    store.changeSession('another-session');
    await store.privateTestMarketStore.refresh();
    expect(store.calls).toHaveLength(2);
  });

  test('an ordinary page never asks for private markets; only a private pair\'s terminal does, and the lists then show what it found', async () => {
    const { JSDOM } = require('jsdom');
    const React = req('react');
    const { createRoot } = req('react-dom/client');
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
    Object.assign(globalThis, { window: dom.window, IS_REACT_ACT_ENVIRONMENT: true });
    const store = realStore((url) => ({ ok: true, status: 200, body: { serverTime: 1, assets: url.includes('/private-test/') ? [privateRow()] : [] } }));
    store.session.token = 'session-token-fixture';
    const asked = () => store.calls.filter((call: { url: string }) => call.url.includes('/private-test/')).length;
    const lists: string[][] = [];
    const List = () => { lists.push(store.useTestMarkets().assets.map((asset: { pair: string }) => asset.pair)); return null; };
    const Terminal = () => { store.useTestMarket('VHX07/SIMUSDT'); return null; };
    const root = createRoot(dom.window.document.getElementById('root'));
    const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    try {
      // A signed-in Spot or Markets page: every public catalogue is read, the private list never.
      await React.act(async () => { root.render(React.createElement(List)); await settle(); });
      expect(store.calls.length).toBeGreaterThan(0);
      expect(asked()).toBe(0);
      // A participant opens the private pair (Admin → Listings → Открыть рынок): its terminal asks once.
      await React.act(async () => { root.render(React.createElement(React.Fragment, null, React.createElement(List), React.createElement(Terminal))); await settle(); });
      expect(asked()).toBe(1);
      expect(lists.at(-1)).toContain('VHX07/SIMUSDT');
      // The session ends: the list forgets it, and nothing asks for the next session on its behalf.
      await React.act(async () => { root.render(React.createElement(List)); await settle(); });
      await React.act(async () => { store.changeSession('another-session'); await settle(); });
      expect(lists.at(-1)).not.toContain('VHX07/SIMUSDT');
      expect(asked()).toBe(1);
    } finally {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const key of ['window', 'IS_REACT_ACT_ENVIRONMENT']) Reflect.deleteProperty(globalThis, key);
    }
  });
});
