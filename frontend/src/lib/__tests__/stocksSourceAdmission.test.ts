import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { stockTranslator } from '../../pages/stocks/global/stockText';

const frontend = resolve(__dirname, '../../..'), req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), { JSDOM } = req('jsdom');
let ID = 'BYBIT:AAPLXUSDT';
const languageLocales = { ru: 'ru-RU', en: 'en-US', es: 'es-ES', zh: 'zh-CN', hi: 'hi-IN', ja: 'ja-JP', ko: 'ko-KR' } as const;
let language: keyof typeof languageLocales = 'ru';
// Execution tests opt in explicitly; the shipped build remains OFF.
let executionEnabled = true;
const compile = (file: string, imports: Record<string, unknown> = {}) => {
  // Vite replaces this build-time constant; the test exercises the USDT review build.
  const input = readFileSync(resolve(frontend, file), 'utf8')
    .replace("import.meta.env.VITE_STOCKS_OWNER_USDT_ONLY", "'true'")
    .replace("import.meta.env.VITE_STOCKS_ORDER_EXECUTION_ENABLED", JSON.stringify(executionEnabled ? 'true' : 'false'));
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

// Synthetic local responses only: this suite tests the actual terminal's event
// handlers, not market-data providers, matching, browser implicit-Enter or storage.
function state(canTrade?: boolean, id = 'fixture-alice') {
  const timestamp = Date.now();
  return {
    schema: 2, revision: 1, token: 'fixture-csrf', serverTime: timestamp,
    account: { id, mode: canTrade === false ? 'viewer' : 'isolated-paper', canTrade, fundingMode: 'existing-only' },
    catalogue: [{ id: ID, ticker: 'AAPLX', asset: 'AAPLX', name: 'Apple token', provider: 'bybit',
      sourceSymbol: 'AAPLXUSDT', region: 'US', kind: 'token', currency: 'USDT', delaySeconds: 0, timeframes: ['1m', '15m'] }],
    wallets: { USDT: { cash: '137.42', reserved: '4.25', available: '133.17' },
      USDC: { cash: '0', reserved: '0', available: '0' } },
    positions: { [ID + '|USDT']: { instrumentId: ID, currency: 'USDT', quantity: '1', available: '1',
      reserved: '0', average: '10', averageNative: '10', mark: '10', unrealized: '0', realized: '0' } },
    orders: [{ id: 'fixture-open-order', instrumentId: ID, currency: 'USDT', side: 'BUY', type: 'LIMIT',
      quantity: '1', filled: '0', remaining: '1', limitPrice: '4.25', status: 'OPEN', createdAt: timestamp }],
    fills: [], realized: { USDT: '0', USDC: '0' }, adjustments: [], errors: {}, metrics: { rssBytes: 0, requests: 0, cacheHits: 0 },
    quotes: { [ID]: { instrumentId: ID, provider: 'bybit', nativeCurrency: 'USDT', timestamp, receivedAt: timestamp,
      bid: '9', ask: '10', last: '10', multiplier: '1', change24h: 0, volume: '1',
      prices: { USDT: { buy: '10', sell: '9' } }, status: { USDT: 'READY', USDC: 'FX_UNAVAILABLE' }, fx: {} } },
  };
}

describe('Solana source-to-chart admission contract', () => {
  let dom: any, root: any, Terminal: any, terminalImports: Record<string, unknown>, credential: string | null;
  let listeners: Set<() => void>, pendingState: Array<(body: any) => void>;
  let writes: Array<{ url: string; init: RequestInit; finish: (status: number, body: any) => void }>;
  let fetchMock: jest.Mock;
  let historyReply: unknown, chartCandles: unknown[], chartGaps: unknown[];

  const originalFetch = globalThis.fetch;
  const globals = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLInputElement', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  let priorGlobals: Map<string, PropertyDescriptor | undefined>;
  const flush = async (work: () => void = () => {}) => React.act(async () => { work(); await Promise.resolve(); await Promise.resolve(); });
  const button = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent === text)!;
  const submit = () => document.querySelector<HTMLFormElement>('.vxg-ticket form')!.dispatchEvent(
    new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  const amounts = () => Array.from(document.querySelectorAll<HTMLInputElement>('.vxg-ticket form input')).map(i => i.value);
  const notices = () => Array.from(document.querySelectorAll('.vxg-ticket > .vxg-error, .vxg-ticket > .vxg-success')).map(i => i.textContent);
  const draw = async (body?: any) => {
    await flush(() => root.render(React.createElement(Terminal)));
    if (body) await flush(() => pendingState.shift()!(body));
  };
  beforeEach(() => {
    ID = 'BYBIT:AAPLXUSDT'; language = 'ru'; executionEnabled = true; historyReply = { candles: [] }; chartCandles = []; chartGaps = [];
    jest.useFakeTimers(); root = undefined; credential = 'fixture-alice-session'; listeners = new Set(); pendingState = []; writes = [];
    dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:4438/stocks/' + encodeURIComponent(ID), pretendToBeVisual: true });
    priorGlobals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
      sessionStorage: dom.window.sessionStorage, HTMLInputElement: dom.window.HTMLInputElement, HTMLElement: dom.window.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true });
    const reply = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    fetchMock = jest.fn((url: string, init: RequestInit = {}) => {
      if (init.method === 'POST') return new Promise(resolve => writes.push({ url, init, finish: (status, body) => resolve(reply(status, body)) }));
      if (url.includes('/history?')) return Promise.resolve(reply(200, historyReply));
      if (url.includes('/state?')) return new Promise(resolve => pendingState.push(body => resolve(reply(200, body))));
      throw new Error(`Unexpected request: ${url}`);
    });
    globalThis.fetch = fetchMock;
    const Empty = () => null;
    class Demand {
      controller = new AbortController();
      open(_id: string, headers: Record<string, string>) {
        this.controller = new AbortController(); return { headers, signal: this.controller.signal, accept: () => {} };
      }
      close() { this.controller.abort(); }
      headers() { return {}; }
      signal() { return this.controller.signal; }
    }
    class RequestError extends Error { constructor(public code: string) { super(code); } }
    terminalImports = {
      react: React, 'react/jsx-runtime': req('react/jsx-runtime'), 'bignumber.js': { default: req('bignumber.js') },
      'react-router-dom': { useParams: () => ({ instrumentId: ID }), useNavigate: () => jest.fn() },
      './useStocksText': { useStocksText: () => ({ s: stockTranslator(language), lang: language, locale: languageLocales[language] }) },
      './stockText': { stockOrderLabel: (s: string) => s, stockNoticeText: (s: any) => s.message || s.status, stockFxPolicyText: () => '' },
      './OriginalStocksHeader': compile('src/pages/stocks/global/OriginalStocksHeader.tsx', {
        'react/jsx-runtime': req('react/jsx-runtime'), 'lucide-react': req('lucide-react'),
        'react-router-dom': { Link: ({ to, children, ...props }: any) => React.createElement('a', { ...props, href: to }, children) },
        '../../../components/LanguageSwitcher': { LanguageSwitcher: Empty },
        '../../../lib/i18n': { useLanguage: () => ({ t: (key: string) => key }) },
        './useStocksText': { useStocksText: () => ({ s: stockTranslator(language), lang: language, locale: languageLocales[language] }) },
      }),
      './stockOriginalText': compile('src/pages/stocks/global/stockOriginalText.ts'),
      './quoteReadiness': compile('src/pages/stocks/global/quoteReadiness.ts'),
      './chartDemand': { StockChartDemand: Demand }, '../../../components/Nav': { Nav: Empty },
      './GlobalChart': { default: ({ fills, entry, candles, sourceGaps }: { fills: unknown[]; entry: string | null; candles: unknown[]; sourceGaps: unknown[] }) => {
        chartCandles = candles; chartGaps = sourceGaps;
        return React.createElement('div', { 'data-testid': 'chart', 'data-fill-count': fills.length, 'data-entry': entry || '' });
      } },
      '../../../lib/stocksIdentity': { DEFAULT_STOCKS_INSTRUMENT: ID },
      '../stockRequestError': { StockRequestError: RequestError, globalStockErrorText: (s: string) => s },
      './tradeMarkers': { quoteAge: () => '' }, './globalStocks.css': {}, './desktopProfessional.css': {}, './stocksOriginal.css': {},
      '../../../lib/api': { getToken: () => credential, clearToken: () => { credential = null; listeners.forEach(l => l()); },
        onSessionChange: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }, api: { logout: jest.fn() } },
      './accountSession': compile('src/pages/stocks/global/accountSession.ts'),
      './readWork': compile('src/pages/stocks/global/readWork.ts'),
      './overload': compile('src/pages/stocks/global/overload.ts', { './stockText': { stockTranslator: () => (s: string) => s } }),
      './DesktopShell': { DesktopHeader: Empty, DesktopMarketStats: Empty,
        DesktopQuotes: ({ fills }: { fills: unknown[] }) => React.createElement('div', { 'data-testid': 'quote-fills', 'data-fill-count': fills.length }),
        DesktopFooter: Empty,
        // An allocation control is a child boundary, not a replacement submit implementation.
        DesktopAllocation: ({ onChange }: { onChange: (s: string) => void }) => React.createElement('div', null,
          ...['0.25', 'not-a-number', ''].map(value => React.createElement('button', { key: value, type: 'button',
            onClick: () => onChange(value) }, 'amount:' + value))) },
    };
    Terminal = compile('src/pages/stocks/global/GlobalStocks.tsx', terminalImports).default;
    root = createRoot(document.getElementById('root'));
  });
  afterEach(async () => {
    if (root) await flush(() => root.unmount()); dom.window.close(); jest.useRealTimers(); globalThis.fetch = originalFetch;
    for (const key of globals) { const old = priorGlobals.get(key); if (old) Object.defineProperty(globalThis, key, old); else delete (globalThis as any)[key]; }
  });

  test('source-admission: an empty source page remains empty, never zero or forward-filled candles', async () => {
    historyReply = { candles: [], provenance: { status: 'UNKNOWN', intervalComplete: false } };
    await draw(state(false));
    expect(chartCandles).toEqual([]);
    expect(writes).toHaveLength(0);
  });

  // Original #615 negative acceptance assertions are preserved. These hostile
  // numeric rows are NOT accepted trades or prices, or evidence of a live feed.
  test.each(['1m', '5m', '1h'])('source-admission: UNKNOWN/incomplete %s must not reach the existing chart', async interval => {
    executionEnabled = false;
    Terminal = compile('src/pages/stocks/global/GlobalStocks.tsx', terminalImports).default;
    const candidate = { time: 1792924740, open: 10, high: 12, low: 9, close: 11, volume: 4 };
    historyReply = { instrumentId: ID, interval, candles: [candidate],
      provenance: { status: 'UNKNOWN', intervalComplete: false, acceptedTradeCount: 0 } };
    const viewer = state(false); viewer.catalogue[0].timeframes = [interval];
    await draw(viewer);
    if (interval !== '15m') await flush(() => button(interval).click());
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(`interval=${interval}`))).toBe(true);
    // Execution safety remains independent from source admission.
    await flush(() => document.querySelector<HTMLButtonElement>('.vxg-submit')!.click());
    expect(writes).toHaveLength(0);
    expect(chartCandles).toEqual([]);
  });

  test('versioned source admission and later revocation reach the mounted chart without retaining stale candles', async () => {
    executionEnabled = false;
    const mint = 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', pool = '4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw';
    ID = `SOLANA:${mint}:${pool}`;
    Terminal = compile('src/pages/stocks/global/GlobalStocks.tsx', terminalImports).default;
    // Disposable transport fixture only; no real interval or market is claimed.
    const time = 1792924740, candidate = { time, open: 10, high: 12, low: 9, close: 11, volume: 4, tradeCount: 1, proofDigest: 'a'.repeat(64) };
    const accepted = { schema: 'voltex.solana-ohlcv.v1', instrumentId: ID, interval: '1m', priceKind: 'raw-token', quoteCurrency: 'USDC',
      range: { from: time, to: time + 60 }, candles: [candidate], gaps: [], provenance: {
        status: 'ACCEPTED', intervalComplete: true, finality: 'finalized', acceptedTradeCount: 1, receiptsHash: 'b'.repeat(64), synthetic: false,
        gates: { programIdentity: true, poolState: true, mintChronology: true, feeChronology: true, completeness: true, executionBinding: true },
        source: { network: 'solana-mainnet-beta', program: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
          mint, pool, quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' } } };
    historyReply = accepted;
    const viewer = state(false); viewer.catalogue[0].timeframes = ['1m'];
    await draw(viewer); await flush(() => button('1m').click());
    expect(chartCandles).toEqual([candidate]); expect(chartGaps).toEqual([]);
    historyReply = { ...accepted, candles: [], gaps: [{ time, reason: 'UNKNOWN' }],
      provenance: { ...accepted.provenance, status: 'UNKNOWN', intervalComplete: false, acceptedTradeCount: 0 } };
    await flush(() => jest.advanceTimersByTime(15000));
    expect(chartCandles).toEqual([]); expect(chartGaps).toEqual([{ time, reason: 'UNKNOWN' }]);
    await flush(() => document.querySelector<HTMLButtonElement>('.vxg-submit')!.click());
    expect(writes).toHaveLength(0);
  });

});
