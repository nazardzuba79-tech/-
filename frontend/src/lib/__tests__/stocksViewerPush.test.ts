import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { stockTranslator } from '../../pages/stocks/global/stockText';
import { ViewerPush, parseViewerEvent } from '../../pages/stocks/global/viewerPush';

// #613 viewer push: the terminal's fetch-based stream of the public quote for viewers, its fallback to the ordinary
// 3 s state read, and its lifecycle (instrument, visibility, sign-out, revocation). Synthetic local responses only.
const frontend = resolve(__dirname, '../../..'), req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), { JSDOM } = req('jsdom');
const ID = 'BYBIT:AAPLXUSDT', OTHER = 'BYBIT:TSLAXUSDT';
const encoder = new TextEncoder();
const quote = (id: string, last: string, timestamp: number) => ({ instrumentId: id, provider: 'bybit', nativeCurrency: 'USDT', bid: last, ask: last, last,
  timestamp, receivedAt: timestamp, multiplier: '1', change24h: 0, volume: '1', prices: { USDT: { buy: last, sell: last } }, status: { USDT: 'READY', USDC: 'FX_UNAVAILABLE' }, fx: {} });
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const quoteEvent = (id: string, seq: number, last: string, timestamp: number) => sse('quote', { instrumentId: id, seq, serverTime: timestamp, quote: quote(id, last, timestamp) });

// A controllable event stream as fetch returns it; aborting the request errors its body as a real fetch does.
function streamResponse(init: RequestInit, status = 200, headers: Record<string, string> = { 'content-type': 'text/event-stream' }) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: c => { controller = c; } });
  init.signal?.addEventListener('abort', () => { try { controller.error(new Error('aborted')); } catch { /* closed */ } });
  return {
    response: new Response(status === 200 ? body : JSON.stringify({ error: 'SOURCE_BUSY', retryAfterMs: 5000 }), { status, headers }),
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
    aborted: () => !!init.signal?.aborted,
  };
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

describe('viewer push events', () => {
  test('a quote event carries the public quote only; native candles are dropped; malformed or unknown blocks are ignored', () => {
    const event = parseViewerEvent(sse('quote', { instrumentId: ID, seq: 4, serverTime: 1, quote: { ...quote(ID, '10', 5), nativeCandles: { '15m': { time: 1 } } } }).trim());
    expect(event).toMatchObject({ kind: 'quote', instrumentId: ID, seq: 4 });
    expect(event && event.kind === 'quote' && 'nativeCandles' in event.quote).toBe(false);
    expect(parseViewerEvent(': open')).toBeNull();
    expect(parseViewerEvent('event: quote\ndata: {not json')).toBeNull();
    expect(parseViewerEvent(sse('quote', { instrumentId: ID, seq: 0, serverTime: 1, quote: quote(ID, '10', 5) }).trim())).toBeNull();
    expect(parseViewerEvent(sse('quote', { instrumentId: ID, seq: 1, serverTime: 1, quote: quote(OTHER, '10', 5) }).trim())).toBeNull();
    expect(parseViewerEvent(sse('quote', { instrumentId: ID, seq: 1, serverTime: 1, quote: { ...quote(ID, '10', 5), timestamp: 'now' } }).trim())).toBeNull();
    expect(parseViewerEvent(sse('wallets', { seq: 1 }).trim())).toBeNull();
    expect(parseViewerEvent(sse('unavailable', { instrumentId: ID, seq: 2, error: 'QUOTE_UNAVAILABLE' }).trim())).toEqual({ kind: 'unavailable', instrumentId: ID, seq: 2, error: 'QUOTE_UNAVAILABLE' });
    expect(parseViewerEvent(sse('unavailable', { instrumentId: ID, seq: 2, error: '<b>x</b>' }).trim())).toBeNull();
    expect(parseViewerEvent(sse('wait', { seq: 3, retryAfterMs: 999999 }).trim())).toEqual({ kind: 'wait', seq: 3, retryAfterMs: 60000 });
    expect(parseViewerEvent(sse('revoked', {}).trim())).toEqual({ kind: 'revoked' });
  });
});

describe('ViewerPush session', () => {
  let streams: Array<ReturnType<typeof streamResponse> & { url: string; init: RequestInit }>, next: Array<{ status: number; headers?: Record<string, string> }>;
  let handlers: { quote: jest.Mock; unavailable: jest.Mock; recheck: jest.Mock; down: jest.Mock }, push: ViewerPush, credential: string;
  beforeEach(() => {
    jest.useFakeTimers(); streams = []; next = []; credential = 'viewer-session';
    handlers = { quote: jest.fn(), unavailable: jest.fn(), recheck: jest.fn(), down: jest.fn() };
    const fetchImpl = jest.fn(async (url: string, init: RequestInit) => {
      const planned = next.shift() ?? { status: 200 };
      const stream = streamResponse(init, planned.status, planned.headers);
      streams.push({ ...stream, url, init }); return stream.response;
    }) as unknown as typeof fetch;
    push = new ViewerPush(id => '/__stocks_global/stream?id=' + encodeURIComponent(id), handlers, { fetch: fetchImpl, random: () => 0.5 });
  });
  afterEach(() => { push.stop(); jest.useRealTimers(); });
  const capture = () => { const held = credential; return { headers: { Authorization: 'Bearer ' + held }, current: () => credential === held }; };

  test('the bearer travels in the header, never in the URL; events in order update the quote; older or foreign ones are dropped', async () => {
    push.want(ID, capture); await settle();
    expect(streams).toHaveLength(1);
    expect(streams[0].url).toBe('/__stocks_global/stream?id=' + encodeURIComponent(ID));
    expect(streams[0].url).not.toContain(credential);
    expect(streams[0].init.headers).toEqual({ Authorization: 'Bearer viewer-session' });
    expect(push.live(ID)).toBe(true);
    streams[0].send(': open\n\n' + quoteEvent(ID, 5, '10', 1000) + quoteEvent(ID, 4, '9', 1001) + quoteEvent(ID, 6, '8', 900) + quoteEvent(OTHER, 7, '7', 2000) + quoteEvent(ID, 8, '11', 1100));
    await settle();
    expect(handlers.quote.mock.calls.map(call => call[1].last)).toEqual(['10', '11']);
    expect(push.metrics.discarded).toBe(3);
    // Unavailable: told once, no price.
    streams[0].send(sse('unavailable', { instrumentId: ID, seq: 9, error: 'QUOTE_UNAVAILABLE' })); await settle();
    expect(handlers.unavailable).toHaveBeenCalledWith(ID, 'QUOTE_UNAVAILABLE');
  });

  test('a silent stream is closed after 5 s and the ordinary reads take over; it reopens with backoff', async () => {
    push.want(ID, capture); await settle();
    streams[0].send(quoteEvent(ID, 1, '10', 1000)); await settle();
    jest.advanceTimersByTime(5000); await settle();
    expect(streams[0].aborted()).toBe(true); expect(push.live(ID)).toBe(false); expect(handlers.down).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1400); await settle();
    expect(streams).toHaveLength(1);
    jest.advanceTimersByTime(200); await settle();
    expect(streams).toHaveLength(2); expect(push.live(ID)).toBe(true);
  });

  test('busy (503 + Retry-After): not reopened before it; refused otherwise (422): the ordinary reads for a minute', async () => {
    next.push({ status: 503, headers: { 'content-type': 'application/json', 'retry-after': '5' } });
    push.want(ID, capture); await settle();
    expect(handlers.down).toHaveBeenCalledTimes(1); expect(push.live(ID)).toBe(false);
    jest.advanceTimersByTime(5000); await settle(); expect(streams).toHaveLength(1);
    jest.advanceTimersByTime(600); await settle(); expect(streams).toHaveLength(2);
    push.stop();
    next.push({ status: 422, headers: { 'content-type': 'application/json' } });
    push.want(OTHER, capture); await settle();
    expect(streams).toHaveLength(3); expect(push.live(OTHER)).toBe(false);
    jest.advanceTimersByTime(59000); await settle(); expect(streams).toHaveLength(3);
    jest.advanceTimersByTime(2000); await settle(); expect(streams).toHaveLength(4);
  });

  test('revoked or 401: closed, the terminal re-reads its state, nothing reopens by itself', async () => {
    push.want(ID, capture); await settle();
    streams[0].send(sse('revoked', {})); await settle();
    expect(handlers.recheck).toHaveBeenCalledTimes(1); expect(push.live(ID)).toBe(false);
    next.push({ status: 401, headers: { 'content-type': 'application/json' } });
    push.want(ID, capture); await settle();
    expect(handlers.recheck).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(120000); await settle();
    expect(streams).toHaveLength(2); expect(handlers.down).not.toHaveBeenCalled();
  });

  test('another instrument, a hidden tab, sign-out: the open stream is aborted at once', async () => {
    push.want(ID, capture); await settle();
    push.want(OTHER, capture); await settle();
    expect(streams[0].aborted()).toBe(true); expect(push.live(OTHER)).toBe(true); expect(push.live(ID)).toBe(false);
    push.pause(); expect(streams[1].aborted()).toBe(true); expect(push.live(OTHER)).toBe(false);
    push.want(OTHER, capture); await settle(); expect(streams).toHaveLength(3);
    // A delivery after the credential changed is not shown; the stream ends without reopening.
    credential = 'another-session';
    streams[2].send(quoteEvent(OTHER, 1, '10', 1000)); await settle();
    expect(handlers.quote).not.toHaveBeenCalled(); expect(push.live(OTHER)).toBe(false);
    jest.advanceTimersByTime(120000); await settle(); expect(streams).toHaveLength(3);
  });
});

// The real terminal with the push session wired in.
const compile = (file: string, imports: Record<string, unknown> = {}) => {
  const input = readFileSync(resolve(frontend, file), 'utf8')
    .replace("import.meta.env.VITE_STOCKS_OWNER_USDT_ONLY", "'true'")
    .replace("import.meta.env.VITE_STOCKS_ORDER_EXECUTION_ENABLED", "'false'");
  const source = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const out: any = {};
  new Function('exports', 'require', source)(out, (name: string) => {
    if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`);
    return imports[name];
  });
  return out;
};
function state({ canTrade = false, offered = true, last = '10', timestamp = Date.now() } = {}) {
  return {
    schema: 2, revision: 1, token: 'fixture-csrf', serverTime: timestamp, ...(offered ? { viewerStream: 'v1' } : {}),
    account: { id: canTrade ? 'fixture-alice' : 'fixture-viewer', mode: canTrade ? 'isolated-paper' : 'viewer', canTrade, fundingMode: 'existing-only' },
    catalogue: [ID, OTHER].map(id => ({ id, ticker: id.slice(6, 11), asset: id.slice(6, 11), name: id, provider: 'bybit', sourceSymbol: id.slice(6), region: 'US', kind: 'token', currency: 'USDT', delaySeconds: 0, timeframes: ['1m', '15m'] })),
    wallets: { USDT: { cash: '0', reserved: '0', available: '0' }, USDC: { cash: '0', reserved: '0', available: '0' } },
    positions: {}, orders: [], fills: [], realized: { USDT: '0', USDC: '0' }, adjustments: [], errors: {}, metrics: { rssBytes: 0, requests: 0, cacheHits: 0 },
    quotes: { [ID]: quote(ID, last, timestamp) },
  };
}

describe('GlobalStocks viewer push', () => {
  let dom: any, root: any, Terminal: any, credential: string | null, listeners: Set<() => void>, instrument: string;
  let stateReads: Array<{ url: string; init: RequestInit }>, stateReply: () => { status: number; body: any };
  let streams: Array<ReturnType<typeof streamResponse> & { url: string; init: RequestInit }>, streamPlan: Array<{ status: number; headers: Record<string, string> }>;
  const originalFetch = globalThis.fetch;
  const globals = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLInputElement', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  let priorGlobals: Map<string, PropertyDescriptor | undefined>;
  const flush = async (work: () => void = () => {}) => React.act(async () => { work(); await settle(); });
  const shown = () => document.querySelector('.vxg-last strong')!.textContent;
  const draw = () => flush(() => root.render(React.createElement(Terminal)));
  const tick = async (ms: number) => { for (let t = 0; t < ms; t += 500) await flush(() => jest.advanceTimersByTime(500)); };
  const setHidden = (hidden: boolean) => flush(() => { Object.defineProperty(document, 'hidden', { value: hidden, configurable: true }); document.dispatchEvent(new dom.window.Event('visibilitychange')); });

  beforeEach(() => {
    jest.useFakeTimers(); credential = 'fixture-viewer-session'; listeners = new Set(); stateReads = []; streams = []; streamPlan = []; instrument = ID;
    stateReply = () => ({ status: 200, body: state() });
    dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:4438/stocks/' + encodeURIComponent(ID), pretendToBeVisual: true });
    priorGlobals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
      HTMLInputElement: dom.window.HTMLInputElement, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
    globalThis.fetch = jest.fn((url: string, init: RequestInit = {}) => {
      if (url.includes('/history?')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ candles: [] }) });
      if (url.includes('/state?')) { stateReads.push({ url, init }); const { status, body } = stateReply(); return Promise.resolve({ ok: status === 200, status, json: async () => body }); }
      if (url.includes('/stream?')) { const plan = streamPlan.shift(); const stream = streamResponse(init, plan?.status, plan?.headers); streams.push({ ...stream, url, init }); return Promise.resolve(stream.response); }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;
    const Empty = () => null;
    class Demand { controller = new AbortController(); open(_id: string, headers: Record<string, string>) { this.controller = new AbortController(); return { headers, signal: this.controller.signal, accept: () => {} }; }
      close() { this.controller.abort(); } headers() { return {}; } signal() { return this.controller.signal; } }
    class RequestError extends Error { constructor(public code: string) { super(code); } }
    const text = { useStocksText: () => ({ s: stockTranslator('ru'), lang: 'ru', locale: 'ru-RU' }) };
    Terminal = compile('src/pages/stocks/global/GlobalStocks.tsx', {
      react: React, 'react/jsx-runtime': req('react/jsx-runtime'), 'bignumber.js': { default: req('bignumber.js') },
      'react-router-dom': { useParams: () => ({ instrumentId: instrument }), useNavigate: () => jest.fn() },
      './useStocksText': text, './stockText': { stockOrderLabel: (s: string) => s, stockNoticeText: (s: any) => s.message || s.status, stockFxPolicyText: () => '' },
      './OriginalStocksHeader': { default: Empty }, './stockOriginalText': compile('src/pages/stocks/global/stockOriginalText.ts'),
      './quoteReadiness': compile('src/pages/stocks/global/quoteReadiness.ts'), './chartDemand': { StockChartDemand: Demand },
      './GlobalChart': { default: () => React.createElement('div', { 'data-testid': 'chart' }) },
      '../../../lib/stocksIdentity': { DEFAULT_STOCKS_INSTRUMENT: ID },
      '../stockRequestError': { StockRequestError: RequestError, globalStockErrorText: (s: string) => s },
      './tradeMarkers': { quoteAge: () => '' }, './globalStocks.css': {}, './desktopProfessional.css': {}, './stocksOriginal.css': {},
      '../../../lib/api': { getToken: () => credential, clearToken: () => { credential = null; listeners.forEach(l => l()); },
        onSessionChange: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }, api: { logout: jest.fn() } },
      './accountSession': compile('src/pages/stocks/global/accountSession.ts'), './readWork': compile('src/pages/stocks/global/readWork.ts'),
      './catalogueVersion': compile('src/pages/stocks/global/catalogueVersion.ts'), './viewerPush': compile('src/pages/stocks/global/viewerPush.ts'),
      './overload': compile('src/pages/stocks/global/overload.ts', { './stockText': { stockTranslator: () => (s: string) => s } }),
      './DesktopShell': { DesktopMarketStats: Empty, DesktopQuotes: Empty, DesktopFooter: Empty, DesktopAllocation: Empty },
    }).default;
    root = createRoot(document.getElementById('root'));
  });
  afterEach(async () => {
    if (root) await flush(() => root.unmount()); dom.window.close(); jest.useRealTimers(); globalThis.fetch = originalFetch;
    for (const key of globals) { const old = priorGlobals.get(key); if (old) Object.defineProperty(globalThis, key, old); else delete (globalThis as any)[key]; }
  });

  test('a viewer offered the stream reads quotes from it instead of polling the state; stale and out-of-order events change nothing', async () => {
    await draw();
    expect(stateReads).toHaveLength(1); expect(streams).toHaveLength(1);
    expect(streams[0].url).toBe('/__stocks_global/stream?id=' + encodeURIComponent(ID));
    expect(streams[0].url).not.toContain('fixture-viewer-session');
    expect((streams[0].init.headers as Record<string, string>).Authorization).toBe('Bearer fixture-viewer-session');
    expect(shown()).toBe('10');
    const at = Date.now();
    for (let n = 1; n <= 9; n++) { await flush(() => streams[0].send(quoteEvent(ID, n, String(10 + n), at + n * 1000))); await tick(1000); }
    expect(shown()).toBe('19');
    expect(stateReads).toHaveLength(1);
    await flush(() => streams[0].send(quoteEvent(ID, 10, '5', at + 2000) + quoteEvent(ID, 3, '6', at + 20000)));
    expect(shown()).toBe('19');
    await flush(() => streams[0].send(sse('unavailable', { instrumentId: ID, seq: 11, error: 'QUOTE_UNAVAILABLE' })));
    expect(shown()).toBe('—'); expect(document.querySelector('.vxg-ticket')!.textContent).toContain('QUOTE_UNAVAILABLE');
  });

  test('the stream fails: the state is read at once, the 3 s reads carry on while it is refused, and stop once it delivers again', async () => {
    await draw();
    streamPlan.push({ status: 503, headers: { 'content-type': 'application/json', 'retry-after': '10' } });
    await flush(() => streams[0].end());
    expect(stateReads).toHaveLength(2);
    // Reopened after 1-2 s, refused busy for 10 s: the ordinary 3 s reads show the price meanwhile.
    await tick(2000);
    expect(streams).toHaveLength(2); expect(stateReads).toHaveLength(3);
    await tick(9000);
    expect(streams).toHaveLength(2); expect(stateReads.length).toBeGreaterThanOrEqual(6);
    await tick(3000);
    expect(streams).toHaveLength(3);
    const reads = stateReads.length;
    for (let n = 1; n <= 6; n++) { await flush(() => streams[2].send(quoteEvent(ID, n, '12', Date.now()))); await tick(1000); }
    expect(stateReads).toHaveLength(reads); expect(shown()).toBe('12');
  });

  test('sign-out, a hidden tab and revocation close the stream at once', async () => {
    await draw();
    await setHidden(true);
    expect(streams[0].aborted()).toBe(true);
    await tick(10000); expect(streams).toHaveLength(1);
    await setHidden(false);
    expect(streams).toHaveLength(2);
    // Revoked: the terminal re-reads its state; the gateway now refuses the session.
    stateReply = () => ({ status: 401, body: { error: 'AUTH_REQUIRED' } });
    await flush(() => streams[1].send(sse('revoked', {})));
    expect(document.querySelector('.vxg-ticket')!.textContent).toContain('AUTH_REQUIRED');
    await tick(70000); expect(streams).toHaveLength(2);
  });

  test('switching the instrument closes its stream at once and opens the new one; a late event of the old one is not shown', async () => {
    await draw();
    stateReply = () => ({ status: 200, body: { ...state(), quotes: { [OTHER]: quote(OTHER, '200', Date.now()) } } });
    instrument = OTHER; await draw();
    expect(streams[0].aborted()).toBe(true);
    expect(streams).toHaveLength(2); expect(streams[1].url).toBe('/__stocks_global/stream?id=' + encodeURIComponent(OTHER));
    expect(shown()).toBe('200');
    try { streams[0].send(quoteEvent(ID, 99, '1', Date.now() + 5000)); } catch { /* the old body is already closed */ }
    await flush(() => streams[1].send(quoteEvent(OTHER, 1, '201', Date.now())));
    expect(shown()).toBe('201');
  });

  test('logout aborts the stream immediately and nothing reopens without a new offer', async () => {
    await draw();
    await flush(() => { credential = null; listeners.forEach(l => l()); });
    expect(streams[0].aborted()).toBe(true);
    stateReply = () => ({ status: 401, body: { error: 'AUTH_REQUIRED' } });
    await tick(70000); expect(streams).toHaveLength(1);
  });

  test('a trader, or a state without the offer, never opens a stream and keeps the 3 s reads', async () => {
    stateReply = () => ({ status: 200, body: state({ canTrade: true }) });
    await draw(); await tick(6000);
    expect(streams).toHaveLength(0); expect(stateReads.length).toBeGreaterThanOrEqual(3);
    await flush(() => root.unmount()); root = createRoot(document.getElementById('root')); stateReads = [];
    stateReply = () => ({ status: 200, body: state({ offered: false }) });
    await draw(); await tick(6000);
    expect(streams).toHaveLength(0); expect(stateReads.length).toBeGreaterThanOrEqual(3);
  });
});
