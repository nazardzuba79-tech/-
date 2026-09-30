import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { isManagedListingPair, isManagedTradablePair, isTestMarketPair, managedListingLogo, managedListingTime, parseTestMarkets, registerManagedListings } from '../testMarkets';
import * as testMarketHelpers from '../testMarkets';
import { isEdgeMarketPair, isEdgeMarketUrl, nrxPublicUrl } from '../nrxMarket';
import * as nrxHelpers from '../nrxMarket';
import { resolveMarketEdgeBase, MARKET_EDGE_BASE } from '../marketEdge';
import { utcToZonedWallTime, zonedWallTimeToUtc, utcOffsetLabel } from '../../pages/admin/adminListingsTime';

const managed = (extra: Record<string, unknown> = {}) => ({
  pair: 'QAX/USDT', symbol: 'QAX', name: 'QA Example', quote: 'USDT', isTestAsset: true, isTradable: true, status: 'SPOT',
  listingArmed: true, listingAt: '2026-10-01T12:00:00.000Z', initialPrice: 0.25, managed: true, listingId: 'qax-1', version: 1,
  logo: 'data:image/png;base64,AAAA', displayTimeZone: 'Europe/Kyiv',
  state: { phase: 'pre-listing', lastPrice: null, openPrice24h: null, change24hPercent: null, high24h: null, low24h: null, volume24h: null, quoteVolume24h: null, serverTime: 1 },
  ...extra,
});

describe('managed listings in the frontend', () => {
  test('a pair is unknown until the edge catalogue names it; then it is an edge-served test market', () => {
    expect(isTestMarketPair('QBX/USDT')).toBe(false);
    const snapshot = parseTestMarkets({ serverTime: 1, assets: [managed({ pair: 'QBX/USDT', symbol: 'QBX', isTradable: false, logo: null })] })!;
    expect(snapshot.assets).toHaveLength(1);
    registerManagedListings(snapshot.assets);
    expect(isTestMarketPair('QBX/USDT')).toBe(true);
    expect(isManagedListingPair('qbx/usdt')).toBe(true);
    expect(isEdgeMarketPair('QBX/USDT')).toBe(true);
    expect(isManagedTradablePair('QBX/USDT')).toBe(false);
    expect(managedListingLogo('QBX')).toBeNull();
    expect(managedListingLogo('BTC')).toBeUndefined();
  });

  test('parse rules: managed rows need a well-formed USDT pair and may not impersonate VTA/NRX; logos must be image data URLs', () => {
    const body = { serverTime: 1, assets: [
      managed(), managed({ pair: 'VTA/USDT', symbol: 'VTA' }), managed({ pair: 'bad pair' }), managed({ pair: 'QCX/USDT', symbol: 'QCX', logo: 'https://evil.invalid/x.png' }),
    ] };
    const assets = parseTestMarkets(body)!.assets;
    expect(assets.map((a) => a.pair)).toEqual(['QAX/USDT', 'QCX/USDT']);
    expect(assets[0].logo).toBe('data:image/png;base64,AAAA');
    expect(assets[1].logo).toBeNull();
    registerManagedListings(assets);
    expect(isManagedTradablePair('QAX/USDT')).toBe(true);
  });

  test('edge routing: catalogue, NRX and listed pairs go to the edge; ordinary pairs never do', () => {
    registerManagedListings(parseTestMarkets({ serverTime: 1, assets: [managed()] })!.assets);
    expect(isEdgeMarketUrl(`${MARKET_EDGE_BASE}/market/listings`)).toBe(true);
    expect(isEdgeMarketUrl('/api/v1/market/display/spot-book/QAX-USDT')).toBe(true);
    expect(isEdgeMarketUrl('/api/v1/market/test-assets/QAX-USDT/candles?interval=5m')).toBe(true);
    expect(isEdgeMarketUrl('/api/v1/market/test-assets/VTA-USDT')).toBe(false);
    expect(isEdgeMarketUrl('/api/v1/market/display/spot-book/BTC-USDT')).toBe(false);
    expect(nrxPublicUrl('/api/v1/market/external/trades/QAX-USDT')).toBe(`${MARKET_EDGE_BASE}/market/external/trades/QAX-USDT`);
  });

  test('edge base: production default unless a valid https (or loopback) origin is configured', () => {
    expect(MARKET_EDGE_BASE).toBe('https://market.voltextech.net');
    expect(resolveMarketEdgeBase('https://edge.example.test/')).toBe('https://edge.example.test');
    expect(resolveMarketEdgeBase('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(resolveMarketEdgeBase('http://evil.example')).toBe('https://market.voltextech.net');
    expect(resolveMarketEdgeBase('javascript:alert(1)')).toBe('https://market.voltextech.net');
  });

  test('time zones: the admin enters wall-clock time in a zone; the config stores the UTC instant (DST-aware)', () => {
    expect(zonedWallTimeToUtc('2026-10-01T15:00', 'Europe/Kyiv')).toBe('2026-10-01T12:00:00Z'); // summer UTC+3
    expect(zonedWallTimeToUtc('2026-12-01T15:00', 'Europe/Kyiv')).toBe('2026-12-01T13:00:00Z'); // winter UTC+2
    expect(zonedWallTimeToUtc('2026-10-01T15:00', 'UTC')).toBe('2026-10-01T15:00:00Z');
    expect(utcToZonedWallTime('2026-10-01T12:00:00Z', 'Europe/Kyiv')).toBe('2026-10-01T15:00');
    expect(utcOffsetLabel(Date.parse('2026-10-01T12:00:00Z'), 'Europe/Kyiv')).toBe('UTC+3');
    expect(managedListingTime('2026-10-01T12:00:00Z', 'Europe/Kyiv')).toBe('01.10.2026 · 15:00 Europe/Kyiv · 12:00 UTC');
  });
});

describe('test-market list identity', () => {
  test('the merged VTA + NRX + managed list is memoised per store change, never rebuilt per render', () => {
    // A fresh array each render made useMarketTickers rebuild its Map on every render, which kept the
    // Markets page re-rendering and starved React Router transitions (Markets → Trade never committed).
    const source = require('fs').readFileSync(require('path').join(__dirname, '../testMarketStore.ts'), 'utf8') as string;
    expect(source).toMatch(/const assets = useMemo\(\(\) => \[\.\.\.vta\.assets, \.\.\.nrx\.assets, \.\.\.managed\.assets\], \[vta\.assets, nrx\.assets, managed\.assets\]\);/);
    expect(source).not.toMatch(/assets: \[\.\.\.vta\.assets/);
  });
});

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const flush = () => new Promise<void>((done) => setImmediate(done));
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const compile = (file: string) => ts.transpileModule(readFileSync(file, 'utf8').replaceAll('import.meta.env.VITE_SIMULATION_PREVIEW', 'undefined'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

/** Execute the real store, parser and registry; only transport and document visibility are fixtures. */
function stores(read: (url: string) => Promise<unknown>) {
  const listeners = new Set<(event?: Event) => void>();
  const document = {
    hidden: false,
    addEventListener: (_name: string, listener: (event?: Event) => void) => listeners.add(listener),
    removeEventListener: (_name: string, listener: (event?: Event) => void) => listeners.delete(listener),
  };
  const activity: any = {};
  const fetch = async (url: string) => ({ ok: true, json: () => read(url) });
  new Function('exports', 'document', 'globalThis', compile(resolve(frontend, 'src/lib/browserActivity.ts')))(activity, document, { fetch });
  const output: any = {};
  new Function('require', 'exports', 'document', 'fetch', compile(resolve(frontend, 'src/lib/testMarketStore.ts')))((name: string) => {
    if (name === './api') return { API_BASE: '/api/v1' };
    if (name === './testMarkets') return testMarketHelpers;
    if (name === './nrxMarket') return { ...nrxHelpers, fetchNrxPublic: read };
    if (name === './browserActivity') return activity;
    return req(name);
  }, output, document, async (url: string) => ({ ok: true, json: () => read(url) }));
  return { ...output, listeners, visibility(hidden: boolean) { document.hidden = hidden; for (const listener of listeners) listener(); },
    wake() { document.hidden = false; for (const listener of listeners) listener(new Event('voltex:browser-activity')); } };
}

describe('managed catalogue scheduling with the real store', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(Date.parse('2026-09-29T00:00:00Z')));
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  test('a future-only catalogue discovers another listing on its regular minute cadence and stops after unsubscribe', async () => {
    const assets = [managed()];
    const read = jest.fn(async (_url: string) => ({ serverTime: Date.now(), assets }));
    const market = stores(read);
    const off = market.managedListingStore.subscribe(() => {}, 60_000);
    await settle();
    assets.push(managed({ pair: 'QDX/USDT', symbol: 'QDX' }));
    await jest.advanceTimersByTimeAsync(59_999);
    expect(read).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(market.managedListingStore.getState().assets.map((asset: any) => asset.pair)).toEqual(['QAX/USDT', 'QDX/USDT']);
    expect(read.mock.calls.every(([url]) => url === `${MARKET_EDGE_BASE}/market/listings`)).toBe(true);
    off();
    await jest.advanceTimersByTimeAsync(600_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(market.listeners.size).toBe(0);
  });

  test('re-entering refreshes a cached future-only catalogue once and concurrent subscribers share that read', async () => {
    const assets = [managed()];
    const read = jest.fn(async (_url: string) => ({ serverTime: Date.now(), assets }));
    const market = stores(read);
    const off = market.managedListingStore.subscribe(() => {});
    await settle(); off();
    await jest.advanceTimersByTimeAsync(1_000);
    assets.push(managed({ pair: 'QEX/USDT', symbol: 'QEX' }));
    const offA = market.managedListingStore.subscribe(() => {});
    const offB = market.managedListingStore.subscribe(() => {});
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(market.managedListingStore.getState().assets).toHaveLength(2);
    offA(); offB();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('the fastest subscriber controls future catalogue reads and leaving the terminal restores the list budget', async () => {
    const read = jest.fn(async (_url: string) => ({ serverTime: Date.now(), assets: [managed()] }));
    const market = stores(read);
    const offList = market.managedListingStore.subscribe(() => {}, 60_000);
    await settle();
    await jest.advanceTimersByTimeAsync(20_000);
    const offTerminal = market.managedListingStore.subscribe(() => {}, 5_000);
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(read).toHaveBeenCalledTimes(3);
    offTerminal();
    await jest.advanceTimersByTimeAsync(59_999);
    expect(read).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(4);
    offList();
  });

  test('a launch before the next discovery poll still gets its own refresh', async () => {
    const listingAt = new Date(Date.now() + 10_000).toISOString();
    const read = jest.fn(async (_url: string) => ({ serverTime: Date.now(), assets: [managed({ listingAt })] }));
    const market = stores(read);
    const off = market.managedListingStore.subscribe(() => {}, market.MANAGED_LISTING_DISCOVERY_INTERVAL_MS);
    await settle();
    await jest.advanceTimersByTimeAsync(10_999);
    expect(read).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    off();
  });

  test('an empty catalogue sleeps while hidden and resumes even after a quick hidden re-entry', async () => {
    const read = jest.fn(async (_url: string) => ({ serverTime: Date.now(), assets: [] }));
    const market = stores(read);
    const off = market.managedListingStore.subscribe(() => {});
    await settle();
    market.visibility(true);
    await jest.advanceTimersByTimeAsync(300_000);
    expect(read).toHaveBeenCalledTimes(1);
    market.visibility(false); await settle();
    expect(read).toHaveBeenCalledTimes(2);
    off();
    market.visibility(true);
    const offAgain = market.managedListingStore.subscribe(() => {});
    await settle();
    await jest.advanceTimersByTimeAsync(1_000);
    market.visibility(false); await settle();
    expect(read).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(59_000);
    expect(read).toHaveBeenCalledTimes(3);
    offAgain();
  });

  test('sleep removes the catalogue clock and waking supersedes a suspended pre-sleep response', async () => {
    const responses: ((value: unknown) => void)[] = [];
    const read = jest.fn((_url: string) => new Promise(resolve => responses.push(resolve)));
    const market = stores(read);
    const off = market.managedListingStore.subscribe(() => {}, 60_000);
    await settle();
    market.visibility(true);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(300_000);
    expect(read).toHaveBeenCalledTimes(1);
    market.wake(); market.wake();
    responses[0]({ serverTime: Date.now() - 300_000, assets: [managed()] });
    await settle(); await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(market.managedListingStore.getState().assets).toEqual([]);
    responses[1]({ serverTime: Date.now(), assets: [managed({ pair: 'QWX/USDT', symbol: 'QWX' })] });
    await settle(); await settle();
    expect(market.managedListingStore.getState().assets.map((asset: any) => asset.pair)).toEqual(['QWX/USDT']);
    market.visibility(true); expect(jest.getTimerCount()).toBe(0);
    off();
  });

  test.each(['VTA', 'NRX'])('%s keeps its fixed-market launch-only budget, including route re-entry', async (symbol) => {
    const listingAt = Date.now() + 86_400_000;
    const read = jest.fn(async (_url: string) => ({ serverTime: Date.now(), assets: [managed({
      pair: `${symbol}/USDT`, symbol, managed: false, isTradable: symbol === 'NRX', listingAt: new Date(listingAt).toISOString(),
    })] }));
    const market = stores(read);
    const store = symbol === 'VTA' ? market.testMarketStore : market.nrxMarketStore;
    const off = store.subscribe(() => {});
    await settle();
    expect(store.getState().assets).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(3_600_000);
    off();
    const offAgain = store.subscribe(() => {});
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(listingAt - Date.now() + 1_000);
    expect(read).toHaveBeenCalledTimes(2);
    offAgain();
  });

  test.each(['VTA', 'NRX'])('%s unarmed preview stays silent after visibility changes', async (symbol) => {
    const read = jest.fn(async (_url: string) => ({ serverTime: Date.now(), assets: [managed({
      pair: `${symbol}/USDT`, symbol, managed: false, isTradable: symbol === 'NRX', listingArmed: false,
    })] }));
    const market = stores(read);
    const store = symbol === 'VTA' ? market.testMarketStore : market.nrxMarketStore;
    const off = store.subscribe(() => {});
    await settle();
    market.visibility(true);
    await jest.advanceTimersByTimeAsync(86_400_000);
    market.visibility(false); await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    off();
  });
});

describe('saved-draft actions in the mounted Listings admin', () => {
  const { JSDOM } = req('jsdom');
  const React = req('react');
  const { act } = React;
  const { Simulate } = req('react-dom/test-utils');
  let dom: any, root: any, host: HTMLElement, listing: any, extraListings: any[], fetchMock: jest.Mock;
  let previewGate: Promise<void> | null, previewRevision: number | null, publishFailures: number;
  let globals: Map<string, PropertyDescriptor | undefined>;
  const modules = new Map<string, any>();
  const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => structuredClone(body) });

  function load(file: string): any {
    for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix)) { file += suffix; break; }
    if (modules.has(file)) return modules.get(file);
    const output: any = {}; modules.set(file, output);
    new Function('exports', 'require', compile(file))(output, (name: string) => {
      if (name.endsWith('.css')) return {};
      if (name === '../../lib/api') return { API_BASE: '/api/v1', getToken: () => 'fixture-admin-token' };
      return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
    });
    return output;
  }

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/admin/listings' });
    const values = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
      FileReader: dom.window.FileReader, IS_REACT_ACT_ENVIRONMENT: true, fetch: undefined };
    globals = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.assign(globalThis, values);
    host = document.getElementById('root')!;
    root = req('react-dom/client').createRoot(host);
    modules.clear(); previewGate = null; previewRevision = null; publishFailures = 0; extraListings = [];
    listing = {
      id: 'qax-1', symbol: 'QAX', draftRevision: 2, draftUpdatedAt: '2026-09-29T00:00:00Z', draftUpdatedBy: 'fixture-admin',
      activeVersion: null, active: null, versions: [],
      draft: { schemaVersion: 1, symbol: 'QAX', name: 'QA Example', logo: null, initialPrice: '0.25',
        listingAt: '2026-10-01T12:00:00Z', displayTimeZone: 'Europe/Kyiv', ownerAllocation: '0', seedMode: 'auto',
        seed: 'qax-fixed-seed', tradable: false, simulationProfile: 'CALM_TREND' },
    };
    fetchMock = jest.fn(async (url: string, init: any = {}) => {
      const path = String(url);
      if (path === '/api/v1/admin/listings') return json({ revision: String(listing.draftRevision), serverTime: Date.now(), listings: [listing, ...extraListings] });
      if (path.endsWith('/draft') && init.method === 'PUT') {
        const { config } = JSON.parse(init.body);
        listing = { ...listing, draftRevision: listing.draftRevision + 1, draft: { ...listing.draft, ...config } };
        return json({ id: listing.id, draftRevision: listing.draftRevision, draft: listing.draft });
      }
      if (path.includes('/preview?')) {
        const saved = structuredClone(listing);
        if (previewGate) await previewGate;
        return json({ listingId: saved.id, draftRevision: previewRevision ?? saved.draftRevision,
          previewAt: Date.parse(saved.draft.listingAt) + 7_200_000, serverTime: Date.now(),
          asset: { pair: `${saved.symbol}/USDT`, state: { phase: 'live', lastPrice: Number(saved.draft.initialPrice), change24hPercent: 0 } },
          candles: [], book: { available: false, asks: [], bids: [] }, trades: [] });
      }
      if (path.endsWith('/publish') && init.method === 'POST') {
        if (publishFailures > 0) { publishFailures -= 1; throw new Error('fixture connection lost'); }
        listing = { ...listing, activeVersion: 1, active: structuredClone(listing.draft),
          versions: [{ version: 1, publishedAt: '2026-09-29T01:00:00Z', publishedBy: 'fixture-admin' }] };
        return json({ id: listing.id, version: 1, replayed: false, publishedAt: '2026-09-29T01:00:00Z' });
      }
      return json({ error: `unexpected fixture request ${path}` }, 404);
    });
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  async function mount() {
    const { AdminListingsPage } = load(resolve(frontend, 'src/pages/admin/AdminListingsPage'));
    const { MemoryRouter } = req('react-router-dom');
    await act(async () => { root.render(React.createElement(MemoryRouter, null, React.createElement(AdminListingsPage))); await flush(); });
    await click('[data-edit-listing="QAX"]');
  }
  const button = (selector: string) => host.querySelector<HTMLButtonElement>(selector)!;
  async function click(selector: string) { await act(async () => { button(selector).click(); await flush(); }); }
  async function change(field: string, value: string | boolean) {
    const input = host.querySelector<HTMLInputElement>(`[data-field="${field}"]`)!;
    await act(async () => {
      Simulate.change(input, { target: typeof value === 'boolean' ? { checked: value } : { value } });
      await flush();
    });
  }
  const calls = (part: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(part));

  function deferredLogos() {
    const readers: any[] = [];
    (globalThis as any).FileReader = class {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() { readers.push(this); }
    };
    return {
      async choose() {
        const input = host.querySelector('[data-field="logo"]');
        const file = new dom.window.File(['fixture'], 'logo.png', { type: 'image/png' });
        await act(async () => { Simulate.change(input, { target: { files: [file], value: 'logo.png' } }); await flush(); });
      },
      async finish(index = 0, failed = false) {
        await act(async () => {
          readers[index].result = 'data:image/png;base64,RklYVFVSRQ==';
          if (failed) readers[index].onerror(); else readers[index].onload();
          await flush();
        });
      },
    };
  }

  test('editing clears the saved preview and requires Save; reverting restores actions without reviving that preview', async () => {
    await mount();
    expect(button('[data-preview]').disabled).toBe(false);
    await click('[data-preview]');
    expect(host.querySelector('[data-listing-preview]')).not.toBeNull();
    await change('initialPrice', '0.45');
    expect(host.querySelector('[data-listing-preview]')).toBeNull();
    expect(host.querySelector('[data-unsaved-draft]')?.textContent).toContain('Сначала сохраните');
    expect(button('[data-preview]').disabled).toBe(true);
    expect(button('[data-publish]').disabled).toBe(true);
    await click('[data-preview]'); await click('[data-publish]');
    expect(calls('/preview?')).toHaveLength(1);
    expect(calls('/publish')).toHaveLength(0);
    expect(host.querySelector('[data-publish-dialog]')).toBeNull();
    await change('initialPrice', '0.25');
    expect(button('[data-preview]').disabled).toBe(false);
    expect(button('[data-publish]').disabled).toBe(false);
    expect(host.querySelector('[data-unsaved-draft]')).toBeNull();
    expect(host.querySelector('[data-listing-preview]')).toBeNull();
    await click('[data-preview]');
    expect(calls('/preview?')).toHaveLength(2);
  });

  test('saving enables the new revision; publish still confirms it and retries with the same key and CAS revision', async () => {
    await mount();
    await change('initialPrice', '0.45');
    await click('[data-save-draft]');
    const [, saveRequest] = calls('/draft')[0];
    expect(saveRequest.method).toBe('PUT');
    expect(saveRequest.headers['If-Match']).toBe('2');
    expect(JSON.parse(saveRequest.body).config.initialPrice).toBe('0.45');
    expect(button('[data-preview]').disabled).toBe(false);
    await click('[data-preview]');
    expect(host.querySelector('[data-preview-price]')?.textContent).toContain('0.45');
    await click('[data-publish]');
    expect(host.querySelector('[data-publish-dialog]')?.textContent).toContain('0.45 USDT');
    expect(calls('/publish')).toHaveLength(0);
    publishFailures = 1;
    await click('[data-confirm-publish]');
    expect(host.querySelector('[data-publish-dialog]')).not.toBeNull();
    await click('[data-confirm-publish]');
    const requests = calls('/publish').map(([, init]) => JSON.parse(init.body));
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ draftRevision: 3, publishKey: expect.any(String) });
    expect(requests[0].publishKey.length).toBeGreaterThanOrEqual(32);
    expect(requests[1]).toEqual(requests[0]);
    expect(host.querySelector('[data-publish-dialog]')).toBeNull();
    expect(calls('/allocation')).toHaveLength(0);
  });

  test('a preview response arriving after edit and revert stays invalidated', async () => {
    await mount();
    let finish!: () => void;
    previewGate = new Promise<void>((done) => { finish = done; });
    await click('[data-preview]');
    await change('name', 'Unsaved name');
    await change('name', 'QA Example');
    await act(async () => { finish(); await flush(); });
    expect(host.querySelector('[data-listing-preview]')).toBeNull();
    expect(button('[data-preview]').disabled).toBe(false);
    previewGate = null;
    await click('[data-preview]');
    expect(host.querySelector('[data-listing-preview]')).not.toBeNull();
  });

  test('checkbox and seed-mode edits use the same saved-draft guard; returning to automatic seed is clean', async () => {
    await mount();
    await change('tradable', true);
    expect(button('[data-publish]').disabled).toBe(true);
    await change('tradable', false);
    expect(button('[data-publish]').disabled).toBe(false);
    const radios = host.querySelectorAll<HTMLInputElement>('.listing-seed input[type="radio"]');
    await act(async () => { Simulate.change(radios[1]); await flush(); });
    await change('seed', 'unsaved-manual-seed');
    expect(button('[data-preview]').disabled).toBe(true);
    await act(async () => { Simulate.change(radios[0]); await flush(); });
    expect(button('[data-preview]').disabled).toBe(false);
    expect(host.querySelector('[data-unsaved-draft]')).toBeNull();
    expect(host.querySelector('[data-saved-seed]')?.textContent).toBe('qax-fixed-seed');
    expect(calls('/draft')).toHaveLength(0);
  });

  test('choosing a logo immediately invalidates preview and blocks saved-draft actions until its asynchronous read and Save', async () => {
    await mount();
    await click('[data-preview]');
    const logos = deferredLogos();
    let finishPreview!: () => void;
    previewGate = new Promise<void>((done) => { finishPreview = done; });
    await click('[data-preview]');
    await logos.choose();
    expect(host.querySelector('[data-listing-preview]')).toBeNull();
    expect(host.querySelector('[data-logo-reading]')).not.toBeNull();
    for (const selector of ['[data-save-draft]', '[data-preview]', '[data-publish]']) expect(button(selector).disabled).toBe(true);
    await act(async () => { finishPreview(); await flush(); });
    expect(host.querySelector('[data-listing-preview]')).toBeNull();
    await click('[data-preview]'); await click('[data-publish]'); await click('[data-save-draft]');
    expect(calls('/preview?')).toHaveLength(2);
    expect(calls('/publish')).toHaveLength(0);
    expect(calls('/draft')).toHaveLength(0);
    await logos.finish();
    expect(host.querySelector('[data-logo-reading]')).toBeNull();
    expect(button('[data-save-draft]').disabled).toBe(false);
    expect(button('[data-preview]').disabled).toBe(true);
    expect(button('[data-publish]').disabled).toBe(true);
    await click('[data-save-draft]');
    expect(JSON.parse(calls('/draft')[0][1].body).config.logo).toBe('data:image/png;base64,RklYVFVSRQ==');
    expect(button('[data-preview]').disabled).toBe(false);
  });

  test('a late logo callback cannot alter another listing; a failed read permits a clean retry', async () => {
    extraListings = [{ ...structuredClone(listing), id: 'qbx-2', symbol: 'QBX', draft: { ...listing.draft, symbol: 'QBX', name: 'Second listing' } }];
    await mount();
    const logos = deferredLogos();
    await logos.choose();
    await click('[data-edit-listing="QBX"]');
    await logos.finish();
    expect(host.querySelector<HTMLInputElement>('[data-field="name"]')?.value).toBe('Second listing');
    expect(host.querySelector('.listing-logo img')).toBeNull();
    expect(host.querySelector('[data-unsaved-draft]')).toBeNull();
    expect(button('[data-preview]').disabled).toBe(false);
    await logos.choose();
    await logos.finish(1, true);
    expect(host.querySelector('[data-listing-error]')?.textContent).toContain('Не удалось прочитать логотип');
    expect(host.querySelector('[data-logo-reading]')).toBeNull();
    expect(button('[data-save-draft]').disabled).toBe(false);
    expect(button('[data-preview]').disabled).toBe(false);
    expect(host.querySelector('.listing-logo img')).toBeNull();
  });

  test('a preview of another saved revision is refused and a changed preview moment clears the old view', async () => {
    await mount();
    previewRevision = 3;
    await click('[data-preview]');
    expect(host.querySelector('[data-listing-preview]')).toBeNull();
    expect(host.querySelector('[data-listing-error]')?.textContent).toContain('Черновик уже изменён');
    previewRevision = null;
    await click('[data-preview]');
    expect(host.querySelector('[data-listing-preview]')).not.toBeNull();
    await change('previewAt', '2026-10-01T16:00');
    expect(host.querySelector('[data-listing-preview]')).toBeNull();
    expect(button('[data-preview]').disabled).toBe(false);
    expect(button('[data-publish]').disabled).toBe(false);
  });
});
