import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

/**
 * The shared stock read hook (lib/stocks.ts): one request per path, a late
 * answer for the previous instrument is never shown under the next one, a
 * stalled request becomes an error, retry is explicit, and nothing is read
 * while the tab is hidden or the flag is off.
 */
const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { createRoot } = req('react-dom/client');
const { JSDOM } = req('jsdom');
const source = ts.transpileModule(readFileSync(resolve(frontend, 'src/lib/stocks.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

type Pending = { url: string; signal: AbortSignal; resolve: (body: unknown) => void; reject: (error: unknown) => void };

describe('useStocks', () => {
  let dom: any, root: any, pending: Pending[], seen: Record<string, any>;
  const originalFetch = globalThis.fetch;
  const load = (enabled = true) => {
    const exports: any = {};
    new Function('exports', 'require', '__VOLTEX_STOCKS_ENABLED__', '__VOLTEX_STOCKS_ORIGIN__', source)(
      exports, (name: string) => { if (name !== 'react') throw new Error(name); return React; }, enabled, 'https://stocks.invalid');
    return exports;
  };
  let renders: { name: string; path: string; data: any }[];
  const Probe = ({ hook, path, name }: { hook: any; path: string; name: string }) => {
    const read = hook(path);
    seen[name] = read;
    renders.push({ name, path, data: read.data });
    return null;
  };
  const render = async (element: any) => { await React.act(async () => root.render(element)); };
  const answer = async (index: number, body: unknown) => { await React.act(async () => { pending[index].resolve(body); await Promise.resolve(); }); };

  beforeEach(() => {
    // pretendToBeVisual: otherwise jsdom reports document.hidden and the hook (rightly) reads nothing.
    dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    pending = []; seen = {}; renders = [];
    globalThis.fetch = jest.fn((url: string, init: RequestInit) => new Promise((resolveFetch, rejectFetch) => {
      const signal = init.signal!;
      signal.addEventListener('abort', () => rejectFetch(new Error('aborted')));
      pending.push({ url, signal, reject: rejectFetch, resolve: body => resolveFetch({ ok: true, json: async () => body }) });
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
    await React.act(async () => { await Promise.resolve(); });
    expect(pending[0].signal.aborted).toBe(true);
    pending[0].resolve({ instrumentId: 'XNGS:AAPL', candles: [{ close: 'AAPL' }] });
    await React.act(async () => { await Promise.resolve(); });
    expect(seen.chart.data).toBeUndefined();
    expect(seen.chart.loading).toBe(true);
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
    expect(pending.map(p => p.url.endsWith(encodeURIComponent('XJPX:N225')) || p.url.endsWith(encodeURIComponent('XNGS:AAPL')))).toEqual([true, true]);
  });

  test('a stalled request becomes an error after 12 s; retry is explicit and reads again', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
    const { useStocks } = load();
    await render(React.createElement(Probe, { hook: useStocks, path: '/stocks', name: 'c' }));
    await React.act(async () => { jest.advanceTimersByTime(11_999); });
    expect(seen.c.error).toBe(false);
    await React.act(async () => { jest.advanceTimersByTime(1); await Promise.resolve(); await Promise.resolve(); });
    expect(pending[0].signal.aborted).toBe(true);
    expect(seen.c.error).toBe(true);
    expect(seen.c.loading).toBe(false);
    expect(pending).toHaveLength(1);
    await React.act(async () => { seen.c.retry(); });
    expect(pending).toHaveLength(2);
    await answer(1, { instruments: [{ instrumentId: 'XNGS:AAPL' }] });
    expect(seen.c.error).toBe(false);
    expect(seen.c.data.instruments).toHaveLength(1);
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
