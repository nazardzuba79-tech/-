import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

/**
 * The shared stock read hook (lib/stocks.ts): one request per path, a late
 * answer for the previous instrument is never shown under the next one, a
 * stalled request becomes an error, a failed refresh keeps the last valid data
 * and reports itself until a read succeeds, an answer that fails the contract
 * check never enters the cache, retry is explicit and joins a read in flight,
 * and nothing is read while the tab is hidden or the flag is off.
 */
const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { createRoot } = req('react-dom/client');
const { JSDOM } = req('jsdom');
const source = ts.transpileModule(readFileSync(resolve(frontend, 'src/lib/stocks.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const SLOT = 900000, FIFTEEN_MINUTES = 15 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 7, 14, 30);
const candle = (open: number, close = '100.5') => ({ openTimeUtc: open, closeTimeUtc: open + SLOT, open: '100', high: '101', low: '99.5', close, volume: '1200', fetchedAt: open + SLOT + 60000 });
const history = (instrumentId: string, currency = 'USD', closes = ['100.5', '100.75']) => ({
  instrumentId, currency, provider: 'twelvedata', adjustmentMode: 'unadjusted', candles: closes.map((close, n) => candle(T0 + n * SLOT, close)), next: null,
});
const AAPL = { instrumentId: 'XNGS:AAPL', currency: 'USD' }, MSFT = { instrumentId: 'XNGS:MSFT', currency: 'USD' };

type Pending = { url: string; signal: AbortSignal; ok: (body: unknown) => void; status: (code: number) => void; raw: (text: string) => void };

describe('useStocks', () => {
  let dom: any, root: any, pending: Pending[], seen: Record<string, any>, renders: { name: string; path: string; data: any; error: boolean; loading: boolean }[];
  const originalFetch = globalThis.fetch;
  const load = (enabled = true) => {
    const exports: any = {};
    new Function('exports', 'require', '__VOLTEX_STOCKS_ENABLED__', '__VOLTEX_STOCKS_ORIGIN__', source)(
      exports, (name: string) => { if (name !== 'react') throw new Error(name); return React; }, enabled, 'https://stocks.invalid');
    return exports;
  };
  const Probe = ({ hook, path, name, accept }: { hook: any; path: string; name: string; accept?: (body: unknown) => boolean }) => {
    const read = hook(path, accept);
    seen[name] = read;
    renders.push({ name, path, data: read.data, error: read.error, loading: read.loading });
    return null;
  };
  const render = async (element: any) => { await React.act(async () => root.render(element)); };
  const flush = async () => { await React.act(async () => { for (let n = 0; n < 5; n++) await Promise.resolve(); }); };
  const settle = async (index: number, how: (p: Pending) => void) => { await React.act(async () => { how(pending[index]); for (let n = 0; n < 5; n++) await Promise.resolve(); }); };
  const answer = (index: number, body: unknown) => settle(index, p => p.ok(body));
  const fail = (index: number, code = 503) => settle(index, p => p.status(code));
  const advance = async (ms: number) => { await React.act(async () => { jest.advanceTimersByTime(ms); for (let n = 0; n < 5; n++) await Promise.resolve(); }); };

  beforeEach(() => {
    // pretendToBeVisual: otherwise jsdom reports document.hidden and the hook (rightly) reads nothing.
    dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    pending = []; seen = {}; renders = [];
    globalThis.fetch = jest.fn((url: string, init: RequestInit) => new Promise((resolveFetch, rejectFetch) => {
      const signal = init.signal!;
      signal.addEventListener('abort', () => rejectFetch(new Error('aborted')));
      pending.push({
        url, signal,
        ok: body => resolveFetch({ ok: true, status: 200, json: async () => body }),
        status: code => resolveFetch({ ok: false, status: code, json: async () => ({ error: 'unavailable' }) }),
        raw: text => resolveFetch({ ok: true, status: 200, json: async () => JSON.parse(text) }),
      });
    })) as unknown as typeof fetch;
    root = createRoot(document.getElementById('root'));
  });
  afterEach(async () => {
    await React.act(async () => root.unmount());
    jest.useRealTimers();
    globalThis.fetch = originalFetch;
    dom.window.close();
    for (const key of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) delete (globalThis as any)[key];
  });

  test('two readers of one path share one request', async () => {
    const { useStocks } = load();
    await render(React.createElement(React.Fragment, null,
      React.createElement(Probe, { hook: useStocks, path: '/stocks', name: 'a' }),
      React.createElement(Probe, { hook: useStocks, path: '/stocks', name: 'b' })));
    expect(pending).toHaveLength(1);
    expect(pending[0].url).toBe('https://stocks.invalid/stocks');
    expect(seen.a.loading).toBe(true);
    await answer(0, { instruments: [] });
    expect(seen.a.data).toEqual({ instruments: [] });
    expect(seen.b.data).toEqual({ instruments: [] });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test('a late answer for the previous instrument is never shown for the next one', async () => {
    const { useStocks, catalogueHistoryPath } = load();
    const a = catalogueHistoryPath('XNGS:AAPL'), b = catalogueHistoryPath('XJPX:N225');
    expect(a).toBe('/stocks/history/XNGS%3AAAPL');
    await render(React.createElement(Probe, { hook: useStocks, path: a, name: 'chart' }));
    await render(React.createElement(Probe, { hook: useStocks, path: b, name: 'chart' }));
    expect(pending.map(p => p.url.slice('https://stocks.invalid'.length))).toEqual([a, b]);
    // The abandoned read is aborted once nobody uses it.
    await flush();
    expect(pending[0].signal.aborted).toBe(true);
    pending[0].ok({ instrumentId: 'XNGS:AAPL', candles: [{ close: 'AAPL' }] });
    await flush();
    expect(seen.chart.data).toBeUndefined();
    expect(seen.chart.loading).toBe(true);
    // Leaving a page is not a failure: no error is recorded for the aborted read.
    expect(seen.chart.error).toBe(false);
    await answer(1, { instrumentId: 'XJPX:N225', candles: [{ close: 'N225' }] });
    expect(seen.chart.data.instrumentId).toBe('XJPX:N225');
  });

  test('no render of the next instrument ever carries the previous instrument\'s candles', async () => {
    const { useStocks, catalogueHistoryPath } = load();
    const a = catalogueHistoryPath('XNGS:AAPL'), b = catalogueHistoryPath('XJPX:N225');
    await render(React.createElement(Probe, { hook: useStocks, path: a, name: 'chart' }));
    await answer(0, { instrumentId: 'XNGS:AAPL', candles: [{ close: 'AAPL' }] });
    expect(seen.chart.data.instrumentId).toBe('XNGS:AAPL');
    await render(React.createElement(Probe, { hook: useStocks, path: b, name: 'chart' }));
    const forB = renders.filter(r => r.path === b);
    expect(forB.length).toBeGreaterThan(0);
    expect(forB.every(r => r.data === undefined)).toBe(true);
    // Back to the first instrument: its fresh cached answer is shown at once, without a new request.
    await render(React.createElement(Probe, { hook: useStocks, path: a, name: 'chart' }));
    expect(renders.filter(r => r.path === a).at(-1)!.data.instrumentId).toBe('XNGS:AAPL');
    expect(pending).toHaveLength(2);
  });

  test('rapid AAPL → MSFT → AAPL: only AAPL is ever drawn for AAPL, the late MSFT answer is dropped', async () => {
    const { useStocks, catalogueHistoryPath, stockHistoryCheck } = load();
    const a = catalogueHistoryPath(AAPL.instrumentId), m = catalogueHistoryPath(MSFT.instrumentId);
    const checkA = stockHistoryCheck(AAPL), checkM = stockHistoryCheck(MSFT);
    await render(React.createElement(Probe, { hook: useStocks, path: a, name: 'chart', accept: checkA }));
    await render(React.createElement(Probe, { hook: useStocks, path: m, name: 'chart', accept: checkM }));
    await render(React.createElement(Probe, { hook: useStocks, path: a, name: 'chart', accept: checkA }));
    await flush();
    // AAPL's first read was abandoned while MSFT was open; going back reads AAPL afresh.
    expect(pending.map(p => p.url.endsWith(encodeURIComponent('XNGS:AAPL')))).toEqual([true, false, true]);
    await answer(1, history('XNGS:MSFT', 'USD', ['300']));
    await answer(2, history('XNGS:AAPL'));
    const forA = renders.filter(r => r.path === a && r.data);
    expect(forA.length).toBeGreaterThan(0);
    expect(forA.every(r => r.data.instrumentId === 'XNGS:AAPL')).toBe(true);
    expect(seen.chart.data.instrumentId).toBe('XNGS:AAPL');
    expect(seen.chart.error).toBe(false);
  });

  test('a stalled request becomes an error after 12 s; retry is explicit and reads again', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
    const { useStocks } = load();
    await render(React.createElement(Probe, { hook: useStocks, path: '/stocks', name: 'c' }));
    await advance(11_999);
    expect(seen.c.error).toBe(false);
    await advance(1);
    expect(pending[0].signal.aborted).toBe(true);
    expect(seen.c.error).toBe(true);
    expect(seen.c.failure).toBe('unavailable');
    expect(seen.c.loading).toBe(false);
    expect(pending).toHaveLength(1);
    await React.act(async () => { seen.c.retry(); });
    expect(pending).toHaveLength(2);
    await answer(1, { instruments: [{ instrumentId: 'XNGS:AAPL' }] });
    expect(seen.c.error).toBe(false);
    expect(seen.c.data.instruments).toHaveLength(1);
  });

  describe('a failed refresh keeps the last valid data and says so', () => {
    const start = async (path = '/stocks/history/XNGS%3AAAPL') => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'], now: T0 + 3 * SLOT });
      const lib = load();
      await render(React.createElement(Probe, { hook: lib.useStocks, path, name: 'h', accept: lib.stockHistoryCheck(AAPL) }));
      await answer(0, history('XNGS:AAPL'));
      const first = seen.h.data;
      expect(first.candles).toHaveLength(2);
      expect(seen.h.error).toBe(false);
      // Inside the 15-minute window nothing is read again.
      await advance(FIFTEEN_MINUTES - 2000);
      expect(pending).toHaveLength(1);
      // The scheduled refresh: an ordinary wait while in flight, not an error.
      await advance(2000);
      expect(pending).toHaveLength(2);
      expect(seen.h.loading).toBe(true);
      expect(seen.h.error).toBe(false);
      expect(seen.h.data).toBe(first);
      return first;
    };

    test('refresh → 503: data kept, error reported until a retry succeeds', async () => {
      const first = await start();
      await fail(1, 503);
      expect(seen.h.data).toBe(first);
      expect(seen.h.error).toBe(true);
      expect(seen.h.failure).toBe('unavailable');
      expect(seen.h.loading).toBe(false);
      await React.act(async () => { seen.h.retry(); });
      expect(pending).toHaveLength(3);
      // While the retry is in flight the warning stays (busy), the data stays.
      expect(seen.h.error).toBe(true);
      expect(seen.h.loading).toBe(true);
      expect(seen.h.data).toBe(first);
      await answer(2, history('XNGS:AAPL', 'USD', ['100.5', '100.75', '101']));
      expect(seen.h.error).toBe(false);
      expect(seen.h.failure).toBeUndefined();
      expect(seen.h.data.candles).toHaveLength(3);
    });

    test('refresh → timeout: data kept, error after the 12 s deadline, retry recovers', async () => {
      const first = await start();
      await advance(11_999);
      expect(seen.h.error).toBe(false);
      await advance(1);
      expect(pending[1].signal.aborted).toBe(true);
      expect(seen.h.error).toBe(true);
      expect(seen.h.data).toBe(first);
      await React.act(async () => { seen.h.retry(); });
      await answer(2, history('XNGS:AAPL'));
      expect(seen.h.error).toBe(false);
    });

    test('catalogue already loaded → refresh fails → catalogue kept with the warning', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'], now: T0 + 3 * SLOT });
      const lib = load();
      const catalogue = { instruments: [{ instrumentId: 'XNGS:AAPL', symbol: 'AAPL', name: 'Apple Inc.', type: 'stock', region: 'USA', country: 'United States', exchange: 'XNGS', currency: 'USD', exchangeTimeZone: 'America/New_York', logoPath: null, latest: candle(T0), sessionChange: null }] };
      await render(React.createElement(Probe, { hook: lib.useStocks, path: '/stocks', name: 'c', accept: lib.isStockCatalogue }));
      await answer(0, catalogue);
      const first = seen.c.data;
      await advance(FIFTEEN_MINUTES);
      await fail(1, 500);
      expect(seen.c.data).toBe(first);
      expect(seen.c.error).toBe(true);
      await React.act(async () => { seen.c.retry(); });
      await answer(2, catalogue);
      expect(seen.c.error).toBe(false);
    });

    test('a manual retry joins the read in flight: no duplicate request', async () => {
      await start();
      await fail(1, 503);
      await React.act(async () => { seen.h.retry(); seen.h.retry(); });
      await React.act(async () => { seen.h.retry(); });
      expect(pending).toHaveLength(3);
      await answer(2, history('XNGS:AAPL'));
      expect(pending).toHaveLength(3);
      expect(seen.h.error).toBe(false);
    });

    test('hidden tab after a failure: no extra polling until visible again', async () => {
      await start();
      await fail(1, 503);
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      await React.act(async () => { document.dispatchEvent(new dom.window.Event('visibilitychange')); });
      await advance(2 * FIFTEEN_MINUTES);
      expect(pending).toHaveLength(2);
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      await React.act(async () => { document.dispatchEvent(new dom.window.Event('visibilitychange')); });
      expect(pending).toHaveLength(3);
    });
  });

  describe('answers that fail the contract check never enter the cache', () => {
    test('HTTP 200 with another instrumentId: an invalid-data error, no candles, no endless loading', async () => {
      const lib = load();
      await render(React.createElement(Probe, { hook: lib.useStocks, path: lib.catalogueHistoryPath(AAPL.instrumentId), name: 'h', accept: lib.stockHistoryCheck(AAPL) }));
      await answer(0, history('XNGS:MSFT'));
      expect(seen.h.data).toBeUndefined();
      expect(seen.h.error).toBe(true);
      expect(seen.h.failure).toBe('invalid');
      expect(seen.h.loading).toBe(false);
      expect(renders.every(r => !r.data)).toBe(true);
      await React.act(async () => { seen.h.retry(); });
      expect(pending).toHaveLength(2);
      await answer(1, history('XNGS:AAPL'));
      expect(seen.h.error).toBe(false);
      expect(seen.h.data.instrumentId).toBe('XNGS:AAPL');
    });

    test('another instrument after a valid AAPL page: the AAPL page stays, with the warning', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'], now: T0 + 3 * SLOT });
      const lib = load();
      await render(React.createElement(Probe, { hook: lib.useStocks, path: lib.catalogueHistoryPath(AAPL.instrumentId), name: 'h', accept: lib.stockHistoryCheck(AAPL) }));
      await answer(0, history('XNGS:AAPL'));
      const first = seen.h.data;
      await advance(FIFTEEN_MINUTES);
      await answer(1, history('XNGS:MSFT', 'USD', ['300', '301']));
      expect(seen.h.data).toBe(first);
      expect(seen.h.failure).toBe('invalid');
      expect(renders.every(r => !r.data || r.data.instrumentId === 'XNGS:AAPL')).toBe(true);
    });

    test('a valid empty page is "no history yet", not an error', async () => {
      const lib = load();
      await render(React.createElement(Probe, { hook: lib.useStocks, path: lib.catalogueHistoryPath(AAPL.instrumentId), name: 'h', accept: lib.stockHistoryCheck(AAPL) }));
      await answer(0, { candles: [], next: null });
      expect(seen.h.error).toBe(false);
      expect(seen.h.loading).toBe(false);
      expect(seen.h.data).toEqual({ candles: [], next: null });
    });

    test('malformed JSON is invalid data, not an empty history', async () => {
      const lib = load();
      await render(React.createElement(Probe, { hook: lib.useStocks, path: '/stocks', name: 'c', accept: lib.isStockCatalogue }));
      await settle(0, p => p.raw('{"instruments": ['));
      expect(seen.c.failure).toBe('invalid');
      expect(seen.c.data).toBeUndefined();
      expect(seen.c.loading).toBe(false);
    });
  });

  test('history contract: the server\'s enabled and disabled shapes pass; foreign, unattributed or malformed pages do not', () => {
    const { stockHistoryCheck, isStockCatalogue } = load();
    const check = stockHistoryCheck(AAPL);
    expect(check(history('XNGS:AAPL'))).toBe(true);
    expect(check({ candles: [], next: null })).toBe(true);
    expect(check({ ...history('XNGS:AAPL'), next: T0 })).toBe(true);
    expect(check(history('XNGS:MSFT'))).toBe(false);
    expect(check({ instrumentId: 'XNGS:MSFT', candles: [], next: null })).toBe(false);
    expect(check({ candles: [candle(T0)], next: null })).toBe(false);
    expect(check(history('XNGS:AAPL', 'EUR'))).toBe(false);
    expect(check({ ...history('XNGS:AAPL'), candles: [candle(T0 + SLOT), candle(T0)] })).toBe(false);
    expect(check({ ...history('XNGS:AAPL'), candles: [{ ...candle(T0), low: '102' }] })).toBe(false);
    expect(check({ ...history('XNGS:AAPL'), candles: [{ ...candle(T0), close: 'NaN' }] })).toBe(false);
    expect(check({ ...history('XNGS:AAPL'), candles: [{ ...candle(T0), closeTimeUtc: T0 + 60000 }] })).toBe(false);
    expect(check({ ...history('XNGS:AAPL'), candles: Array.from({ length: 501 }, (_, n) => candle(T0 + n * SLOT)) })).toBe(false);
    for (const body of [null, [], 'x', { candles: 'x', next: null }, { candles: [], next: -1 }]) expect(check(body)).toBe(false);
    const row = { instrumentId: 'XNGS:AAPL', symbol: 'AAPL', name: 'Apple Inc.', type: 'stock', region: 'USA', country: 'United States', exchange: 'XNGS', currency: 'USD', exchangeTimeZone: 'America/New_York', logoPath: null, latest: null, sessionChange: null };
    // The catalogue also carries provider/enabled/sourceUrl fields; extra fields are allowed.
    expect(isStockCatalogue({ instruments: [{ ...row, provider: 'twelvedata', enabled: false }, { ...row, instrumentId: 'XJPX:N225', type: 'index', latest: candle(T0) }] })).toBe(true);
    expect(isStockCatalogue({ instruments: [row, row] })).toBe(false);
    expect(isStockCatalogue({ instruments: [{ ...row, instrumentId: 'aapl' }] })).toBe(false);
    expect(isStockCatalogue({ instruments: [{ ...row, latest: { close: '1' } }] })).toBe(false);
    expect(isStockCatalogue({ items: [] })).toBe(false);
  });

  test('a hidden tab reads nothing until it is visible again', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const { useStocks } = load();
    await render(React.createElement(Probe, { hook: useStocks, path: '/stocks', name: 'h' }));
    expect(pending).toHaveLength(0);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await React.act(async () => { document.dispatchEvent(new dom.window.Event('visibilitychange')); });
    expect(pending).toHaveLength(1);
  });

  test('flag off: no stock request at all', async () => {
    const { useStocks, stocksEnabled } = load(false);
    expect(stocksEnabled).toBe(false);
    await render(React.createElement(Probe, { hook: useStocks, path: '/stocks', name: 'off' }));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
