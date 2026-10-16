import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as catalogueModel from '../../pages/stocks/global/stockCatalogueModel';
import * as session from '../../pages/stocks/global/accountSession';
import * as readWork from '../../pages/stocks/global/readWork';
import * as overload from '../../pages/stocks/global/overload';
import * as markers from '../../pages/stocks/global/tradeMarkers';
import * as requestErrors from '../../pages/stocks/stockRequestError';
import * as originalText from '../../pages/stocks/global/stockOriginalText';
import { stockTranslator } from '../../pages/stocks/global/stockText';
import type { Asset } from '../../pages/stocks/global/types';

const frontend = resolve(__dirname, '../../..'), req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), { JSDOM } = req('jsdom');
const router = req('react-router-dom');
const NOW = Date.parse('2026-10-16T15:00:00Z');
// Local fixture observations exercise presentation only; none are provider data or
// execution prices. No candle generators or financial account fixtures are used.
const bybit: Asset = { id: 'BYBIT:AAPLXUSDT', ticker: 'AAPLX', asset: 'AAPLX', name: 'Apple xStock',
  provider: 'bybit', sourceSymbol: 'AAPLXUSDT', region: 'US', kind: 'token', currency: 'USDT',
  delaySeconds: 0, timeframes: ['1m', '15m'], display: { price: '123.4567', change24h: -1.25, timestamp: NOW - 120000 } };
const binance: Asset = { ...bybit, id: 'BINANCE:AAPLBUSDT', ticker: 'AAPLB', asset: 'AAPLB', name: 'Apple bStock',
  provider: 'binance', sourceSymbol: 'AAPLBUSDT', display: null };
const moex: Asset = { ...bybit, id: 'MOEX:TQBR:SBER', ticker: 'SBER', asset: 'SBER', name: 'Sberbank',
  provider: 'moex', sourceSymbol: 'SBER', region: 'RU', kind: 'stock', currency: 'RUB',
  sourceError: 'MOEX_UNVERIFIED', display: null };
const fixtureAssets = () => [structuredClone(bybit), structuredClone(binance), structuredClone(moex)];
const defaults: catalogueModel.CatalogueFilters = { tab: 'all', query: '', provider: 'all', currency: 'all', descending: false };

test('catalogue identities keep different token providers distinct and reject contradictory source mappings', () => {
  expect(catalogueModel.isAssetCatalogue({ catalogue: fixtureAssets() })).toBe(true);
  for (const bad of [
    { ...bybit, provider: 'binance' }, { ...bybit, sourceSymbol: 'NVDAXUSDT' },
    { ...bybit, id: 'AAPL' }, { ...bybit, provider: 'unknown' },
    { ...moex, id: 'MOEX:SBER' }, { ...bybit, timeframes: [1] },
  ]) expect(catalogueModel.isAssetCatalogue({ catalogue: [bad] })).toBe(false);
  expect(catalogueModel.isAssetCatalogue({ catalogue: [bybit, bybit] })).toBe(false);
  expect(catalogueModel.isAssetCatalogue({ catalogue: Array.from({ length: 251 }, (_, i) =>
    ({ ...bybit, id: `BYBIT:T${i}`, sourceSymbol: `T${i}` })) })).toBe(false);
  for (const body of [null, [], {}, { catalogue: null }, { catalogue: [{}] }])
    expect(catalogueModel.isAssetCatalogue(body)).toBe(false);
});

test('filters and favorites use canonical IDs without creating missing Asian or index instruments', () => {
  const assets = fixtureAssets(), original = JSON.stringify(assets);
  const select = (overrides: Partial<catalogueModel.CatalogueFilters> = {}, favorites: string[] = []) =>
    catalogueModel.filterCatalogue(assets, { ...defaults, ...overrides }, favorites, 'en-US').map(a => a.id);
  expect(select()).toEqual([binance.id, bybit.id, moex.id]);
  expect(select({ descending: true })).toEqual([moex.id, bybit.id, binance.id]);
  expect(select({ tab: 'US', provider: 'bybit', currency: 'USDT' })).toEqual([bybit.id]);
  expect(select({ tab: 'RU', currency: 'RUB' })).toEqual([moex.id]);
  expect(select({ query: '  aaplbUSDT  ' })).toEqual([binance.id]);
  expect(select({ tab: 'favorites' }, [bybit.id, 'AAPL'])).toEqual([bybit.id]);
  expect(select({ tab: 'Asia' })).toEqual([]);
  expect(select({ tab: 'index' })).toEqual([]);
  expect(JSON.stringify(assets)).toBe(original);
});

test('stale observations retain the actual source timestamp and price; unavailable MOEX never gains a quote', () => {
  expect(catalogueModel.catalogueObservation(bybit, NOW)).toEqual({ price: '123.4567', change: -1.25,
    timestamp: NOW - 120000, ageSeconds: 120 });
  expect(catalogueModel.catalogueObservation(bybit, NOW + 60000)?.ageSeconds).toBe(180);
  expect(catalogueModel.catalogueObservation({ ...moex, display: bybit.display }, NOW)).toBeNull();
  expect(catalogueModel.catalogueObservation(binance, NOW)).toBeNull();
  for (const display of [
    { price: '0', change24h: 1, timestamp: NOW }, { price: 'NaN', change24h: 1, timestamp: NOW },
    { price: '100', change24h: 1, timestamp: 0 }, { price: '100', change24h: 1, timestamp: NOW + 1 },
  ]) expect(catalogueModel.catalogueObservation({ ...bybit, display }, NOW)).toBeNull();
  expect(catalogueModel.catalogueObservation({ ...bybit, display: { ...bybit.display!, change24h: NaN } }, NOW)?.change).toBeNull();
  expect(bybit.display).toEqual({ price: '123.4567', change24h: -1.25, timestamp: NOW - 120000 });
});

describe('original Stocks catalogue read-only lifecycle', () => {
  let dom: any, root: any, Catalogue: any, credential: string | null, hidden: boolean;
  let listeners: Set<() => void>, fetchMock: jest.Mock, clearToken: jest.Mock;
  let requests: Array<{ url: string; init: RequestInit; finish: (status: number, body: unknown) => void }>;
  const globals = ['window', 'document', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  let previous: Map<string, PropertyDescriptor | undefined>;
  const originalFetch = globalThis.fetch;
  const flush = async (work: () => void = () => {}) => React.act(async () => { work(); await Promise.resolve(); await Promise.resolve(); });
  const advance = async (ms: number) => React.act(async () => { await jest.advanceTimersByTimeAsync(ms); });
  const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  const button = (text: string) => buttons().find(b => b.textContent === text)!;
  const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.vxo-original-row'));
  const row = (id: string) => rows().find(r => r.querySelector('a')?.getAttribute('href') === '/stocks/' + encodeURIComponent(id))!;
  const visibility = async (value: boolean) => flush(() => { hidden = value; document.dispatchEvent(new dom.window.Event('visibilitychange')); });
  const login = async (token: string | null) => flush(() => { credential = token; listeners.forEach(listener => listener()); });
  const finish = async (index: number, body: unknown = { catalogue: fixtureAssets() }, status = 200) =>
    flush(() => requests[index].finish(status, body));
  const draw = () => flush(() => root.render(React.createElement(router.MemoryRouter, { initialEntries: ['/stocks'] }, React.createElement(Catalogue))));

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW }); root = undefined; credential = 'fixture-alice-session'; hidden = false; listeners = new Set(); requests = [];
    dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:4438/stocks', pretendToBeVisual: true });
    previous = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
      HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    clearToken = jest.fn(() => { credential = null; listeners.forEach(listener => listener()); });
    fetchMock = jest.fn((url: string, init: RequestInit = {}) => {
      if (url !== '/__stocks_global/catalogue' || (init.method || 'GET') !== 'GET')
        throw new Error(`Unexpected catalogue request: ${init.method || 'GET'} ${url}`);
      return new Promise(resolve => requests.push({ url, init, finish: (status, body) =>
        resolve({ status, ok: status >= 200 && status < 300, json: async () => body }) }));
    });
    globalThis.fetch = fetchMock;
    const Empty = () => null;
    const imports: Record<string, unknown> = {
      react: React, 'react/jsx-runtime': req('react/jsx-runtime'), 'react-router-dom': router,
      'lucide-react': { ChevronDown: Empty, Search: Empty, Star: Empty, TrendingUp: Empty },
      '../../../lib/api': { getToken: () => credential, clearToken,
        onSessionChange: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } },
      '../../../lib/i18n': { useLanguage: () => ({ t: (key: string, values?: { count: number }) => values ? `${key}:${values.count}` : key }) },
      './useStocksText': { useStocksText: () => ({ s: stockTranslator('ru'), lang: 'ru', locale: 'ru-RU' }) },
      './OriginalStocksHeader': { default: Empty }, './stockOriginalText': originalText, './stocksOriginal.css': {},
      '../stockRequestError': requestErrors, './accountSession': session, './readWork': readWork,
      './overload': overload, './tradeMarkers': markers, './stockCatalogueModel': catalogueModel,
    };
    const output: any = {};
    new Function('exports', 'require', ts.transpileModule(
      readFileSync(resolve(frontend, 'src/pages/stocks/global/GlobalStocksCatalogue.tsx'), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } },
    ).outputText)(output, (name: string) => {
      if (!(name in imports)) throw new Error(`Unexpected catalogue dependency: ${name}`);
      return imports[name];
    });
    Catalogue = output.default; root = createRoot(document.getElementById('root'));
  });
  afterEach(async () => {
    if (root) await flush(() => root.unmount());
    expect(listeners.size).toBe(0);
    // Inspect every transport attempt, including ones that the component catches.
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe('/__stocks_global/catalogue');
      expect(init.method || 'GET').toBe('GET'); expect(init.body).toBeUndefined();
      expect(init.credentials).toBe('omit'); expect(init.cache).toBe('no-store');
    }
    globalThis.fetch = originalFetch; dom.window.close(); jest.useRealTimers();
    for (const key of globals) { const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; }
  });

  test('renders exact provider links and aged observations without chart/history/account reads or invented indices', async () => {
    await draw(); expect(requests).toHaveLength(1);
    expect(requests[0].init.headers).toEqual({ Authorization: 'Bearer fixture-alice-session' });
    await finish(0, { catalogue: [...fixtureAssets().slice(0, 2), { ...moex, display: bybit.display }] });
    expect(rows()).toHaveLength(3);
    expect(row(bybit.id).querySelector('.vxo-original-price strong')!.textContent).toBe('123,4567');
    expect(row(bybit.id).querySelector('.vxo-original-age')!.textContent).toBe(markers.quoteAge(NOW - 120000, NOW, 'ru'));
    expect(row(binance.id).textContent).toContain('AAPLB · BINANCE');
    for (const id of [binance.id, moex.id]) {
      expect(row(id).querySelector('.vxo-original-price strong')!.textContent).toBe('—');
      expect(row(id).querySelector('.vxo-original-age')!.textContent).toBe('stocks.unavailable');
    }
    expect(row(moex.id).querySelector('.vxo-original-price small')!.textContent).toBe('RUB');
    expect(Array.from(document.querySelectorAll('.vxo-original-indices article b')).map(n => n.textContent))
      .toEqual(Array(6).fill('—'));
    expect(document.querySelectorAll('canvas, iframe, form')).toHaveLength(0);
    await flush(() => button('stocks.Asia').click()); expect(rows()).toHaveLength(0);
    await flush(() => button('stocks.index').click()); expect(rows()).toHaveLength(0);
    await flush(() => button('stocks.Russia').click()); expect(rows()).toHaveLength(1);
    expect(row(moex.id)).toBeDefined(); expect(requests).toHaveLength(1);
    expect(localStorage.length).toBe(0);
  });

  test('favorites persist exact provider IDs across remount; filters and sorting require no additional reads', async () => {
    localStorage.setItem('voltex.stocks.global.pending.v2.fixture-owner', 'unchanged-financial-intent');
    await draw(); await finish(0);
    await flush(() => row(bybit.id).querySelector<HTMLButtonElement>('.vxo-original-favorite')!.click());
    expect(JSON.parse(localStorage.getItem(catalogueModel.STOCKS_FAVORITES_KEY)!)).toEqual([bybit.id]);
    expect(row(bybit.id).querySelector('button')!.getAttribute('aria-pressed')).toBe('true');
    expect(row(binance.id).querySelector('button')!.getAttribute('aria-pressed')).toBe('false');
    await flush(() => button('stocks.favorites').click()); expect(rows()).toHaveLength(1); expect(row(bybit.id)).toBeDefined();
    await flush(() => button('stocks.all').click());
    const provider = document.querySelector<HTMLSelectElement>('select[aria-label="stocks.exchange"]')!;
    await flush(() => { provider.value = 'binance'; provider.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    expect(rows()).toHaveLength(1); expect(row(binance.id)).toBeDefined();
    await flush(() => button('stocks.Russia').click());
    expect(provider.value).toBe('all'); expect(row(moex.id)).toBeDefined(); expect(requests).toHaveLength(1);
    await flush(() => root.unmount()); root = createRoot(document.getElementById('root'));
    await draw(); await finish(1); await flush(() => button('stocks.favorites').click());
    expect(rows()).toHaveLength(1); expect(row(bybit.id)).toBeDefined();
    expect(localStorage.getItem('voltex.stocks.global.pending.v2.fixture-owner')).toBe('unchanged-financial-intent');
    expect(localStorage.length).toBe(2);
  });

  test('invalid favorites storage is ignored without account mutations', () => {
    localStorage.setItem(catalogueModel.STOCKS_FAVORITES_KEY, '{broken');
    expect(catalogueModel.readCatalogueFavorites()).toEqual([]);
    localStorage.setItem(catalogueModel.STOCKS_FAVORITES_KEY, JSON.stringify([bybit.id, null, 3, { id: binance.id }]));
    expect(catalogueModel.readCatalogueFavorites()).toEqual([bybit.id]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('without a token no reads start; login begins a single catalogue read and logout removes results', async () => {
    credential = null; await draw(); await advance(120000);
    expect(fetchMock).not.toHaveBeenCalled(); expect(document.querySelector('a[href="/login?next=%2Fstocks"]')).not.toBeNull();
    await login('fixture-bob-session'); expect(requests).toHaveLength(1);
    expect(requests[0].init.headers).toEqual({ Authorization: 'Bearer fixture-bob-session' });
    await finish(0); expect(rows()).toHaveLength(3);
    await login(null); expect(rows()).toHaveLength(0); await advance(120000);
    expect(requests).toHaveLength(1); expect(clearToken).not.toHaveBeenCalled();
  });

  test('late prior-session success and 401 cannot replace the next catalogue or log out the next user', async () => {
    await draw(); const aliceSignal = requests[0].init.signal!;
    await login('fixture-bob-session'); expect(aliceSignal.aborted).toBe(true); expect(requests).toHaveLength(2);
    await finish(0, { error: 'AUTH_REQUIRED' }, 401);
    expect(clearToken).not.toHaveBeenCalled(); expect(credential).toBe('fixture-bob-session'); expect(rows()).toHaveLength(0);
    await finish(1, { catalogue: [binance] }); expect(rows()).toHaveLength(1); expect(row(binance.id)).toBeDefined();
    await advance(60000); expect(requests).toHaveLength(3);
    await login('fixture-carol-session'); expect(rows()).toHaveLength(0); expect(requests).toHaveLength(4);
    await finish(2, { catalogue: [bybit] }); expect(rows()).toHaveLength(0);
    await finish(3, { catalogue: [moex] }); expect(rows()).toHaveLength(1); expect(row(moex.id)).toBeDefined();
  });

  test('current 401 clears the rejected login and prevents further polling', async () => {
    await draw(); await finish(0, { error: 'AUTH_REQUIRED' }, 401);
    expect(clearToken).toHaveBeenCalledTimes(1); expect(credential).toBeNull(); expect(rows()).toHaveLength(0);
    await advance(180000); expect(requests).toHaveLength(1);
  });

  test('hidden catalogue performs no reads; repeated visibility and intervals coalesce pending catalogue requests', async () => {
    hidden = true; await draw(); await advance(120000); expect(requests).toHaveLength(0);
    await visibility(false); expect(requests).toHaveLength(1);
    await visibility(false); await advance(120000); expect(requests).toHaveLength(1);
    await finish(0); await visibility(true); await advance(180000); expect(requests).toHaveLength(1);
    await visibility(false); expect(requests).toHaveLength(2);
    await finish(1); await advance(60000); expect(requests).toHaveLength(3);
  });

  test.each(['RATE_LIMIT', 'ACCOUNT_BUSY'] as const)('%s pauses automatic reads and allows only bounded explicit recovery', async code => {
    await draw(); await finish(0, { error: code, retryAfterMs: 1 }, 429);
    let retry = document.querySelector<HTMLButtonElement>('[role="alert"] button')!;
    expect(retry.disabled).toBe(true); expect(document.querySelector('[role="alert"]')!.textContent)
      .toContain(overload.stockOverloadText(code, 'ru'));
    await advance(180000); await visibility(false); expect(requests).toHaveLength(1);
    retry = button('stocks.retry'); expect(retry.disabled).toBe(false);
    await flush(() => { retry.click(); retry.click(); retry.click(); }); expect(requests).toHaveLength(2);
    expect(button('stocks.retry').disabled).toBe(true); await advance(120000); expect(requests).toHaveLength(2);
    await finish(1, { error: code }, 429); await advance(180000); expect(requests).toHaveLength(2);
    await flush(() => button('stocks.retry').click()); expect(requests).toHaveLength(3);
    await finish(2); expect(document.querySelector('[role="alert"]')).toBeNull(); expect(rows()).toHaveLength(3);
    await advance(60000); expect(requests).toHaveLength(4);
  });

  test('session switch cancels an overload recovery so its response cannot affect the new session', async () => {
    await draw(); await finish(0, { error: 'ACCOUNT_BUSY' }, 429); await advance(3000);
    await flush(() => button('stocks.retry').click()); expect(requests).toHaveLength(2);
    await login('fixture-bob-session'); expect(requests[1].init.signal!.aborted).toBe(true); expect(requests).toHaveLength(3);
    await finish(1, { error: 'RATE_LIMIT' }, 429); expect(document.querySelector('[role="alert"]')).toBeNull();
    await finish(2, { catalogue: [binance] }); expect(row(binance.id)).toBeDefined();
    await advance(60000); expect(requests).toHaveLength(4);
  });

  test('hiding during manual recovery cannot leave Retry permanently disabled or start background retries', async () => {
    await draw(); await finish(0, { error: 'ACCOUNT_BUSY' }, 429); await advance(3000);
    await flush(() => button('stocks.retry').click()); expect(requests).toHaveLength(2);
    expect(button('stocks.retry').disabled).toBe(true);
    await visibility(true); await finish(1); await advance(60000);
    expect(requests).toHaveLength(2);
    await visibility(false); expect(requests).toHaveLength(2);
    expect(button('stocks.retry').disabled).toBe(false);
    await flush(() => button('stocks.retry').click()); expect(requests).toHaveLength(3);
    await finish(2); expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  test('malformed identity responses fail closed and a failed read never refreshes the old observation timestamp', async () => {
    await draw(); await finish(0); await advance(60000);
    await finish(1, { catalogue: [{ ...bybit, provider: 'binance' }] });
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(row(bybit.id).querySelector('.vxo-original-price strong')!.textContent).toBe('123,4567');
    expect(row(bybit.id).querySelector('.vxo-original-age')!.textContent).toBe(markers.quoteAge(NOW - 120000, Date.now(), 'ru'));
    expect(rows()).toHaveLength(3);
    await advance(60000); await finish(2, { error: 'SOURCE_UNAVAILABLE' }, 503);
    expect(row(bybit.id).querySelector('.vxo-original-age')!.textContent).toBe(markers.quoteAge(NOW - 120000, Date.now(), 'ru'));
    expect(bybit.display!.timestamp).toBe(NOW - 120000);
  });

  test('unmount aborts pending transport and removes visible polling and session listeners', async () => {
    await draw(); const signal = requests[0].init.signal!;
    await flush(() => root.unmount()); expect(signal.aborted).toBe(true); expect(listeners.size).toBe(0);
    await finish(0); await advance(120000); expect(requests).toHaveLength(1);
    // Keep teardown idempotent while verifying no mounted subscriber remains.
    root = { unmount() {} };
  });
});
