import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

/**
 * StockChart lifecycle against a recording lightweight-charts double: the
 * host exists before the first answer (loading is an overlay, not a
 * replacement), one chart serves stock → index → stock, a refresh keeps the
 * reader's zoom, a period change only moves the visible range, and unmount
 * removes the chart and its crosshair listener.
 */
const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { createRoot } = req('react-dom/client');
const { JSDOM } = req('jsdom');
const source = ts.transpileModule(readFileSync(resolve(frontend, 'src/pages/stocks/StockChart.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

const SLOT = 900000;
const candles = (from: number, count: number, volume: string | null = '1200') => Array.from({ length: count }, (_, n) => ({
  openTimeUtc: from + n * SLOT, closeTimeUtc: from + (n + 1) * SLOT, open: '100', high: '101.5', low: '99.25', close: '100.75', volume, fetchedAt: from + (n + 1) * SLOT,
}));

describe('StockChart lifecycle', () => {
  let dom: any, root: any, calls: any, StockChart: any;
  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
    calls = { created: [] as HTMLElement[], removed: 0, fit: 0, ranges: [] as unknown[], candles: [] as unknown[][], volume: [] as unknown[][], sub: 0, unsub: 0, hostInDom: [] as boolean[] };
    const series = (kind: string) => ({
      setData: (rows: unknown[]) => (kind === 'histogram' ? calls.volume : calls.candles).push(rows),
      applyOptions: () => undefined,
      priceScale: () => ({ applyOptions: () => undefined }),
    });
    const charts = {
      CandlestickSeries: 'candle', HistogramSeries: 'histogram', ColorType: { Solid: 'solid' }, CrosshairMode: { Normal: 0 },
      TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 },
      createChart: (host: HTMLElement) => {
        calls.created.push(host); calls.hostInDom.push(document.body.contains(host));
        return {
          addSeries: (kind: string) => series(kind),
          subscribeCrosshairMove: () => { calls.sub++; },
          unsubscribeCrosshairMove: () => { calls.unsub++; },
          timeScale: () => ({ fitContent: () => { calls.fit++; }, setVisibleRange: (range: unknown) => calls.ranges.push(range) }),
          priceScale: () => ({ applyOptions: () => undefined }),
          remove: () => { calls.removed++; },
        };
      },
    };
    const imports: Record<string, unknown> = {
      react: React, 'react/jsx-runtime': req('react/jsx-runtime'), 'lucide-react': req('lucide-react'), 'lightweight-charts': charts,
      '../../lib/i18n': { localeOf: () => 'en-US', useLanguage: () => ({ lang: 'en', t: (key: string) => key }) },
      './stockFormat': { currencyDigits: () => 2, formatStockDay: () => 'day', formatStockPrice: (value: string) => value },
    };
    const exports: any = {};
    new Function('exports', 'require', source)(exports, (name: string) => { if (!(name in imports)) throw new Error(name); return imports[name]; });
    StockChart = exports.StockChart;
    root = createRoot(document.getElementById('root'));
  });
  afterEach(() => {
    dom.window.close();
    for (const key of ['window', 'document', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT']) delete (globalThis as any)[key];
  });

  const draw = async (props: Record<string, unknown>) => {
    await React.act(async () => root.render(React.createElement(StockChart, {
      currency: 'USD', timeZone: 'America/New_York', periods: new Map(), period: 'all', onPeriod: () => undefined, onRetry: () => undefined, ...props,
    })));
  };

  test('one chart from first paint to unmount across loading, refresh, period and stock → index → stock', async () => {
    const t0 = Date.UTC(2026, 9, 1, 13, 30);
    await draw({ instrumentId: 'XNGS:AAPL', candles: [], status: 'loading' });
    expect(calls.created).toHaveLength(1);
    expect(calls.hostInDom[0]).toBe(true);
    expect(calls.created[0].className).toBe('vxs-chart-host');
    expect(document.querySelector('.vxs-chart-overlay')?.textContent).toContain('stocks.loading');

    const first = candles(t0, 40);
    await draw({ instrumentId: 'XNGS:AAPL', candles: first, status: 'ready' });
    expect(document.querySelector('.vxs-chart-overlay')).toBeNull();
    expect(calls.candles.at(-1)).toHaveLength(40);
    expect(calls.fit).toBe(1);

    // Refresh of the same instrument: new data, same zoom.
    await draw({ instrumentId: 'XNGS:AAPL', candles: candles(t0 + SLOT, 40), status: 'ready' });
    expect(calls.candles.at(-1)).toHaveLength(40);
    expect(calls.fit).toBe(1);
    expect(calls.ranges).toHaveLength(0);

    // Period change: the range moves, nothing is refetched or recreated.
    const periods = new Map([['all', { from: t0, to: t0 + 41 * SLOT }], ['5D', { from: t0 + 20 * SLOT, to: t0 + 41 * SLOT }]]);
    await draw({ instrumentId: 'XNGS:AAPL', candles: candles(t0 + SLOT, 40), status: 'ready', periods, period: '5D' });
    expect(calls.ranges).toEqual([{ from: Math.floor((t0 + 20 * SLOT) / 1000), to: Math.floor((t0 + 41 * SLOT) / 1000) }]);

    // Stock → index: old candles are cleared while the index loads, the index has no volume.
    await draw({ instrumentId: 'XJPX:N225', candles: [], status: 'loading' });
    expect(calls.candles.at(-1)).toEqual([]);
    expect(calls.volume.at(-1)).toEqual([]);
    await draw({ instrumentId: 'XJPX:N225', candles: candles(t0, 30, null), status: 'ready', currency: 'JPY' });
    expect(calls.volume.at(-1)).toEqual([]);
    expect(calls.fit).toBe(2);

    // Index → stock again, still the same chart instance.
    await draw({ instrumentId: 'XNGS:AAPL', candles: first, status: 'ready' });
    expect(calls.fit).toBe(3);
    expect(calls.created).toHaveLength(1);
    expect(calls.removed).toBe(0);

    await React.act(async () => root.unmount());
    expect(calls.removed).toBe(1);
    expect(calls.unsub).toBe(calls.sub);
  });

  test('error and empty are overlays on the same host, with an explicit retry', async () => {
    const retry = jest.fn();
    await draw({ instrumentId: 'XNGS:AAPL', candles: [], status: 'error', onRetry: retry });
    expect(document.querySelector('.vxs-chart-host')).not.toBeNull();
    const button = document.querySelector('.vxs-chart-overlay button') as HTMLButtonElement;
    expect(button.textContent).toContain('stocks.retry');
    await React.act(async () => button.click());
    expect(retry).toHaveBeenCalledTimes(1);
    await draw({ instrumentId: 'XNGS:AAPL', candles: [], status: 'empty' });
    expect(document.querySelector('.vxs-chart-overlay')?.textContent).toContain('stocks.noHistory');
    expect(document.querySelector('.vxs-chart-overlay button')).toBeNull();
    expect(calls.created).toHaveLength(1);
    await React.act(async () => root.unmount());
  });

  test('a failed refresh adds a notice above the same chart: no overlay, no new chart, zoom untouched', async () => {
    const t0 = Date.UTC(2026, 9, 1, 13, 30);
    // As in the panel: kept candles are the same array and periods are memoised from them.
    const kept = candles(t0, 40), periods = new Map([['all', { from: t0, to: t0 + 40 * SLOT }]]);
    await draw({ instrumentId: 'XNGS:AAPL', candles: kept, status: 'ready', periods });
    expect(calls.fit).toBe(1);
    const setDataCalls = calls.candles.length;
    const notice = React.createElement('div', { className: 'vxs-stale' }, 'stale');
    await draw({ instrumentId: 'XNGS:AAPL', candles: kept, status: 'ready', periods, notice });
    const chart = document.querySelector('.vxs-chart')!;
    expect(chart.querySelector(':scope > .vxs-stale')?.nextElementSibling?.className).toBe('vxs-chart-stage');
    expect(document.querySelector('.vxs-chart-overlay')).toBeNull();
    expect(calls.created).toHaveLength(1);
    expect(calls.fit).toBe(1);
    expect(calls.ranges).toHaveLength(0);
    // The kept candles are the same array: nothing is redrawn.
    expect(calls.candles.length).toBe(setDataCalls);
    await draw({ instrumentId: 'XNGS:AAPL', candles: kept, status: 'ready', periods });
    expect(document.querySelector('.vxs-stale')).toBeNull();
    expect(calls.fit).toBe(1);
    expect(calls.created).toHaveLength(1);
    await draw({ instrumentId: 'XJPX:N225', candles: [], status: 'error', errorText: 'stocks.invalidData' });
    expect(document.querySelector('.vxs-chart-overlay')?.textContent).toContain('stocks.invalidData');
    await React.act(async () => root.unmount());
  });

  test('only periods the data covers are offered', async () => {
    const t0 = Date.UTC(2026, 9, 1, 13, 30);
    await draw({ instrumentId: 'XNGS:AAPL', candles: candles(t0, 10), status: 'ready', periods: new Map([['all', { from: t0, to: t0 + 10 * SLOT }], ['1D', { from: t0, to: t0 + 10 * SLOT }]]) });
    expect(Array.from(document.querySelectorAll('.vxs-periods button')).map(b => b.textContent)).toEqual(['stocks.period1D', 'stocks.periodAll']);
    await React.act(async () => root.unmount());
  });
});
