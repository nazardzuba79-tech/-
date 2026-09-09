import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as indicators from '../indicators';
import * as drawings from '../chartDrawings';
import * as chartPriceFormat from '../spotChartPriceFormat';

/**
 * Conditional (SL/TP trigger) orders are a SPOT-ONLY feature, and the
 * futures chart must not fetch them.
 *
 * `/orders/me?status=PENDING_TRIGGER` is the SPOT order book. There is no
 * futures conditional-order contract behind it. Before this change the
 * poll's dependencies were `[pair]` alone, so the futures terminal issued
 * an authenticated spot order request every 4 seconds for lines describing
 * a different product's orders — PR #14's QA measured ~97 in one run.
 *
 * These tests drive the REAL PriceChart through the repo's hook-stub
 * harness. The chart-init effect early-returns on a null container ref, so
 * `lightweight-charts` never runs while every data effect still does —
 * which is precisely the layer under test.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const source = readFileSync(resolve(frontend, 'src/components/PriceChart.tsx'), 'utf8');

const ORDER = [{
  id: 'o1', pair: 'BTC/USDT', side: 'SELL', type: 'STOP_LIMIT',
  triggerPrice: '99000.00000000', price: '98900.00000000', ocoGroupId: null,
}];

function mount(props: Record<string, unknown>, overrides: Record<string, any> = {}) {
  let index = 0;
  const hooks: any[] = [];
  let effects: (() => void)[] = [];
  const cleanups: (() => void)[] = [];

  const getMyOrders = overrides.getMyOrders ?? jest.fn().mockResolvedValue(ORDER);
  const updateOrderTrigger = overrides.updateOrderTrigger ?? jest.fn().mockResolvedValue({});
  const getExternalCandles = jest.fn().mockResolvedValue({ candles: [] });
  const api = { getMyOrders, updateOrderTrigger, getExternalCandles };

  const react = { ...React, memo: (fn: any) => fn,
    useState(initial: any) {
      const i = index++;
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], (next: any) => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }];
    },
    useRef(initial: any) {
      const i = index++;
      if (!(i in hooks)) hooks[i] = { current: i === 0 ? containerStub() : initial };
      return hooks[i];
    },
    useMemo(fn: any) { return fn(); },
    useCallback(fn: any, deps: any[]) {
      const i = index++, previous = hooks[i];
      if (!previous || deps.some((v, n) => !Object.is(v, previous.deps[n]))) hooks[i] = { deps, fn };
      return hooks[i].fn;
    },
    useEffect(fn: any, deps: any[]) {
      const i = index++, previous = hooks[i];
      if (!previous || deps === undefined || deps.some((v, n) => !Object.is(v, previous.deps[n]))) {
        hooks[i] = { deps, cleanup: undefined };
        effects.push(() => { previous?.cleanup?.(); hooks[i].cleanup = fn(); cleanups[i] = hooks[i].cleanup; });
      }
    },
  };

  const compiled = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const output: any = {};
  new Function('require', 'exports', 'window', compiled)((name: string) => {
    if (name === 'react') return react;
    if (name === '../lib/api') return { api, ApiError: Error };
    if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key, lang: 'en' }) };
    // The chart library is never reached: the init effect early-returns on
    // a null container ref, which the stubbed useRef gives it.
    if (name === 'lightweight-charts') return fakeCharts();
    // The REAL modules, so drawing/indicator/format behaviour is genuine
    // rather than stubbed away: only the network and the chart library are
    // replaced.
    if (name === '../lib/indicators') return indicators;
    if (name === '../lib/chartDrawings') return drawings;
    if (name === '../lib/spotChartPriceFormat') return chartPriceFormat;
    if (name === 'react-dom') return { createPortal: (children: unknown) => children };
    if (name.endsWith('.css')) return {};
    return req(name);
  }, output, windowStub());

  const Component = output.PriceChart;
  let current = { ...props };
  const render = (next: Record<string, unknown> = {}) => {
    current = { ...current, ...next };
    index = 0;
    const tree = Component(current);
    const queued = effects; effects = [];
    queued.forEach((fn) => fn());
    return tree;
  };
  const unmount = () => cleanups.forEach((fn) => fn?.());
  return { render, unmount, getMyOrders, updateOrderTrigger };
}

/**
 * A fake `lightweight-charts` that is real enough for the chart to
 * initialise and for `priceToCoordinate` to answer.
 *
 * This matters: without it the SVG overlay renders no conditional-order
 * line for EITHER market (priceToY returns null with no series), and the
 * futures "no lines" assertion would pass for the wrong reason. With it,
 * spot genuinely draws lines and futures genuinely does not.
 */
function fakeCharts() {
  const series = () => ({
    applyOptions: () => {},
    setData: () => {},
    priceScale: () => ({ applyOptions: () => {} }),
    // A linear, invertible mapping is all the overlay needs.
    priceToCoordinate: (price: number) => 500 - price / 1000,
    coordinateToPrice: (y: number) => (500 - y) * 1000,
    createPriceLine: () => ({ applyOptions: () => {} }),
    removePriceLine: () => {},
  });
  const timeScale = {
    fitContent: () => {},
    setVisibleLogicalRange: () => {},
    subscribeVisibleTimeRangeChange: () => {},
    unsubscribeVisibleTimeRangeChange: () => {},
    subscribeVisibleLogicalRangeChange: () => {},
    coordinateToTime: () => 0,
    timeToCoordinate: () => 0,
    applyOptions: () => {},
  };
  const chart = {
    addSeries: () => series(),
    priceScale: () => ({ applyOptions: () => {} }),
    timeScale: () => timeScale,
    subscribeClick: () => {},
    unsubscribeClick: () => {},
    subscribeCrosshairMove: () => {},
    unsubscribeCrosshairMove: () => {},
    resize: () => {},
    remove: () => {},
    applyOptions: () => {},
  };
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid' },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    CandlestickSeries: 'candlestick', LineSeries: 'line', AreaSeries: 'area', HistogramSeries: 'histogram',
  };
}

/** The container element the chart mounts into. */
function containerStub() {
  return {
    clientWidth: 1200, clientHeight: 600,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 1200, height: 600, right: 1200, bottom: 600 }),
    addEventListener: () => {}, removeEventListener: () => {},
    appendChild: () => {}, removeChild: () => {}, contains: () => false,
    querySelector: () => null, style: {},
  };
}

/** The browser surface PriceChart actually touches. Jest runs on `node`
 *  here (no jsdom), so it is provided explicitly rather than implied. */
/** Window listeners the drag gesture installs, so a test can complete it. */
const handlers = new Map<string, (e: any) => unknown>();

function windowStub() {
  const store = new Map<string, string>();
  return {
    addEventListener: (type: string, fn: any) => { handlers.set(type, fn); },
    removeEventListener: (type: string) => { handlers.delete(type); },
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: any) => clearInterval(id),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: any) => clearTimeout(id),
    confirm: () => false,
    prompt: () => null,
    innerWidth: 1440, innerHeight: 950,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    },
  };
}

function nodes(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
}
/** The conditional-order overlay is a dashed <line> stroked with the
 *  stop/take colours — nothing else on the chart uses those. */
const conditionalLines = (tree: any) =>
  nodes(tree).filter((n) => n.type === 'line' && (n.props?.stroke === '#ff4d6a' || n.props?.stroke === '#00d68f'));

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

const SPOT = { pair: 'BTC/USDT', chrome: 'terminal', drawingTools: true, market: 'spot' };
const FUTURES = { pair: 'BTC/USDT', chrome: 'terminal', drawingTools: true, market: 'futures' };

/**
 * `ResizeObserver`, `document` and `localStorage` are referenced as BARE
 * globals inside the component, so the `window` argument above cannot
 * supply them — this suite runs on `testEnvironment: 'node'` with no DOM.
 * Installed and removed around each test rather than leaked into others.
 */
const savedGlobals: Record<string, unknown> = {};
beforeEach(() => {
  jest.useFakeTimers();
  handlers.clear();
  for (const key of ['ResizeObserver', 'document', 'localStorage']) {
    savedGlobals[key] = (globalThis as any)[key];
  }
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (globalThis as any).document = {
    addEventListener: () => {}, removeEventListener: () => {},
    createElement: () => containerStub(),
    body: containerStub(),
    documentElement: containerStub(),
  };
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
});
afterEach(() => {
  jest.useRealTimers();
  for (const [key, value] of Object.entries(savedGlobals)) {
    if (value === undefined) delete (globalThis as any)[key];
    else (globalThis as any)[key] = value;
  }
});

// ── Futures: no spot conditional-order traffic at all ────────────────

describe('futures never touches the spot conditional-order endpoint', () => {
  test('A. getMyOrders(PENDING_TRIGGER) is never called on mount', async () => {
    const chart = mount(FUTURES);
    chart.render();
    await flush();
    expect(chart.getMyOrders).not.toHaveBeenCalled();
  });

  test('B. 60 seconds of fake timers cause zero conditional-order requests', async () => {
    const chart = mount(FUTURES);
    chart.render();
    await flush();
    for (let elapsed = 0; elapsed < 60_000; elapsed += 1000) {
      jest.advanceTimersByTime(1000);
      await flush();
    }
    // At the old 4s cadence this would have been 15 requests a minute.
    expect(chart.getMyOrders).not.toHaveBeenCalled();
  });

  test('B2. five minutes is still zero, and no timer exists to fire', async () => {
    const chart = mount(FUTURES);
    chart.render();
    await flush();
    jest.advanceTimersByTime(300_000);
    await flush();
    expect(chart.getMyOrders).not.toHaveBeenCalled();
  });

  test('B3. changing contract several times still issues nothing', async () => {
    const chart = mount(FUTURES);
    chart.render();
    await flush();
    for (const pair of ['ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BTC/USDT']) {
      chart.render({ pair });
      jest.advanceTimersByTime(5000);
      await flush();
    }
    expect(chart.getMyOrders).not.toHaveBeenCalled();
  });

  test('C. no spot conditional price lines are drawn', async () => {
    const chart = mount(FUTURES);
    const tree = chart.render();
    await flush();
    expect(conditionalLines(tree)).toHaveLength(0);
    expect(conditionalLines(chart.render())).toHaveLength(0);
  });

  test('D. updateOrderTrigger cannot be reached — the drag refuses to start', async () => {
    const chart = mount(FUTURES);
    chart.render();
    await flush();
    // There is no line to grab, and even if a caller invoked the handler
    // directly it must not arm the drag or call the endpoint.
    expect(chart.updateOrderTrigger).not.toHaveBeenCalled();
    const source2 = source;
    // The guard is the first statement of startDrag, before preventDefault.
    expect(source2).toContain('if (!spotConditionalOrders) return;\n      e.preventDefault();');
  });
});

// ── Spot: functionally identical ─────────────────────────────────────

describe('spot behaviour is unchanged', () => {
  test('E. the initial conditional-order load still happens', async () => {
    const chart = mount(SPOT);
    chart.render();
    await flush();
    expect(chart.getMyOrders).toHaveBeenCalledTimes(1);
    expect(chart.getMyOrders).toHaveBeenCalledWith('PENDING_TRIGGER');
  });

  test('F. the 4-second cadence is unchanged', async () => {
    const chart = mount(SPOT);
    chart.render();
    await flush();
    chart.getMyOrders.mockClear();

    for (let elapsed = 0; elapsed < 60_000; elapsed += 1000) {
      jest.advanceTimersByTime(1000);
      await flush();
    }
    // 60s / 4s = 15, exactly as before.
    expect(chart.getMyOrders).toHaveBeenCalledTimes(15);
  });

  test('G. pair filtering is unchanged — only this pair draws a line', async () => {
    const getMyOrders = jest.fn().mockResolvedValue([
      ...ORDER,
      { id: 'o2', pair: 'ETH/USDT', side: 'BUY', type: 'TAKE_PROFIT_LIMIT', triggerPrice: '4000', price: '4010', ocoGroupId: null },
    ]);
    const chart = mount(SPOT, { getMyOrders });
    chart.render();
    await flush();
    // Two orders came back, one pair matches: one line.
    expect(conditionalLines(chart.render())).toHaveLength(1);
  });

  test('G2. changing pair re-requests and re-filters', async () => {
    const getMyOrders = jest.fn().mockResolvedValue([
      ...ORDER,
      { id: 'o2', pair: 'ETH/USDT', side: 'BUY', type: 'TAKE_PROFIT_LIMIT', triggerPrice: '4000', price: '4010', ocoGroupId: null },
    ]);
    const chart = mount(SPOT, { getMyOrders });
    chart.render();
    await flush();
    getMyOrders.mockClear();

    chart.render({ pair: 'ETH/USDT' });
    await flush();
    expect(getMyOrders).toHaveBeenCalledTimes(1);
    expect(conditionalLines(chart.render({ pair: 'ETH/USDT' }))).toHaveLength(1);
  });

  test('H. drag still calls updateOrderTrigger with the same payload shape', async () => {
    const chart = mount(SPOT);
    chart.render();
    await flush();
    const tree = chart.render();
    expect(conditionalLines(tree).length).toBeGreaterThan(0);

    // The draggable label group carries the mousedown that starts the drag.
    const draggable = nodes(tree).find((n) => n.type === 'g' && typeof n.props?.onMouseDown === 'function');
    expect(draggable).toBeDefined();

    const preventDefault = jest.fn();
    draggable.props.onMouseDown({ preventDefault });
    // Spot arms the drag — futures refuses before this point (test D).
    expect(preventDefault).toHaveBeenCalled();

    // Completing the gesture calls the SAME endpoint with the same payload
    // shape: the new trigger, and the execution price moved by the original
    // trigger-to-execution gap. Both come from the untouched handler.
    const move = handlers.get('mousemove'); const up = handlers.get('mouseup');
    expect(move).toBeDefined(); expect(up).toBeDefined();
    move!({ clientY: 120 });
    await up!({ clientY: 120 });
    await flush();

    expect(chart.updateOrderTrigger).toHaveBeenCalledTimes(1);
    const [id, payload] = chart.updateOrderTrigger.mock.calls[0];
    expect(id).toBe('o1');
    // coordinateToPrice(120) = (500 - 120) * 1000 = 380000
    expect(payload.triggerPrice).toBe('380000.00000000');
    // gap = 98900 - 99000 = -100, so price = 380000 - 100
    expect(payload.price).toBe('379900.00000000');
  });

  test('H2. the drag refetches through the same spot endpoint afterwards', async () => {
    const chart = mount(SPOT);
    chart.render();
    await flush();
    const tree = chart.render();
    chart.getMyOrders.mockClear();

    const draggable = nodes(tree).find((n) => n.type === 'g' && typeof n.props?.onMouseDown === 'function');
    draggable.props.onMouseDown({ preventDefault: jest.fn() });
    await handlers.get('mouseup')!({ clientY: 200 });
    await flush();

    expect(chart.getMyOrders).toHaveBeenCalledWith('PENDING_TRIGGER');
  });

  test('spot still renders lines for a real order', async () => {
    const chart = mount(SPOT);
    chart.render();
    await flush();
    expect(conditionalLines(chart.render())).toHaveLength(1);
  });
});

// ── Stale responses ──────────────────────────────────────────────────

describe('a stale spot response cannot populate a non-spot chart', () => {
  test('I. a response in flight when the chart leaves spot is dropped', async () => {
    let resolveOrders!: (value: unknown) => void;
    const getMyOrders = jest.fn(() => new Promise((res) => { resolveOrders = res; }));
    const chart = mount(SPOT, { getMyOrders });
    chart.render();
    expect(getMyOrders).toHaveBeenCalledTimes(1);

    // Leave spot while the request is still in the air.
    chart.render({ market: 'futures' });
    await flush();

    // Now the old spot response finally lands.
    resolveOrders(ORDER);
    await flush();

    expect(conditionalLines(chart.render({ market: 'futures' }))).toHaveLength(0);
    // And nothing restarted the poll.
    getMyOrders.mockClear();
    jest.advanceTimersByTime(60_000);
    await flush();
    expect(getMyOrders).not.toHaveBeenCalled();
  });

  test('unmounting while a request is in flight commits nothing', async () => {
    let resolveOrders!: (value: unknown) => void;
    const getMyOrders = jest.fn(() => new Promise((res) => { resolveOrders = res; }));
    const chart = mount(SPOT, { getMyOrders });
    chart.render();
    chart.unmount();
    resolveOrders(ORDER);
    await flush();
    // The cleanup's `cancelled` flag is what makes this safe without
    // relying on the router remounting the component.
    expect(conditionalLines(chart.render())).toHaveLength(0);
  });

  test('leaving spot clears lines a previous spot context had drawn', async () => {
    const chart = mount(SPOT);
    chart.render();
    await flush();
    expect(conditionalLines(chart.render())).toHaveLength(1);

    chart.render({ market: 'futures' });
    await flush();
    expect(conditionalLines(chart.render({ market: 'futures' }))).toHaveLength(0);
  });
});

// ── The gate itself, and that no substitute was invented ─────────────

describe('the change is a removal, not a replacement', () => {
  test('no futures conditional-order endpoint was invented', () => {
    expect(source).not.toContain('getMyFuturesOrders');
    expect(source).not.toContain('futures/orders');
    // The only conditional-order reads are the spot ones, both gated.
    expect(source.match(/getMyOrders\('PENDING_TRIGGER'\)/g)).toHaveLength(2);
  });

  test('both call sites still pass an explicit market', () => {
    const futures = readFileSync(resolve(frontend, 'src/pages/FuturesPage.tsx'), 'utf8');
    const trade = readFileSync(resolve(frontend, 'src/pages/TradePage.tsx'), 'utf8');
    expect(futures).toContain('market="futures"');
    expect(trade).toContain('market="spot"');
  });

  test('the poll effect depends on the market gate, not on pair alone', () => {
    expect(source).toContain('}, [pair, spotConditionalOrders]);');
    expect(source).toContain("const spotConditionalOrders = market === 'spot';");
  });
});
