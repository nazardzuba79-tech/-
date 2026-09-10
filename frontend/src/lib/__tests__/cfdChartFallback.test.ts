import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { readAllLocales } from '../../../test-utils/i18nSource';

/**
 * The CFD chart when TradingView's CDN is not there.
 *
 * Found by the production frontend audit: `/trade?market=cfd` threw an
 * UNCAUGHT "Failed to load TradingView widget script" and left the chart
 * area blank with nothing to explain it. Two things were wrong and the
 * second is the one that made it unrecoverable:
 *
 *   1. `loadTradingViewScript().then(...)` had no `.catch()`, so the
 *      rejection escaped as a page error and no failure UI existed.
 *   2. the module-level `tvScriptPromise` kept the REJECTED promise, so
 *      every later attempt re-read the same old failure and issued no
 *      request at all. A Retry button on top of that would have been a lie.
 *
 * These tests drive the real component against a fake document, so the
 * script tags it appends are countable and its load/error handlers are the
 * test's to fire. Each `mount()` compiles the module afresh, which is what
 * gives every case its own `tvScriptPromise`.
 */

const root = resolve(__dirname, '../../..');
const req = createRequire(resolve(root, 'package.json'));
const React = req('react');
const read = (file: string) => readFileSync(resolve(root, 'src', file), 'utf8');
const nodes = (tree: any): any[] => Array.isArray(tree) ? tree.flatMap(nodes)
  : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = (tree: any): string => Array.isArray(tree) ? tree.map(text).join('')
  : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null ? '' : String(tree);
const flush = () => new Promise((r) => setImmediate(r));

interface FakeScript {
  src: string;
  async: boolean;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  parentNode: { removeChild: (n: FakeScript) => void } | null;
}

/**
 * The real CfdChart.tsx, executed with hooks and a document of our own.
 * `TradingView` is absent from `window` unless a test puts it there, and no
 * script ever really loads: the test fires `onload`/`onerror` itself.
 */
function mount(options: { lang?: string; tradingView?: any; hasContainer?: boolean } = {}) {
  let index = 0;
  const hooks: any[] = [];
  let effects: (() => void)[] = [];
  const scripts: FakeScript[] = [];
  const widgets: any[] = [];

  const react = { ...React,
    useState(initial: any) {
      const at = index++;
      if (!(at in hooks)) hooks[at] = typeof initial === 'function' ? initial() : initial;
      return [hooks[at], (value: any) => { hooks[at] = typeof value === 'function' ? value(hooks[at]) : value; }];
    },
    useRef(initial: any) { const at = index++; return hooks[at] ??= { current: initial }; },
    useCallback(fn: any, deps: any[]) {
      const at = index++, old = hooks[at];
      if (!old || deps.some((d: any, i: number) => !Object.is(d, old.deps[i]))) hooks[at] = { fn, deps };
      return hooks[at].fn;
    },
    useEffect(fn: any, deps: any[]) {
      const at = index++, old = hooks[at];
      if (!old || deps.some((d: any, i: number) => !Object.is(d, old.deps[i]))) {
        hooks[at] = { deps, cleanup: undefined };
        effects.push(() => { old?.cleanup?.(); hooks[at].cleanup = fn(); });
      }
    },
  };

  const head = {
    appendChild(node: FakeScript) {
      node.parentNode = { removeChild: (n: FakeScript) => { const i = scripts.indexOf(n); if (i >= 0) scripts.splice(i, 1); n.parentNode = null; } };
      scripts.push(node);
    },
  };
  // The container the widget is told to draw into. `innerHTML = ''` is what
  // the component does to it, so it has to be writable.
  const container = { innerHTML: 'stale' };
  const document = {
    createElement: (): FakeScript => ({ src: '', async: false, onload: null, onerror: null, parentNode: null }),
    head,
    getElementById: (id: string) => (options.hasContainer === false ? null : { ...container, id }),
  } as any;

  const win: any = { setInterval, clearInterval };
  if (options.tradingView) win.TradingView = options.tradingView;

  const compiled = ts.transpileModule(read('components/CfdChart.tsx'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const output: any = {};
  new Function('require', 'exports', 'window', 'document', compiled)((name: string) => {
    if (name === 'react') return react;
    if (name.endsWith('/i18n')) return { useLanguage: () => ({ t: (key: string) => key, lang: options.lang ?? 'en' }) };
    if (name.endsWith('.css')) return {};
    return req(name);
  }, output, win, document);

  const Component = output.CfdChart;
  const api = {
    scripts, widgets, win,
    render(props: any = { symbol: 'XAUUSD' }) {
      index = 0;
      const tree = Component(props);
      const queued = effects; effects = [];
      queued.forEach((fn) => fn());
      return tree;
    },
    unmount() { for (const h of hooks) h?.cleanup?.(); },
    /** Make the pending script "arrive", installing a widget constructor. */
    succeed(ctor?: any) {
      win.TradingView = { widget: ctor ?? function widget(this: any, config: any) { widgets.push(config); } };
      scripts[scripts.length - 1].onload!();
    },
    fail() { scripts[scripts.length - 1].onerror!(); },
  };
  return api;
}

const fallbackOf = (tree: any) => nodes(tree).find((n) => n?.props?.className === 'cfd-chart-fallback');
const canvasOf = (tree: any) => nodes(tree).find((n) => n?.props?.className === 'cfd-chart-canvas');
const disclaimerOf = (tree: any) => nodes(tree).find((n) => n?.props?.className === 'cfd-disclaimer');
const retryOf = (tree: any) => nodes(tree).find((n) => n?.props?.className === 'cfd-chart-retry');

test('A. a successful load initialises the chart and shows no fallback', async () => {
  const c = mount();
  c.render();
  expect(c.scripts).toHaveLength(1);
  expect(c.scripts[0].src).toBe('https://s3.tradingview.com/tv.js');
  c.succeed();
  await flush();

  const tree = c.render();
  expect(fallbackOf(tree)).toBeUndefined();
  expect(canvasOf(tree)).toBeDefined();
  expect(disclaimerOf(tree)).toBeDefined();
  expect(c.widgets).toHaveLength(1);
  // The TradingView configuration is the one that always shipped.
  expect(c.widgets[0]).toMatchObject({
    symbol: 'OANDA:XAUUSD', interval: '60', autosize: true, theme: 'dark', style: '1',
    locale: 'en', timezone: 'Etc/UTC', toolbar_bg: '#000000',
    hide_side_toolbar: true, allow_symbol_change: false, withdateranges: true,
  });
});

test('B. a failed script shows the fallback, keeps the disclaimer, and rejects nothing', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const c = mount();
    c.render();
    c.fail();
    await flush();

    const tree = c.render();
    const fallback = fallbackOf(tree);
    expect(fallback).toBeDefined();
    expect(canvasOf(tree)).toBeUndefined();
    // The CFD reference-price disclaimer is not collateral damage.
    expect(disclaimerOf(tree)).toBeDefined();
    expect(text(fallback)).toContain('trade.cfdChartUnavailable');
    expect(text(fallback)).toContain('trade.cfdChartRetry');
    expect(c.widgets).toHaveLength(0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  await flush();
  expect(unhandled).toEqual([]);
});

test('C. the rejected promise is not kept: Retry issues a NEW request and recovers', async () => {
  const c = mount();
  c.render();
  expect(c.scripts).toHaveLength(1);

  c.fail();
  await flush();
  let tree = c.render();
  expect(fallbackOf(tree)).toBeDefined();
  // The dead tag is gone, not left behind for a retry to race.
  expect(c.scripts).toHaveLength(0);

  retryOf(tree).props.onClick();
  tree = c.render();
  // Exactly ONE new request: the old rejection did not short-circuit it,
  // and it did not become two.
  expect(c.scripts).toHaveLength(1);

  c.succeed();
  await flush();
  tree = c.render();
  expect(fallbackOf(tree)).toBeUndefined();
  expect(canvasOf(tree)).toBeDefined();
  expect(c.widgets).toHaveLength(1);
  expect(c.widgets[0].symbol).toBe('OANDA:XAUUSD');
});

test('D. repeated Retry while a request is in flight still makes only ONE request', async () => {
  const c = mount();
  c.render();
  c.fail();
  await flush();

  const tree = c.render();
  retryOf(tree).props.onClick();
  c.render();
  expect(c.scripts).toHaveLength(1);

  // Three more clicks while that request is still in the air.
  for (let i = 0; i < 3; i++) {
    const again = c.render();
    if (retryOf(again)) retryOf(again).props.onClick();
    c.render();
  }
  expect(c.scripts).toHaveLength(1);

  c.succeed();
  await flush();
  expect(c.widgets).toHaveLength(1);
});

test('E. an already-present window.TradingView inserts no script at all', async () => {
  const seen: any[] = [];
  const c = mount({ tradingView: { widget: function widget(this: any, config: any) { seen.push(config); } } });
  c.render();
  await flush();

  expect(c.scripts).toHaveLength(0);
  expect(seen).toHaveLength(1);
  expect(fallbackOf(c.render())).toBeUndefined();
});

test('F. unmounting while the load is pending creates no widget and sets no state', async () => {
  const c = mount();
  c.render();
  c.unmount();
  c.succeed();
  await flush();

  expect(c.widgets).toHaveLength(0);
});

test('G. a symbol change keeps using the correct TradingView symbol', async () => {
  const c = mount();
  c.render({ symbol: 'XAUUSD' });
  c.succeed();
  await flush();
  c.render({ symbol: 'XAUUSD' });
  expect(c.widgets[0].symbol).toBe('OANDA:XAUUSD');

  c.render({ symbol: 'EURUSD' });
  await flush();
  expect(c.widgets).toHaveLength(2);
  expect(c.widgets[1].symbol).toBe('FX:EURUSD');
  // The second instrument needs no second script: the first load is reused.
  expect(c.scripts).toHaveLength(1);
});

test.each([['ru', 'ru'], ['en', 'en'], ['zh', 'zh_CN'], ['es', 'en'], ['ja', 'en']])(
  'H. language %s maps to the TradingView locale %s', async (lang, expected) => {
    const c = mount({ lang });
    c.render();
    c.succeed();
    await flush();
    c.render();
    expect(c.widgets[0].locale).toBe(expected);
  });

test('I. a throwing widget constructor shows the fallback instead of crashing', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const c = mount();
    c.render();
    c.succeed(function widget() { throw new Error('widget init blew up'); });
    await flush();

    const tree = c.render();
    expect(fallbackOf(tree)).toBeDefined();
    expect(disclaimerOf(tree)).toBeDefined();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  await flush();
  expect(unhandled).toEqual([]);
});

describe('the failure path invents nothing, and says so in every language', () => {
  it('no candle, quote or alternate provider appears in the component', () => {
    const executable = ts.createPrinter({ removeComments: true })
      .printFile(ts.createSourceFile('chart.tsx', read('components/CfdChart.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
    // The fallback is a message, not a second chart.
    expect(executable).not.toMatch(/candles|orderBook|volume|funding|openInterest|time_series|twelvedata|api\./i);
    // And the TradingView contract is untouched.
    expect(executable).toContain("'https://s3.tradingview.com/tv.js'");
    expect(executable).toContain("interval: '60'");
    expect(executable).toContain('withdateranges: true');
  });

  it('the rejected promise is cleared before the rejection is delivered', () => {
    const src = read('components/CfdChart.tsx');
    const onerror = src.slice(src.indexOf('script.onerror'), src.indexOf('document.head.appendChild'));
    // Order matters: clearing after `reject` would still work, but clearing
    // inside the handler at all is the whole fix, so it is pinned here.
    expect(onerror).toContain('tvScriptPromise = null');
    expect(onerror.indexOf('tvScriptPromise = null')).toBeLessThan(onerror.indexOf('reject('));
    expect(onerror).toContain('removeChild(script)');
  });

  it('all three strings exist in all seven locales, none of them Russian by default', () => {
    const locales = readAllLocales().split('\n');
    for (const key of ['trade.cfdChartUnavailable', 'trade.cfdChartUnavailableHint', 'trade.cfdChartRetry']) {
      const lines = locales.filter((line) => line.includes(`'${key}':`));
      expect(lines).toHaveLength(7);
      // Seven distinct translations, so no locale is quietly serving the
      // Russian string — or any other locale's — as its own.
      expect(new Set(lines.map((l) => l.slice(l.indexOf(':') + 1).trim())).size).toBe(7);
    }
  });
});
