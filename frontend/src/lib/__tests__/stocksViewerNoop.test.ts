import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..'), req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), { JSDOM } = req('jsdom');
const ID = 'BYBIT:AAPLXUSDT';
const compile = (file: string, imports: Record<string, unknown> = {}) => {
  // Vite replaces this build-time constant; the test exercises the USDT review build.
  const input = readFileSync(resolve(frontend, file), 'utf8')
    .replace("import.meta.env.VITE_STOCKS_OWNER_USDT_ONLY", "'true'");
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

describe('GlobalStocks session-bound trading and silent viewer submit', () => {
  let dom: any, root: any, Terminal: any, credential: string | null;
  let listeners: Set<() => void>, pendingState: Array<(body: any) => void>;
  let writes: Array<{ url: string; init: RequestInit; finish: (status: number, body: any) => void }>;
  let fetchMock: jest.Mock;
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
    jest.useFakeTimers(); root = undefined; credential = 'fixture-alice-session'; listeners = new Set(); pendingState = []; writes = [];
    dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:4438/stocks/' + encodeURIComponent(ID), pretendToBeVisual: true });
    priorGlobals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
      sessionStorage: dom.window.sessionStorage, HTMLInputElement: dom.window.HTMLInputElement, HTMLElement: dom.window.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true });
    const reply = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    fetchMock = jest.fn((url: string, init: RequestInit = {}) => {
      if (init.method === 'POST') return new Promise(resolve => writes.push({ url, init, finish: (status, body) => resolve(reply(status, body)) }));
      if (url.includes('/history?')) return Promise.resolve(reply(200, { candles: [] }));
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
    Terminal = compile('src/pages/stocks/global/GlobalStocks.tsx', {
      react: React, 'react/jsx-runtime': req('react/jsx-runtime'), 'bignumber.js': { default: req('bignumber.js') },
      'react-router-dom': { useParams: () => ({ instrumentId: ID }), useNavigate: () => jest.fn() },
      './useStocksText': { useStocksText: () => ({ s: (s: string) => s, lang: 'ru', locale: 'ru-RU' }) },
      './stockText': { stockOrderLabel: (s: string) => s, stockNoticeText: (s: any) => s.message || s.status, stockFxPolicyText: () => '' },
      './chartDemand': { StockChartDemand: Demand }, '../../../components/Nav': { Nav: Empty },
      './GlobalChart': { default: ({ fills, entry }: { fills: unknown[]; entry: string | null }) =>
        React.createElement('div', { 'data-testid': 'chart', 'data-fill-count': fills.length, 'data-entry': entry || '' }) },
      '../../../lib/stocksIdentity': { DEFAULT_STOCKS_INSTRUMENT: ID },
      '../stockRequestError': { StockRequestError: RequestError, globalStockErrorText: (s: string) => s },
      './tradeMarkers': { quoteAge: () => '' }, './globalStocks.css': {}, './desktopProfessional.css': {},
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
    }).default;
    root = createRoot(document.getElementById('root'));
  });
  afterEach(async () => {
    if (root) await flush(() => root.unmount()); dom.window.close(); jest.useRealTimers(); globalThis.fetch = originalFetch;
    for (const key of globals) { const old = priorGlobals.get(key); if (old) Object.defineProperty(globalThis, key, old); else delete (globalThis as any)[key]; }
  });

  test.each([false, undefined])('viewer or missing permission (%s) silently ignores valid, invalid and repeated submit', async permission => {
    await draw(state(permission));
    const refresh = button('Обновить котировку');
    expect(refresh.disabled).toBe(true);
    await flush(() => refresh.click()); expect(writes).toHaveLength(0);
    const beforeStorage = { local: { ...localStorage }, session: { ...sessionStorage } };
    for (const side of ['Купить', 'Продать']) {
      await flush(() => Array.from(document.querySelectorAll<HTMLButtonElement>('.vxg-sides button')).find(b => b.textContent === side)!.click());
      for (const type of ['Market', 'Limit']) {
        await flush(() => Array.from(document.querySelectorAll<HTMLButtonElement>('.vxg-order-types button')).find(b => b.textContent === type)!.click());
        for (const amount of ['', 'not-a-number', '0.25']) {
          await flush(() => button('amount:' + amount).click());
          const before = { fields: amounts(), notices: notices(), text: document.querySelector('.vxg-submit')!.textContent };
          const submitButton = document.querySelector<HTMLButtonElement>('.vxg-submit')!;
          expect(submitButton.disabled).toBe(false);
          await flush(() => { for (let n = 0; n < 5; n++) { submitButton.click(); submit(); } });
          expect(writes).toHaveLength(0);
          expect(amounts()).toEqual(before.fields); expect(notices()).toEqual(before.notices);
          expect(submitButton.disabled).toBe(false); expect(submitButton.textContent).toBe(before.text);
          expect({ local: { ...localStorage }, session: { ...sessionStorage } }).toEqual(beforeStorage);
        }
      }
    }
    expect(document.querySelector('.vxg-wallets')!.textContent).not.toContain('137.42');
    expect(document.querySelector('.vxg-wallets')!.textContent).toContain('—');
    expect(document.querySelector('.vxg-ticket form')!.previousElementSibling!.textContent).toContain('—');
  });

  test('loading submit is active and cannot create an intent before authenticated state arrives', async () => {
    await draw(); const before = notices();
    expect(document.querySelectorAll('.vxg-notice')).toHaveLength(1);
    expect(document.querySelector('.vxg-notice')!.textContent).toBe('Баланс и позиции — тестовые. Заявки не выходят на реальный рынок.');
    expect(document.querySelector<HTMLButtonElement>('.vxg-submit')!.disabled).toBe(false);
    await flush(() => { document.querySelector<HTMLButtonElement>('.vxg-submit')!.click(); submit(); });
    expect(writes).toHaveLength(0); expect(sessionStorage.length).toBe(0); expect(notices()).toEqual(before);
  });

  test('a stale loading handler stays no-op after permission arrives but before the authorized render commits', async () => {
    await draw();
    const allowed = state(true); let permissionRead = false;
    Object.defineProperty(allowed.account, 'canTrade', { get: () => { permissionRead = true; return true; } });
    await React.act(async () => {
      pendingState.shift()!(allowed);
      for (let i = 0; i < 6; i++) await Promise.resolve();
      // React batches this render until act completes. The response was already
      // consumed, while this form still has its original loading/invalid fields.
      expect(permissionRead).toBe(true);
      expect(document.querySelector('.vxg-active-asset')!.textContent).toContain('STOCKS');
      submit();
      expect(writes).toHaveLength(0); expect(sessionStorage.length).toBe(0);
    });
    expect(document.querySelector<HTMLButtonElement>('.vxg-submit')!.disabled).toBe(true);
  });

  test('an old allowed-trader handler cannot submit with the second allowed trader session', async () => {
    await draw(state(true)); await flush(() => button('amount:0.25').click());
    const next = state(true, 'fixture-bob'); let permissionRead = false;
    Object.defineProperty(next.account, 'canTrade', { get: () => { permissionRead = true; return true; } });
    await React.act(async () => {
      credential = 'fixture-bob-session'; listeners.forEach(listener => listener());
      pendingState.shift()!(next);
      for (let i = 0; i < 6; i++) await Promise.resolve();
      expect(permissionRead).toBe(true);
      expect(document.querySelector<HTMLInputElement>('input[aria-label="Количество"]')!.value).toBe('0.25');
      submit();
      expect(writes).toHaveLength(0); expect(sessionStorage.length).toBe(0);
    });
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Количество"]')!.value).toBe('');
    await flush(() => button('amount:0.25').click()); await flush(submit);
    expect(writes).toHaveLength(1);
    expect(writes[0].init.headers).toMatchObject({ Authorization: 'Bearer fixture-bob-session' });
    expect(Object.keys(sessionStorage)).toEqual(['voltex.stocks.global.pending.v2.fixture-bob']);
    await flush(() => writes[0].finish(422, { error: 'INSUFFICIENT_FUNDS' }));
  });

  test('trader keeps validation and actual operation errors, but existing-only balance editing is blocked', async () => {
    await draw(state(true));
    expect(document.querySelector<HTMLButtonElement>('.vxg-submit')!.disabled).toBe(true);
    await flush(submit); expect(writes).toHaveLength(0);
    const balance = document.querySelector<HTMLInputElement>('.vxg-settings input')!;
    expect(balance.disabled).toBe(true);
    const setBalance = Array.from(document.querySelectorAll<HTMLButtonElement>('.vxg-settings button'))[0];
    expect(setBalance.disabled).toBe(true);
    await flush(() => setBalance.click()); expect(writes).toHaveLength(0);
    await flush(() => button('amount:0.25').click());
    expect(document.querySelector<HTMLButtonElement>('.vxg-submit')!.disabled).toBe(false);
    await flush(() => { submit(); submit(); });
    expect(writes).toHaveLength(1); expect(writes[0].url).toBe('/__stocks_global/orders');
    expect(JSON.parse(String(writes[0].init.body))).toMatchObject({ quantity: '0.25000000', side: 'BUY', currency: 'USDT' });
    await flush(() => writes[0].finish(422, { error: 'INSUFFICIENT_FUNDS' }));
    expect(notices()).toContain('INSUFFICIENT_FUNDS');
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Количество"]')!.value).toBe('0.25');
  });

  test('new credential cannot reuse an old rendered permission even before session notification/render', async () => {
    await draw(state(true)); await flush(() => button('amount:0.25').click());
    const beforeStorage = { ...sessionStorage };
    credential = 'fixture-viewer-session';
    await flush(submit); expect(writes).toHaveLength(0); expect({ ...sessionStorage }).toEqual(beforeStorage);
    await flush(() => listeners.forEach(listener => listener()));
    await flush(() => pendingState.shift()!(state(false, 'fixture-viewer')));
    await flush(submit); expect(writes).toHaveLength(0);
  });

  test('same-credential invalidation fences submit/close before rerender and late old reads cannot restore permission', async () => {
    await draw(state(true)); await flush(() => button('amount:0.25').click());
    await flush(() => jest.advanceTimersByTime(3000));
    const oldRead = pendingState.shift()!;
    await flush(() => {
      listeners.forEach(listener => listener());
      submit(); button('Закрыть').click(); button('Продать 50%').click();
    });
    expect(writes).toHaveLength(0); expect(sessionStorage.length).toBe(0);
    await flush(() => pendingState.shift()!(state(false, 'fixture-viewer')));
    await flush(() => oldRead(state(true)));
    expect(document.querySelector('.vxg-wallets')!.textContent).not.toContain('137.42');
    await flush(submit); expect(writes).toHaveLength(0);
  });

  test('a stale cancel handler cannot mutate after synchronous session invalidation', async () => {
    await draw(state(true));
    await flush(() => document.querySelectorAll<HTMLButtonElement>('.vxg-account-tabs button')[1].click());
    const cancel = button('Отменить'); expect(cancel.disabled).toBe(false);
    await flush(() => { listeners.forEach(listener => listener()); cancel.click(); });
    expect(writes).toHaveLength(0);
  });

  test.each(['credential-replaced', 'same-credential-invalidated'])('matcher-feeding refresh rejects a stale enabled handler (%s)', async transition => {
    await draw(state(true));
    const refresh = button('Обновить котировку'); expect(refresh.disabled).toBe(false);
    const before = notices();
    await flush(() => {
      if (transition === 'credential-replaced') credential = 'fixture-viewer-session';
      else listeners.forEach(listener => listener());
      // This is still the enabled old render. Disabled-button behavior alone
      // cannot protect the matcher; act itself must check current capability.
      refresh.click(); refresh.click(); refresh.click();
    });
    expect(writes).toHaveLength(0); expect(sessionStorage.length).toBe(0);
    expect(notices()).toEqual(transition === 'same-credential-invalidated' ? ['Нет связи с локальным сервисом'] : before);
  });

  test('current trader can refresh and receives a real refresh failure instead of a silent no-op', async () => {
    await draw(state(true));
    await flush(() => button('Обновить котировку').click());
    expect(writes).toHaveLength(1); expect(writes[0].url).toBe('/__stocks_global/refresh');
    expect(JSON.parse(String(writes[0].init.body))).toEqual({ id: ID });
    await flush(() => writes[0].finish(503, { error: 'SOURCE_UNAVAILABLE' }));
    expect(notices()).toContain('SOURCE_UNAVAILABLE');
  });

  test('a lower-revision viewer response still revokes trading permission', async () => {
    const initial = state(true); initial.revision = 9; await draw(initial);
    await flush(() => button('amount:0.25').click());
    await flush(() => jest.advanceTimersByTime(3000));
    const revoked = state(false); revoked.revision = 0;
    await flush(() => pendingState.shift()!(revoked));
    await flush(submit); expect(writes).toHaveLength(0); expect(sessionStorage.length).toBe(0);
    expect(document.querySelector('.vxg-wallets')!.textContent).not.toContain('137.42');
  });

  test('account-switch rendering never exposes previous positions, orders, fills or settings before the next response', async () => {
    const initial: any = state(true);
    initial.fills = [{ id: 'fixture-private-fill', instrumentId: ID, currency: 'USDT', side: 'BUY',
      quantity: '0.125', price: '10', nativePrice: '10', realized: '0', timestamp: Date.now(), provider: 'bybit', quoteTimestamp: Date.now() }];
    await draw(initial);
    const chart = () => document.querySelector<HTMLElement>('[data-testid="chart"]')!;
    expect(chart().dataset.fillCount).toBe('1'); expect(chart().dataset.entry).toBe('10');
    expect(document.querySelectorAll('.vxg-account-rows article')).toHaveLength(1);
    // Render with a changed credential before its storage/session event is
    // delivered. Old state deliberately remains in memory for this assertion.
    credential = 'fixture-viewer-session';
    await flush(() => root.render(React.createElement(Terminal)));
    expect(pendingState).toHaveLength(0);
    expect(chart().dataset.fillCount).toBe('0'); expect(chart().dataset.entry).toBe('');
    expect(document.querySelector<HTMLElement>('[data-testid="quote-fills"]')!.dataset.fillCount).toBe('0');
    expect(document.querySelector('.vxg-active-asset')!.textContent).toContain('AAPLX');
    for (let tab = 0; tab < 4; tab++) {
      await flush(() => document.querySelectorAll<HTMLButtonElement>('.vxg-account-tabs button')[tab].click());
      expect(document.querySelectorAll('.vxg-account-rows article')).toHaveLength(0);
    }
    expect(document.querySelector('.vxg-wallets')!.textContent).not.toContain('137.42');
    expect(document.querySelector<HTMLInputElement>('.vxg-settings input')!.value).toBe('');
    await flush(() => listeners.forEach(listener => listener()));
    // Even accidental private fields in a viewer response cannot reopen rows.
    await flush(() => pendingState.shift()!({ ...initial, account: { ...initial.account, id: 'fixture-viewer', mode: 'viewer', canTrade: false } }));
    expect(document.querySelectorAll('.vxg-account-rows article')).toHaveLength(0);
    expect(chart().dataset.fillCount).toBe('0'); expect(writes).toHaveLength(0);
  });
});
