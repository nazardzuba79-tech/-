import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as indicators from '../indicators';
import * as drawings from '../chartDrawings';
import * as chartPriceFormat from '../spotChartPriceFormat';
import * as chartTrading from '../chartTrading';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const source = readFileSync(resolve(frontend, 'src/components/PriceChart.tsx'), 'utf8');

const trace: string[] = [];

// PriceChart reads these as globals, not off the injected `window`.
(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!(globalThis as any).document) (globalThis as any).document = { hidden: false, addEventListener: () => {}, removeEventListener: () => {}, createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }) };

function containerStub(harness?: any) {
  return { clientWidth: 1200, clientHeight: 600,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 1200, height: 600, right: 1200, bottom: 600 }),
    addEventListener: (n: string, c: unknown) => { harness?.hostEvents.set(n, c); }, removeEventListener: (n: string) => { harness?.hostEvents.delete(n); },
    appendChild: () => {}, removeChild: () => {}, contains: () => false, querySelector: () => null, style: {} };
}
function windowStub() {
  const store = new Map<string, string>();
  return { addEventListener: () => {}, removeEventListener: () => {},
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms), clearInterval: (id: any) => clearInterval(id),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: any) => clearTimeout(id),
    confirm: () => false, prompt: () => null, innerWidth: 1440, innerHeight: 950,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } } };
}
function fakeCharts(chartOptions: any[], harness: any) {
  const series = () => { const r = { applyOptions: () => {}, options: () => ({ priceFormat: { type: 'price', precision: 2, minMove: 0.01 } }),
      setData: jest.fn((rows: any[]) => { if (harness.series[0] === r) trace.push(`setData(main) n=${rows.length}`); }),
      priceScale: () => ({ applyOptions: () => {} }), priceToCoordinate: (p: number) => 500 - p / 1000, coordinateToPrice: (y: number) => (500 - y) * 1000,
      createPriceLine: (o: unknown) => { const l = { options: o, applyOptions: () => {} }; harness.priceLines.push(l); return l; },
      removePriceLine: () => {} }; harness.series.push(r); return r; };
  const timeScale = { fitContent: () => {}, setVisibleLogicalRange: (r: unknown) => { harness.ranges.push(r); }, getVisibleLogicalRange: () => ({ from: 100, to: 200 }),
    options: () => ({ barSpacing: 10 }), subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    subscribeVisibleLogicalRangeChange: (c: unknown) => { harness.rangeChange = c; }, unsubscribeVisibleLogicalRangeChange: () => { harness.rangeChange = undefined; },
    coordinateToTime: () => 0, timeToCoordinate: () => 100, applyOptions: () => {} };
  const chart = { addSeries: () => series(), priceScale: () => ({ applyOptions: () => {} }), timeScale: () => timeScale,
    subscribeClick: () => {}, unsubscribeClick: () => {}, subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    resize: () => {}, remove: () => {}, applyOptions: () => {}, paneSize: () => ({ width: 1100, height: 600 }) };
  return { createChart: (_h: unknown, o: unknown) => { chartOptions.push(o); return chart; },
    createSeriesMarkers: (_s: unknown, m: unknown[]) => { harness.markers = m; return { setMarkers: (n: unknown[]) => { harness.markers = n; }, detach: () => {} }; },
    ColorType: { Solid: 'solid' }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
    CrosshairMode: { Normal: 0, Magnet: 1 }, CandlestickSeries: 'candlestick', LineSeries: 'line', AreaSeries: 'area', HistogramSeries: 'histogram' };
}

function mount(props: Record<string, unknown>) {
  let index = 0; const hooks: any[] = []; let effects: (() => void)[] = []; const cleanups: (() => void)[] = [];
  const chartOptions: any[] = [];
  const chartHarness: any = { series: [], hostEvents: new Map(), markers: [], priceLines: [], ranges: [] };
  const getExternalCandles = jest.fn().mockResolvedValue({ candles: [] });
  const api = { getMyOrders: jest.fn().mockResolvedValue([]), updateOrderTrigger: jest.fn(), getExternalCandles };
  const react = { ...React, memo: (fn: any) => fn,
    useState(initial: any) { const i = index++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], (next: any) => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }]; },
    useRef(initial: any) { const i = index++; if (!(i in hooks)) hooks[i] = { current: i === 0 ? containerStub(chartHarness) : initial }; return hooks[i]; },
    useMemo(fn: any) { return fn(); },
    useCallback(fn: any, deps: any[]) { const i = index++, p = hooks[i]; if (!p || deps.some((v, n) => !Object.is(v, p.deps[n]))) hooks[i] = { deps, fn }; return hooks[i].fn; },
    useEffect(fn: any, deps: any[]) { const i = index++, p = hooks[i];
      if (!p || deps === undefined || deps.some((v, n) => !Object.is(v, p.deps[n]))) {
        hooks[i] = { deps, cleanup: undefined };
        effects.push(() => { if (p?.cleanup) { trace.push('effect cleanup'); p.cleanup(); } hooks[i].cleanup = fn(); cleanups[i] = hooks[i].cleanup; }); } },
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const output: any = {};
  new Function('require', 'exports', 'window', compiled)((name: string) => {
    if (name === 'react') return react;
    if (name === '../lib/api') return { api, ApiError: Error };
    if (name === '../lib/i18n') return { useLanguage: () => ({ t: (k: string) => k, lang: 'ru' }) };
    if (name === 'lightweight-charts') return fakeCharts(chartOptions, chartHarness);
    if (name === '../lib/indicators') return indicators;
    if (name === '../lib/chartDrawings') return drawings;
    if (name === '../lib/spotChartPriceFormat') return chartPriceFormat;
    if (name === '../lib/chartTrading') return chartTrading;
    if (name === './PrivatePositionLines') return { PrivatePositionLines: () => null };
    if (name === 'react-dom') return { createPortal: (c: unknown) => c };
    if (name.endsWith('.css')) return {};
    return req(name);
  }, output, windowStub());
  const Component = output.PriceChart;
  let current = { ...props };
  const render = (next: Record<string, unknown> = {}) => {
    current = { ...current, ...next }; index = 0;
    const tree = Component(current); const queued = effects; effects = []; queued.forEach((fn) => fn()); return tree;
  };
  return { render, unmount: () => cleanups.forEach((fn) => fn?.()), chartHarness, getExternalCandles };
}

const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
const FUTURES = { pair: 'BTC/USDT', chrome: 'terminal', drawingTools: true, market: 'futures' };
const bar = (n: number) => ({ time: Date.UTC(2026, 8, 1, n) / 1000, open: 100, high: 110, low: 90, close: 105, volume: 5 });
const CANDLES = [bar(1), bar(2), bar(3)];

/**
 * THE INTERMITTENT BLANK FUTURES CHART.
 *
 * Root cause, reproduced below as case 2 and case 8: the candle effect used to
 * call clearSeries() unconditionally at the top of every run, and its
 * dependency array contains `candleLoader` and `privateTrading.enabled`. At
 * cold open BOTH change exactly once, as the native binding resolves from
 * unknown to owner — so a chart that had already painted perfectly good
 * futures candles was wiped by a re-run that was only a loader SWAP, not a
 * data change. Whatever ran next stared at a canvas it had emptied itself,
 * and if the replacement request was slow, superseded again, or failed, the
 * blank simply stayed. Nothing said so: an aborted request skipped the catch
 * entirely, and a genuine failure only cleared and fell silent.
 *
 * Measured on the real component before the fix, the painted candle counts in
 * order were [0, 3, 3, 0, 0] — three good bars, then zero, permanently. After:
 * [0, 3, 3].
 *
 * These drive the REAL PriceChart through the repo's hook-stub harness, so
 * what is asserted is the shipped effect, not a model of it.
 */


const flushAll = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const nodes = (tree: any): any[] => Array.isArray(tree) ? tree.flatMap(nodes)
  : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const textOf = (tree: any) => nodes(tree).map(n => typeof n.props?.children === 'string' ? n.props.children : '').join(' ');
const retryButton = (tree: any) => nodes(tree).find(n => n.type === 'button' && n.props?.children === 'trade.chartRetry');
const lastPaint = (chart: any) => {
  const calls = chart.chartHarness.series[0].setData.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
};
const paintedCounts = (chart: any) => chart.chartHarness.series[0].setData.mock.calls.map((c: any[]) => c[0].length);
const NATIVE = { enabled: true, selecting: null, trades: [], onCandleSelect: jest.fn(), onCancelSelection: jest.fn(), onTradeSelect: jest.fn() };
/** A loader whose promise is settled by the test, and which honours abort. */
function deferredLoader() {
  const calls: { resolve: (v: any) => void; reject: (e: any) => void; signal?: AbortSignal }[] = [];
  const fn = jest.fn((_p: string, _i: string, _l: number, signal?: AbortSignal) => new Promise<any>((resolve, reject) => {
    calls.push({ resolve, reject, signal });
    signal?.addEventListener?.('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  return Object.assign(fn, { calls });
}

describe('futures chart never goes blank on a loader or binding change', () => {
  afterEach(() => { (globalThis as any).document.hidden = false; });

  // 1
  test('cold open paints candles', async () => {
    const loader = jest.fn().mockResolvedValue({ candles: CANDLES });
    const chart = mount({ ...FUTURES, candleLoader: loader });
    chart.render();
    await flushAll();
    expect(lastPaint(chart)).toHaveLength(3);
    chart.unmount();
  });

  // 2 — THE BUG. Binding flips while the first request is still in flight.
  test('binding change mid-request still ends with candles', async () => {
    const pending = deferredLoader();
    const native = jest.fn().mockResolvedValue({ candles: CANDLES });
    const chart = mount({ ...FUTURES, candleLoader: pending });
    chart.render();
    await flushAll();
    chart.render({ candleLoader: native, privateTrading: NATIVE });
    await flushAll();
    pending.calls[0].resolve({ candles: CANDLES });
    await flushAll();
    expect(lastPaint(chart)).toHaveLength(3);
    chart.unmount();
  });

  // 2b — the root cause, pinned directly: a loader/binding swap is not a data
  // change, so it must not empty the canvas even for an instant.
  test('a loader swap alone never wipes candles that are already painted', async () => {
    const publicLoader = jest.fn().mockResolvedValue({ candles: CANDLES });
    const slowNative = deferredLoader();
    const chart = mount({ ...FUTURES, candleLoader: publicLoader });
    chart.render();
    await flushAll();
    expect(lastPaint(chart)).toHaveLength(3);

    chart.render({ candleLoader: slowNative, privateTrading: NATIVE });
    await flushAll();
    // Nothing has answered the native loader yet. The bars on screen are still
    // the ones that were there a moment ago, and no empty paint happened in
    // between — the pre-fix component painted [] here and stayed blank.
    expect(slowNative).toHaveBeenCalledTimes(1);
    expect(lastPaint(chart)).toHaveLength(3);
    expect(paintedCounts(chart).slice(1)).not.toContain(0);
    chart.unmount();
  });

  // 3
  test('a superseded request is replaced, and the replacement is what shows', async () => {
    const first = deferredLoader();
    const second = jest.fn().mockResolvedValue({ candles: [bar(9)] });
    const chart = mount({ ...FUTURES, candleLoader: first });
    chart.render();
    await flushAll();
    chart.render({ candleLoader: second, privateTrading: NATIVE });
    await flushAll();
    expect(lastPaint(chart)).toHaveLength(1);
    expect(lastPaint(chart)[0].time).toBe(bar(9).time);
    chart.unmount();
  });

  // 4
  test('a superseded request rejecting late never clears the newer candles', async () => {
    const first = deferredLoader();
    const second = jest.fn().mockResolvedValue({ candles: CANDLES });
    const chart = mount({ ...FUTURES, candleLoader: first });
    chart.render();
    await flushAll();
    chart.render({ candleLoader: second, privateTrading: NATIVE });
    await flushAll();
    expect(lastPaint(chart)).toHaveLength(3);
    first.calls[0].reject(new Error('late failure of a request nobody is waiting for'));
    await flushAll();
    expect(lastPaint(chart)).toHaveLength(3);
    chart.unmount();
  });

  // 5
  test('a server error with nothing on screen shows the error state, not a blank', async () => {
    const loader = jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { status: 503 }));
    const chart = mount({ ...FUTURES, candleLoader: loader });
    chart.render();
    await flushAll();
    const tree = chart.render();
    expect(textOf(tree)).toContain('trade.chartLoadFailed');
    expect(retryButton(tree)).toBeTruthy();
    // Nothing about the provider or the status code reaches the customer.
    expect(textOf(tree)).not.toContain('503');
    expect(textOf(tree)).not.toContain('boom');
    chart.unmount();
  });

  // 6
  test('the 12s deadline shows the error state rather than failing silently', async () => {
    jest.useFakeTimers();
    try {
      const loader = deferredLoader();
      const chart = mount({ ...FUTURES, candleLoader: loader });
      chart.render();
      await flushAll();
      jest.advanceTimersByTime(12_000);
      await flushAll();
      const tree = chart.render();
      expect(textOf(tree)).toContain('trade.chartLoadFailed');
      chart.unmount();
    } finally { jest.useRealTimers(); }
  });

  // 7
  test('Retry re-requests candles alone and the chart recovers', async () => {
    const loader = jest.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ candles: CANDLES });
    const chart = mount({ ...FUTURES, candleLoader: loader });
    chart.render();
    await flushAll();
    const failed = chart.render();
    expect(textOf(failed)).toContain('trade.chartLoadFailed');
    retryButton(failed).props.onClick();
    await flushAll();
    expect(lastPaint(chart)).toHaveLength(3);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(textOf(chart.render())).not.toContain('trade.chartLoadFailed');
    chart.unmount();
  });

  // 8 — last good survives a failed refresh, and no error is raised over it.
  test('a failed refresh keeps the candles already on screen', async () => {
    const loader = jest.fn()
      .mockResolvedValueOnce({ candles: CANDLES })
      .mockRejectedValue(new Error('tail refresh failed'));
    const chart = mount({ ...FUTURES, candleLoader: loader, privateTrading: NATIVE });
    chart.render();
    await flushAll();
    expect(lastPaint(chart)).toHaveLength(3);
    chart.render({ candleLoader: jest.fn().mockRejectedValue(new Error('still failing')), privateTrading: { ...NATIVE } });
    await flushAll();
    expect(lastPaint(chart)).toHaveLength(3);
    expect(textOf(chart.render())).not.toContain('trade.chartLoadFailed');
    chart.unmount();
  });

  // 9
  test('BTC bars are never painted under ETH', async () => {
    const btc = deferredLoader();
    const eth = jest.fn().mockResolvedValue({ candles: [bar(7)] });
    const chart = mount({ ...FUTURES, candleLoader: btc });
    chart.render();
    await flushAll();
    chart.render({ pair: 'ETH/USDT', candleLoader: eth });
    await flushAll();
    const beforeLate = paintedCounts(chart).length;
    btc.calls[0].resolve({ candles: CANDLES });
    await flushAll();
    // The ETH series is what is on screen, and BTC's late answer added nothing.
    expect(lastPaint(chart)).toHaveLength(1);
    expect(lastPaint(chart)[0].time).toBe(bar(7).time);
    expect(paintedCounts(chart).length).toBe(beforeLate);
    chart.unmount();
  });

  // 10
  test('an interval switch wipes first, so only the new interval is shown', async () => {
    const hourly = jest.fn().mockResolvedValue({ candles: CANDLES });
    const quarter = jest.fn().mockResolvedValue({ candles: [bar(4), bar(5)] });
    const chart = mount({ ...FUTURES, candleLoader: hourly });
    chart.render();
    await flushAll();
    expect(lastPaint(chart)).toHaveLength(3);
    chart.render({ interval: '15m', candleLoader: quarter });
    await flushAll();
    expect(paintedCounts(chart)).toContain(0);
    expect(lastPaint(chart)).toHaveLength(2);
    chart.unmount();
  });

  // 11
  test('a hidden tab issues no candle request', async () => {
    const loader = jest.fn().mockResolvedValue({ candles: CANDLES });
    (globalThis as any).document.hidden = true;
    const chart = mount({ ...FUTURES, candleLoader: loader });
    chart.render();
    await flushAll();
    expect(loader).not.toHaveBeenCalled();
    chart.unmount();
  });

  // 12 — PR #167's reduction must survive: a re-render carrying only trade /
  // mark / PnL churn must not repaint the candle series.
  test('trade and mark churn does not call setData on the candle series', async () => {
    const loader = jest.fn().mockResolvedValue({ candles: CANDLES });
    const chart = mount({ ...FUTURES, candleLoader: loader, privateTrading: NATIVE });
    chart.render();
    await flushAll();
    // What a book tick or a PnL tick actually looks like from here: the
    // `interaction` useMemo hands down a NEW object every time, while
    // `enabled` — the only scalar the candle effects depend on — is unchanged.
    //
    // The first churn render is allowed to settle the revision bump the load
    // itself queued. What must NOT happen is the count climbing with the
    // number of renders, which is exactly the 175-setData behaviour PR #167
    // removed.
    chart.render({ privateTrading: { ...NATIVE } });
    await flushAll();
    const settled = chart.chartHarness.series[0].setData.mock.calls.length;
    for (let i = 0; i < 20; i += 1) chart.render({ privateTrading: { ...NATIVE } });
    await flushAll();
    expect(chart.chartHarness.series[0].setData.mock.calls.length).toBe(settled);
    expect(loader).toHaveBeenCalledTimes(1);
    chart.unmount();
  });
});
