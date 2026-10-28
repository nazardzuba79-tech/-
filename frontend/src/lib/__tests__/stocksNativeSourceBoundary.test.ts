import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { stockTranslator } from '../../pages/stocks/global/stockText';

// Combined #613 + #621 terminal: native CEX bars that ride the quote response
// keep working, but they are never a second path around own-source (#615)
// history admission. Synthetic local responses only; no provider, feed, order
// or balance is involved, and every account here is a silent viewer.
const frontend = resolve(__dirname, '../../..'), req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), { JSDOM } = req('jsdom');
const CEX = 'BYBIT:AAPLXUSDT';
const MINT = 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', POOL = '4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw';
const OWN = `SOLANA:${MINT}:${POOL}`;
const STEP: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600 };
const T = 1792922400; // aligned to every step above
let ID = CEX;
const compile = (file: string, imports: Record<string, unknown> = {}) => {
  const input = readFileSync(resolve(frontend, file), 'utf8')
    .replace("import.meta.env.VITE_STOCKS_OWNER_USDT_ONLY", "'true'")
    .replace("import.meta.env.VITE_STOCKS_ORDER_EXECUTION_ENABLED", "'false'");
  const source = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const out: any = {};
  new Function('exports', 'require', source)(out, (name: string) => {
    if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`);
    return imports[name];
  });
  return out;
};
const bar = (time: number, close = 11) => ({ time, open: 10, high: 12, low: 9, close, volume: 4 });
const asset = (id: string, timeframes: string[]) => ({ id, ticker: 'AAPLX', asset: 'AAPLX', name: 'Apple token',
  provider: id.startsWith('SOLANA:') ? 'solana' : 'bybit', sourceSymbol: 'AAPLXUSDT', region: 'US', kind: 'token',
  currency: 'USDT', delaySeconds: 0, timeframes });
function viewer(native: Record<string, Record<string, unknown>>, timeframes: Record<string, string[]>) {
  const timestamp = Date.now(), quotes: Record<string, unknown> = {};
  for (const id of Object.keys(timeframes)) quotes[id] = { instrumentId: id, provider: 'bybit', nativeCurrency: 'USDT', timestamp,
    receivedAt: timestamp, bid: '9', ask: '10', last: '10.5', multiplier: '1', change24h: 0, volume: '1', transport: 'websocket',
    nativeCandles: native[id], prices: { USDT: { buy: '10', sell: '9' } }, status: { USDT: 'READY', USDC: 'FX_UNAVAILABLE' }, fx: {} };
  return {
    schema: 2, revision: 1, token: 'fixture-csrf', serverTime: timestamp,
    account: { id: 'fixture-viewer', mode: 'viewer', canTrade: false, fundingMode: 'existing-only' },
    catalogue: Object.entries(timeframes).map(([id, t]) => asset(id, t)),
    wallets: { USDT: { cash: '0', reserved: '0', available: '0' }, USDC: { cash: '0', reserved: '0', available: '0' } },
    positions: {}, orders: [], fills: [], realized: { USDT: '0', USDC: '0' }, adjustments: [], errors: {},
    metrics: { rssBytes: 0, requests: 0, cacheHits: 0 }, quotes,
  };
}
const source = (interval: string, status: 'UNKNOWN' | 'ACCEPTED', from = T) => {
  const step = STEP[interval], candle = { ...bar(from), tradeCount: 1, proofDigest: 'a'.repeat(64) };
  return { schema: 'voltex.solana-ohlcv.v1', instrumentId: OWN, interval, priceKind: 'raw-token', quoteCurrency: 'USDC',
    range: { from, to: from + step }, candles: status === 'ACCEPTED' ? [candle] : [],
    gaps: status === 'UNKNOWN' ? [{ time: from, reason: 'UNKNOWN' }] : [],
    provenance: { status, intervalComplete: status === 'ACCEPTED', finality: 'finalized', synthetic: false,
      acceptedTradeCount: status === 'ACCEPTED' ? 1 : 0, receiptsHash: 'b'.repeat(64),
      gates: { programIdentity: true, poolState: true, mintChronology: true, feeChronology: true, completeness: true, executionBinding: true },
      source: { network: 'solana-mainnet-beta', program: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', mint: MINT, pool: POOL,
        quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' } } };
};

describe('native CEX bars vs own-source history admission (combined #613 + #621 terminal)', () => {
  let dom: any, root: any, Terminal: any, credential: string | null, listeners: Set<() => void>;
  let pendingState: Array<(body: any) => void>, pendingHistory: Array<{ url: string; send: (body: any) => void }>;
  let writes: unknown[], historyUrls: string[], deferHistory: boolean, historyReply: (url: string) => unknown;
  let renders: Array<{ candles: unknown[]; gaps: unknown[]; priceKind?: string; error: string }>;
  const originalFetch = globalThis.fetch;
  const globals = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLInputElement', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  let priorGlobals: Map<string, PropertyDescriptor | undefined>;
  const flush = async (work: () => void = () => {}) => React.act(async () => { work(); await Promise.resolve(); await Promise.resolve(); });
  const chart = () => renders[renders.length - 1];
  const button = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent === text)!;
  const sendState = (body: unknown) => flush(() => pendingState.shift()!(body));
  const nextPoll = async (body: unknown) => { await flush(() => jest.advanceTimersByTime(3000)); if (pendingState.length) await sendState(body); };
  // Answer the newest pending history read for the interval; older reads belong to stale generations.
  const sendHistory = (body: any, interval = body?.interval) => flush(() => {
    const i = pendingHistory.map(h => !interval || h.url.includes(`interval=${interval}`)).lastIndexOf(true);
    pendingHistory.splice(i, 1)[0].send(body);
  });
  const mount = () => flush(() => root.render(React.createElement(Terminal)));
  const silent = async () => {
    await flush(() => document.querySelector<HTMLButtonElement>('.vxg-submit')!.click());
    expect(writes).toHaveLength(0);
  };

  beforeEach(() => {
    ID = CEX; credential = 'fixture-viewer-session'; listeners = new Set(); pendingState = []; pendingHistory = [];
    writes = []; historyUrls = []; deferHistory = false; renders = []; historyReply = () => ({ candles: [] });
    jest.useFakeTimers();
    dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:4438/stocks/' + encodeURIComponent(ID), pretendToBeVisual: true });
    priorGlobals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
      sessionStorage: dom.window.sessionStorage, HTMLInputElement: dom.window.HTMLInputElement, HTMLElement: dom.window.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true });
    const reply = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    globalThis.fetch = jest.fn((url: string, init: RequestInit = {}) => {
      if (init.method === 'POST') { writes.push(url); return new Promise(() => {}); }
      if (url.includes('/history?')) {
        historyUrls.push(url);
        if (deferHistory) return new Promise(resolve => pendingHistory.push({ url, send: body => resolve(reply(200, body)) }));
        return Promise.resolve(reply(200, historyReply(url)));
      }
      if (url.includes('/state?')) return new Promise(resolve => pendingState.push(body => resolve(reply(200, body))));
      throw new Error(`Unexpected request: ${url}`);
    }) as any;
    const Empty = () => null;
    class Demand {
      controller = new AbortController();
      open(_id: string, headers: Record<string, string>) { this.controller = new AbortController(); return { headers, signal: this.controller.signal, accept: () => {} }; }
      close() { this.controller.abort(); }
      headers() { return {}; }
      signal() { return this.controller.signal; }
    }
    class RequestError extends Error { constructor(public code: string) { super(code); } }
    const text = { useStocksText: () => ({ s: stockTranslator('ru'), lang: 'ru', locale: 'ru-RU' }) };
    Terminal = compile('src/pages/stocks/global/GlobalStocks.tsx', {
      react: React, 'react/jsx-runtime': req('react/jsx-runtime'), 'bignumber.js': { default: req('bignumber.js') },
      'react-router-dom': { useParams: () => ({ instrumentId: ID }), useNavigate: () => jest.fn() },
      './useStocksText': text,
      './stockText': { stockOrderLabel: (s: string) => s, stockNoticeText: (s: any) => s.message || s.status, stockFxPolicyText: () => '' },
      './OriginalStocksHeader': { default: Empty }, './stockOriginalText': compile('src/pages/stocks/global/stockOriginalText.ts'),
      './quoteReadiness': compile('src/pages/stocks/global/quoteReadiness.ts'), './chartDemand': { StockChartDemand: Demand },
      './GlobalChart': { default: ({ candles, sourceGaps, priceKind, error }: any) => {
        renders.push({ candles, gaps: sourceGaps, priceKind, error });
        return React.createElement('div', { 'data-testid': 'chart' });
      } },
      '../../../lib/stocksIdentity': { DEFAULT_STOCKS_INSTRUMENT: CEX },
      '../stockRequestError': { StockRequestError: RequestError, globalStockErrorText: (s: string) => s },
      './tradeMarkers': { quoteAge: () => '' }, './globalStocks.css': {}, './desktopProfessional.css': {}, './stocksOriginal.css': {},
      '../../../lib/api': { getToken: () => credential, clearToken: () => { credential = null; listeners.forEach(l => l()); },
        onSessionChange: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }, api: { logout: jest.fn() } },
      './accountSession': compile('src/pages/stocks/global/accountSession.ts'),
      './readWork': compile('src/pages/stocks/global/readWork.ts'),
      './catalogueVersion': compile('src/pages/stocks/global/catalogueVersion.ts'),
      './overload': compile('src/pages/stocks/global/overload.ts', { './stockText': { stockTranslator: () => (s: string) => s } }),
      './DesktopShell': { DesktopMarketStats: Empty, DesktopQuotes: Empty, DesktopFooter: Empty, DesktopAllocation: Empty },
    }).default;
    root = createRoot(document.getElementById('root'));
  });
  afterEach(async () => {
    if (root) await flush(() => root.unmount()); dom.window.close(); jest.useRealTimers(); globalThis.fetch = originalFetch;
    for (const key of globals) { const old = priorGlobals.get(key); if (old) Object.defineProperty(globalThis, key, old); else delete (globalThis as any)[key]; }
  });

  test('CEX history-before-quote: the native bar is merged, an unchanged native observation keeps the same series', async () => {
    historyReply = () => ({ candles: [bar(T - 1800), bar(T - 900)] });
    await mount();
    expect(chart().candles).toEqual([bar(T - 1800), bar(T - 900)]);
    await sendState(viewer({ [CEX]: { '15m': bar(T) } }, { [CEX]: ['15m'] }));
    expect(chart().candles).toEqual([bar(T - 1800), bar(T - 900), bar(T)]);
    const series = chart().candles;
    await nextPoll(viewer({ [CEX]: { '15m': bar(T) } }, { [CEX]: ['15m'] }));
    expect(chart().candles).toBe(series);
    await nextPoll(viewer({ [CEX]: { '15m': bar(T, 11.5) } }, { [CEX]: ['15m'] }));
    expect(chart().candles).toEqual([bar(T - 1800), bar(T - 900), bar(T, 11.5)]);
    await silent();
  });

  test('CEX quote-before-history: the native bar shows while history is pending and survives the history page', async () => {
    deferHistory = true;
    await mount();
    await sendState(viewer({ [CEX]: { '15m': bar(T) } }, { [CEX]: ['15m'] }));
    expect(chart().candles).toEqual([bar(T)]);
    await sendHistory({ candles: [bar(T - 900)] });
    expect(chart().candles).toEqual([bar(T - 900), bar(T)]);
    expect(chart().gaps).toEqual([]); expect(chart().priceKind).toBeUndefined();
    await silent();
  });

  test('CEX: a quote without native bars never turns the last price into OHLC or adds history reads', async () => {
    historyReply = () => ({ candles: [bar(T - 900)] });
    await mount();
    await sendState(viewer({}, { [CEX]: ['15m'] }));
    for (let i = 0; i < 4; i++) await nextPoll(viewer({}, { [CEX]: ['15m'] }));
    expect(chart().candles).toEqual([bar(T - 900)]);
    // Mount plus one 15 s tick within 12 s of quote polling: quotes add no history reads.
    expect(historyUrls).toHaveLength(1);
  });

  test.each(['1m', '5m', '1h'])('own-source %s UNKNOWN page with a native bar present: no numbers in either response order', async interval => {
    ID = OWN;
    const state = () => viewer({ [OWN]: { [interval]: bar(T + STEP[interval]) } }, { [OWN]: [interval] });
    // History first, then the quote.
    historyReply = url => url.includes(`interval=${interval}`) ? source(interval, 'UNKNOWN') : { candles: [] };
    await mount(); await sendState(state());
    await flush(() => button(interval).click());
    expect(historyUrls.some(u => u.includes(`interval=${interval}`))).toBe(true);
    await nextPoll(state());
    expect(chart().candles).toEqual([]); expect(chart().gaps).toEqual([{ time: T, reason: 'UNKNOWN' }]);
    expect(chart().error).toBe('SOURCE_UNAVAILABLE');
    // Quote first while admission is pending, then the history page.
    deferHistory = true;
    await flush(() => jest.advanceTimersByTime(15000));
    await nextPoll(state());
    expect(chart().candles).toEqual([]);
    await sendHistory(source(interval, 'UNKNOWN'));
    await nextPoll(state());
    expect(chart().candles).toEqual([]); expect(chart().gaps).toEqual([{ time: T, reason: 'UNKNOWN' }]);
    await silent();
  });

  test('own-source pending admission, acceptance and revocation: the native bar never joins and never resurrects', async () => {
    ID = OWN; deferHistory = true;
    const state = () => viewer({ [OWN]: { '1m': bar(T + 60, 99) } }, { [OWN]: ['1m'] });
    await mount(); await sendState(state());
    await flush(() => button('1m').click());
    await nextPoll(state());
    expect(chart().candles).toEqual([]);
    expect(pendingHistory.filter(h => h.url.includes('interval=1m'))).toHaveLength(1);
    await sendHistory(source('1m', 'ACCEPTED'));
    expect(chart().candles).toEqual([{ ...bar(T), tradeCount: 1, proofDigest: 'a'.repeat(64) }]);
    expect(chart().priceKind).toBe('raw-token');
    await nextPoll(state());
    expect(chart().candles).toEqual([{ ...bar(T), tradeCount: 1, proofDigest: 'a'.repeat(64) }]);
    // A corrected (UNKNOWN) range revokes the admitted candle; later quotes do not bring numbers back.
    await flush(() => jest.advanceTimersByTime(15000));
    await sendHistory(source('1m', 'UNKNOWN'));
    await nextPoll(state());
    expect(chart().candles).toEqual([]); expect(chart().gaps).toEqual([{ time: T, reason: 'UNKNOWN' }]);
    await silent();
  });

  test('a provenance page on a CEX-looking identity revokes earlier native bars for that generation', async () => {
    deferHistory = true;
    const state = () => viewer({ [CEX]: { '15m': bar(T) } }, { [CEX]: ['15m'] });
    await mount(); await sendState(state());
    expect(chart().candles).toEqual([bar(T)]);
    await sendHistory({ ...source('15m', 'UNKNOWN'), instrumentId: CEX });
    expect(chart().candles).toEqual([]); expect(chart().error).toBe('SOURCE_UNAVAILABLE');
    await nextPoll(state());
    await nextPoll(viewer({ [CEX]: { '15m': bar(T, 12) } }, { [CEX]: ['15m'] }));
    expect(chart().candles).toEqual([]);
    await silent();
  });

  // Review of 5645884b: a later provenance-less page must not downgrade a generation already
  // classified as own-source, neither re-opening the native-bar path nor admitting plain numbers.
  test.each([
    ['empty', { candles: [] }],
    ['numeric', { candles: [bar(T - 900), bar(T - 1800)] }],
  ])('a provenance-less %s page cannot downgrade an own-source generation; a new generation starts fresh', async (_kind, plain) => {
    deferHistory = true;
    const state = (close = 12) => viewer({ [CEX]: { '15m': bar(T, close), '1m': bar(T, 1) } }, { [CEX]: ['15m', '1m'] });
    await mount(); await sendState(state());
    expect(chart().candles).toEqual([bar(T, 12)]);
    await sendHistory({ ...source('15m', 'UNKNOWN'), instrumentId: CEX });
    expect(chart().candles).toEqual([]); expect(chart().error).toBe('SOURCE_UNAVAILABLE');
    // Next 15 s poll of the same generation answers without provenance.
    await flush(() => jest.advanceTimersByTime(15000));
    await sendHistory(plain, '15m');
    expect(chart().candles).toEqual([]); expect(chart().gaps).toEqual([]);
    expect(chart().error).toBe('SOURCE_UNAVAILABLE'); expect(chart().priceKind).toBe('raw-token');
    await nextPoll(state(13));
    await nextPoll(state(14));
    expect(chart().candles).toEqual([]);
    // A new generation (interval change) is classified afresh: genuine CEX history and native bars work.
    deferHistory = false; historyReply = url => url.includes('interval=1m') ? { candles: [bar(T - 60)] } : { candles: [] };
    await flush(() => button('1m').click());
    await nextPoll(state());
    expect(chart().candles).toEqual([bar(T - 60), bar(T, 1)]);
    expect(chart().priceKind).toBeUndefined(); expect(chart().error).toBe('');
    await silent();
  });

  test('the desktop chart heading marks own-source prices as token prices, never CEX prices', async () => {
    const heading = () => document.querySelector('.vxg-pro-chart-heading > span')!.textContent;
    historyReply = () => ({ candles: [bar(T - 900)] });
    await mount(); await sendState(viewer({}, { [CEX]: ['15m'] }));
    expect(heading()).not.toMatch(/Цена токена/);
    await flush(() => root.unmount()); root = createRoot(document.getElementById('root'));
    ID = OWN; historyReply = url => url.includes('interval=1m') ? source('1m', 'ACCEPTED') : { candles: [] };
    await mount(); await sendState(viewer({}, { [OWN]: ['1m'] }));
    await flush(() => button('1m').click());
    expect(heading()).toMatch(/Цена токена/);
    await silent();
  });

  test('interval and instrument changes: a native bar never crosses into another generation', async () => {
    historyReply = url => ({ candles: url.includes('interval=1m') ? [bar(T - 60)] : [bar(T - 900)] });
    const state = () => viewer({ [CEX]: { '15m': bar(T, 15), '1m': bar(T, 1) }, [OWN]: { '1m': bar(T, 77) } },
      { [CEX]: ['15m', '1m'], [OWN]: ['1m'] });
    await mount(); await sendState(state());
    expect(chart().candles).toEqual([bar(T - 900), bar(T, 15)]);
    await flush(() => button('1m').click());
    await nextPoll(state());
    expect(chart().candles).toEqual([bar(T - 60), bar(T, 1)]);
    // Instrument change to the own-source identity: neither CEX nor raw native bars survive.
    ID = OWN; historyReply = () => source('1m', 'UNKNOWN');
    await mount();
    await nextPoll(state());
    expect(chart().candles).toEqual([]); expect(chart().gaps).toEqual([{ time: T, reason: 'UNKNOWN' }]);
    await silent();
  });
});
