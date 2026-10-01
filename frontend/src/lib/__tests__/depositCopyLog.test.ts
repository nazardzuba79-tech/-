import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

/**
 * «Копировали адрес» on the client: one note per successful ADDRESS copy,
 * sent outside the dialog, bound to the account that copied, retried at most
 * once, and never in the way of the copy itself.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
const flush = () => new Promise<void>((done) => setImmediate(done));

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TRON_2 = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
const XRP = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const jwtFor = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub, sid: `s-${sub}` })).toString('base64url')}.sig`;

let dom: any;
let token: string | null;
let sessionListeners: Set<() => void>;
let calls: { url: string; init: any }[];
let respond: (call: { url: string; init: any }) => Promise<any>;
const modules = new Map<string, any>();
let mocks: Record<string, any> = {};

function load(file: string): any {
  for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix)) { file += suffix; break; }
  if (modules.has(file)) return modules.get(file);
  const exports: any = {}; modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8').replace(/import\.meta\.env/g, '({} as any)'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('exports', 'require', code)(exports, (name: string) => {
    if (name.endsWith('.css')) return {};
    for (const [suffix, value] of Object.entries(mocks)) if (name.endsWith(suffix)) return value;
    if (name.endsWith('/api')) return { API_BASE: '/api/v1', getToken: () => token, onSessionChange: (l: () => void) => { sessionListeners.add(l); return () => sessionListeners.delete(l); } };
    if (name.endsWith('/browserActivity')) return { browserFetch: (url: string, init: any) => { const call = { url, init }; calls.push(call); return respond(call); } };
    return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
  });
  return exports;
}
const logModule = () => load(resolve(frontend, 'src/lib/depositCopyLog'));
const outbox = () => JSON.parse(dom.window.localStorage.getItem('voltex.depositCopyOutbox.v1') ?? '[]');
const signIn = (sub: string | null) => { token = sub ? jwtFor(sub) : null; for (const l of [...sessionListeners]) l(); };
const ok = (status = 201) => Promise.resolve({ ok: status < 300, status, json: async () => ({}) });
const destination = (over: Record<string, unknown> = {}) => ({ asset: 'USDT', network: 'tron', destinationId: 'tether:tron', address: TRON, source: 'wallet', ...over });

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'https://voltextech.net/wallet' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  token = jwtFor(U1);
  sessionListeners = new Set();
  calls = [];
  respond = () => ok();
  mocks = {};
  modules.clear();
});
afterEach(() => { dom.window.close(); });

describe('the note after a successful address copy', () => {
  it('sends one keepalive POST with the session token and exactly the copied destination', async () => {
    const log = logModule();
    log.reportDepositAddressCopy(destination({ asset: 'XRP', network: 'xrp', destinationId: 'ripple:xrp', address: XRP, memo: '77', source: 'header' }), Date.parse('2026-10-01T07:24:18Z'));
    await flush();
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toBe('/api/v1/deposit-address-copies');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(init.headers.Authorization).toBe(`Bearer ${jwtFor(U1)}`);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ asset: 'XRP', network: 'xrp', destinationId: 'ripple:xrp', address: XRP, memo: '77', source: 'header', clientCopiedAt: '2026-10-01T07:24:18.000Z' });
    expect(body.eventId).toMatch(/^[0-9a-f-]{36}$/);
    // No user ID, email, amount or TXID leaves the browser, and nothing token-like is stored.
    expect(Object.keys(body).sort()).toEqual(['address', 'asset', 'clientCopiedAt', 'destinationId', 'eventId', 'memo', 'network', 'source']);
    expect(dom.window.localStorage.getItem('voltex.depositCopyOutbox.v1')).toBeNull();
  });

  it('a guest copies without any note', async () => {
    signIn(null);
    logModule().reportDepositAddressCopy(destination());
    await flush();
    expect(calls).toHaveLength(0);
  });

  it('a double press within 2 s is one note; a later copy of the same address is a new one', async () => {
    const log = logModule();
    const t = Date.parse('2026-10-01T07:00:00Z');
    log.reportDepositAddressCopy(destination(), t);
    log.reportDepositAddressCopy(destination(), t + 400);
    log.reportDepositAddressCopy(destination(), t + 1_900);
    log.reportDepositAddressCopy(destination({ address: TRON_2 }), t + 500);
    log.reportDepositAddressCopy(destination(), t + 2_100);
    await flush();
    expect(calls.map((c) => JSON.parse(c.init.body).address)).toEqual([TRON, TRON_2, TRON]);
    expect(new Set(calls.map((c) => JSON.parse(c.init.body).eventId)).size).toBe(3);
  });

  it('offline: kept, tried once more on the next return (same eventId, no keepalive), then dropped', async () => {
    const log = logModule();
    respond = () => Promise.reject(new TypeError('Failed to fetch'));
    log.reportDepositAddressCopy(destination());
    await flush();
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0].attempts).toBe(1);
    log.flushDepositCopyOutbox();
    await flush();
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1].init.body).eventId).toBe(JSON.parse(calls[0].init.body).eventId);
    expect(calls[1].init.keepalive).toBe(false);
    expect(outbox()).toHaveLength(0);
    log.flushDepositCopyOutbox();
    await flush();
    expect(calls).toHaveLength(2);
  });

  it('a 5xx is retried once; 401, 429 and 409 are not', async () => {
    const log = logModule();
    respond = () => ok(503);
    log.reportDepositAddressCopy(destination());
    await flush();
    respond = () => ok(200);
    log.flushDepositCopyOutbox();
    await flush();
    expect(calls).toHaveLength(2);
    expect(outbox()).toHaveLength(0);
    let at = Date.now();
    for (const status of [401, 429, 409]) {
      calls = [];
      respond = () => ok(status);
      at += 10_000;
      log.reportDepositAddressCopy(destination({ address: status === 401 ? TRON : TRON_2 }), at);
      await flush();
      log.flushDepositCopyOutbox();
      await flush();
      expect([status, calls.length]).toEqual([status, 1]);
      expect(outbox()).toHaveLength(0);
    }
  });

  it('a reload mid-send: the next app start tries the waiting note once', async () => {
    let log = logModule();
    respond = () => new Promise(() => {}); // the page unloads before the answer
    log.reportDepositAddressCopy(destination());
    await flush();
    expect(outbox()).toHaveLength(1);
    modules.clear();
    calls = [];
    respond = () => ok(200);
    log = logModule();
    log.startDepositCopyLog();
    await flush();
    expect(calls).toHaveLength(1);
    expect(outbox()).toHaveLength(0);
  });

  it('returning to the tab and the network coming back each try waiting notes; there is no timer', async () => {
    const log = logModule();
    const timers = jest.spyOn(globalThis, 'setTimeout');
    const intervals = jest.spyOn(globalThis, 'setInterval');
    log.startDepositCopyLog();
    respond = () => Promise.reject(new TypeError('offline'));
    log.reportDepositAddressCopy(destination());
    await flush();
    respond = () => ok();
    dom.window.dispatchEvent(new dom.window.Event('online'));
    await flush();
    expect(calls).toHaveLength(2);
    // Nothing is scheduled for later: no retry timer, no polling.
    expect(timers.mock.calls.every((call) => !call[1])).toBe(true);
    expect(intervals).not.toHaveBeenCalled();
    timers.mockRestore(); intervals.mockRestore();
  });

  it('a note is only ever sent with its own account; sign-out or switch deletes the outbox', async () => {
    const log = logModule();
    log.startDepositCopyLog();
    respond = () => Promise.reject(new TypeError('offline'));
    log.reportDepositAddressCopy(destination());
    await flush();
    expect(outbox()).toHaveLength(1);
    calls = [];
    respond = () => ok();
    signIn(U2);
    log.flushDepositCopyOutbox();
    await flush();
    expect(calls).toHaveLength(0);
    expect(outbox()).toHaveLength(0);

    // Sign-out, too.
    respond = () => Promise.reject(new TypeError('offline'));
    log.reportDepositAddressCopy(destination({ address: TRON_2 }));
    await flush();
    expect(outbox()).toHaveLength(1);
    signIn(null);
    expect(outbox()).toHaveLength(0);
  });

  it('another tab signing in as someone else: the waiting note is dropped before it is sent', async () => {
    const log = logModule();
    respond = () => Promise.reject(new TypeError('offline'));
    log.reportDepositAddressCopy(destination());
    await flush();
    calls = [];
    respond = () => ok();
    token = jwtFor(U2); // no listener ran in this tab yet
    log.flushDepositCopyOutbox();
    await flush();
    expect(calls).toHaveLength(0);
    expect(outbox()).toHaveLength(0);
  });

  it('works without localStorage (in-memory), and the outbox keeps at most 20 notes for 24 hours', async () => {
    const storage = dom.window.localStorage;
    const failing = new Proxy({}, { get: () => () => { throw new Error('SecurityError'); } });
    Object.defineProperty(globalThis, 'localStorage', { value: failing, configurable: true });
    const log = logModule();
    respond = () => Promise.reject(new TypeError('offline'));
    const t = Date.now() - 100_000;
    for (let i = 0; i < 25; i++) log.reportDepositAddressCopy(destination({ address: `T${String(i).padStart(33, 'A')}` }), t + i * 3_000);
    await flush();
    expect(calls).toHaveLength(25);
    calls = [];
    respond = () => ok();
    log.flushDepositCopyOutbox();
    await flush();
    expect(calls).toHaveLength(20);
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

    // 24 h: an old note is not sent.
    modules.clear(); calls = [];
    storage.setItem('voltex.depositCopyOutbox.v1', JSON.stringify([{ owner: U1, createdAt: Date.now() - 25 * 60 * 60_000, attempts: 1, body: { eventId: 'e', address: TRON } }]));
    logModule().flushDepositCopyOutbox();
    await flush();
    expect(calls).toHaveLength(0);
  });

  it('never throws into the copy, even when everything around it fails', () => {
    const log = logModule();
    respond = () => { throw new Error('boom'); };
    expect(() => log.reportDepositAddressCopy(destination())).not.toThrow();
  });
});

describe('the deposit dialog', () => {
  const wallets = [
    { chain: 'tether:tron', assets: ['USDT'], address: TRON, networkName: 'TRON', standard: 'TRC-20' },
    { chain: 'ripple:xrp', assets: ['XRP'], address: XRP, networkName: 'XRP Ledger', standard: 'Native', memo: '77', memoLabel: 'Destination tag' },
  ];
  let reports: any[];
  let clipboard: { writeText: jest.Mock };
  let host: HTMLElement;
  let root: any;

  async function mount(source?: string) {
    reports = [];
    mocks = {
      '/depositCopyLog': { reportDepositAddressCopy: (d: unknown) => reports.push(d) },
      '/i18n': { useLanguage: () => ({ lang: 'ru', t: (k: string) => ({ 'deposit.ui.copied': 'Адрес скопирован', 'deposit.ui.copyAddress': 'Скопировать адрес', 'deposit.ui.copyError': 'Не удалось скопировать', 'deposit.ui.copyMemo': 'Скопировать Memo', 'deposit.ui.memoCopied': 'Memo скопирован' } as Record<string, string>)[k] ?? k }), localeOf: () => 'ru-RU' },
      '/useDepositOptions': {
        useDepositWallets: () => ({ loaded: true, wallets, error: null }),
        useDepositSelection: (list: typeof wallets) => {
          const [asset, setAsset] = React.useState('USDT');
          const [, setChain] = React.useState('');
          const networks = list.filter((w) => w.assets.includes(asset));
          return { assets: ['USDT', 'XRP'], asset, setAsset, networks, wallet: networks[0] ?? null, setChain };
        },
      },
      '/CryptoIcon': { CryptoIcon: () => null },
      '/depositAssetMetadata': { depositAssetMetadata: {} },
      '/depositMinimum': { depositMinimumView: () => ({ pegged: true, usd: 300, estimate: null, estimateExpiresAt: null }) },
      '/marketDataStore': { marketDataStore: { getState: () => ({ tickers: new Map(), tickersMeta: null }) } },
      '/depositOrder': { orderDepositDestinations: (w: unknown) => w },
      qrcode: { default: { create: () => ({ modules: { size: 1, data: [1] } }) } },
    };
    clipboard = { writeText: jest.fn(async () => {}) };
    Object.defineProperty(dom.window.navigator, 'clipboard', { value: clipboard, configurable: true });
    Object.assign(globalThis, { navigator: dom.window.navigator });
    dom.window.matchMedia = () => ({ matches: true });
    Object.assign(globalThis, { matchMedia: dom.window.matchMedia, requestAnimationFrame: (f: () => void) => setTimeout(f, 0) });
    host = document.getElementById('root')!;
    root = req('react-dom/client').createRoot(host);
    const { DepositCatalogueDialog } = load(resolve(frontend, 'src/components/DepositCatalogueDialog'));
    await act(async () => { root.render(React.createElement(DepositCatalogueDialog, { onClose: () => {}, ...(source ? { source } : {}) })); await flush(); });
  }
  const button = (text: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
  async function pickAsset(symbol: string) {
    await act(async () => { (document.querySelector('.dc-asset-trigger') as HTMLButtonElement).click(); await flush(); });
    await act(async () => { (Array.from(document.querySelectorAll('[role="option"]')).find((b) => b.textContent?.includes(symbol)) as HTMLButtonElement).click(); await flush(); });
  }
  afterEach(async () => { await act(async () => root?.unmount()); });

  it('a successful address copy is noted once, with the copied rail and the dialog source', async () => {
    await mount('otc');
    await act(async () => { button('Скопировать адрес').click(); await flush(); });
    expect(clipboard.writeText).toHaveBeenCalledWith(TRON);
    expect(reports).toEqual([{ asset: 'USDT', network: 'tron', destinationId: 'tether:tron', address: TRON, memo: undefined, source: 'otc' }]);
    expect(document.body.textContent).toContain('Адрес скопирован');
  });

  it('a refused clipboard shows the copy error and notes nothing', async () => {
    await mount();
    clipboard.writeText.mockRejectedValueOnce(new Error('NotAllowedError'));
    await act(async () => { button('Скопировать адрес').click(); await flush(); });
    expect(reports).toEqual([]);
    expect(document.body.textContent).toContain('Не удалось скопировать');
  });

  it('Memo, QR and re-renders note nothing; the address of a memo rail carries its tag', async () => {
    await mount();
    await act(async () => { (document.querySelector('.dc-qr-button') as HTMLButtonElement).click(); await flush(); });
    await act(async () => { (document.querySelector('.dc-qr-button') as HTMLButtonElement).click(); await flush(); });
    expect(reports).toEqual([]);
    await pickAsset('XRP');
    expect(reports).toEqual([]);
    await act(async () => { button('Скопировать Memo').click(); await flush(); });
    expect(clipboard.writeText).toHaveBeenLastCalledWith('77');
    expect(reports).toEqual([]);
    await act(async () => { button('Скопировать адрес').click(); await flush(); });
    expect(reports).toEqual([{ asset: 'XRP', network: 'xrp', destinationId: 'ripple:xrp', address: XRP, memo: '77', source: 'header' }]);
  });

  it('a coin switched while the clipboard works: the note names what was copied', async () => {
    await mount();
    let finish!: () => void;
    clipboard.writeText.mockImplementationOnce(() => new Promise<void>((done) => { finish = done; }));
    await act(async () => { button('Скопировать адрес').click(); await flush(); });
    await pickAsset('XRP');
    await act(async () => { finish(); await flush(); });
    expect(reports).toEqual([{ asset: 'USDT', network: 'tron', destinationId: 'tether:tron', address: TRON, memo: undefined, source: 'header' }]);
    // The confirmation is not shown on the other coin.
    expect(document.body.textContent).not.toContain('Адрес скопирован');
  });
});
